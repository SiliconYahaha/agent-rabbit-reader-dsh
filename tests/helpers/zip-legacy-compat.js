'use strict'

const { crc32 } = require('./archive-duplicates')

const BZIP2_ZIP = Buffer.from('UEsDBC4AAAgMAIeDHl0idKZffwAAADgYAAAKAAAA6K+05piOLnR4dEJaaDkxQVkmU1mdSiCdAAEsH/FAABAAECBAEAAgQABUhAEViAMLoDAAuAoAAAGBQAAAMApVQGgANDamoRbRFkIuIiyEWQi3iLIRbBFwEXwRchF3EWBF4EXcRaCLARaCLMRaCLaIsCLeItBFgRYEWBFgRZiL+LuSKcKEhOpRBOhQSwECPwMuAAAIDACHgx5dInSmX38AAAA4GAAACgAkAAAAAAAAACCAtoEAAAAA6K+05piOLnR4dAoAIAAAAAAAAQAYAJCjwn9ZON0BAAAAAAAAAAAAAAAAAAAAAFBLBQYAAAAAAQABAFwAAACnAAAAAAA=', 'base64')
const AES_ZIP = Buffer.from('UEsDBDMAAQhjAEeDHl0AAAAAPAAAACAAAAAKAAsA6K+05piOLnR4dAGZBwACAEFFAwAAxqYMIEpxkD93Onq2L5ImmUfPhbPyetKmhWqhu6zsmy8UmbjOqKaLZFmSwivNKekk2YEYTwVVNvsBaSqRUEsBAj8DMwABCGMAR4MeXQAAAAA8AAAAIAAAAAoALwAAAAAAAAAggLaBAAAAAOivtOaYji50eHQKACAAAAAAAAEAGACgres3WTjdAQAAAAAAAAAAAAAAAAAAAAABmQcAAgBBRQMAAFBLBQYAAAAAAQABAGcAAABvAAAAAAA=', 'base64')
const BZIP2_LINK_ZIP = Buffer.from('UEsDBC4AAAAMAPSMIV2gAZ5lWgAAACYAAAAOAAAAZG9jcy9wYWdlLmh0bWxCWmg5MUFZJlNZV/SiFAAAAp/5AACwBRAAABAAYEAAAMFpRYoDAAEDoCAAMUAAAAAIoaM0RgjI0zaimE1zFlNpm7meChgK8CfJ6s7WugAF8i7kinChIK/pRChQSwMELgAAAAwAAAAhACedFVY0AAAADgAAAAgAAABzaG9ydGN1dEJaaDkxQVkmU1lJqE/zAAACEYAAAa7GzAAgADEAAAppiMPUjgXUeMLM+LuSKcKEgk1Cf5hQSwECLgMuAAAADAD0jCFdoAGeZVoAAAAmAAAADgAAAAAAAAAAAAAAgAEAAAAAZG9jcy9wYWdlLmh0bWxQSwECLgMuAAAADAAAACEAJ50VVjQAAAAOAAAACAAAAAAAAAAAAAAA/6GGAAAAc2hvcnRjdXRQSwUGAAAAAAIAAgByAAAA4AAAAAAA', 'base64')
// Fixed libarchive 9313b877 fixtures, BSD-2-Clause. These are real public
// archives, separate from the deterministic generators above.
const PUBLIC_SYMLINK_ZIP = Buffer.from('UEsDBAoAAAAAANiklT/BiewvBQAAAAUAAAAEABwAZmlsZVVUCQADWLTyTne08k51eAsAAQT1AQAABBQAAABmaWxlClBLAwQKAAAAAADcpJU/EDafjAQAAAAEAAAABwAcAHN5bWxpbmtVVAkAA2C08k5gtPJOdXgLAAEE9QEAAAQUAAAAZmlsZVBLAQIeAwoAAAAAANiklT/BiewvBQAAAAUAAAAEABgAAAAAAAEAAACkgQAAAABmaWxlVVQFAANYtPJOdXgLAAEE9QEAAAQUAAAAUEsBAh4DCgAAAAAA3KSVPxA2n4wEAAAABAAAAAcAGAAAAAAAAAAAAO2hQwAAAHN5bWxpbmtVVAUAA2C08k51eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCXAAAAiAAAAAAA', 'base64')
const PUBLIC_UNSUPPORTED_LINK_ZIP = Buffer.from('UEsDBBQAAADIAAAAAAA+jhlPCQAAAAkAAAALAAAAYmFkX3N5bWxpbmtzb21ld2hlcnVQSwMEFAAAAAAAAAAAAIURSg0LAAAACwAAAAYAAABzZWNvbmRoZWxsbyB3b3JsZFBLAQIUAxQAAADIAAAAAAA+jhlPCQAAAAkAAAALAAAAAAAAAAAAAAD/oQAAAABiYWRfc3ltbGlua1BLAQIUAxQAAAAAAAAAAACFEUoNCwAAAAsAAAAGAAAAAAAAAAAAAACkgTIAAABzZWNvbmRQSwUGAAAAAAIAAgBtAAAAYQAAAAAA', 'base64')

