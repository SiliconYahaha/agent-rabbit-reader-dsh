'use strict'

// 引擎里"用户可见文案"的位置扫描：供 codemod（一次性）与 gen-skin-messages（清单）共用。
// 约定：引擎写 skinCopy.message('<code>', { 参数 }, '<默认文案>')，code 由分类 + 默认文案哈希得出，
// 文案一改 code 就变，宿主的覆盖要跟着复核；清单在 miniprogram/file-reader/MESSAGES.md。
const crypto = require('node:crypto')

const ENGINE_FILES = [
  'miniprogram/file-reader/engine/components/reader/reader.js',
  'miniprogram/file-reader/engine/components/design-preview/design-preview.js',
  'miniprogram/file-reader/engine/core/file-inspector.js'
]
const FILE_PREFIX = { 'reader.js': 'reader', 'design-preview.js': 'design', 'file-inspector.js': 'inspector' }
const KIND_BY_KEY = {
  'stopLoadingWithError(': 'error', 'error: ': 'error', 'nativeStatus: ': 'status', 'mediaDiagnostic: ': 'media',
  'inspectorPasswordStatus: ': 'password', 'inspectorModelStatus: ': 'model', 'message: ': 'message', 'loadingDetail: ': 'loading',
  'title: ': 'title', 'summary: ': 'summary', 'label: ': 'label'
}

function hash6 (text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 6)
}

// 把模板字面量拆成静态文本 + ${} 表达式列表；参数名按表达式猜（error→detail，.name→name，.length→count）
function splitTemplate (literal) {
  const body = literal.slice(1, -1)
  const parts = []
  const expressions = []
  let index = 0
  let text = ''
  while (index < body.length) {
    if (body[index] === '$' && body[index + 1] === '{') {
      let depth = 1; let cursor = index + 2
      while (cursor < body.length && depth > 0) { if (body[cursor] === '{') depth++; else if (body[cursor] === '}') depth--; cursor++ }
      const expression = body.slice(index + 2, cursor - 1)
      const name = paramName(expression, expressions.map(item => item.name))
      expressions.push({ name, expression })
      text += `{${name}}`
      index = cursor
    } else { text += body[index]; index++ }
  }
  parts.push(text)
  return { text, expressions }
}

function paramName (expression, taken) {
  let base = 'value'
  if (/error|Error|errMsg|reason|message|detail/.test(expression)) base = 'detail'
  else if (/\.name\b|Name\b|mainName/.test(expression)) base = 'name'
  else if (/\.length\b|reduce\(|count/i.test(expression)) base = 'count'
  else if (/formatBytes|Bytes|size/i.test(expression)) base = 'size'
  else if (/label/i.test(expression)) base = 'label'
  let name = base; let n = 2
  while (taken.includes(name)) name = `${base}${n++}`
  return name
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'with'])

function enclosingName (lines, lineIndex) {
  for (let i = lineIndex; i >= 0; i--) {
    const method = lines[i].match(/^    (?:async )?([A-Za-z_]\w*) \([^)]*\) \{$/)
    if (method && !KEYWORDS.has(method[1])) return method[1]
    const fn = lines[i].match(/^(?:async )?function ([A-Za-z_]\w*)/)
    if (fn) return fn[1]
  }
  return 'module'
}

// 从 line[start]（' 或 `）读到字面量结束，模板字符串里的 ${ } 与嵌套模板都算在内；返回结束位置（含）
function readLiteral (line, start) {
  const quote = line[start]
  if (quote === "'" || quote === '"') {
    for (let i = start + 1; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue }
      if (line[i] === quote) return i
    }
    return -1
  }
  let i = start + 1
  const stack = [] // 记录 ${ 的层级；遇到嵌套模板压入 'tpl'
  while (i < line.length) {
    const char = line[i]
    if (char === '\\') { i += 2; continue }
    if (stack.length === 0 || stack[stack.length - 1] === 'tpl') {
      if (char === '`') { if (stack.length === 0) return i; stack.pop(); i++; continue }
      if (char === '$' && line[i + 1] === '{') { stack.push('expr'); i += 2; continue }
      i++; continue
    }
    // 在 ${ } 表达式里
    if (char === '`') { stack.push('tpl'); i++; continue }
    if (char === '{') { stack.push('brace'); i++; continue }
    if (char === '}') { const top = stack.pop(); if (top !== 'expr' && top !== 'brace') return -1; i++; continue }
    if (char === "'" || char === '"') { const end = readLiteral(line, i); if (end < 0) return -1; i = end + 1; continue }
    i++
  }
  return -1
}

// 找出一行里所有 key + 字面量 的位置
function findSites (line, keys) {
  const sites = []
  for (const key of keys) {
    let from = 0
    while (true) {
      const at = line.indexOf(key, from)
      if (at < 0) break
      const start = at + key.length
      const quote = line[start]
      if (quote === "'" || quote === '`') {
        const end = readLiteral(line, start)
        if (end > start) sites.push({ key, start: at, literalStart: start, end })
      }
      from = at + key.length
    }
  }
  return sites.sort((a, b) => a.start - b.start)
}

module.exports = { ENGINE_FILES, FILE_PREFIX, KIND_BY_KEY, enclosingName, findSites, hash6, readLiteral, splitTemplate }
