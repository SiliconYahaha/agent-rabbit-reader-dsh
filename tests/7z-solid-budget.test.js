'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { solidArchive } = require('./helpers/7z-solid')
const { extractArchiveVolumeEntry, extract7zEntry, inspectArchiveVolumes, inspect7zArchive } = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const budget = 1024 * 1024
const body = Buffer.from('<h1>固实块边界正文</h1>')
const options = { wasmBinary, archiveExtension: '.7z', archiveType: '7z-engine', maxEntrySize: budget, maxSolidDecodeBytes: budget }
const password = 'solid-header-fixture-91'

async function inspectTargetLast (decodedBytes) {
  const filler = Buffer.alloc(decodedBytes - body.length, 0x61)
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: filler },
    { name: '999-target.html', bytes: body }
  ])
  const inspection = await inspect7zArchive(archive, options)
  return { archive, inspection, target: inspection.entries.find(entry => entry.name === '999-target.html') }
}

async function inspectEncryptedTargetLast (decodedBytes) {
  const filler = Buffer.alloc(decodedBytes - body.length, 0x65)
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: filler },
    { name: '999-target.html', bytes: body }
  ], { password })
  const inspection = await inspect7zArchive(archive, { ...options, password })
  return { archive, inspection, target: inspection.entries.find(entry => entry.name === '999-target.html') }
}

async function encryptedManyTinyArchive (extraBytes = 0) {
  const fillerCount = 1024
  const fillerBytes = budget - body.length + extraBytes
  const baseSize = Math.floor(fillerBytes / fillerCount)
  let remainder = fillerBytes % fillerCount
  const members = Array.from({ length: fillerCount }, (_, index) => {
    const size = baseSize + (remainder-- > 0 ? 1 : 0)
    return { name: `piece-${String(index).padStart(4, '0')}.dat`, bytes: Buffer.alloc(size, index % 251) }
  })
  members.push({ name: 'zzzz-target.html', bytes: body })
  const archive = await solidArchive(wasmBinary, members, { password })
  return { archive, members }
}

test('固实块目标累计解码量恰好等于上限时仍可打开真实正文', async () => {
  const { archive, target } = await inspectTargetLast(budget)
  assert.equal(target.canOpen, true)
  assert.equal(target.solidDecodeSize, budget)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, options)), body)
})

test('小目标位于超限固实块尾部时目录和提取同时拒绝', async () => {
  const { archive, target } = await inspectTargetLast(budget + 1)
  assert.equal(target.uncompressedSize, body.length)
  assert.equal(target.solidDecodeSize, budget + 1)
  assert.equal(target.canOpen, false)
  assert.match(target.detail, /固实块需解码 1\.0 MB，超过安全上限/)
  await assert.rejects(extract7zEntry(archive, target, options), /固实块需先解码 1\.0 MB，超过 1\.0 MB 安全上限/)
})

test('目标在固实块首部时不受后续大成员影响', async () => {
  const archive = await solidArchive(wasmBinary, [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(budget + 1, 0x62) }
  ])
  const inspection = await inspect7zArchive(archive, options)
  const target = inspection.entries.find(entry => entry.name === '000-target.html')
  assert.equal(target.canOpen, true)
  assert.equal(target.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, options)), body)
})

test('新固实块会重置累计解码量而不是继承前一块', async () => {
  const targetBody = Buffer.alloc(768 * 1024, 0x63)
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(768 * 1024, 0x64) },
    { name: '999-target.html', bytes: targetBody }
  ], { solid: '1m' })
  const inspection = await inspect7zArchive(archive, options)
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(target.canOpen, true)
  assert.equal(target.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, options)), targetBody)
})

test('数字分卷沿用固实块解码预算且拒绝后仍能打开正常包', async () => {
  const { archive, target } = await inspectTargetLast(budget + 1)
  const split = Math.ceil(archive.length / 2)
  const volumes = [
    { name: 'solid.7z.001', bytes: archive.subarray(0, split) },
    { name: 'solid.7z.002', bytes: archive.subarray(split) }
  ]
  const volumeOptions = { ...options, format: '7z', mainName: volumes[0].name }
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const volumeTarget = inspection.entries.find(entry => entry.name === target.name)
  assert.equal(volumeTarget.canOpen, false)
  assert.equal(volumeTarget.solidDecodeSize, budget + 1)
  await assert.rejects(extractArchiveVolumeEntry(volumes, volumeTarget, volumeOptions), /固实块需先解码/)

  const valid = await inspectTargetLast(budget)
  assert.equal(valid.target.canOpen, true)
  assert.deepEqual(Buffer.from(await extract7zEntry(valid.archive, valid.target, options)), body)
})