function findSignature (bytes, signature) {
  for (let offset = bytes.length - 4; offset >= 0; offset--) {
    if (bytes.readUInt32LE(offset) === signature) return offset
  }
  throw new Error(`ZIP signature ${signature.toString(16)} not found`)
}

function renameSingleMemberZip (source, rawName) {
  const archive = Buffer.from(source)
  const name = Buffer.from(rawName)
  const eocdAt = findSignature(archive, 0x06054b50)
  const centralAt = archive.readUInt32LE(eocdAt + 16)
  if (archive.readUInt32LE(centralAt) !== 0x02014b50 || archive.readUInt32LE(0) !== 0x04034b50) throw new Error('expected one-member ZIP')
  const localNameLength = archive.readUInt16LE(26)
  const localExtraLength = archive.readUInt16LE(28)
  const centralNameLength = archive.readUInt16LE(centralAt + 28)
  const centralExtraLength = archive.readUInt16LE(centralAt + 30)
  const centralCommentLength = archive.readUInt16LE(centralAt + 32)
  const compressedSize = archive.readUInt32LE(centralAt + 20)

  const localHeader = Buffer.from(archive.subarray(0, 30))
  localHeader.writeUInt16LE(localHeader.readUInt16LE(6) & ~0x0800, 6)
  localHeader.writeUInt16LE(name.length, 26)
  const localExtra = archive.subarray(30 + localNameLength, 30 + localNameLength + localExtraLength)
  const payloadAt = 30 + localNameLength + localExtraLength
  const payload = archive.subarray(payloadAt, payloadAt + compressedSize)

  const centralHeader = Buffer.from(archive.subarray(centralAt, centralAt + 46))
  centralHeader.writeUInt16LE(centralHeader.readUInt16LE(8) & ~0x0800, 8)
  centralHeader.writeUInt16LE(name.length, 28)
  centralHeader.writeUInt32LE(0, 42)
  const centralExtraAt = centralAt + 46 + centralNameLength
  const centralExtra = archive.subarray(centralExtraAt, centralExtraAt + centralExtraLength)
  const centralComment = archive.subarray(centralExtraAt + centralExtraLength, centralExtraAt + centralExtraLength + centralCommentLength)
  const localRecord = Buffer.concat([localHeader, name, localExtra, payload])
  const centralRecord = Buffer.concat([centralHeader, name, centralExtra, centralComment])
  const eocd = Buffer.from(archive.subarray(eocdAt))
  eocd.writeUInt32LE(centralRecord.length, 12)
  eocd.writeUInt32LE(localRecord.length, 16)
  return Buffer.concat([localRecord, centralRecord, eocd])
}

function appendStoredUnixSymlink (source, name, target) {
  const archive = Buffer.from(source)
  const rawName = Buffer.from(name)
  const payload = Buffer.from(target)
  const eocdAt = findSignature(archive, 0x06054b50)
  const count = archive.readUInt16LE(eocdAt + 10)
  const centralSize = archive.readUInt32LE(eocdAt + 12)
  const centralAt = archive.readUInt32LE(eocdAt + 16)
  if (centralAt + centralSize !== eocdAt || count === 0xffff) throw new Error('expected ordinary ZIP central directory')
  const crc = crc32(payload)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(rawName.length, 26)
  const localRecord = Buffer.concat([local, rawName, payload])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0x0314, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(rawName.length, 28)
  central.writeUInt32LE(0xa1ff0000, 38)
  central.writeUInt32LE(centralAt, 42)
  const centralRecord = Buffer.concat([central, rawName])

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count + 1, 8)
  end.writeUInt16LE(count + 1, 10)
  end.writeUInt32LE(centralSize + centralRecord.length, 12)
  end.writeUInt32LE(centralAt + localRecord.length, 16)
  return Buffer.concat([
    archive.subarray(0, centralAt),
    localRecord,
    archive.subarray(centralAt, eocdAt),
    centralRecord,
    end
  ])
}

