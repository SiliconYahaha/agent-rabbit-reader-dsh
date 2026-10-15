'use strict'

const { zipSync } = require('../../miniprogram/file-reader/document/vendor/fflate')

function crc32 (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Concatenate complete single-member records, preserving independent offsets.
// Unlike a filename-keyed object, a ZIP central directory permits duplicates.
function combineZips (archives, reverseDirectory = false) {
  let offset = 0
  const rows = archives.map(bytes => {
    const archive = Buffer.from(bytes)
    const end = archive.length - 22
    const centralOffset = archive.readUInt32LE(end + 16)
    const local = archive.subarray(0, centralOffset)
    const central = Buffer.from(archive.subarray(centralOffset, end))
    central.writeUInt32LE(offset, 42)
    offset += local.length
    return { local, central }
  })
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(rows.length, 8)
  end.writeUInt16LE(rows.length, 10)
  end.writeUInt32LE(rows.reduce((size, row) => size + row.central.length, 0), 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...rows.map(row => row.local), ...(reverseDirectory ? rows.slice().reverse() : rows).map(row => row.central), end])
}

function duplicateZip (members, reverseDirectory = false) {
  return combineZips(members.map(member => zipSync({ [member.name]: Buffer.from(member.content) }, { level: member.level || 0 })), reverseDirectory)
}

function duplicateRar (members) {
  const main = Buffer.alloc(13)
  main[2] = 0x73
  main.writeUInt16LE(main.length, 5)
  main.writeUInt16LE(crc32(main.subarray(2)) & 0xffff, 0)
  const rows = members.map(member => {
    const name = Buffer.from(member.name)
    const content = Buffer.from(member.content)
    const header = Buffer.alloc(32 + name.length)
    header[2] = 0x74
    header.writeUInt16LE(0x8000, 3)
    header.writeUInt16LE(header.length, 5)
    header.writeUInt32LE(content.length, 7)
    header.writeUInt32LE(content.length, 11)
    header[15] = 3
    header.writeUInt32LE(crc32(content), 16)
    header[24] = 20
    header[25] = 0x30
    header.writeUInt16LE(name.length, 26)
    header.writeUInt32LE(0x81a4, 28)
    name.copy(header, 32)
    header.writeUInt16LE(crc32(header.subarray(2)) & 0xffff, 0)
    return Buffer.concat([header, content])
  })
  const end = Buffer.from('c43d7b00400700', 'hex')
  return Buffer.concat([Buffer.from('526172211a0700', 'hex'), main, ...rows, end])
}

async function duplicateSevenZip (members, wasmBinary, password = '') {
  const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  engine.FS.mkdir('/source')
  engine.FS.chdir('/source')
  const names = members.map((member, index) => String(index).padStart(member.name.length, '0'))
  members.forEach((member, index) => engine.FS.writeFile(names[index], Buffer.from(member.content)))
  // Use a plain header so each filename can be replaced by a UTF-16 string
  // of equal length without changing property sizes or compressed payloads.
  const args = ['a', '-t7z', '-m0=lzma2', '-ms=on', '-mhc=off', '-mhe=off', '/duplicate.7z', '.']
  if (password) args.push(`-p${password}`)
  if (engine.callMain(args) !== 0) throw new Error('7z fixture generation failed')
  const archive = Buffer.from(engine.FS.readFile('/duplicate.7z'))
  const headerStart = 32 + Number(archive.readBigUInt64LE(12))
  const headerSize = Number(archive.readBigUInt64LE(20))
  const header = archive.subarray(headerStart, headerStart + headerSize)
  names.forEach((name, index) => {
    const original = Buffer.from(`${name}\0`, 'utf16le')
    const replacement = Buffer.from(`${members[index].name}\0`, 'utf16le')
    const position = header.indexOf(original)
    if (position < 0 || original.length !== replacement.length) throw new Error('7z fixture header mismatch')
    replacement.copy(header, position)
  })
  archive.writeUInt32LE(crc32(header), 28)
  archive.writeUInt32LE(crc32(archive.subarray(12, 32)), 8)
  return archive
}

async function headerEncryptedDuplicateSevenZip (members, wasmBinary, password) {
  const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  engine.FS.mkdir('/source')
  engine.FS.chdir('/source')
  const sources = members.map((member, index) => `source-${index}.bin`)
  members.forEach((member, index) => engine.FS.writeFile(sources[index], Buffer.from(member.content)))
  if (engine.callMain(['a', '-t7z', '-m0=lzma2', '-ms=on', '-mhe=on', `-p${password}`, '/duplicate-encrypted.7z', ...sources]) !== 0) throw new Error('Header-encrypted 7z fixture generation failed')
  const renames = sources.flatMap((source, index) => [source, members[index].name])
  if (engine.callMain(['rn', `-p${password}`, '/duplicate-encrypted.7z', ...renames]) !== 0) throw new Error('Header-encrypted 7z duplicate rename failed')
  return Buffer.from(engine.FS.readFile('/duplicate-encrypted.7z'))
}

module.exports = { combineZips, crc32, duplicateRar, duplicateSevenZip, duplicateZip, headerEncryptedDuplicateSevenZip }