test('损坏固实包报错后正常包仍可检查和提取', async () => {
  const valid = await inspectTargetLast(budget)
  await assert.rejects(inspect7zArchive(valid.archive.subarray(0, 20), options))
  const recovered = await inspect7zArchive(valid.archive, options)
  const target = recovered.entries.find(entry => entry.name === '999-target.html')
  assert.deepEqual(Buffer.from(await extract7zEntry(valid.archive, target, options)), body)
})

test('文件头加密固实包在正确密码后仍按恰好上限打开真实正文', async () => {
  const { archive, inspection, target } = await inspectEncryptedTargetLast(budget)
  assert.equal(inspection.passwordRequired, true)
  assert.equal(inspection.passwordProvided, true)
  assert.equal(target.encrypted, true)
  assert.equal(target.canOpen, true)
  assert.equal(target.solidDecodeSize, budget)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, { ...options, password })), body)
})

test('文件头加密固实包的缺失和错误密码不绕过超限保护且后续正确密码可恢复', async () => {
  const { archive, target } = await inspectEncryptedTargetLast(budget + 1)
  await assert.rejects(inspect7zArchive(archive, options), error => error.archiveFailure === 'password-required')
  await assert.rejects(inspect7zArchive(archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const recovered = await inspect7zArchive(archive, { ...options, password })
  const recoveredTarget = recovered.entries.find(entry => entry.name === target.name)
  assert.equal(recoveredTarget.canOpen, false)
  assert.equal(recoveredTarget.solidDecodeSize, budget + 1)
  assert.match(recoveredTarget.detail, /固实块需解码 1\.0 MB，超过安全上限/)
  await assert.rejects(extract7zEntry(archive, recoveredTarget, { ...options, password }), /固实块需先解码/)

  const ordinary = await inspectTargetLast(budget)
  assert.deepEqual(Buffer.from(await extract7zEntry(ordinary.archive, ordinary.target, options)), body)
})

test('文件头加密固实包的目标在块首时不受后续数据影响', async () => {
  const archive = await solidArchive(wasmBinary, [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(budget + 1, 0x66) }
  ], { password })
  const inspection = await inspect7zArchive(archive, { ...options, password })
  const target = inspection.entries.find(entry => entry.name === '000-target.html')
  assert.equal(target.canOpen, true)
  assert.equal(target.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, { ...options, password })), body)
})

