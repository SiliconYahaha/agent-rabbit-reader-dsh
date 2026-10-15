'use strict'

// 内核共用的编码小函数：UTF-8 与 Base64 互转、setData 载荷字节数。
// 原先散在 html-runtime 与 view-payload 里；拆分包后内核（SVG data URI、诊断）与
// document 分包都要用，放内核由 kernel-exports 注入给各族。

function utf8Encode (value) {
  const bytes = []
  for (const char of String(value || '')) {
    const code = char.codePointAt(0)
    if (code <= 0x7f) bytes.push(code)
    else if (code <= 0x7ff) bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f)
    else if (code <= 0xffff) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f)
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f)
  }
  return new Uint8Array(bytes)
}

function utf8Decode (input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  let output = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first < 0x80) output += String.fromCodePoint(first)
    else if (first < 0xe0 && index < bytes.length) output += String.fromCodePoint((first & 31) << 6 | bytes[index++] & 63)
    else if (first < 0xf0 && index + 1 < bytes.length) output += String.fromCodePoint((first & 15) << 12 | (bytes[index++] & 63) << 6 | bytes[index++] & 63)
    else if (index + 2 < bytes.length) output += String.fromCodePoint((first & 7) << 18 | (bytes[index++] & 63) << 12 | (bytes[index++] & 63) << 6 | bytes[index++] & 63)
    else output += '\ufffd'
  }
  return output
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function btoaSafe (value) {
  const bytes = Array.from(String(value || ''), char => char.charCodeAt(0) & 255)
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    output += BASE64[a >> 2]
    output += BASE64[(a & 3) << 4 | (b == null ? 0 : b >> 4)]
    output += b == null ? '=' : BASE64[(b & 15) << 2 | (c == null ? 0 : c >> 6)]
    output += c == null ? '=' : BASE64[c & 63]
  }
  return output
}

function bytesToBase64 (bytes) {
  let binary = ''
  for (const byte of bytes || []) binary += String.fromCharCode(byte)
  return btoaSafe(binary)
}

function atobSafe (value) {
  const input = String(value || '').replace(/\s+/g, '').replace(/=+$/, '')
  let output = ''
  let buffer = 0
  let bits = 0
  for (const char of input) {
    if (!char) continue
    const valueIndex = BASE64.indexOf(char)
    if (valueIndex < 0) throw new Error('InvalidCharacterError')
    buffer = buffer << 6 | valueIndex
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode(buffer >> bits & 255)
    }
  }
  return output
}

function payloadBytes (value) {
  const text = JSON.stringify(value)
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index++
    } else bytes += 3
  }
  return bytes
}

module.exports = { atobSafe, btoaSafe, bytesToBase64, payloadBytes, utf8Decode, utf8Encode }
