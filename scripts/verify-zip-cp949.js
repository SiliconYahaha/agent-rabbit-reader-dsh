'use strict'

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const iconv = require('iconv-lite')

const { extractZipEntry, inspectZipCentral, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')

function crc32 (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip (name, content) {
  const payload = Buffer.from(content)
  const checksum = crc32(payload)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + payload.length, 16)
  return Buffer.concat([local, payload, central, eocd])
}

function run (command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { ...options, encoding: options.encoding || null })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${path.basename(command)} ${args.join(' ')}: ${Buffer.from(result.stderr || '').toString()}`)
  return result.stdout
}

const tool = name => {
  const found = childProcess.spawnSync('/usr/bin/env', ['sh', '-c', `command -v ${name}`], { encoding: 'utf8' })
  assert.equal(found.status, 0, `缺少独立对照工具 ${name}`)
  return found.stdout.trim()
}

const iconvPath = tool('iconv')
const bsdtarPath = tool('bsdtar')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-reader-cp949-'))
const samples = [
  { id: 'euc-kr', name: '한글/폴더/읽기.html', content: '<h1>압축 파일의 실제 본문</h1>', encoding: 'euc-kr' },
  { id: 'cp949-extension', name: '갂힣/확장.txt', content: 'Windows UHC 확장 문자 본문', encoding: 'cp949' }
]

try {
  const results = []
  for (const sample of samples) {
    const rawName = iconv.encode(sample.name, sample.encoding)
    const systemName = Buffer.from(run(iconvPath, ['-f', sample.encoding === 'euc-kr' ? 'EUC-KR' : 'CP949', '-t', 'UTF-8'], { input: rawName })).toString('utf8')
    assert.equal(systemName, sample.name)

    const archive = storedZip(rawName, sample.content)
    const archivePath = path.join(tempRoot, `${sample.id}.zip`)
    fs.writeFileSync(archivePath, archive)
    const nativeListing = Buffer.from(run(bsdtarPath, ['-tf', archivePath, '--options', 'zip:hdrcharset=CP949'])).toString('utf8').trim().normalize('NFC')
    assert.equal(nativeListing, sample.name)
    const nativeContent = Buffer.from(run(bsdtarPath, ['-xOf', archivePath, '--options', 'zip:hdrcharset=CP949'])).toString('utf8')
    assert.equal(nativeContent, sample.content)

    const descriptor = readZipDirectoryDescriptor(archive)
    const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
    const automatic = inspectZipCentral(central, descriptor)
    const korean = inspectZipCentral(central, descriptor, { legacyEncoding: 'cp949' })
    const automaticEntry = automatic.entries.find(entry => entry.canOpen)
    const entry = korean.entries.find(item => item.canOpen)
    assert.notEqual(automaticEntry.name, sample.name, '基线必须证明自动 CP437 会产生静默乱码')
    assert.equal(entry.name, sample.name)
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString('utf8'), sample.content)
    assert.equal(korean.filenameEncodingLabel, '韩文 CP949 / EUC-KR')
    results.push({ id: sample.id, name: sample.name, rawNameHex: rawName.toString('hex'), contentBytes: Buffer.byteLength(sample.content) })
  }
  console.log(JSON.stringify({ status: 'pass', iconv: iconvPath, archiveOracle: bsdtarPath, samples: results }, null, 2))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
