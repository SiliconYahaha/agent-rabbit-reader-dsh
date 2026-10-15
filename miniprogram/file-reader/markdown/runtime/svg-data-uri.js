'use strict'

// Markdown 分包不能同步 require 引擎分包，所以这里自带 UTF-8 → Base64 的两个纯函数，
// 只用于把 Mermaid 生成的 SVG 装进 <img src="data:…">。

function utf8Encode (value) {
  const bytes = []
  for (const char of String(value || '')) {
    const code = char.codePointAt(0)
    if (code <= 0x7f) bytes.push(code)
    else if (code <= 0x7ff) bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f)
    else if (code <= 0xffff) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f)
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f)
  }
  return bytes
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64 (bytes) {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0
    const triple = a << 16 | b << 8 | c
    output += ALPHABET[triple >> 18 & 63] + ALPHABET[triple >> 12 & 63]
    output += index + 1 < bytes.length ? ALPHABET[triple >> 6 & 63] : '='
    output += index + 2 < bytes.length ? ALPHABET[triple & 63] : '='
  }
  return output
}

function svgDataUri (svg) {
  return `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(svg))}`
}

module.exports = { bytesToBase64, svgDataUri, utf8Encode }
