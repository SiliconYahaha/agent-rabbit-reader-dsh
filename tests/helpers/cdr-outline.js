'use strict'

const zlib = require('node:zlib')
const { cdrCompressedVectorFixture, repackCdrStreams } = require('./cdr-zlib')

// Add a real nonzero outl id and update loda's line reference. No thumbnail.
function cdrOutlineFixture ({ type = 1, width = 25400, color = 0x112233, caps = 0, join = 0, stretch = 100, matrix, dashes = [] } = {}) {
  const base = cdrCompressedVectorFixture()
  const firstEnd = 48 + base.readUInt32LE(24) - 8
  const stream = zlib.inflateSync(base.subarray(48, firstEnd))
  const table = zlib.inflateSync(base.subarray(firstEnd + 8))
  const lineId = 0x23456789
  const lodaStart = stream.indexOf(Buffer.from('loda')) + 8
  stream.writeUInt32LE(lineId, lodaStart + stream.readUInt32LE(lodaStart) - 4)
  if (matrix) {
    const matrixStart = stream.indexOf(Buffer.from('trfd')) + 8 + 24
    matrix.forEach((value, index) => stream.writeDoubleLE(value, matrixStart + index * 8))
  }
  const record = Buffer.alloc(114 + dashes.length * 2)
  record.write('outl', 0)
  record.writeUInt32LE(table.length / 4, 4)
  record.writeUInt32LE(lineId, 8)
  record.writeUInt16LE(type, 12)
  record.writeUInt16LE(caps, 14)
  record.writeUInt16LE(join, 16)
  record.writeInt32LE(width, 20)
  record.writeUInt16LE(stretch, 24)
  record.writeUInt16LE(5, 84)
  record.writeUInt16LE(5, 86)
  record.writeUInt32LE(color, 92)
  record.writeUInt16LE(dashes.length, 112)
  dashes.forEach((value, index) => record.writeUInt16LE(value, 114 + index * 2))
  const data = Buffer.concat([stream.subarray(0, 12), record, stream.subarray(12)])
  const lengths = Buffer.concat([table, Buffer.alloc(4)])
  const rootIndex = stream.readUInt32LE(4)
  lengths.writeUInt32LE(table.readUInt32LE(rootIndex * 4) + record.length, rootIndex * 4)
  lengths.writeUInt32LE(record.length - 8, table.length)
  return repackCdrStreams(base, zlib.deflateSync(data), zlib.deflateSync(lengths), data.length, lengths.length)
}

module.exports = { cdrOutlineFixture }
