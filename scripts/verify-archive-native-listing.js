'use strict'

const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { files, names, nativeNamesArchive } = require('../tests/helpers/archive-native-names')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function uudecode (text) {
  const lines = text.split(/\r?\n/), start = lines.findIndex(line => /^begin \d{3} /.test(line))
  assert.ok(start >= 0)
  const parts = []
  for (const line of lines.slice(start + 1)) {
    if (line === 'end') break
    const n = (line.charCodeAt(0) - 32) & 63, bytes = []
    for (let i = 1; bytes.length < n; i += 4) {
      const a = (line.charCodeAt(i) - 32) & 63, b = (line.charCodeAt(i + 1) - 32) & 63, c = (line.charCodeAt(i + 2) - 32) & 63, d = (line.charCodeAt(i + 3) - 32) & 63
      bytes.push((a << 2 | b >> 4) & 255, (b << 4 | c >> 2) & 255, (c << 6 | d) & 255)
    }
    parts.push(Buffer.from(bytes.slice(0, n)))
  }
  return Buffer.concat(parts)
}
async function main () {
  const oracle = process.env.RABBIT_7ZIP_ORACLE
  assert.ok(oracle, 'Set RABBIT_7ZIP_ORACLE to an independently compiled unmodified 7-Zip 24.09 CLI')
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'archive-native-oracle-')); fs.mkdirSync(out, { recursive: true })
  const results = { at: new Date().toISOString(), oracleBanner: execFileSync(oracle, [], { encoding: 'utf8' }).split('\n').slice(0, 4), generated: [], public: [] }
  for (const format of ['zip', '7z', 'encrypted-7z']) {
    const password = format === 'encrypted-7z' ? 'native-fixture-password' : ''
    const bytes = await nativeNamesArchive(wasmBinary, format, password)
    const file = path.join(out, format === 'zip' ? 'generated.zip' : format + '.7z'); fs.writeFileSync(file, bytes)
    const outputRoot = fs.mkdtempSync(path.join(out, 'native-extract-'))
    execFileSync(oracle, ['x', file, '-y', `-o${outputRoot}`, ...(password ? ['-p' + password] : [])], { maxBuffer: 4 * 1024 * 1024 })
    const actual = []
    const visit = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) visit(p); else actual.push(path.relative(outputRoot, p)) } }
    visit(outputRoot)
    assert.deepEqual(actual.sort(), names.slice().sort())
    for (const name of names) assert.deepEqual(fs.readFileSync(path.join(outputRoot, name)), files[name])
    results.generated.push({ format, members: names.length, archiveSha256: hash(bytes), identitiesAndBytesEqual: true })
  }
  // Independent producer too: use native CLI to create an encrypted archive.
  const inputRoot = fs.mkdtempSync(path.join(out, 'native-input-'))
  for (const [name, bytes] of Object.entries(files)) { const file = path.join(inputRoot, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes) }
  const produced = path.join(out, 'native-produced.7z')
  execFileSync(oracle, ['a', '-t7z', '-ms=on', '-pnative-producer', '-mhe=on', produced, '--', ...names], { cwd: inputRoot, maxBuffer: 4 * 1024 * 1024 })
  const producedBytes = fs.readFileSync(produced), options = { wasmBinary, password: 'native-producer' }
  const producedEntries = (await seven.inspect7zArchive(producedBytes, options)).entries.filter(e => !e.isDirectory)
  assert.deepEqual(producedEntries.map(e => e.name).sort(), names.slice().sort())
  for (const entry of producedEntries) assert.deepEqual(Buffer.from(await seven.extract7zEntry(producedBytes, entry, options)), files[entry.name])
  results.nativeProduced = { archiveSha256: hash(producedBytes), members: producedEntries.length, identitiesAndBytesEqual: true }
  const commit = '9313b877941434d9830aa4b3b700c2ae2ee68c7d'
  for (const name of ['test_read_format_7zip_ppmd.7z', 'test_read_format_7zip_delta4_lzma2.7z', 'test_read_format_7zip_bcj2_copy_1.7z']) {
    const source = `https://raw.githubusercontent.com/libarchive/libarchive/${commit}/libarchive/test/${name}.uu`
    const response = await fetch(source); assert.equal(response.status, 200)
    const encoded = await response.text(); assert.ok(encoded.length < 2 * 1024 * 1024)
    const bytes = uudecode(encoded), file = path.join(out, name); fs.writeFileSync(file, bytes)
    const entries = (await seven.inspect7zArchive(bytes, { wasmBinary })).entries
    const nativeNames = execFileSync('/usr/bin/tar', ['-tf', file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(n => n.replace(/\/$/, ''))
    assert.deepEqual(entries.map(e => e.name.replace(/\/$/, '')).sort(), nativeNames.sort())
    const members = []
    for (const entry of entries.filter(e => !e.isDirectory)) {
      const actual = Buffer.from(await seven.extract7zEntry(bytes, entry, { wasmBinary }))
      const native = execFileSync(oracle, ['x', '-so', '-spd', file, '--', entry.name], { maxBuffer: 20 * 1024 * 1024 })
      const tar = execFileSync('/usr/bin/tar', ['-xOf', file, entry.name], { maxBuffer: 20 * 1024 * 1024 })
      assert.deepEqual(actual, native); assert.deepEqual(actual, tar)
      members.push({ name: entry.name, bytes: actual.length, sha256: hash(actual) })
    }
    results.public.push({ name, source, sourceCommit: commit, license: 'Per-fixture license not established; local verification only, not redistributed', archiveSha256: hash(bytes), members, independentOracles: ['7-Zip 24.09 native', 'macOS libarchive/tar'] })
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
