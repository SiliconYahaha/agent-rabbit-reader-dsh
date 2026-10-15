'use strict'

const crypto = require('node:crypto')
const { crc32 } = require('./archive-duplicates')

function rar4Links (members) {
  const main = Buffer.alloc(13)
  main[2] = 0x73
  main.writeUInt16LE(main.length, 5)
  main.writeUInt16LE(crc32(main.subarray(2)) & 0xffff, 0)
  const records = members.map(member => {
    const name = Buffer.from(member.name)
    const content = Buffer.from(member.target === undefined ? member.content || '' : member.target)
    const header = Buffer.alloc(32 + name.length)
    header[2] = 0x74
    header.writeUInt16LE(0x8000 | (member.directory && member.target === undefined ? 0xe0 : 0), 3)
    header.writeUInt16LE(header.length, 5)
    header.writeUInt32LE(content.length, 7)
    header.writeUInt32LE(content.length, 11)
    header[15] = 3
    header.writeUInt32LE(crc32(content), 16)
    header[24] = 20
    header[25] = 0x30
    header.writeUInt16LE(name.length, 26)
    header.writeUInt32LE(member.target !== undefined ? 0xa1ff : member.directory ? 0x41ed : 0x81a4, 28)
    name.copy(header, 32)
    header.writeUInt16LE(crc32(header.subarray(2)) & 0xffff, 0)
    return Buffer.concat([header, content])
  })
  return Buffer.concat([Buffer.from('526172211a0700', 'hex'), main, ...records, Buffer.from('c43d7b00400700', 'hex')])
}

function vint (value) {
  const bytes = []
  do {
    const byte = value % 128
    value = Math.floor(value / 128)
    bytes.push(byte | (value ? 128 : 0))
  } while (value)
  return Buffer.from(bytes)
}

function rar5Block (header, data = Buffer.alloc(0)) {
  const body = Buffer.concat([vint(header.length), header])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32LE(crc32(body))
  return Buffer.concat([checksum, body, data])
}

function rar5Links (members) {
  const main = rar5Block(Buffer.from([1, 0, 0]))
  const records = members.map(member => {
    const name = Buffer.from(member.name)
    const linked = member.target !== undefined
    const content = Buffer.from(linked ? '' : member.content || '')
    const target = Buffer.from(member.target || '')
    const extraBody = linked ? Buffer.concat([vint(5), vint(member.linkType || 1), vint(member.directory ? 1 : 0), vint(target.length), target]) : Buffer.alloc(0)
    const extra = linked ? Buffer.concat([vint(extraBody.length), extraBody]) : Buffer.alloc(0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32LE(crc32(content))
    const header = Buffer.concat([
      vint(2), vint(2 | (linked ? 1 : 0)), ...(linked ? [vint(extra.length)] : []), vint(content.length),
      vint(4 | (member.directory && !linked ? 1 : 0)), vint(linked ? target.length : content.length), vint(linked ? 0xa1ff : member.directory ? 0x41ed : 0x81a4), crc,
      vint(0), vint(1), vint(name.length), name, extra
    ])
    return rar5Block(header, content)
  })
  return Buffer.concat([Buffer.from('526172211a070100', 'hex'), main, ...records, rar5Block(Buffer.from([5, 0, 0]))])
}

function rar5HeaderImage (header) {
  const body = Buffer.concat([vint(header.length), header])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32LE(crc32(body))
  return Buffer.concat([checksum, body])
}

function rar5EncryptedHeaderBlock (header, data, key, index) {
  const plain = rar5HeaderImage(header)
  const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16)
  plain.copy(padded)
  const iv = Buffer.alloc(16, index)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([iv, cipher.update(padded), cipher.final(), data])
}

function rar5HeaderEncryptedLinks (members, password = '1234') {
  // Deterministic conformance fixture only: the fixed salt/IVs make regressions
  // reproducible and must never be copied into archive-writing product code.
  const kdfCountLog = 4
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const key = crypto.pbkdf2Sync(Buffer.from(password), salt, 1 << kdfCountLog, 32, 'sha256')
  const crypt = rar5Block(Buffer.concat([vint(4), vint(0), vint(0), vint(0), Buffer.from([kdfCountLog]), salt]))
  let blockIndex = 1
  const main = rar5EncryptedHeaderBlock(Buffer.from([1, 0, 0]), Buffer.alloc(0), key, blockIndex++)
  const records = members.map(member => {
    const name = Buffer.from(member.name)
    const linked = member.target !== undefined
    const content = Buffer.from(linked ? '' : member.content || '')
    const target = Buffer.from(member.target || '')
    const extraBody = linked ? Buffer.concat([vint(5), vint(member.linkType || 1), vint(member.directory ? 1 : 0), vint(target.length), target]) : Buffer.alloc(0)
    const extra = linked ? Buffer.concat([vint(extraBody.length), extraBody]) : Buffer.alloc(0)
    const dataCrc = Buffer.alloc(4)
    dataCrc.writeUInt32LE(crc32(content))
    const header = Buffer.concat([
      vint(2), vint((content.length ? 2 : 0) | (linked ? 1 : 0)), ...(linked ? [vint(extra.length)] : []), ...(content.length ? [vint(content.length)] : []),
      vint(4 | (member.directory && !linked ? 1 : 0)), vint(linked ? target.length : content.length), vint(linked ? 0xa1ff : member.directory ? 0x41ed : 0x81a4), dataCrc,
      vint(0), vint(1), vint(name.length), name, extra
    ])
    return rar5EncryptedHeaderBlock(header, content, key, blockIndex++)
  })
  const end = rar5EncryptedHeaderBlock(Buffer.from([5, 0, 0]), Buffer.alloc(0), key, blockIndex)
  return Buffer.concat([Buffer.from('526172211a070100', 'hex'), crypt, main, ...records, end])
}

