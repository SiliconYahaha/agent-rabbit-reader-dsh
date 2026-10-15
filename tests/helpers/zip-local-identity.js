'use strict'

const { zipMember, cases } = require('./zip-integrity')

function localNameMismatch (options = {}) {
  const bytes = zipMember(options)
  bytes[30] ^= 1
  return bytes
}

function withLocalExtra (source, extra) {
  const bytes = Buffer.from(source), nameLength = bytes.readUInt16LE(26)
  const at = 30 + nameLength, end = bytes.length - 22
  bytes.writeUInt16LE(extra.length, 28)
  bytes.writeUInt32LE(bytes.readUInt32LE(end + 16) + extra.length, end + 16)
  return Buffer.concat([bytes.subarray(0, at), extra, bytes.subarray(at)])
}

// Model Python's force_zip64 local header with an ordinary central directory.
function localZip64 (options = {}) {
  let source = zipMember(options)
  const extra = Buffer.alloc(20)
  const descriptorLength = options.descriptor === 'signed' ? 16 : options.descriptor ? 12 : 0
  let central = source.readUInt32LE(source.length - 22 + 16)
  const packedSize = central - 30 - source.readUInt16LE(26) - descriptorLength
  const size = Buffer.from(options.content || '').length
  extra.writeUInt16LE(1); extra.writeUInt16LE(16, 2)
  extra.writeBigUInt64LE(BigInt(size), 4)
  extra.writeBigUInt64LE(BigInt(packedSize), 12)
  if (descriptorLength) {
    const descriptor = Buffer.alloc(descriptorLength + 8), prefix = descriptorLength === 16 ? 4 : 0
    if (prefix) descriptor.writeUInt32LE(0x08074b50)
    descriptor.writeUInt32LE(source.readUInt32LE(central + 16), prefix)
    descriptor.writeBigUInt64LE(BigInt(packedSize), prefix + 4)
    descriptor.writeBigUInt64LE(BigInt(size), prefix + 12)
    source = Buffer.concat([source.subarray(0, central - descriptorLength), descriptor, source.subarray(central)])
    central += 8
    source.writeUInt32LE(central, source.length - 22 + 16)
  }
  source.writeUInt16LE(45, 4)
  source.writeUInt16LE(45, central + 6)
  source.writeUInt32LE(0xffffffff, 18); source.writeUInt32LE(0xffffffff, 22)
  return withLocalExtra(source, extra)
}

const variants = cases.map(c => ({ ...c, name: `样本/${c.name}.txt` }))
module.exports = { localNameMismatch, localZip64, withLocalExtra, variants }
