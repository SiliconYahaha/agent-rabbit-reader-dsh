'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')
const { mixedBlocksFixture } = require('../tests/helpers/7z-mixed-blocks')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  assert.ok(process.argv[2], 'output directory is required')
  assert.ok(process.env.PY7ZR_PYTHON, 'independent py7zr interpreter is required')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const results = []
  for (const methods of [['LZMA:d=1m', 'PPMd:mem=1m'], ['Deflate', 'BZip2'], ['Copy', 'LZMA2:d=1m']]) {
    const fixture = await mixedBlocksFixture(wasmBinary, methods)
    const out = path.resolve(process.argv[2], methods.map(method => method.split(':')[0]).join('-'))
    fs.mkdirSync(out, { recursive: true })
    const options = { wasmBinary, password: fixture.password, passwordVerified: true }
    const variants = [{ name: 'complete.7z', bytes: fixture.archive, damagedBlock: -1 }, ...fixture.damaged.map((bytes, index) => ({ name: `damaged-${index}.7z`, bytes, damagedBlock: index }))]
    const cases = []
    for (const variant of variants) {
      fs.writeFileSync(path.join(out, variant.name), variant.bytes)
      const inspection = await seven.inspect7zArchive(variant.bytes, options)
      assert.deepEqual(inspection.entries.map(entry => entry.name), fixture.names)
      for (const [index, entry] of inspection.entries.entries()) {
        const worker = spawnSync(process.env.PY7ZR_PYTHON, [path.join(__dirname, 'oracles/7z-packed-data.py'), out, variant.name, entry.name, 'oracle'], {
          encoding: 'utf8', timeout: 30000, env: { ...process.env, READER_7Z_TEST_PASSWORD: fixture.password }
        })
        if (worker.error) throw worker.error
        const oracle = worker.signal ? { failure: 'native-signal', signal: worker.signal } : JSON.parse(worker.stdout)
        if (!worker.signal) assert.equal(worker.status, 0)
        const damaged = fixture.blockIds[index] === variant.damagedBlock
        if (damaged) {
          assert.ok(oracle.failure, 'independent decoder must reject corrupted member')
          await assert.rejects(seven.extract7zEntry(variant.bytes, entry, options), error => error.archiveFailure === 'data-corrupt' && error.archiveIntegrity === 'packed-data')
        } else {
          const expected = hash(fixture.bodies[index])
          assert.equal(oracle.sha256, expected)
          assert.equal(hash(await seven.extract7zEntry(variant.bytes, entry, options)), expected)
        }
        cases.push({ archive: variant.name, member: entry.name, block: fixture.blockIds[index], damaged, oracle })
      }
    }
    results.push({ methods, blocks: fixture.blockIds, offsets: fixture.offsets, archives: variants.map(v => ({ name: v.name, bytes: v.bytes.length, sha256: hash(v.bytes) })), cases })
  }
  fs.writeFileSync(path.join(process.argv[2], 'report.json'), JSON.stringify({ at: new Date().toISOString(), boundary: 'Generated encrypted mixed-codec blocks; Node and isolated py7zr, not device UI evidence.', results }, null, 2))
  console.log(JSON.stringify(results.map(result => ({ methods: result.methods, blocks: result.blocks, comparedMembers: result.cases.length })), null, 2))
  // Expected native extraction failures set Node's exitCode; assertions above
  // determine verifier success, not the last deliberately damaged member.
  process.exitCode = 0
}

main().catch(error => { console.error(error); process.exitCode = 1 })
