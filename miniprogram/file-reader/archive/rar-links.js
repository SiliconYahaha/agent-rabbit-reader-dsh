'use strict'

const { bounded, readRarHeaders, readVint } = require('./kernel').rarHeaders
const { crc32 } = require('./kernel').archiveMembers
const { cp437High: CP437_HIGH } = require('./kernel').legacyCjkData
const { decodeBig5, decodeCp949, decodeGb18030, decodeShiftJis, decodeUtf8 } = require('./kernel').textDecoder

const MAX_LINK_BYTES = 4096
const LEGACY_ENCODINGS = ['auto', 'utf-8', 'cp437', 'gb18030', 'shift_jis', 'cp949', 'big5']

function decodeCp437 (bytes) {
  let text = ''
  for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] || '�')
  return { text, errors: 0 }
}

function decodeLegacyText (bytes, encoding = 'auto') {
  const selected = LEGACY_ENCODINGS.includes(encoding) ? encoding : 'auto'
  const utf8 = decodeUtf8(bytes)
  let decoded
  if (selected === 'auto') decoded = utf8.errors ? decodeCp437(bytes) : utf8
  else if (selected === 'utf-8') decoded = utf8
  else if (selected === 'cp437') decoded = decodeCp437(bytes)
  else if (selected === 'gb18030') decoded = decodeGb18030(bytes)
  else if (selected === 'shift_jis') decoded = decodeShiftJis(bytes)
  else if (selected === 'cp949') decoded = decodeCp949(bytes)
  else decoded = decodeBig5(bytes)
  if (decoded.errors) throw new Error('RAR 旧式路径与所选字符编码不匹配')
  return decoded.text
}

function linkText (bytes, options = {}) {
  if (!bytes.length || bytes.length > MAX_LINK_BYTES) throw new Error('RAR 链接目标为空或超过长度上限')
  if (options.rarVersion === 4) return decodeLegacyText(bytes, options.legacyEncoding)
  const decoded = decodeUtf8(bytes)
  if (decoded.errors) throw new Error('RAR 链接目标编码无法可靠识别')
  return decoded.text
}

// Read link metadata only. Never create a filesystem link or trust a native
// filesystem to resolve it. Header CRCs and record-local bounds are mandatory.
function readRarLinks (bytes, options = {}) {
  const records = []
  for (const block of readRarHeaders(bytes, { sfx: true })) {
    const file = block.file
    if (!file) continue
    const record = { isLink: file.isLink, rarVersion: block.version }
    if (block.version === 4) {
      if (!(block.flags & 0x200)) {
        const rawName = bytes.subarray(file.nameStart, file.nameStart + file.nameSize)
        record.name = decodeLegacyText(rawName, options.legacyEncoding)
        record.legacyEncodingAmbiguous = rawName.some(byte => byte >= 0x80)
      }
      if (file.isLink && !file.encrypted && !file.split && file.method === 0x30) {
        const payload = bytes.subarray(block.end, block.end + block.dataSize)
        if (payload.length > MAX_LINK_BYTES) throw new Error('RAR 链接目标超过长度上限')
        if (crc32(payload) !== file.crc) throw new Error('RAR 链接目标 CRC 校验失败')
        record.linkTarget = linkText(payload, { rarVersion: 4, legacyEncoding: options.legacyEncoding })
        record.legacyEncodingAmbiguous = record.legacyEncodingAmbiguous || payload.some(byte => byte >= 0x80)
        record.linkType = 1
      }
    } else {
      for (const extra of file.extras) {
        if (extra.type !== 5) continue
        const cursor = { pos: extra.start }
        record.linkType = readVint(bytes, cursor, extra.end)
        record.linkDirectory = Boolean(readVint(bytes, cursor, extra.end) & 1)
        const length = readVint(bytes, cursor, extra.end)
        bounded(cursor.pos, length, extra.end)
        record.linkTarget = linkText(bytes.subarray(cursor.pos, cursor.pos + length), { rarVersion: 5 })
      }
    }
    records.push(record)
  }
  return records
}

function packagePath (value, parent = '') {
  const text = String(value || '').replace(/\\/g, '/')
  if (!text || text.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(text) || /[\x00-\x1f\x7f]/.test(text)) throw new Error('RAR 链接路径不安全，已拒绝访问包外内容')
  const parts = parent ? parent.split('/').filter(Boolean) : []
  for (const part of text.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('RAR 链接目标超出压缩包范围')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

module.exports = { LEGACY_ENCODINGS, MAX_LINK_BYTES, decodeLegacyText, linkText, packagePath, readRarLinks }
