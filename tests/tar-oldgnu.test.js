'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), zlib = require('node:zlib'), crypto = require('node:crypto')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const { oldGnu, archive, malformed } = require('./helpers/tar-oldgnu')
const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')) }
const hash = b => crypto.createHash('sha256').update(b).digest('hex')

test('old GNU sparse original names and byte-granular extents restore independent reference content', async () => {
  for (const sample of require('./fixtures/tar-oldgnu/before.json').rows) {
    assert.equal(sample.python.exact, true); assert.equal(sample.bsdtar.exact, true)
    const bytes = Buffer.from(sample.base64, 'base64'); assert.equal(hash(bytes), sample.sourceSha256)
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    const selected = entries.find(e => e.name === 'body.bin'); assert.ok(selected, sample.name)
    assert.equal(selected.uncompressedSize, sample.size)
    const body = Buffer.from(await runtime.extractTarEntry(bytes, selected, options))
    assert.equal(hash(body), sample.expectedSha256, sample.name)
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries.find(e => e.name === 'after.html'), options)).toString(), '<p>AFTER 正文</p>')
  }
})

test('old GNU sparse inconsistent maps fail explicitly instead of skipping to a later member', async () => {
  const blocks = [[1, Buffer.from('HELLO')]], size = 128
  for (const { name, bytes } of malformed()) {
    await assert.rejects(runtime.inspectTarArchive(bytes, options), undefined, name)
    const good = archive(oldGnu({ size, blocks }))
    const { entries } = await runtime.inspectTarArchive(good, options)
    const body = Buffer.from(await runtime.extractTarEntry(good, entries[0], options))
    assert.equal(body.subarray(1, 6).toString(), 'HELLO')
    assert.equal(body.length, size)
  }
})


test('old GNU sparse map record limit counts zero-length records before allocating output', async () => {
  for (const count of [65536, 65537]) {
    const pairs = Array.from({ length: count - 1 }, () => [0, 0]); pairs.push([31, 0])
    const bytes = archive(oldGnu({ size: 31, blocks: [], pairs }))
    if (count > 65536) { await assert.rejects(runtime.inspectTarArchive(bytes, options)); continue }
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    assert.equal(entries[0].uncompressedSize, 31)
    assert.deepEqual(Buffer.from(await runtime.extractTarEntry(bytes, entries[0], options)), Buffer.alloc(31))
  }
})

test('old GNU sparse logical size determines the20MiB output boundary, including forged row sizes', async () => {
  for (const size of [20 * 1024 * 1024, 20 * 1024 * 1024 + 1]) {
    const bytes = archive(oldGnu({ size, blocks: [] }))
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    assert.equal(entries[0].uncompressedSize, size)
    if (size > 20 * 1024 * 1024) {
      assert.equal(entries[0].canOpen, false)
      await assert.rejects(runtime.extractTarEntry(bytes, entries[0], options), /超过/)
      await assert.rejects(runtime.extractTarEntry(bytes, { ...entries[0], uncompressedSize: 1 }, options), /超过|大小|校验|变化/)
    } else {
      assert.equal(entries[0].canOpen, true)
      const body = Buffer.from(await runtime.extractTarEntry(bytes, entries[0], options))
      assert.equal(body.length, size); assert.equal(hash(body), hash(Buffer.alloc(size)))
    }
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries[1], options)).toString(), '<p>AFTER 正文</p>')
  }
})
