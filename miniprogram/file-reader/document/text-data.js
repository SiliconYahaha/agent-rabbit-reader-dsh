'use strict'

const { decodeText, declaredEncoding, normalizeEncoding } = require('./kernel').textDecoder
const { mimeParametersOf } = require('../shared/file-types')

function decodeTextData (input, file, kind = 'text') {
  if (typeof input === 'string') return decodeText(input, { kind })
  const charsets = mimeParametersOf(file).filter(parameter => parameter.name === 'charset')
  const declared = declaredEncoding(input, { kind })
  if (!charsets.length || declared?.source === 'bom') {
    const decoded = decodeText(input, { kind })
    if (decoded.errors) throw new Error('文本包含无法解码的字节，请核对原文件编码或完整性')
    return decoded
  }
  if (charsets.some(parameter => !parameter.valid)) throw new Error('文本声明的字符编码参数不完整')
  const encodings = charsets.map(parameter => normalizeEncoding(parameter.value))
  if (encodings.some(encoding => encoding !== encodings[0])) throw new Error('文本声明了相互冲突的字符编码')
  const encoding = encodings[0]
  if (!['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'shift_jis', 'cp949', 'big5', 'windows-1252', 'latin1'].includes(encoding)) throw new Error('文本声明的字符编码暂不支持')
  const decoded = decodeText(input, { kind, encoding })
  if (decoded.errors) throw new Error('文本字节与声明的字符编码不匹配')
  return decoded
}

// Read-only presentation. Never parse JSON numbers into JS Number, merge keys,
// evaluate source code, or rewrite the author's file. Whitespace is the only
// change to JSON lexemes; CSV cells remain literal strings.
function boundedError (code) { const error = new Error(code); error.code = code; return error }
// 缩进只服务可读性。按真实深度线性增长时，深度 60、1 万个数字的 48 kB 输入会
// 放大成 1.2 MB 以上的桥接载荷，再嵌套深一点就越过 maxOutput，连缩进视图都保不住，
// 只能整体退回原文。超过 MAX_INDENT_DEPTH 后保持同一缩进，让载荷随内容增长而不是
// 随嵌套深度膨胀；JSON 词元与原文逐字不变。
const MAX_INDENT_DEPTH = 8
function formatJson (source, { maxChars = 200000, maxDepth = 64, maxOutput = 2 * 1024 * 1024 } = {}) {
  if (source.length > maxChars) throw boundedError('presentation-limit')
  let offset = 0, length = 0
  const out = []
  const write = text => { length += text.length; if (length > maxOutput) throw boundedError('presentation-limit'); out.push(text) }
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[offset] || '\0')) offset++ }
  const newline = depth => write('\n' + '  '.repeat(Math.min(depth, MAX_INDENT_DEPTH)))
  function string () {
    const start = offset++
    while (offset < source.length) {
      const char = source[offset++]
      if (char === '"') { write(source.slice(start, offset)); return }
      if (char.charCodeAt(0) < 32) throw boundedError('invalid-json')
      if (char === '\\') {
        const escape = source[offset++]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset, offset + 4))) throw boundedError('invalid-json')
          offset += 4
        } else if (!'"\\/bfnrt'.includes(escape || '\0')) throw boundedError('invalid-json')
      }
    }
    throw boundedError('invalid-json')
  }
  function value (depth) {
    if (depth > maxDepth) throw boundedError('presentation-limit')
    whitespace()
    const char = source[offset]
    if (char === '"') { string(); return }
    if (char === '{' || char === '[') {
      const object = char === '{', close = object ? '}' : ']'
      write(char); offset++; whitespace()
      if (source[offset] === close) { offset++; write(close); return }
      while (true) {
        newline(depth + 1); whitespace()
        if (object) {
          if (source[offset] !== '"') throw boundedError('invalid-json')
          string(); whitespace()
          if (source[offset++] !== ':') throw boundedError('invalid-json')
          write(': ')
        }
        value(depth + 1); whitespace()
        const end = source[offset++]
        if (end === close) { newline(depth); write(close); return }
        if (end !== ',') throw boundedError('invalid-json')
        write(',')
      }
    }
    const token = source.slice(offset).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)
    if (!token) throw boundedError('invalid-json')
    write(token[0]); offset += token[0].length
  }
  value(0); whitespace()
  if (offset !== source.length) throw boundedError('invalid-json')
  return out.join('')
}

