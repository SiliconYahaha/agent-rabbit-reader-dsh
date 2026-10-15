'use strict'

// Independent fixture writer: Node's native DEFLATE, explicit ZIP records.
// Never use the product's decompressor to create expected payloads.
const zlib = require('node:zlib')
const { crc32 } = require('./archive-duplicates')

function zipMember (options = {}) {
  const content = Buffer.from(options.content || '')
  const name = Buffer.from(options.name || '正文.txt')
  const method = options.method == null ? 8 : options.method
  const packed = options.packed || (method === 0 ? content : zlib.deflateRawSync(content, options.zlib))
  const crc = options.crc == null ? crc32(content) : options.crc
  const size = options.size == null ? content.length : options.size
  const descriptor = options.descriptor || false
  const flags = 0x800 | (descriptor ? 8 : 0)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8)
  if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(size, 22) }
  local.writeUInt16LE(name.length, 26); name.copy(local, 30)
  const dd = Buffer.alloc(descriptor === 'signed' ? 16 : descriptor ? 12 : 0)
  if (descriptor) {
    const at = descriptor === 'signed' ? 4 : 0
    if (at) dd.writeUInt32LE(0x08074b50)
    dd.writeUInt32LE(crc, at); dd.writeUInt32LE(packed.length, at + 4); dd.writeUInt32LE(size, at + 8)
  }
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(size, 24)
  central.writeUInt16LE(name.length, 28); name.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length + packed.length + dd.length, 16)
  return Buffer.concat([local, packed, dd, central, eocd])
}

const cases = Array.from({ length: 60 }, (_, n) => ({
  name: `case-${n}`, content: Buffer.from(('第' + n + '份真实正文，A/B/C 中文 😀\n').repeat(n + 1)),
  method: n % 2 ? 8 : 0, descriptor: [false, 'signed', 'unsigned'][n % 3],
  zlib: { level: n % 10, strategy: [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY][n % 3] }
}))

module.exports = { zipMember, cases }
