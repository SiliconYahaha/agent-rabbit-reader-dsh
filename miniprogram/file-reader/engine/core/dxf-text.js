'use strict'
const { toUint8, decodeText, normalizeEncoding } = require('./text-decoder')
const { singleByteHigh, cp437High } = require('./vendor/legacy-cjk-data')
const ENCODINGS = new Set(['utf-8', 'gb18030', 'shift_jis', 'cp949', 'big5', 'windows-1252'])

function headerEncoding (bytes) {
  let cursor = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  let sectionExpected = false, variable = '', version = '', codepage = ''
  function line () {
    let start = cursor
    while (cursor < bytes.length && bytes[cursor] !== 10 && bytes[cursor] !== 13) cursor++
    let end = cursor
    const first = bytes[cursor++]
    if (first === 13 && bytes[cursor] === 10) cursor++
    // Header variable names/encoding declarations are ASCII and short. Skip
    // unrelated long comment/data lines without copying their whole contents.
    while (start < end && (bytes[start] === 32 || bytes[start] === 9)) start++
    while (end > start && (bytes[end - 1] === 32 || bytes[end - 1] === 9)) end--
    return end - start <= 128 ? String.fromCharCode.apply(null, bytes.subarray(start, end)) : null
  }
  while (cursor < bytes.length) {
    const rawCode = line(), value = line()
    const code = /^[+-]?\d+$/.test(rawCode) ? String(Number(rawCode)) : rawCode
    if (code === '0') {
      if (value === 'SECTION') { sectionExpected = true; continue }
      break
    }
    if (sectionExpected) {
      if (code !== '2' || value !== 'HEADER') break
      sectionExpected = false
      continue
    }
    if (code === '9') { variable = value; continue }
    if (value == null && (variable === '$ACADVER' || variable === '$DWGCODEPAGE')) throw new Error('DXF 版本或编码声明无效')
    if (variable === '$ACADVER' && code === '1') version = value
    else if (variable === '$DWGCODEPAGE' && code === '3') codepage = value
    variable = ''
  }
  if (/^AC\d{4}$/.test(version) && Number(version.slice(2)) >= 1021) return 'utf-8'
  if (codepage) return codepage
  // Preserve the existing UTF-8 path for headerless snippets. Declared older
  // drawings default to ANSI1252, as the DXF header's codepage default specifies.
  return /^AC\d{4}$/.test(version) ? 'ANSI_1252' : 'utf-8'
}

function decodeDxfText (input) {
  const bytes = toUint8(input)
  if (String.fromCharCode.apply(null, bytes.subarray(0, 22)).startsWith('AutoCAD Binary DXF')) throw new Error('暂不支持二进制 DXF，请另存为文本 DXF')
  const declared = headerEncoding(bytes)
  const cp = /^ANSI_(\d+)$/i.exec(declared)
  const encoding = normalizeEncoding(cp ? 'cp' + cp[1] : declared)
  const table = cp && (singleByteHigh[cp[1]] || (cp[1] === '437' ? cp437High : null))
  if (table) {
    const chunks = []
    for (let i = 0; i < bytes.length; i += 8192) {
      const text = Array.from(bytes.subarray(i, i + 8192), b => b < 128 ? String.fromCharCode(b) : table[b - 128]).join('')
      if (text.includes('\ufffd')) throw new Error('DXF 字节与声明的代码页不匹配')
      chunks.push(text)
    }
    return chunks.join('')
  }
  if (!ENCODINGS.has(encoding)) {
    if (bytes.some(b => b > 127)) throw new Error('DXF 暂不支持声明的字符编码')
    return decodeText(bytes, { encoding: 'utf-8' }).text
  }
  const result = decodeText(bytes, { encoding })
  if (result.errors) throw new Error('DXF 字节与声明的字符编码不匹配或文件不完整')
  return result.text
}

function decodeDxfValue (code, value) {
  const n = Number(code)
  const isString = n >= 0 && n <= 9 || n >= 100 && n <= 102 || n >= 300 && n <= 309 || n >= 410 && n <= 419 || n >= 430 && n <= 439 || n >= 470 && n <= 479 || n >= 999 && n <= 1003
  // Decode only inside an already separated physical value. An escaped newline
  // is text and cannot create a new group code, section or entity.
  if (!isString) return value
  const text = value.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return validateDxfString(text)
}

function validateDxfString (text) {
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    if (char < 32 && ![9, 10, 13].includes(char) || char === 0xfffe || char === 0xffff) throw new Error('DXF 文字包含无法显示的控制字符')
    if (char >= 0xd800 && char <= 0xdbff) {
      const low = text.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error('DXF Unicode 转义不是完整字符')
    } else if (char >= 0xdc00 && char <= 0xdfff) throw new Error('DXF Unicode 转义不是完整字符')
  }
  return text
}

module.exports = { decodeDxfText, decodeDxfValue, validateDxfString }