function parseCsv (source, { maxChars = 200000, maxRows = 512, maxCells = 4096 } = {}) {
  if (source.length > maxChars) throw boundedError('presentation-limit')
  const rows = []
  let row = [], field = '', quoted = false, closed = false, touched = false, cells = 0
  const cell = () => { if (++cells > maxCells) throw boundedError('presentation-limit'); row.push(field); field = ''; closed = false }
  const record = () => {
    if (touched || row.length || field) cell()
    if (rows.length >= maxRows) throw boundedError('presentation-limit')
    rows.push(row); row = []; touched = false
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ }
        else { quoted = false; closed = true }
      } else field += char
    } else if (char === ',') { cell(); touched = true }
    else if (char === '\r' || char === '\n') { record(); if (char === '\r' && source[i + 1] === '\n') i++ }
    else if (char === '"' && !field && !closed) { quoted = true; touched = true }
    else {
      if (closed || char === '"') throw boundedError('invalid-csv')
      field += char; touched = true
    }
  }
  if (quoted) throw boundedError('invalid-csv')
  if (touched || row.length || field || closed) record()
  return rows
}

const escape = source => String(source).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pre = (source, id = '', monospace = true) => `<pre ${id ? `id="${id}"` : ''} style="margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;background:#fff;color:#263238;font-size:14px;line-height:1.65${monospace ? ';font-family:monospace' : ''}">${escape(source)}</pre>`
function renderTextData (source, { format = 'source', labels = {}, ...limits } = {}) {
  let formatted, diagnostic = '', rows
  if (format === 'json' || format === 'base') {
    try {
      const snapshot = require('./base-snapshot').renderSnapshot(source)
      if (snapshot) { formatted = snapshot.html; rows = { length: snapshot.rows }; format = 'base' }
    } catch (error) {
      formatted = `<p style="padding:18px">已识别压缩表格，但暂时无法展开：${escape(error.message)}。可查看原文。</p>`
      format = 'base'
    }
  }
  try {
    if (!formatted && format === 'json') formatted = pre(formatJson(source, limits))
    else if (!formatted && format === 'csv') {
      rows = parseCsv(source, limits)
      formatted = `<table style="border-collapse:collapse">${rows.map(row => `<tr>${(row.length ? row : ['']).map(cell => `<td style="padding:8px;border:1px solid #ddd;white-space:pre-wrap;min-width:100px">${escape(cell)}</td>`).join('')}</tr>`).join('')}</table>`
    }
  } catch (error) { diagnostic = error.code || 'presentation-error' }
  if (!formatted) return { html: pre(source, '', format !== 'text'), diagnostic, mode: 'source' }
  // Every piece of file content is escaped. Only this fixed UI handler runs in
  // the existing sandbox; author strings never enter executable script text.
  const html = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 18px;border-bottom:1px solid #e8e8e3;background:#fafaf7;color:#62645c;font-size:13px"><span>${format.toUpperCase()}</span><button id="text-data-toggle" style="margin:0;padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#45483a;font-size:13px;line-height:1.5">${escape(labels.original || '')}</button></div><div id="text-data-formatted">${formatted}</div><div id="text-data-original" style="display:none">${pre(source)}</div><script>
document.getElementById('text-data-toggle').addEventListener('click',function(){
 var a=document.getElementById('text-data-formatted'),b=document.getElementById('text-data-original');
 var raw=b.style.display==='none';a.style.display=raw?'none':'block';b.style.display=raw?'block':'none';
 this.textContent=raw?document.getElementById('text-data-label-formatted').textContent:document.getElementById('text-data-label-original').textContent;
});</script><span id="text-data-label-formatted" style="display:none">${escape(labels.formatted || '')}</span><span id="text-data-label-original" style="display:none">${escape(labels.original || '')}</span>`
  return { html, diagnostic, mode: format, rows: rows?.length }
}
module.exports = { MAX_INDENT_DEPTH, decodeTextData, formatJson, parseCsv, renderTextData }