function rar5VolumeFileRecord (member, content, flags, crcContent) {
  const name = Buffer.from(member.name)
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(crcContent))
  const header = Buffer.concat([
    vint(2), vint(2 | flags), vint(content.length),
    vint(4), vint(member.totalSize), vint(0x81a4), crc,
    vint(0), vint(1), vint(name.length), name
  ])
  return rar5Block(header, content)
}

function rar5VolumeLinks ({ targetName = 'docs/page.html', linkName = 'shortcut', content = '<h1>分卷链接真实正文</h1>' } = {}) {
  const payload = Buffer.from(content)
  const split = Math.max(1, Math.floor(payload.length / 2))
  const firstPayload = payload.subarray(0, split)
  const secondPayload = payload.subarray(split)
  const member = { name: targetName, totalSize: payload.length }
  const firstRecord = rar5VolumeFileRecord(member, firstPayload, 0x10, firstPayload)
  const secondRecord = rar5VolumeFileRecord(member, secondPayload, 0x08, payload)
  const linkRecord = rar5Links([{ name: linkName, target: targetName }]).subarray(16, -8)
  const signature = Buffer.from('526172211a070100', 'hex')
  const firstMain = rar5Block(Buffer.concat([vint(1), vint(0), vint(3), vint(0)]))
  const secondMain = rar5Block(Buffer.concat([vint(1), vint(0), vint(3), vint(1)]))
  return [
    { name: 'linked.part1.rar', bytes: Buffer.concat([signature, firstMain, firstRecord, rar5Block(Buffer.from([5, 0, 1]))]) },
    { name: 'linked.part2.rar', bytes: Buffer.concat([signature, secondMain, secondRecord, linkRecord, rar5Block(Buffer.from([5, 0, 0]))]) }
  ]
}

function rar5HeaderEncryptedVolumeLinks ({ targetName = 'docs/page.html', linkName = 'shortcut', content = '<h1>加密分卷链接真实正文</h1>', password = '1234' } = {}) {
  // Deterministic conformance fixture only. Fixed salts and IVs are intentional
  // test inputs and must never be reused by archive-writing product code.
  const kdfCountLog = 4
  const salt = Buffer.from('102132435465768798a9bacbdcedfe0f', 'hex')
  const key = crypto.pbkdf2Sync(Buffer.from(password), salt, 1 << kdfCountLog, 32, 'sha256')
  const signature = Buffer.from('526172211a070100', 'hex')
  const crypt = rar5Block(Buffer.concat([vint(4), vint(0), vint(0), vint(0), Buffer.from([kdfCountLog]), salt]))
  const payload = Buffer.from(content)
  const split = Math.max(1, Math.floor(payload.length / 2))
  const firstPayload = payload.subarray(0, split)
  const secondPayload = payload.subarray(split)

  function volumeFileHeader (part, flags, crcContent) {
    const name = Buffer.from(targetName)
    const dataCrc = Buffer.alloc(4)
    dataCrc.writeUInt32LE(crc32(crcContent))
    return Buffer.concat([
      vint(2), vint(2 | flags), vint(part.length),
      vint(4), vint(payload.length), vint(0x81a4), dataCrc,
      vint(0), vint(1), vint(name.length), name
    ])
  }

  const linkNameBytes = Buffer.from(linkName)
  const targetBytes = Buffer.from(targetName)
  const linkExtraBody = Buffer.concat([vint(5), vint(1), vint(0), vint(targetBytes.length), targetBytes])
  const linkExtra = Buffer.concat([vint(linkExtraBody.length), linkExtraBody])
  const linkCrc = Buffer.alloc(4)
  linkCrc.writeUInt32LE(crc32(Buffer.alloc(0)))
  const linkHeader = Buffer.concat([
    vint(2), vint(1), vint(linkExtra.length),
    vint(4), vint(targetBytes.length), vint(0xa1ff), linkCrc,
    vint(0), vint(1), vint(linkNameBytes.length), linkNameBytes, linkExtra
  ])

  const first = Buffer.concat([
    signature,
    crypt,
    rar5EncryptedHeaderBlock(Buffer.concat([vint(1), vint(0), vint(3), vint(0)]), Buffer.alloc(0), key, 1),
    rar5EncryptedHeaderBlock(volumeFileHeader(firstPayload, 0x10, firstPayload), firstPayload, key, 2),
    rar5EncryptedHeaderBlock(Buffer.from([5, 0, 1]), Buffer.alloc(0), key, 3)
  ])
  const second = Buffer.concat([
    signature,
    crypt,
    rar5EncryptedHeaderBlock(Buffer.concat([vint(1), vint(0), vint(3), vint(1)]), Buffer.alloc(0), key, 1),
    rar5EncryptedHeaderBlock(volumeFileHeader(secondPayload, 0x08, payload), secondPayload, key, 2),
    rar5EncryptedHeaderBlock(linkHeader, Buffer.alloc(0), key, 3),
    rar5EncryptedHeaderBlock(Buffer.from([5, 0, 0]), Buffer.alloc(0), key, 4)
  ])
  return [
    { name: 'encrypted-linked.part1.rar', bytes: first },
    { name: 'encrypted-linked.part2.rar', bytes: second }
  ]
}

module.exports = { rar4Links, rar5Links, rar5HeaderEncryptedLinks, rar5HeaderEncryptedVolumeLinks, rar5VolumeLinks }