function writeSmallUint64LE (buffer, offset, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('ZIP64 test value outside safe range')
  buffer.writeUInt32LE(value >>> 0, offset)
  buffer.writeUInt32LE(Math.floor(value / 0x100000000), offset + 4)
}

// Promote every central-directory size/offset and the end record to ZIP64
// without changing the local records or compressed payload. The fixture stays
// small, but exercises the exact sentinel/extra-field route used by large ZIPs.
function forceZip64Archive (source, options = {}) {
  const archive = Buffer.from(source)
  const eocdAt = findSignature(archive, 0x06054b50)
  const count = archive.readUInt16LE(eocdAt + 10)
  const centralSize = archive.readUInt32LE(eocdAt + 12)
  const centralAt = archive.readUInt32LE(eocdAt + 16)
  if (!count || count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff || centralAt + centralSize !== eocdAt) throw new Error('expected ordinary ZIP central directory')

  const records = []
  let cursor = centralAt
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('expected central record')
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    const oldExtra = archive.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)
    for (let at = 0; at + 4 <= oldExtra.length;) {
      const id = oldExtra.readUInt16LE(at)
      const size = oldExtra.readUInt16LE(at + 2)
      if (id === 0x0001) throw new Error('fixture already has ZIP64 entry extra')
      at += 4 + size
    }
    const header = Buffer.from(archive.subarray(cursor, cursor + 46))
    header.writeUInt16LE(Math.max(45, header.readUInt16LE(6)), 6)
    const uncompressedSize = header.readUInt32LE(24)
    const compressedSize = header.readUInt32LE(20)
    const localOffset = header.readUInt32LE(42)
    const includeDiskStart = Boolean(options.includeDiskStart)
    header.writeUInt32LE(0xffffffff, 20)
    header.writeUInt32LE(0xffffffff, 24)
    header.writeUInt32LE(0xffffffff, 42)
    if (includeDiskStart) header.writeUInt16LE(0xffff, 34)
    header.writeUInt16LE(extraLength + (includeDiskStart ? 32 : 28), 30)
    const zip64Extra = Buffer.alloc(includeDiskStart ? 32 : 28)
    zip64Extra.writeUInt16LE(0x0001, 0)
    zip64Extra.writeUInt16LE(includeDiskStart ? 28 : 24, 2)
    writeSmallUint64LE(zip64Extra, 4, uncompressedSize)
    writeSmallUint64LE(zip64Extra, 12, compressedSize)
    writeSmallUint64LE(zip64Extra, 20, localOffset)
    if (includeDiskStart) zip64Extra.writeUInt32LE(0, 28)
    records.push(Buffer.concat([
      header,
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
      zip64Extra,
      oldExtra,
      archive.subarray(cursor + 46 + nameLength + extraLength, end)
    ]))
    cursor = end
  }
  if (cursor !== eocdAt) throw new Error('central directory size mismatch')

  const localRecords = archive.subarray(0, centralAt)
  const central = Buffer.concat(records)
  const zip64At = localRecords.length + central.length
  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  writeSmallUint64LE(zip64End, 4, 44)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  writeSmallUint64LE(zip64End, 24, count)
  writeSmallUint64LE(zip64End, 32, count)
  writeSmallUint64LE(zip64End, 40, central.length)
  writeSmallUint64LE(zip64End, 48, localRecords.length)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  writeSmallUint64LE(locator, 8, zip64At)
  locator.writeUInt32LE(1, 16)
  const commentLength = archive.readUInt16LE(eocdAt + 20)
  const end = Buffer.from(archive.subarray(eocdAt, eocdAt + 22 + commentLength))
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([localRecords, central, zip64End, locator, end])
}

