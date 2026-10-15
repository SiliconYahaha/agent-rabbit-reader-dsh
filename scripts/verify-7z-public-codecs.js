'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync, spawnSync } = require('node:child_process')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const commit = '9313b877941434d9830aa4b3b700c2ae2ee68c7d'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function uudecode (text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => /^begin \d{3} /.test(line))
  assert.ok(start >= 0)
  const chunks = []
  for (const line of lines.slice(start + 1)) {
    if (line === 'end') break
    const size = (line.charCodeAt(0) - 32) & 63
    const bytes = []
    for (let i = 1; bytes.length < size; i += 4) {
      const [a, b, c, d] = [0, 1, 2, 3].map(offset => (line.charCodeAt(i + offset) - 32) & 63)
      bytes.push((a << 2 | b >> 4) & 255, (b << 4 | c >> 2) & 255, (c << 6 | d) & 255)
    }
    chunks.push(Buffer.from(bytes.slice(0, size)))
  }
  return Buffer.concat(chunks)
}

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-public-codecs-'))
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const results = []
  const requested = process.argv.slice(3)
  const names = requested.length ? requested : ['test_read_format_7zip_ppmd.7z', 'test_read_format_7zip_delta4_lzma2.7z', 'test_read_format_7zip_bcj2_copy_1.7z']
  for (const name of names) {
    assert.match(name, /^test_read_format_7zip_[a-z0-9_]+\.7z$/)
    const source = `https://raw.githubusercontent.com/libarchive/libarchive/${commit}/libarchive/test/${name}.uu`
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
    assert.equal(response.status, 200)
    const encoded = await response.text()
    assert.ok(encoded.length < 2 * 1024 * 1024)
    const bytes = uudecode(encoded)
    const file = path.join(out, name)
    fs.writeFileSync(file, bytes)
    const entries = (await seven.inspect7zArchive(bytes, { wasmBinary })).entries
    const oracleNames = execFileSync('/usr/bin/tar', ['-tf', file], { encoding: 'utf8', timeout: 30000 }).trim().split('\n').filter(Boolean).map(n => n.replace(/\/$/, ''))
    assert.deepEqual(entries.map(e => e.name.replace(/\/$/, '')).sort(), oracleNames.sort())
    const members = []
    for (const entry of entries.filter(e => !e.isDirectory)) {
      const actual = Buffer.from(await seven.extract7zEntry(bytes, entry, { wasmBinary }))
      const tar = spawnSync('/usr/bin/tar', ['-xOf', file, entry.name], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 })
      let oracle = 'macOS bsdtar/libarchive'
      let oracleLimitation
      if (tar.error) throw tar.error
      if (tar.status === 0) {
        assert.deepEqual(actual, tar.stdout)
      } else {
        assert.ok(process.env.PY7ZR_PYTHON, 'bsdtar failed; an independent py7zr result is required, not an assumed pass')
        const fallback = JSON.parse(execFileSync(process.env.PY7ZR_PYTHON, [path.join(__dirname, 'oracles/7z-packed-data.py'), out, name, entry.name, 'public-oracle'], {
          encoding: 'utf8', timeout: 30000, env: { ...process.env, READER_7Z_TEST_PASSWORD: '' }
        }))
        assert.equal(hash(actual), fallback.sha256)
        oracle = 'py7zr (separate implementation)'
        oracleLimitation = { bsdtarExit: tar.status, stderr: tar.stderr.toString().trim() }
      }
      members.push({ name: entry.name, bytes: actual.length, sha256: hash(actual), oracle, oracleLimitation })
    }
    results.push({ name, source, sourceCommit: commit, archiveSha256: hash(bytes), members, license: 'Per-fixture redistribution license not established; local verification only, not committed or redistributed', boundary: 'Public unencrypted codec examples; encryption/damage combinations use generated samples separately.' })
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
