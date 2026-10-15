'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { solidArchive } = require('./helpers/7z-solid')
const { packedCorruptionFixture, password } = require('./helpers/7z-packed-corruption')
const { extract7zEntry, inspect7zArchive } = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const options = { wasmBinary, maxEntrySize: 2 * 1024 * 1024, maxSolidDecodeBytes: 2 * 1024 * 1024 }

test('正确密码解锁目录后数据区损坏不误报密码，独立固实块和完整包仍可打开', async () => {
  const { archive, damaged, firstBody, secondBody } = await packedCorruptionFixture(wasmBinary)
  const originalDamaged = Buffer.from(damaged)

  const inspection = await inspect7zArchive(damaged, { ...options, password })
  assert.deepEqual(inspection.entries.map(entry => entry.name), ['000-first.html', '999-second.html'])
  const first = inspection.entries[0]
  const second = inspection.entries[1]

  await assert.rejects(extract7zEntry(damaged, first, { ...options, password, passwordVerified: true }), error => {
    assert.equal(error.archiveFailure, 'data-corrupt')
    assert.equal(error.archiveIntegrity, 'packed-data')
    assert.match(error.message, /数据校验失败|文件可能已损坏/)
    assert.doesNotMatch(error.message, /密码不正确/)
    return true
  })
  assert.deepEqual(Buffer.from(damaged), originalDamaged)
  assert.deepEqual(Buffer.from(await extract7zEntry(damaged, second, { ...options, password, passwordVerified: true })), secondBody)

  await assert.rejects(inspect7zArchive(archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const complete = await inspect7zArchive(archive, { ...options, password })
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, complete.entries[0], { ...options, password, passwordVerified: true })), firstBody)
})

test('仅正文加密但目录未验证密码时，错误密码仍保留密码重试语义', async () => {
  const body = Buffer.from('<h1>仅正文加密</h1>')
  const archive = await solidArchive(wasmBinary, [{ name: 'content.html', bytes: body }], {
    password,
    headerEncryption: false
  })
  const inspection = await inspect7zArchive(archive, options)
  const entry = inspection.entries[0]
  assert.equal(entry.encrypted, true)

  await assert.rejects(extract7zEntry(archive, entry, { ...options, password: 'wrong-password', passwordVerified: false }), error => {
    assert.equal(error.archiveFailure, 'password-or-corrupt')
    assert.match(error.message, /密码不正确或压缩包损坏/)
    return true
  })
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, entry, { ...options, password, passwordVerified: false })), body)
})
