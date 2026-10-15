'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { packedCorruptionFixture } = require('./helpers/7z-packed-corruption')
const { extract7zEntry, inspect7zArchive } = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const limits = { wasmBinary, maxEntrySize: 2 * 1024 * 1024, maxSolidDecodeBytes: 2 * 1024 * 1024 }

for (const method of ['LZMA:d=1m', 'Deflate', 'BZip2', 'PPMd:mem=1m', 'Copy']) {
  test(`7z ${method}: 已解锁后拒绝损坏正文，保留独立成员和完整包恢复`, async () => {
    const fixture = await packedCorruptionFixture(wasmBinary, { method, solid: 'off' })
    const options = { ...limits, password: fixture.password, passwordVerified: true }
    const damagedBefore = Buffer.from(fixture.damaged)
    const inspection = await inspect7zArchive(fixture.damaged, options)
    assert.deepEqual(inspection.entries.map(entry => entry.name), ['000-first.html', '999-second.html'])
    for (const entry of inspection.entries) {
      assert.ok(entry.method.toLowerCase().includes(method.split(':')[0].toLowerCase()), entry.method)
      assert.equal(entry.encrypted, true)
      assert.ok(entry.compressedSize > 0, 'each member starts an independent packed block')
    }
    const exact = { ...options, maxSize: fixture.firstBody.length }
    await assert.rejects(extract7zEntry(fixture.archive, inspection.entries[0], { ...exact, maxSize: fixture.firstBody.length - 1 }), /包内文件超过/)
    await assert.rejects(extract7zEntry(fixture.damaged, inspection.entries[0], options), error => {
      assert.equal(error.archiveFailure, 'data-corrupt')
      assert.equal(error.archiveIntegrity, 'packed-data')
      assert.doesNotMatch(error.message, /密码不正确/)
      return true
    })
    assert.deepEqual(Buffer.from(await extract7zEntry(fixture.damaged, inspection.entries[1], options)), fixture.secondBody)
    assert.deepEqual(Buffer.from(fixture.damaged), damagedBefore)
    await assert.rejects(inspect7zArchive(fixture.archive, { ...limits, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
    const complete = await inspect7zArchive(fixture.archive, options)
    assert.deepEqual(Buffer.from(await extract7zEntry(fixture.archive, complete.entries[0], exact)), fixture.firstBody)
  })
}
