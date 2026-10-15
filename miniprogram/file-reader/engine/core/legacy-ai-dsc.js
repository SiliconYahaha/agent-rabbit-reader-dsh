'use strict'

const { skipPostScriptString } = require('./legacy-ai-lexical')

// DSC counts bytes after the complete BeginData/BeginBinary physical line.
// The caller supplies a Latin-1 string, so offsets are original byte offsets.
function scanLegacyDsc (source) {
  let position = 0, depth = 0, blocks = 0, codeStart = 0
  const code = [], boxes = {}, previews = []
  function line () {
    if (position >= source.length) return null
    const start = position
    while (position < source.length && source[position] !== '\r' && source[position] !== '\n') position++
    const text = source.slice(start, position)
    if (position < source.length) {
      const first = source[position++]
      if ((first === '\r' && source[position] === '\n') || (first === '\n' && source[position] === '\r')) position++
    }
    return { text, start, end: position, physicalStart: start === 0 || /[\r\n]/.test(source[start - 1]) }
  }
  function omit (start, end) {
    if (++blocks > 10000) throw new Error('Ai DSC 数据段数量超过本机保护范围')
    code.push(source.slice(codeStart, start), '\n')
    codeStart = end
  }
  let item
  while ((item = line())) {
    const text = item.text
    if (!item.physicalStart || !text.startsWith('%')) {
      // A string can span many physical lines. Skip it without interpreting
      // its bytes as DSC, then resume at the true position on its last line.
      for (let i = item.start; i < item.end;) {
        if (source[i] === '%') break
        if (source[i] === '<' && source[i + 1] === '<') { i += 2; continue }
        const end = skipPostScriptString(source, i)
        if (end != null) { i = end; position = Math.max(position, end) }
        else i++
      }
      continue
    }
    if (/^%%Begin(?:Data|Binary):/.test(text)) {
      const binary = text.startsWith('%%BeginBinary:')
      const match = binary
        ? /^%%BeginBinary:[ \t]*(\d+)[ \t]*$/.exec(text)
        : /^%%BeginData:[ \t]*(\d+)(?:[ \t]+(Hex|Binary|ASCII)(?:[ \t]+(Bytes|Lines))?)?[ \t]*$/.exec(text)
      if (!match) throw new Error('Ai DSC 数据段声明无效')
      const count = Number(match[1])
      if (!Number.isSafeInteger(count) || count > source.length - position) throw new Error('Ai DSC 数据段长度超过文件范围')
      if (!binary && match[3] === 'Lines') {
        for (let i = 0; i < count; i++) if (!line()) throw new Error('Ai DSC 数据段行数不完整')
      } else position += count
      const end = line(), marker = binary ? 'EndBinary' : 'EndData'
      if (!end || !new RegExp('^%%' + marker + '[ \\t]*$').test(end.text)) throw new Error('Ai DSC 数据段结束标记不匹配')
      omit(item.start, position)
      continue
    }
    if (text.startsWith('%%BeginPreview:')) {
      if (depth === 0) previews.push(item.start)
      if (previews.length > 10000) throw new Error('Ai 预览段数量超过本机保护范围')
      let end
      while ((end = line()) && !/^%%EndPreview[ \t]*$/.test(end.text)) {}
      if (!end) throw new Error('Ai 位图预览缺少结束标记')
      omit(item.start, position)
      continue
    }
    if (/^%%BeginDocument:/.test(text)) {
      if (++depth > 64) throw new Error('Ai 嵌套文档层数超过本机保护范围')
      continue
    }
    if (/^%%EndDocument[ \t]*$/.test(text)) {
      if (!depth) throw new Error('Ai 嵌套文档结束标记不匹配')
      depth--
      continue
    }
    if (!depth) {
      const box = /^%%(HiResBoundingBox|BoundingBox):[ \t]*(-?\d+(?:\.\d+)?)[ \t]+(-?\d+(?:\.\d+)?)[ \t]+(-?\d+(?:\.\d+)?)[ \t]+(-?\d+(?:\.\d+)?)[ \t]*$/.exec(text)
      if (box && !boxes[box[1]]) {
        const values = box.slice(2).map(Number)
        if (values.every(Number.isFinite) && values[2] > values[0] && values[3] > values[1]) boxes[box[1]] = values
      }
      if (/^%%EOF[ \t]*$/.test(text)) {
        code.push(source.slice(codeStart, item.start))
        codeStart = source.length
        break
      }
    }
  }
  if (depth) throw new Error('Ai 嵌套文档缺少结束标记')
  code.push(source.slice(codeStart))
  return { code: code.join(''), boundingBox: boxes.HiResBoundingBox || boxes.BoundingBox || null, previewOffset: previews.length ? previews[0] : null }
}

module.exports = { scanLegacyDsc }
