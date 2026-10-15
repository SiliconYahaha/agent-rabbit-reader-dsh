'use strict'
const { deflateSync } = require('node:zlib')
const { sparseMember, archive } = require('./tar-sparse')

function imageFixture () {
  const width = 64, height = 48, pixels = Buffer.alloc(width * height * 4), raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = y >= 8 && y < 40 && x >= 8 && x < 56 ? (x < 24 ? [255, 0, 0] : x < 40 ? [0, 255, 0] : [0, 0, 255]) : [0, 0, 0]
    raw.set(color, y * (width * 3 + 1) + 1 + x * 3)
    pixels.set([...color, 255], (y * width + x) * 4)
  }
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  // Stored DEFLATE preserves long zero pixel runs, which TAR omits as holes.
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))])
  const blocks = []
  let start = 0
  for (let i = 0; i < png.length;) {
    if (png[i] !== 0) { i++; continue }
    const hole = i
    while (i < png.length && png[i] === 0) i++
    if (i - hole < 8) continue
    if (hole > start) blocks.push([start, png.subarray(start, hole)])
    start = i
  }
  if (start < png.length) blocks.push([start, png.subarray(start)])
  return { width, height, pixels, png, blocks, variants: ['0.0', '0.1', '1.0'].map(version => ({ version, bytes: archive(sparseMember({ version, name: '三色图.png', size: png.length, blocks })) })) }
}
module.exports = { imageFixture }