// Convert an ordinary ZIP into the classic PKZIP split layout used by
// `.z01`, `.z02`, ..., `.zip`. Each central record keeps a disk-relative
// local-header offset, while the final EOCD points at the central directory
// inside the last volume. The first volume carries the official split marker.
// This deterministic fixture avoids relying on a host `zip` executable in CI.
function splitClassicZip (source, cuts) {
  const archive = Buffer.from(source)
  const eocdAt = findSignature(archive, 0x06054b50)
  const count = archive.readUInt16LE(eocdAt + 10)
  const centralSize = archive.readUInt32LE(eocdAt + 12)
  const centralAt = archive.readUInt32LE(eocdAt + 16)
  const boundaries = Array.from(cuts || []).map(Number).sort((left, right) => left - right)
  if (!count || count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff || centralAt + centralSize !== eocdAt) throw new Error('expected ordinary ZIP central directory')
  if (!boundaries.length || boundaries.some((value, index) => !Number.isInteger(value) || value <= 0 || value >= centralAt || (index && value === boundaries[index - 1]))) throw new Error('classic ZIP cuts must be unique local-data offsets')

  const diskForOffset = offset => {
    let disk = 0
    while (disk < boundaries.length && offset >= boundaries[disk]) disk++
    return disk
  }
  const diskStart = disk => disk === 0 ? 0 : boundaries[disk - 1]
  const patched = Buffer.from(archive)
  let cursor = centralAt
  for (let index = 0; index < count; index++) {
    if (patched.readUInt32LE(cursor) !== 0x02014b50) throw new Error('expected central record')
    const nameLength = patched.readUInt16LE(cursor + 28)
    const extraLength = patched.readUInt16LE(cursor + 30)
    const commentLength = patched.readUInt16LE(cursor + 32)
    const localOffset = patched.readUInt32LE(cursor + 42)
    if (localOffset === 0xffffffff) throw new Error('classic ZIP64 fixture requires a dedicated generator')
    const disk = diskForOffset(localOffset)
    patched.writeUInt16LE(disk, cursor + 34)
    patched.writeUInt32LE(localOffset - diskStart(disk) + (disk === 0 ? 4 : 0), cursor + 42)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== eocdAt) throw new Error('central directory size mismatch')
  const finalDisk = boundaries.length
  if (diskForOffset(centralAt) !== finalDisk) throw new Error('classic ZIP central directory must be on the final volume')
  patched.writeUInt16LE(finalDisk, eocdAt + 4)
  patched.writeUInt16LE(finalDisk, eocdAt + 6)
  patched.writeUInt16LE(count, eocdAt + 8)
  patched.writeUInt32LE(centralAt - diskStart(finalDisk), eocdAt + 16)

  const parts = []
  let start = 0
  for (const end of boundaries) {
    const body = patched.subarray(start, end)
    parts.push(start === 0 ? Buffer.concat([Buffer.from([0x50, 0x4b, 0x07, 0x08]), body]) : Buffer.from(body))
    start = end
  }
  parts.push(Buffer.from(patched.subarray(start)))
  return parts
}

