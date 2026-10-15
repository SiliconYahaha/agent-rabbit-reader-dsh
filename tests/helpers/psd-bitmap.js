'use strict'
const zlib = require('node:zlib')
function number (value, length) { const b = Buffer.alloc(length); if (length === 8) b.writeBigUInt64BE(BigInt(value)); else b.writeUIntBE(value, 0, length); return b }
function bitmapFixture ({ version = 1, width = 9, height = 3, compression = 0, packed, tail = false } = {}) {
  const stride = Math.ceil(width / 8)
  const raw = packed || Buffer.from(Array.from({ length: stride * height }, (_, i) => Math.floor(i / stride) === 0 ? 0 : Math.floor(i / stride) === 1 ? 255 : i % stride % 2 ? 0x55 : 0xaa))
  if (raw.length !== stride * height) throw Error('packed row length mismatch')
  const header = Buffer.alloc(26)
  header.write('8BPS'); header.writeUInt16BE(version, 4); header.writeUInt16BE(1, 12)
  header.writeUInt32BE(height, 14); header.writeUInt32BE(width, 18); header.writeUInt16BE(1, 22)
  let data = raw
  if (compression === 1) {
    const rows = []
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * stride, (y + 1) * stride), chunks = []
      for (let i = 0; i < row.length; i += 128) {
        const chunk = row.subarray(i, i + 128)
        if (tail && chunk.length > 1 && chunk.every(x => x === chunk[0])) chunks.push(Buffer.from([257 - chunk.length, chunk[0]]))
        else chunks.push(Buffer.from([chunk.length - 1]), chunk)
      }
      if (tail) chunks.push(Buffer.from([128]))
      rows.push(Buffer.concat(chunks))
    }
    data = Buffer.concat([...rows.map(r => number(r.length, version === 2 ? 4 : 2)), ...rows])
  } else if (compression >= 2) data = zlib.deflateSync(raw)
  return Buffer.concat([header, number(0, 4), number(0, 4), number(0, version === 2 ? 8 : 4), number(compression, 2), data])
}
function cases () {
  const inputs = []
  for (const version of [1, 2]) for (const width of [1, 7, 8, 9, 17, 31, 1023, 1024, 1025, 1031]) for (const compression of [0, 1, 2]) {
    const large = width > 1000, height = large ? 5 : 3, stride = Math.ceil(width / 8)
    // Deterministic byte-position pattern; high/low bits and nonzero padding
    // deliberately vary across rows and the PackBits 128-byte boundary.
    const packed = large ? Buffer.from(Array.from({length: stride * height}, (_, i) => {
      const y = Math.floor(i / stride), x = i % stride
      return y === 0 ? 0 : y === 1 ? 255 : y === 2 ? (x % 2 ? 0x55 : 0xaa) : (x * 73 + y * 41 + (x >> 3) * 19) & 255
    })) : undefined
    inputs.push({ name: `bitmap-v${version}-w${width}-c${compression}`, version, width, height, compression,
      bytes: bitmapFixture({version, width, height, compression, packed, tail: large}) })
  }
  const discovery = require('../../compatibility/runs/2026-09-05-next-psd-bitmap.json')
  for (const r of discovery.audit.magickProducer.results) inputs.push({name: `magick-export-${r.label}`, width:9, height:3, compression:r.mergedCompression, version:1, bytes:Buffer.from(r.sourceBase64,'base64')})
  return inputs
}
module.exports = { bitmapFixture, cases }
