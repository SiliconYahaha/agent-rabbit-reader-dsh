'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { solidArchive } = require('./helpers/7z-solid')
const { extractArchiveVolumeEntry, inspectArchiveVolumes, inspect7zArchive, extract7zEntry } = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const password = 'truncated-volume-fixture-92'
const body = Buffer.from('<h1>完整分卷正文</h1>')
const options = { wasmBinary, format: '7z', maxEntrySize: 2 * 1024 * 1024, maxSolidDecodeBytes: 2 * 1024 * 1024 }

function uint32 (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function uint64 (bytes, offset) {
  return uint32(bytes, offset) + uint32(bytes, offset + 4) * 0x100000000
}

function splitThree (archive) {
  const first = Math.ceil(archive.length / 3)
  const second = Math.ceil(archive.length * 2 / 3)
  return [
    { name: 'encrypted-solid.7z.001', bytes: archive.subarray(0, first) },
    { name: 'encrypted-solid.7z.002', bytes: archive.subarray(first, second) },
    { name: 'encrypted-solid.7z.003', bytes: archive.subarray(second) }
  ]
}

function cloneVolumes (volumes) {
  return volumes.map(volume => ({ name: volume.name, bytes: new Uint8Array(volume.bytes) }))
}

async function expectIntegrityFailure (volumes, kind, pattern) {
  await assert.rejects(inspectArchiveVolumes(volumes, { ...options, mainName: 'encrypted-solid.7z.001' }), error => {
    assert.equal(error.archiveFailure, 'command-failed')
    assert.equal(error.archiveIntegrity, kind)
    assert.match(error.message, pattern)
    assert.doesNotMatch(error.message, /000-filler|999-target/)
    return true
  })
}

test('文件头加密数字分卷在缺卷、截断和头部损坏时给出结构化失败并可恢复', async () => {
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(1024 * 1024, 0x6a) },
    { name: '999-target.html', bytes: body }
  ], { password })
  const volumes = splitThree(archive)
  const volumeOptions = { ...options, mainName: volumes[0].name }
  const original = volumes.map(volume => Buffer.from(volume.bytes))

  await assert.rejects(inspectArchiveVolumes(volumes, volumeOptions), error => error.archiveFailure === 'password-required')
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), { ...volumeOptions, password })
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.ok(target)
  assert.deepEqual(Buffer.from(await extractArchiveVolumeEntry(volumes, target, { ...volumeOptions, password })), body)

  await expectIntegrityFailure([volumes[0], volumes[2]], 'missing-volume', /缺少第 2 卷/)
  await expectIntegrityFailure(volumes.slice(0, 2), 'truncated-volume', /末卷缺失或已截断/)

  const truncated = cloneVolumes(volumes)
  truncated[2].bytes = truncated[2].bytes.subarray(0, truncated[2].bytes.length - 1)
  await expectIntegrityFailure(truncated, 'truncated-volume', /末卷缺失或已截断/)

  const damagedStart = cloneVolumes(volumes)
  damagedStart[0].bytes[12] ^= 0x01
  await expectIntegrityFailure(damagedStart, 'start-header-crc', /起始头校验失败/)

  const damagedDirectory = cloneVolumes(volumes)
  const nextStart = 32 + uint64(archive, 12)
  const nextSize = uint64(archive, 20)
  const damageOffset = nextStart + Math.floor(nextSize / 2)
  let cursor = damageOffset
  for (const volume of damagedDirectory) {
    if (cursor < volume.bytes.length) {
      volume.bytes[cursor] ^= 0x01
      break
    }
    cursor -= volume.bytes.length
  }
  await expectIntegrityFailure(damagedDirectory, 'next-header-crc', /目录头校验失败/)
  await assert.rejects(extractArchiveVolumeEntry(damagedDirectory, target, { ...volumeOptions, password }), error => error.archiveIntegrity === 'next-header-crc')

  const recovered = await inspectArchiveVolumes(volumes, { ...volumeOptions, password })
  const recoveredTarget = recovered.entries.find(entry => entry.name === target.name)
  assert.deepEqual(Buffer.from(await extractArchiveVolumeEntry(volumes, recoveredTarget, { ...volumeOptions, password })), body)
  for (let index = 0; index < volumes.length; index++) assert.deepEqual(Buffer.from(volumes[index].bytes), original[index])

  const ordinary = await solidArchive(wasmBinary, [{ name: 'ordinary.html', bytes: body }])
  const ordinaryInspection = await inspect7zArchive(ordinary, { ...options, archiveExtension: '.7z', archiveType: '7z-engine' })
  assert.deepEqual(Buffer.from(await extract7zEntry(ordinary, ordinaryInspection.entries[0], { ...options, archiveExtension: '.7z' })), body)
})

test('数字分卷首头跨越多个小分卷时仍按逻辑字节流校验并打开正文', async () => {
  const archive = await solidArchive(wasmBinary, [{ name: 'target.html', bytes: body }], { password })
  const volumes = [
    { name: 'tiny.7z.001', bytes: archive.subarray(0, 7) },
    { name: 'tiny.7z.002', bytes: archive.subarray(7, 19) },
    { name: 'tiny.7z.003', bytes: archive.subarray(19) }
  ]
  const volumeOptions = { ...options, mainName: volumes[0].name, password }
  const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
  const target = inspection.entries.find(entry => entry.name === 'target.html')
  assert.deepEqual(Buffer.from(await extractArchiveVolumeEntry(volumes, target, volumeOptions)), body)
})