// Convert a small, already-ZIP64 archive into the classic split layout. The
// ZIP64 EOCD and locator keep disk-relative offsets just like a real split
// archive, while member offsets remain in each central ZIP64 extra field.
function splitClassicZip64 (source, cuts) {
  const archive = Buffer.from(source)
  const eocdAt = findSignature(archive, 0x06054b50)
  const locatorAt = eocdAt - 20
  if (locatorAt < 0 || archive.readUInt32LE(locatorAt) !== 0x07064b50) throw new Error('expected ZIP64 locator')
  const zip64At = Number(archive.readBigUInt64LE(locatorAt + 8))
  if (!Number.isSafeInteger(zip64At) || archive.readUInt32LE(zip64At) !== 0x06064b50) throw new Error('expected ZIP64 end record')
  const count = Number(archive.readBigUInt64LE(zip64At + 32))
  const centralSize = Number(archive.readBigUInt64LE(zip64At + 40))
  const centralAt = Number(archive.readBigUInt64LE(zip64At + 48))
  const boundaries = Array.from(cuts || []).map(Number).sort((left, right) => left - right)
  if (!count || !Number.isSafeInteger(count) || !Number.isSafeInteger(centralSize) || !Number.isSafeInteger(centralAt) || centralAt + centralSize !== zip64At) throw new Error('expected small ZIP64 central directory')
  if (!boundaries.length || boundaries.some((value, index) => !Number.isInteger(value) || value <= 0 || value >= centralAt || (index && value === boundaries[index - 1]))) throw new Error('classic ZIP64 cuts must be unique local-data offsets')

  const diskForOffset = offset => {
    let disk = 0
    while (disk < boundaries.length && offset >= boundaries[disk]) disk++
    return disk
  }
  const diskStart = disk => disk === 0 ? 0 : boundaries[disk - 1]
  const patched = Buffer.from(archive)
  let cursor = centralAt
  for (let index = 0; index < count; index++) {
    if (patched.readUInt32LE(cursor) !== 0x02014b50) throw new Error('expected ZIP64 central record')
    const nameLength = patched.readUInt16LE(cursor + 28)
    const extraLength = patched.readUInt16LE(cursor + 30)
    const commentLength = patched.readUInt16LE(cursor + 32)
    const extraStart = cursor + 46 + nameLength
    const extraEnd = extraStart + extraLength
    let extra = extraStart
    let localOffsetAt = -1
    let diskAt = -1
    while (extra + 4 <= extraEnd) {
      const id = patched.readUInt16LE(extra)
      const size = patched.readUInt16LE(extra + 2)
      const data = extra + 4
      if (data + size > extraEnd) throw new Error('truncated ZIP64 central extra')
      if (id === 0x0001) {
        let at = data
        if (patched.readUInt32LE(cursor + 24) === 0xffffffff) at += 8
        if (patched.readUInt32LE(cursor + 20) === 0xffffffff) at += 8
        if (patched.readUInt32LE(cursor + 42) === 0xffffffff && at + 8 <= data + size) {
          localOffsetAt = at
          at += 8
        }
        if (patched.readUInt16LE(cursor + 34) === 0xffff && at + 4 <= data + size) diskAt = at
        break
      }
      extra = data + size
    }
    if (localOffsetAt < 0) throw new Error('ZIP64 central member lacks local offset')
    const localOffset = Number(patched.readBigUInt64LE(localOffsetAt))
    if (!Number.isSafeInteger(localOffset)) throw new Error('ZIP64 fixture offset outside safe range')
    const disk = diskForOffset(localOffset)
    if (diskAt >= 0) patched.writeUInt32LE(disk, diskAt)
    else patched.writeUInt16LE(disk, cursor + 34)
    writeSmallUint64LE(patched, localOffsetAt, localOffset - diskStart(disk) + (disk === 0 ? 4 : 0))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== zip64At) throw new Error('ZIP64 central directory size mismatch')

  const finalDisk = boundaries.length
  if (diskForOffset(centralAt) !== finalDisk || diskForOffset(zip64At) !== finalDisk) throw new Error('ZIP64 metadata must be on the final volume')
  patched.writeUInt32LE(finalDisk, zip64At + 16)
  patched.writeUInt32LE(finalDisk, zip64At + 20)
  writeSmallUint64LE(patched, zip64At + 24, count)
  writeSmallUint64LE(patched, zip64At + 48, centralAt - diskStart(finalDisk))
  patched.writeUInt32LE(finalDisk, locatorAt + 4)
  writeSmallUint64LE(patched, locatorAt + 8, zip64At - diskStart(finalDisk))
  patched.writeUInt32LE(finalDisk + 1, locatorAt + 16)
  patched.writeUInt16LE(finalDisk, eocdAt + 4)
  patched.writeUInt16LE(finalDisk, eocdAt + 6)

  const parts = []
  let start = 0
  for (const end of boundaries) {
    const body = patched.subarray(start, end)
    parts.push(start === 0 ? Buffer.concat([Buffer.from([0x50, 0x4b, 0x07, 0x08]), body]) : Buffer.from(body))
    start = end
  }
  parts.push(Buffer.from(patched.subarray(start)))
  return parts
}

module.exports = { AES_ZIP, BZIP2_LINK_ZIP, BZIP2_ZIP, PUBLIC_SYMLINK_ZIP, PUBLIC_UNSUPPORTED_LINK_ZIP, appendStoredUnixSymlink, forceZip64Archive, renameSingleMemberZip, splitClassicZip, splitClassicZip64 }
