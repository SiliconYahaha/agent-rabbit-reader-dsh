'use strict'

const zlib = require('node:zlib')

function cdrCompressedVectorFixture (options = {}) {
  const lengths = []
  const record = (id, data) => {
    const index = lengths.length
    lengths.push(data.length)
    const header = Buffer.alloc(8)
    header.write(id, 0, 'latin1')
    header.writeUInt32LE(index, 4)
    return Buffer.concat([header, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  }
  const list = (type, children) => record('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...children]))
  const fillId = 0x12345678
  const fill = Buffer.alloc(20)
  fill.writeUInt32LE(fillId, 0)
  fill.writeUInt16LE(1, 4)
  fill.writeUInt16LE(5, 8)
  fill.writeUInt16LE(5, 10)
  fill.writeUInt32LE(options.color == null ? 0x00ff5b43 : options.color, 16)
  const geometry = Buffer.alloc(4 + 3 * 8 + 3)
  geometry.writeUInt16LE(3, 0)
  const points = [[0, 0], [254000, 0], [0, 254000]]
  points.forEach((point, index) => {
    geometry.writeInt32LE(point[0], 4 + index * 8)
    geometry.writeInt32LE(point[1], 8 + index * 8)
  })
  geometry.set([0x00, 0x40, 0x48], 28)
  const loda = Buffer.alloc(44 + geometry.length + 8)
  loda.writeUInt32LE(loda.length, 0)
  loda.writeUInt32LE(3, 4)
  loda.writeUInt32LE(20, 8)
  loda.writeUInt32LE(32, 12)
  loda.writeUInt32LE(3, 16)
  loda.writeUInt32LE(44, 20)
  loda.writeUInt32LE(44 + geometry.length, 24)
  loda.writeUInt32LE(48 + geometry.length, 28)
  loda.writeUInt32LE(0x0a, 32)
  loda.writeUInt32LE(0x14, 36)
  loda.writeUInt32LE(0x1e, 40)
  geometry.copy(loda, 44)
  loda.writeUInt32LE(fillId, 44 + geometry.length)
  loda.writeUInt32LE(0, 48 + geometry.length)
  const transform = Buffer.alloc(72)
  transform.writeUInt32LE(transform.length, 0)
  transform.writeUInt32LE(1, 4)
  transform.writeUInt32LE(12, 8)
  transform.writeUInt32LE(16, 12)
  transform.writeUInt16LE(0x08, 16)
  const [x, y] = options.translation || [2, 3]
  ;[1, 0, x * 254000, 0, 1, y * 254000].forEach((value, index) => transform.writeDoubleLE(value, 24 + index * 8))
  const object = list('obj ', [list('lgob', [record('loda', loda), list('trfl', [record('trfd', transform)])])])
  const part1 = list('doc ', [record('fild', fill), list('page', [object])])
  const lengthBytes = Buffer.alloc(lengths.length * 4)
  lengths.forEach((length, index) => lengthBytes.writeUInt32LE(length, index * 4))
  const first = zlib.deflateSync(part1, options.zlibOptions)
  const second = zlib.deflateSync(lengthBytes, options.zlibOptions)
  const cpng = compressed => {
    const header = Buffer.alloc(8)
    header.write('CPng', 0)
    header.writeUInt16LE(1, 4)
    header.writeUInt16LE(4, 6)
    return Buffer.concat([header, compressed])
  }
  const compressedData = Buffer.alloc(20)
  compressedData.write('cmpr', 0)
  compressedData.writeUInt32LE(first.length + 8, 4)
  compressedData.writeUInt32LE(part1.length, 8)
  compressedData.writeUInt32LE(second.length + 8, 12)
  compressedData.writeUInt32LE(lengthBytes.length, 16)
  const compressedList = Buffer.concat([compressedData, cpng(first), cpng(second)])
  const outer = Buffer.alloc(8)
  outer.write('LIST', 0)
  outer.writeUInt32LE(compressedList.length, 4)
  const riff = Buffer.concat([Buffer.from('RIFF\0\0\0\0CDRA'), outer, compressedList])
  riff.writeUInt32LE(riff.length - 8, 4)
  return riff
}

function repackCdrStreams (fixture, first, second, firstExpected, secondExpected) {
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  const output = Buffer.concat([fixture.subarray(0, 48), first, fixture.subarray(firstEnd, firstEnd + 8), second])
  output.writeUInt32LE(first.length + 8, 24)
  output.writeUInt32LE(firstExpected, 28)
  output.writeUInt32LE(second.length + 8, 32)
  output.writeUInt32LE(secondExpected, 36)
  output.writeUInt32LE(output.length - 20, 16)
  output.writeUInt32LE(output.length - 8, 4)
  return output
}

function cdrZlibFailureFixtures () {
  const fixture = cdrCompressedVectorFixture()
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  const streams = [fixture.subarray(48, firstEnd), fixture.subarray(firstEnd + 8)]
  const expected = [fixture.readUInt32LE(28), fixture.readUInt32LE(36)]
  const cases = []
  for (const side of [0, 1]) {
    for (const kind of ['adler', 'oversized', 'truncated']) {
      const values = streams.map(stream => Buffer.from(stream))
      if (kind === 'adler') values[side][values[side].length - 1] ^= 1
      else if (kind === 'oversized') values[side] = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024))
      else values[side] = values[side].subarray(0, -5)
      cases.push({ name: `cdr-${kind}-${side + 1}.cdr`, bytes: repackCdrStreams(fixture, ...values, ...expected),
        message: kind === 'adler' ? '校验失败' : kind === 'oversized' ? '解压长度超过声明上限' : '不完整' })
    }
  }
  return cases
}

module.exports = { cdrCompressedVectorFixture, repackCdrStreams, cdrZlibFailureFixtures }
