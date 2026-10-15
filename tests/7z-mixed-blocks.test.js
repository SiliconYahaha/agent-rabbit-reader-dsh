'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { mixedBlocksFixture, splitMixedVolumes } = require('./helpers/7z-mixed-blocks')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))

for (const methods of [['LZMA:d=1m', 'PPMd:mem=1m'], ['Deflate', 'BZip2'], ['Copy', 'LZMA2:d=1m']]) {
  test(`混合固实块 ${methods.join('/')}：整包与三分卷仅拒绝损坏块，完整正文恢复`, async () => {
    const fixture = await mixedBlocksFixture(wasmBinary, methods)
    const options = { wasmBinary, password: fixture.password, passwordVerified: true, format: '7z', mainName: 'mixed.7z.001' }
    for (const volumes of [false, true]) {
      const prepare = volumes ? bytes => splitMixedVolumes(bytes).reverse() : bytes => bytes
      const inspect = volumes ? seven.inspectArchiveVolumes : seven.inspect7zArchive
      const extract = volumes ? seven.extractArchiveVolumeEntry : seven.extract7zEntry
      for (let block = 0; block < fixture.damaged.length; block++) {
        const source = fixture.damaged[block]
        const original = Buffer.from(source)
        const input = prepare(source)
        const inspection = await inspect(input, options)
        assert.deepEqual(inspection.entries.map(entry => entry.name), fixture.names)
        for (const [index, entry] of inspection.entries.entries()) {
          assert.ok(entry.method.toLowerCase().includes(methods[Math.floor(index / 2)].split(':')[0].toLowerCase()), entry.method)
          if (fixture.blockIds[index] === block) {
            await assert.rejects(extract(input, entry, options), error => error.archiveFailure === 'data-corrupt' && error.archiveIntegrity === 'packed-data')
          } else {
            assert.deepEqual(Buffer.from(await extract(input, entry, options)), fixture.bodies[index])
          }
        }
        assert.deepEqual(Buffer.from(source), original)
      }
      const complete = prepare(fixture.archive)
      await assert.rejects(inspect(complete, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
      const inspection = await inspect(complete, options)
      for (const [index, entry] of inspection.entries.entries()) {
        assert.deepEqual(Buffer.from(await extract(complete, entry, options)), fixture.bodies[index])
      }
      const exact = fixture.bodies[2].length + fixture.bodies[3].length
      const target = inspection.entries[3]
      assert.equal(target.solidDecodeSize, exact)
      await assert.rejects(extract(complete, target, { ...options, maxSolidDecodeBytes: exact - 1 }), /安全上限/)
      assert.deepEqual(Buffer.from(await extract(complete, target, { ...options, maxSolidDecodeBytes: exact })), fixture.bodies[3])
      assert.equal(inspection.entries[2].solidDecodeSize, undefined, 'new codec block resets the decoded-prefix budget')
    }
  })
}