test('文件头加密数字分卷沿用固实块预算且错误密码后仍可恢复', async () => {
  const { archive } = await inspectEncryptedTargetLast(budget + 1)
  const split = Math.ceil(archive.length / 2)
  const volumes = [
    { name: 'encrypted-solid.7z.001', bytes: archive.subarray(0, split) },
    { name: 'encrypted-solid.7z.002', bytes: archive.subarray(split) }
  ]
  const volumeOptions = { ...options, format: '7z', mainName: volumes[0].name, password }
  await assert.rejects(inspectArchiveVolumes(volumes, { ...volumeOptions, password: '' }), error => error.archiveFailure === 'password-required')
  await assert.rejects(inspectArchiveVolumes(volumes, { ...volumeOptions, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(target.canOpen, false)
  assert.equal(target.solidDecodeSize, budget + 1)
  await assert.rejects(extractArchiveVolumeEntry(volumes, target, volumeOptions), /固实块需先解码/)

  const exact = await inspectEncryptedTargetLast(budget)
  assert.deepEqual(Buffer.from(await extract7zEntry(exact.archive, exact.target, { ...options, password })), body)
})

test('文件头加密固实包的空文件和空目录不伪造块重置', async () => {
  const archive = await solidArchive(wasmBinary, [
    { name: '000-empty-dir', directory: true },
    { name: '010-empty.txt', bytes: Buffer.alloc(0) },
    { name: '020-nested', directory: true },
    { name: '020-nested/empty.txt', bytes: Buffer.alloc(0) },
    { name: '100-filler.bin', bytes: Buffer.alloc(budget - body.length, 0x67) },
    { name: '999-target.html', bytes: body }
  ], { password })
  await assert.rejects(inspect7zArchive(archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const inspection = await inspect7zArchive(archive, { ...options, password })
  assert.deepEqual(inspection.entries.slice(0, 4).map(entry => entry.name), [
    '000-empty-dir',
    '020-nested',
    '010-empty.txt',
    '020-nested/empty.txt'
  ])
  const directory = inspection.entries.find(entry => entry.name === '000-empty-dir')
  const empty = inspection.entries.find(entry => entry.name === '010-empty.txt')
  const nestedEmpty = inspection.entries.find(entry => entry.name === '020-nested/empty.txt')
  assert.equal(directory.isDirectory, true)
  assert.equal(directory.canOpen, false)
  assert.equal(empty.canOpen, true)
  assert.equal(nestedEmpty.canOpen, true)
  assert.equal(empty.solidDecodeSize, undefined)
  assert.equal(nestedEmpty.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, empty, { ...options, password })), Buffer.alloc(0))
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, nestedEmpty, { ...options, password })), Buffer.alloc(0))
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(target.solidDecodeSize, budget)
  assert.equal(target.canOpen, true)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, { ...options, password })), body)
})

test('文件头加密归档的空成员不会吞掉后续真实固实块重置', async () => {
  const targetBody = Buffer.alloc(768 * 1024, 0x68)
  const archive = await solidArchive(wasmBinary, [
    { name: '000-empty-dir', directory: true },
    { name: '010-empty.txt', bytes: Buffer.alloc(0) },
    { name: '100-filler.bin', bytes: Buffer.alloc(768 * 1024, 0x69) },
    { name: '999-target.html', bytes: targetBody }
  ], { password, solid: '1m' })
  const inspection = await inspect7zArchive(archive, { ...options, password })
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(target.solidDecodeSize, undefined)
  assert.equal(target.canOpen, true)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, { ...options, password })), targetBody)
})

test('文件头加密固实包的1024个小成员累计到恰好预算且身份不丢失', async () => {
  const { archive, members } = await encryptedManyTinyArchive(0)
  const inspection = await inspect7zArchive(archive, { ...options, password })
  assert.equal(inspection.entries.length, members.length)
  assert.equal(new Set(inspection.entries.map(entry => entry.name)).size, members.length)
  assert.deepEqual(inspection.entries.map(entry => entry.id), Array.from({ length: members.length }, (_, index) => index))
  for (const index of [0, 499, 500, 1023]) {
    const expected = members[index]
    const entry = inspection.entries.find(item => item.name === expected.name)
    assert.ok(entry)
    assert.equal(entry.canOpen, true)
    assert.deepEqual(Buffer.from(await extract7zEntry(archive, entry, { ...options, password })), expected.bytes)
  }
  const target = inspection.entries.find(entry => entry.name === 'zzzz-target.html')
  assert.equal(target.solidDecodeSize, budget)
  assert.equal(target.canOpen, true)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, target, { ...options, password })), body)
})

test('文件头加密固实包的大量小成员超过预算1字节后禁用尾项且密码失败可恢复', async () => {
  const { archive } = await encryptedManyTinyArchive(1)
  await assert.rejects(inspect7zArchive(archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const inspection = await inspect7zArchive(archive, { ...options, password })
  const target = inspection.entries.find(entry => entry.name === 'zzzz-target.html')
  assert.equal(target.solidDecodeSize, budget + 1)
  assert.equal(target.canOpen, false)
  assert.match(target.detail, /固实块需解码 1\.0 MB，超过安全上限/)
  await assert.rejects(extract7zEntry(archive, target, { ...options, password }), /固实块需先解码/)
  const first = inspection.entries.find(entry => entry.name === 'piece-0000.dat')
  assert.equal(first.canOpen, true)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, first, { ...options, password })), Buffer.alloc(first.uncompressedSize, 0))
})
