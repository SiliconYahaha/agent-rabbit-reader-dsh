'use strict'

// ISO 10303-21 clauses 5.6, 13 and A.2: comments separate tokens;
// physical control characters are ignored, including inside tokens.
function normalizeStep (value) {
  const source = String(value).replace(/[\x00-\x1f\x7f]/g, '')
  const out = []
  let quote = '', chunkStart = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (!quote && c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw new Error('STEP 注释未结束')
      out.push(source.slice(chunkStart, i), ' '); i = end + 1; chunkStart = i + 1; continue
    }
    if (c === '\\') {
      if (quote === "'" && source[i + 1] === '\\') { i++; continue }
      if ((source[i + 1] === 'N' || source[i + 1] === 'F') && source[i + 2] === '\\') {
        out.push(source.slice(chunkStart, i), quote ? '' : ' ')
        i += 2; chunkStart = i + 1; continue
      }
    }
    if (quote) {
      if (c === quote) {
        if (quote === "'" && source[i + 1] === quote) { i++ } else quote = ''
      }
    } else if (c === "'" || c === '"') quote = c
  }
  if (quote) throw new Error('STEP 字符串未结束')
  out.push(source.slice(chunkStart))
  return out.join('')
}

function closingParen (source, open) {
  let depth = 1, quote = ''
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) {
        if (quote === "'" && source[i + 1] === quote) i++
        else quote = ''
      }
    } else if (c === "'" || c === '"') quote = c
    else if (c === '(') { if (++depth > 256) throw new Error('STEP 参数嵌套超过预览范围') }
    else if (c === ')' && --depth === 0) return i
  }
  throw new Error('STEP 实体参数未结束')
}

function simpleRecord (source) {
  const match = /^(!?[A-Z][A-Z0-9_]*)\s*\(/i.exec(source)
  if (!match) throw new Error('STEP 实体记录格式不完整')
  const open = match[0].length - 1, end = closingParen(source, open)
  return { type: match[1].toUpperCase(), body: source.slice(open + 1, end), end: end + 1 }
}

function canonicalId (id) { return id.replace(/^0+(?=\d)/, '') }

function readStepRecords (value) {
  const source = normalizeStep(value), records = [], complexRecords = [], header = Object.create(null), ids = new Set()
  let start = 0, quote = '', depth = 0, section = '', opened = false, ended = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) {
        if (quote === "'" && source[i + 1] === quote) i++
        else quote = ''
      }
      continue
    }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === '(') { if (++depth > 256) throw new Error('STEP 参数嵌套超过预览范围'); continue }
    if (c === ')') { if (--depth < 0) throw new Error('STEP 参数括号不匹配'); continue }
    if (c !== ';' || depth) continue
    const statement = source.slice(start, i).trim(); start = i + 1
    if (!opened) {
      if (statement.toUpperCase() !== 'ISO-10303-21') throw new Error('未找到 STEP ISO-10303-21 标识')
      opened = true; continue
    }
    if (statement.toUpperCase() === 'END-ISO-10303-21') {
      if (section) throw new Error('STEP 数据段未结束')
      ended = true; break
    }
    if (statement.toUpperCase() === 'ENDSEC') {
      if (!section) throw new Error('STEP 数据段边界不匹配')
      section = ''; continue
    }
    if (!section) {
      if (/^HEADER$/i.test(statement)) section = 'header'
      else if (/^DATA(?:\s*\(.*\))?$/i.test(statement)) section = 'data'
      else throw new Error('STEP 含有当前预览不支持的数据段')
      continue
    }
    if (section === 'header') {
      const record = simpleRecord(statement)
      if (statement.slice(record.end).trim()) throw new Error('STEP 头记录格式不完整')
      header[record.type] = record.body; continue
    }
    const match = /^#(\d+)\s*=\s*/.exec(statement)
    if (!match) throw new Error('STEP 数据实体格式不完整')
    const id = canonicalId(match[1]), body = statement.slice(match[0].length)
    if (ids.has(id)) throw new Error('STEP 实体编号重复')
    ids.add(id)
    if (body[0] !== '(') {
      const record = simpleRecord(body)
      if (body.slice(record.end).trim()) throw new Error('STEP 实体记录尾部无效')
      if (records.length >= 30000) throw new Error('STEP 实体数量超过预览范围')
      records.push({ id, type: record.type, body: record.body })
    } else {
      const end = closingParen(body, 0)
      if (body.slice(end + 1).trim()) throw new Error('STEP 复合实体尾部无效')
      const components = []; let cursor = 1
      while (cursor < end) {
        while (body[cursor] === ' ') cursor++
        if (cursor === end) break
        const record = simpleRecord(body.slice(cursor, end))
        components.push({ type: record.type, body: record.body }); cursor += record.end
      }
      if (!components.length) throw new Error('STEP 复合实体为空')
      if (complexRecords.length >= 5000) throw new Error('STEP 复合实体数量超过预览范围')
      complexRecords.push({ id, components })
    }
  }
  if (!opened || !ended || quote || depth) throw new Error('STEP 文件结构未结束')
  if (source.slice(start).trim()) throw new Error('STEP 结束标识之后含有未支持的内容')
  return { records, complexRecords, header }
}

function stepReferences (value) {
  const source = String(value || ''), refs = []; let quote = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) {
        if (quote === "'" && source[i + 1] === quote) i++
        else quote = ''
      }
    } else if (c === "'" || c === '"') quote = c
    else if (c === '#' && /\d/.test(source[i + 1] || '')) {
      let end = i + 2
      while (/\d/.test(source[end] || '')) end++
      refs.push(canonicalId(source.slice(i + 1, end))); i = end - 1
    }
  }
  return refs
}

module.exports = { readStepRecords, stepReferences }
