'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), zlib = require('node:zlib'), crypto = require('node:crypto')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const { sparseMember, archive, malformed, oldGnu } = require('./helpers/tar-sparse')
const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')) }
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const originals = require('./fixtures/tar-sparse/before.json').rows

test('GNU PAX sparse originals restore exact logical bytes, names and following members', async () => {
  for (const row of originals) {
    assert.equal(row.python.exact, true); assert.equal(row.bsdtar.exact, true)
    const bytes = Buffer.from(row.base64, 'base64')
    assert.equal(hash(bytes), row.sha256)
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    assert.equal(entries.length, 2, row.name)
    const entry = entries.find(e => e.name === 'body.bin')
    assert.ok(entry, row.name); assert.equal(entry.uncompressedSize, row.realSize)
    assert.equal(entry.canOpen, true)
    assert.equal(hash(Buffer.from(await runtime.extractTarEntry(bytes, entry, options))), row.expectedSha256, row.name)
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries.find(e => e.name === 'after.txt'), options)).toString(), 'AFTER\n')
  }
})

test('invalid sparse metadata fails explicitly and the next archive still extracts', async () => {
  for (const sample of malformed()) {
    await assert.rejects(runtime.inspectTarArchive(sample.bytes, options), undefined, sample.name)
    const valid = archive(sparseMember({ version: '1.0', blocks: [], size: 31 }))
    const { entries } = await runtime.inspectTarArchive(valid, options)
    assert.deepEqual(Buffer.from(await runtime.extractTarEntry(valid, entries[0], options)), Buffer.alloc(31), sample.name)
  }
})

test('sparse logical output is limited before allocation while following files remain usable', async () => {
  for (const version of ['0.0', '0.1', '1.0']) {
    const bytes = archive(sparseMember({ version, size: 20 * 1024 * 1024 + 1, blocks: [] }))
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    assert.equal(entries[0].uncompressedSize, 20 * 1024 * 1024 + 1)
    assert.equal(entries[0].canOpen, false)
    await assert.rejects(runtime.extractTarEntry(bytes, entries[0], options), /包内文件超过 20\.0 MB/)
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries[1], options)).toString(), '<p>AFTER 正文</p>')
  }
})

test('old GNU sparse including extension maps still restores the body', async () => {
  for (const count of [1, 4, 25]) {
    const blocks = Array.from({ length: count }, (_, i) => [i * 1024, Buffer.alloc(512, 65 + i)])
    const expected = Buffer.alloc(count * 1024)
    for (const [offset, bytes] of blocks) bytes.copy(expected, offset)
    const bytes = archive(oldGnu({ size: expected.length, blocks }))
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    assert.deepEqual(Buffer.from(await runtime.extractTarEntry(bytes, entries[0], options)), expected)
  }
})


test('PAX last-value semantics and sparse metadata scope preserve exact content', async () => {
  const fields = [['GNU.sparse.size', 1], ['GNU.sparse.size', 12], ['GNU.sparse.numblocks', 1], ['GNU.sparse.numblocks', 2], ['GNU.sparse.name', 'old.bin'], ['GNU.sparse.name', '正文.bin'], ['GNU.sparse.map', '0,10'], ['GNU.sparse.map', '1,5,7,5']]
  const bytes = archive(sparseMember({ fields }))
  const { entries } = await runtime.inspectTarArchive(bytes, options)
  assert.equal(entries[0].name, '正文.bin')
  assert.deepEqual(Buffer.from(await runtime.extractTarEntry(bytes, entries[0], options)), Buffer.concat([Buffer.alloc(1), Buffer.from('HEAD\n'), Buffer.alloc(1), Buffer.from('TAIL\n')]))
  assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries[1], options)).toString(), '<p>AFTER 正文</p>')
  const combined = archive(Buffer.concat(['0.0', '0.1', '1.0'].map((version, i) => sparseMember({ version, name: `body${i}.bin`, size: i + 1, blocks: [] }))))
  const result = await runtime.inspectTarArchive(combined, options)
  assert.equal(result.entries.length, 4)
  for (let i = 0; i < 3; i++) {
    assert.equal(result.entries[i].name, `body${i}.bin`)
    assert.deepEqual(Buffer.from(await runtime.extractTarEntry(combined, result.entries[i], options)), Buffer.alloc(i + 1))
  }
})
