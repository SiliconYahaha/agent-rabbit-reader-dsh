'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { packedCorruptionFixture } = require('../tests/helpers/7z-packed-corruption')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-packed-corruption-'))
  fs.mkdirSync(out, { recursive: true })
  const method = process.argv[3] || null
  const fixture = await packedCorruptionFixture(wasmBinary, method ? { method, solid: 'off' } : {})
  const damagedBefore = Buffer.from(fixture.damaged)
  const options = {
    wasmBinary,
    password: fixture.password,
    maxEntrySize: 2 * 1024 * 1024,
    maxSolidDecodeBytes: 2 * 1024 * 1024
  }
  fs.writeFileSync(path.join(out, 'complete.7z'), fixture.archive)
  fs.writeFileSync(path.join(out, 'damaged-first-block.7z'), fixture.damaged)

  const damagedInspection = await seven.inspect7zArchive(fixture.damaged, options)
  assert.deepEqual(damagedInspection.entries.map(entry => entry.name), ['000-first.html', '999-second.html'])
  const first = damagedInspection.entries[0]
  const second = damagedInspection.entries[1]
  let damagedFailure
  await assert.rejects(seven.extract7zEntry(fixture.damaged, first, { ...options, passwordVerified: true }), error => {
    assert.equal(error.archiveFailure, 'data-corrupt')
    assert.equal(error.archiveIntegrity, 'packed-data')
    assert.doesNotMatch(error.message, /密码不正确/)
    damagedFailure = { failure: error.archiveFailure, integrity: error.archiveIntegrity, message: error.message }
    return true
  })
  const secondBytes = await seven.extract7zEntry(fixture.damaged, second, { ...options, passwordVerified: true })
  assert.equal(hash(secondBytes), hash(fixture.secondBody))
  assert.deepEqual(Buffer.from(fixture.damaged), damagedBefore)

  await assert.rejects(seven.inspect7zArchive(fixture.archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const completeInspection = await seven.inspect7zArchive(fixture.archive, options)
  const completeFirst = await seven.extract7zEntry(fixture.archive, completeInspection.entries[0], { ...options, passwordVerified: true })
  assert.equal(hash(completeFirst), hash(fixture.firstBody))

  let independentOracle = 'not-run (set PY7ZR_PYTHON to an isolated Python with py7zr)'
  if (process.env.PY7ZR_PYTHON) {
    independentOracle = JSON.parse(execFileSync(process.env.PY7ZR_PYTHON, [path.join(__dirname, 'oracles/7z-packed-data.py'), out], {
      encoding: 'utf8',
      timeout: 100000,
      env: { ...process.env, READER_7Z_TEST_PASSWORD: fixture.password }
    }))
    assert.deepEqual(independentOracle.damagedNames, ['000-first.html', '999-second.html'])
    assert.equal(independentOracle.damagedSecondSha256, hash(fixture.secondBody))
    assert.equal(independentOracle.completeFirstSha256, hash(fixture.firstBody))
  }

  const report = {
    at: new Date().toISOString(),
    archiveBytes: fixture.archive.length,
    archiveSha256: hash(fixture.archive),
    damagedSha256: hash(fixture.damaged),
    method: method || 'LZMA2:d=1m',
    packedDataOffset: fixture.packedDataOffset,
    nextHeaderStart: fixture.nextHeaderStart,
    entries: damagedInspection.entries.map(entry => entry.name),
    damagedFirst: damagedFailure,
    damagedSecondSha256: hash(secondBytes),
    completeFirstSha256: hash(completeFirst),
    inputUnchanged: true,
    independentOracle,
    boundary: 'Generated header-encrypted 7z with two independent solid blocks; flips one packed-data byte after the signature header and before the encrypted next header.',
    output: out
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
