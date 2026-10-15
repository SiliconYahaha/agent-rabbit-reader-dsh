'use strict'
const zlib = require('node:zlib')
const references = require('../fixtures/psd-thumbnails/references.json')

function resourceBlock (id, data) {
  const header = Buffer.alloc(12)
  header.write('8BIM'); header.writeUInt16BE(id, 4); header.writeUInt32BE(data.length, 8)
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)])
}

function resourceData (resources, id) {
  for (let offset = 0; offset + 12 <= resources.length;) {
    const sizeOffset = offset + 6 + Math.ceil((resources[offset + 6] + 1) / 2) * 2
    const size = resources.readUInt32BE(sizeOffset), start = sizeOffset + 4
    if (resources.readUInt16BE(offset + 4) === id) return Buffer.from(resources.subarray(start, start + size))
    offset = start + size + size % 2
  }
  throw Error('Missing fixture resource ' + id)
}

function documentWithResources (resources, { version = 1, width = 1536, height = 1536 } = {}) {
  const header = Buffer.alloc(30), length = Buffer.alloc(4)
  header.write('8BPS'); header.writeUInt16BE(version, 4); header.writeUInt16BE(3, 12)
  header.writeUInt32BE(height, 14); header.writeUInt32BE(width, 18)
  header.writeUInt16BE(8, 22); header.writeUInt16BE(3, 24)
  length.writeUInt32BE(resources.length)
  const pixels = width * height
  const data = Buffer.concat([Buffer.alloc(pixels, 42), Buffer.alloc(pixels, 84), Buffer.alloc(pixels, 126)])
  return Buffer.concat([header, length, resources, Buffer.alloc(version === 2 ? 8 : 4), Buffer.from([0, 2]), zlib.deflateSync(data)])
}

module.exports = { references, resourceBlock, resourceData, documentWithResources }
