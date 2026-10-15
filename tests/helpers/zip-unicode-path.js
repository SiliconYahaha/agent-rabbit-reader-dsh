'use strict'

function crc32Bytes (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function unicodePathField (rawName, record) {
  const unicode = Buffer.from(record.name, 'utf8')
  const payload = Buffer.alloc(5 + unicode.length)
  payload[0] = 1
  payload.writeUInt32LE(record.crc == null ? crc32Bytes(rawName) : record.crc, 1)
  unicode.copy(payload, 5)
  const field = Buffer.alloc(4 + payload.length)
  field.writeUInt16LE(0x7075, 0)
  field.writeUInt16LE(payload.length, 2)
  payload.copy(field, 4)
  return field
}

function storedZipWithUnicodePaths ({ rawName = 'safe/raw.html', unicodePaths = [], extraTail = Buffer.alloc(0), content = '<h1>ZIP 原始正文</h1>', flags = 0 }) {
  const name = Buffer.from(rawName)
  const payload = Buffer.from(content)
  const extra = Buffer.concat([...unicodePaths.map(record => unicodePathField(name, record)), extraTail])
  const crc = crc32Bytes(payload)
  const local = Buffer.alloc(30 + name.length + extra.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(extra.length, 28)
  name.copy(local, 30)
  extra.copy(local, 30 + name.length)
  const central = Buffer.alloc(46 + name.length + extra.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(extra.length, 30)
  name.copy(central, 46)
  extra.copy(central, 46 + name.length)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + payload.length, 16)
  return Buffer.concat([local, payload, central, eocd])
}

module.exports = { crc32Bytes, storedZipWithUnicodePaths }
