'use strict'

const { crc32 } = require('./archive-members')

function bounded (start, size, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || size > end - start) throw new Error('RAR 头部或文件数据长度越界，文件可能已截断')
}

function readVint (bytes, cursor, end) {
  let value = 0
  let factor = 1
  for (let i = 0; i < 10; i++) {
    bounded(cursor.pos, 1, end)
    const byte = bytes[cursor.pos++]
    value += (byte & 127) * factor
    if (!Number.isSafeInteger(value)) throw new Error('RAR 头部整数超过安全范围')
    if (!(byte & 128)) return value
    factor *= 128
  }
  throw new Error('RAR 头部整数过长')
}

// Shared by native link metadata and the stored-file fallback. Never return a
// partial directory after a bad header. Encrypted headers and end markers stop
// scanning; legacy archives without an end marker remain readable.
function * readRarHeaders (bytes, options = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let signature = -1
  const limit = options.sfx ? Math.min(bytes.length, 1024 * 1024 + 8) : Math.min(bytes.length, 8)
  for (let i = 0; i + 7 <= limit; i++) {
    if (bytes[i] === 0x52 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x72 && bytes[i + 3] === 0x21 && bytes[i + 4] === 0x1a && bytes[i + 5] === 7 && (bytes[i + 6] === 0 || (i + 8 <= bytes.length && bytes[i + 6] === 1 && bytes[i + 7] === 0))) { signature = i; break }
  }
  if (signature < 0) return
  const version = bytes[signature + 6] === 1 ? 5 : 4
  let offset = signature + (version === 5 ? 8 : 7)
  while (offset < bytes.length) {
    let block
    if (version === 4) {
      bounded(offset, 7, bytes.length)
      const type = bytes[offset + 2]
      const flags = view.getUint16(offset + 3, true)
      const size = view.getUint16(offset + 5, true)
      if (size < 7) throw new Error('RAR 头部长度无效')
      bounded(offset, size, bytes.length)
      const end = offset + size
      if ((crc32(bytes.subarray(offset + 2, end)) & 0xffff) !== view.getUint16(offset, true)) throw new Error('RAR 头部 CRC 校验失败')
      if (type === 0x7b || (type === 0x73 && (flags & 0x80))) return
      if (flags & 0x8000) bounded(offset, 11, end)
      let dataSize = flags & 0x8000 ? view.getUint32(offset + 7, true) : 0
      block = { version, type, flags, end }
      if (type === 0x74) {
        bounded(offset, 32, end)
        dataSize = view.getUint32(offset + 7, true)
        let unpacked = view.getUint32(offset + 11, true)
        const large = Boolean(flags & 0x100)
        if (large) {
          bounded(offset, 40, end)
          dataSize += view.getUint32(offset + 32, true) * 0x100000000
          unpacked += view.getUint32(offset + 36, true) * 0x100000000
        }
        if (!Number.isSafeInteger(unpacked)) throw new Error('RAR 文件大小超过安全范围')
        const nameStart = offset + (large ? 40 : 32)
        const nameSize = view.getUint16(offset + 26, true)
        bounded(nameStart, nameSize, end)
        const attributes = view.getUint32(offset + 28, true)
        const host = bytes[offset + 15]
        block.file = { nameStart, nameSize, unpacked, attributes, host, crc: view.getUint32(offset + 16, true), method: bytes[offset + 25], fileFlags: flags, encrypted: Boolean(flags & 4), split: Boolean(flags & 3), directory: (flags & 0xe0) === 0xe0, isLink: host === 3 && (attributes & 0xf000) === 0xa000, extras: [] }
      }
      block.dataSize = dataSize
    } else {
      bounded(offset, 5, bytes.length)
      const cursor = { pos: offset + 4 }
      const size = readVint(bytes, cursor, Math.min(offset + 7, bytes.length))
      bounded(cursor.pos, size, bytes.length)
      const end = cursor.pos + size
      if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(offset, true)) throw new Error('RAR 头部 CRC 校验失败')
      const type = readVint(bytes, cursor, end)
      const flags = readVint(bytes, cursor, end)
      const extraSize = flags & 1 ? readVint(bytes, cursor, end) : 0
      const dataSize = flags & 2 ? readVint(bytes, cursor, end) : 0
      bounded(cursor.pos, extraSize, end)
      if (type === 4 || type === 5) return
      const extraStart = end - extraSize
      block = { version, type, flags, end, dataSize }
      if (type === 2) {
        const fileFlags = readVint(bytes, cursor, extraStart)
        const unpacked = readVint(bytes, cursor, extraStart)
        const attributes = readVint(bytes, cursor, extraStart)
        if (fileFlags & 2) { bounded(cursor.pos, 4, extraStart); cursor.pos += 4 }
        let crc = null // absent is distinct from the valid checksum 0
        if (fileFlags & 4) { bounded(cursor.pos, 4, extraStart); crc = view.getUint32(cursor.pos, true); cursor.pos += 4 }
        const compression = readVint(bytes, cursor, extraStart)
        const host = readVint(bytes, cursor, extraStart)
        const nameSize = readVint(bytes, cursor, extraStart)
        const nameStart = cursor.pos
        bounded(nameStart, nameSize, extraStart)
        block.file = { nameStart, nameSize, unpacked, attributes, host, crc, method: (compression & 0x380) >> 7, fileFlags, encrypted: false, split: Boolean(flags & 0x18), unknownSize: Boolean(fileFlags & 8), directory: Boolean(fileFlags & 1), isLink: false, extras: [] }
      }
      cursor.pos = extraStart
      while (cursor.pos < end) {
        const recordSize = readVint(bytes, cursor, end)
        bounded(cursor.pos, recordSize, end)
        const recordEnd = cursor.pos + recordSize
        const recordType = readVint(bytes, cursor, recordEnd)
        if (block.file) {
          block.file.extras.push({ type: recordType, start: cursor.pos, end: recordEnd })
          if (recordType === 1) block.file.encrypted = true
          if (recordType === 5) block.file.isLink = true
        }
        cursor.pos = recordEnd
      }
    }
    bounded(block.end, block.dataSize, bytes.length)
    yield block
    offset = block.end + block.dataSize
  }
}

module.exports = { bounded, readRarHeaders, readVint }
