'use strict'

const zlib = require('node:zlib')
function u16 (value) { const b = Buffer.alloc(2); b.writeUInt16BE(value & 65535); return b }
function lengthField (value, version = 1) { const b = Buffer.alloc(version === 2 ? 8 : 4); if (version === 2) b.writeBigUInt64BE(BigInt(value)); else b.writeUInt32BE(value); return b }

function taggedBlock (key, data = Buffer.alloc(0), version = 1, wide = false) {
  const long = wide || (version === 2 && ['Layr', 'Lr16', 'Lr32', 'Mtrn', 'Mt16', 'Mt32', 'LMsk'].includes(key))
  return Buffer.concat([Buffer.from((wide ? '8B64' : '8BIM') + key), lengthField(data.length, long ? 2 : 1), data, Buffer.alloc((4 - data.length % 4) % 4)])
}

// Fully populated single-layer metadata, independent of the production reader.
function layerInfo (planes, width, height, version, negative, colorChannels) {
  const rect = Buffer.alloc(16); rect.writeInt32BE(height, 8); rect.writeInt32BE(width, 12)
  const ids = planes.map((plane, index) => Buffer.concat([u16(index === colorChannels ? -1 : index), lengthField(plane.length + 2, version)]))
  const extra = Buffer.alloc(12) // no mask/ranges; empty padded Pascal layer name
  const record = Buffer.concat([rect, u16(planes.length), ...ids, Buffer.from('8BIMnorm'), Buffer.from([255, 0, 0, 0]), lengthField(extra.length), extra])
  const data = Buffer.concat([u16(negative ? -1 : 1), record, ...planes.map(plane => Buffer.concat([u16(0), plane]))])
  return Buffer.concat([data, Buffer.alloc(data.length % 2)])
}

function psdAlphaFixture ({ version = 1, depth = 8, mode = 3, compression = 0, width = 5, height = 1, flag = 'count', extraChannel = true, alpha = [0, 0.25, 0.5, 0.75, 1], trailingSpot = false, opaqueCount = false, extraBlocks = [], omitGlobalMask = false, resources = Buffer.alloc(0), colors = null } = {}) {
  const count = width * height
  const colorChannels = mode === 1 ? 1 : mode === 4 ? 4 : 3
  const levels = colors || (mode === 1 ? [0.5] : mode === 4 ? [1, 1, 1, 1] : mode === 9 ? [0.5, 0.5, 0.5] : [1, 0, 0])
  const values = levels.map(value => Array.from({ length: count }, (_, i) => Array.isArray(value) ? value[i % value.length] : value))
  if (extraChannel) values.push(Array.from({ length: count }, (_, i) => alpha[i % alpha.length]))
  if (trailingSpot) values.push(Array(count).fill(0))
  const encode = samples => {
    const plane = Buffer.alloc(count * depth / 8)
    samples.forEach((sample, i) => {
      if (depth === 8) plane[i] = Math.round(sample * 255)
      else if (depth === 16) plane.writeUInt16BE(Math.round(sample * 65535), i * 2)
      else plane.writeFloatBE(sample, i * 4)
    })
    return plane
  }
  const layerPlanes = values.map(encode)
  const hasAlpha = extraChannel && flag !== 'none' && !opaqueCount
  const planes = values.map((samples, channel) => encode(mode === 3 && channel < 3 && hasAlpha
    ? samples.map((sample, i) => sample * values[colorChannels][i] + 1 - values[colorChannels][i]) : samples))
  const header = Buffer.alloc(26)
  header.write('8BPS'); header.writeUInt16BE(version, 4); header.writeUInt16BE(planes.length, 12)
  header.writeUInt32BE(height, 14); header.writeUInt32BE(width, 18); header.writeUInt16BE(depth, 22); header.writeUInt16BE(mode, 24)
  const info = layerInfo(layerPlanes, width, height, version, flag === 'count' && !opaqueCount, colorChannels)
  const alternate = ['Layr', 'Lr16', 'Lr32'].includes(flag)
  const primary = flag === 'count' || flag === 'none' ? Buffer.concat([lengthField(info.length, version), info]) : lengthField(0, version)
  const blocks = [...extraBlocks]
  if (alternate) blocks.push(taggedBlock(flag, layerInfo(layerPlanes, width, height, version, true, colorChannels), version))
  else if (flag !== 'none' && flag !== 'count') blocks.push(taggedBlock(flag, Buffer.alloc(0), version))
  const layerSection = Buffer.concat([primary, ...(omitGlobalMask ? [] : [lengthField(0)]), ...blocks])
  let data = Buffer.concat(planes)
  if (compression === 1) {
    const rows = []
    const lengths = []
    for (const plane of planes) for (let row = 0; row < height; row++) {
      const bytes = plane.subarray(row * width * depth / 8, (row + 1) * width * depth / 8)
      const chunks = []
      for (let i = 0; i < bytes.length; i += 128) chunks.push(Buffer.from([Math.min(128, bytes.length - i) - 1]), bytes.subarray(i, i + 128))
      const packed = Buffer.concat(chunks); rows.push(packed); lengths.push(version === 2 ? lengthField(packed.length) : u16(packed.length))
    }
    data = Buffer.concat([...lengths, ...rows])
  } else if (compression >= 2) {
    if (compression === 3) {
      const rowBytes = width * depth / 8
      const predicted = Buffer.alloc(data.length)
      for (let start = 0; start < data.length; start += rowBytes) {
        if (depth === 16) {
          for (let x = 0; x < width; x++) predicted.writeUInt16BE((data.readUInt16BE(start + x * 2) - (x ? data.readUInt16BE(start + (x - 1) * 2) : 0) + 65536) & 65535, start + x * 2)
        } else {
          const row = depth === 32 ? Buffer.from(Array.from({ length: rowBytes }, (_, i) => data[start + (i % width) * 4 + Math.floor(i / width)])) : data.subarray(start, start + rowBytes)
          for (let x = 0; x < rowBytes; x++) predicted[start + x] = (row[x] - (x ? row[x - 1] : 0) + 256) & 255
        }
      }
      data = predicted
    }
    data = zlib.deflateSync(data)
  }
  return Buffer.concat([header, lengthField(0), lengthField(resources.length), resources, lengthField(layerSection.length, version), layerSection, u16(compression), data])
}

module.exports = { psdAlphaFixture, taggedBlock }
