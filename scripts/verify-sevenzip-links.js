'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { sevenZipLinks, safeMembers, destinations } = require('../tests/helpers/sevenzip-links')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-sevenzip-links-')))
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const report = { at: new Date().toISOString(), oracle: execFileSync('/usr/bin/bsdtar', ['--version'], { encoding: 'utf8' }).trim(), cases: [] }
  for (const codec of ['copy', 'lzma2', 'lzma', 'ppmd']) {
    const bytes = await sevenZipLinks(safeMembers, wasmBinary, { codec })
    const file = path.join(out, `${codec}.7z`)
    const extracted = path.join(out, `${codec}-extracted`)
    fs.writeFileSync(file, bytes)
    fs.mkdirSync(extracted)
    // Only original, inspected archive-local links are extracted by the oracle.
    // Malformed/absolute/cyclic fixtures stay in the in-memory reader tests.
    execFileSync('/usr/bin/bsdtar', ['-xf', file, '-C', extracted])
    const { entries } = await seven.inspect7zArchive(bytes, { wasmBinary })
    for (const [name, target] of Object.entries(destinations)) {
      assert.equal(fs.lstatSync(path.join(extracted, name)).isSymbolicLink(), true)
      assert.equal(fs.readlinkSync(path.join(extracted, name)), safeMembers.find(m => m.name === name).target)
      const expected = Buffer.from(safeMembers.find(m => m.name === target).content)
      const oracle = fs.readFileSync(path.join(extracted, name))
      const resolved = await seven.resolveSevenZipLink(entries, entries.find(e => e.name === name), e => seven.extract7zLinkTarget(bytes, e, { wasmBinary }))
      const actual = Buffer.from(await seven.extract7zEntry(bytes, resolved.entry, { wasmBinary }))
      assert.deepEqual(oracle, expected)
      assert.deepEqual(actual, expected)
      report.cases.push({ codec, name, target, bytes: actual.length, sha256: hash(actual), exact: true })
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: report.cases.length, exact: true, report: path.join(out, 'report.json') }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
