'use strict'

// Extract only this repository's authored, archive-local fixtures. In particular,
// no private/user archives or absolute/escaping links are passed to the OS.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto'), zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { tar } = require('../tests/helpers/tar-fixtures')
const runtime = require(process.argv[3] ? path.resolve(process.argv[3]) : '../miniprogram/file-reader/archive/tar-runtime')
const hardSamples = require('../tests/helpers/tar-hard-components')
const baseline = require('../compatibility/runs/2026-09-12-next-tar-link-components.json').originalBatch

async function main () {
  const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-tar-components-')))
  fs.mkdirSync(out, { recursive: true })
  const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br'))) }
  const report = { at: new Date().toISOString(), oracle: execFileSync('/usr/bin/tar', ['--version'], { encoding: 'utf8' }).trim(), scope: 'Native filesystem realpath and readFile after bsdtar extraction; actual reader listing, link resolution and extracted body. No WXML or physical device proof.', rows: [] }
  for (const format of ['ustar', 'gnu', 'pax']) for (const sample of baseline.specs) {
    const dir = path.join(out, format + '-' + sample.name), extracted = path.join(dir, 'extracted')
    fs.mkdirSync(extracted, { recursive: true })
    const bytes = tar(sample.members, format), archive = path.join(dir, 'input.tar')
    fs.writeFileSync(archive, bytes)
    execFileSync('/usr/bin/tar', ['-xf', archive, '-C', extracted])
    let native
    try {
      const full = path.join(extracted, sample.selected), resolved = fs.realpathSync.native(full)
      assert.ok(resolved.startsWith(extracted + '/'), 'oracle must remain within authored fixture')
      native = { resolved: path.relative(extracted, resolved), body: fs.readFileSync(full, 'utf8') }
    } catch (error) {
      assert.ok(['ENOENT', 'ENOTDIR'].includes(error.code), error.stack)
      native = { error: error.code }
    }
    const recorded = baseline.rows.find(r => r.format === 'ustar' && r.name === sample.name).native
    assert.deepEqual(native, recorded, sample.name + ': independent oracle changed')
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    let reader
    try {
      const resolved = runtime.resolveTarLink(entries, entries.find(e => e.name === sample.selected))
      reader = { resolved: resolved.entry.name, body: Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString('utf8') }
    } catch (error) { reader = { error: error.message } }
    const exact = native.body !== undefined ? reader.body === native.body : Boolean(reader.error)
    report.rows.push({ name: sample.name, format, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), native, reader, exact })
  }
  // bsdtar's default extraction policy rejects hard targets through symlinks
  // or '..' even when archive-local. -P is limited to these fixed authored
  // cases (no absolute names or paths outside extracted); it is not reader policy.
  for (const format of ['ustar', 'gnu', 'pax']) for (const sample of hardSamples) {
    const dir = path.join(out, format + '-' + sample.name), extracted = path.join(dir, 'extracted')
    fs.mkdirSync(extracted, { recursive: true })
    const bytes = tar(sample.members, format), archive = path.join(dir, 'input.tar')
    fs.writeFileSync(archive, bytes)
    const extraction = require('node:child_process').spawnSync('/usr/bin/tar', ['-xPf', archive, '-C', extracted], { encoding: 'utf8' })
    assert.equal(extraction.status, sample.body === null ? 1 : 0, extraction.stderr)
    let native
    if (sample.body === null) {
      assert.equal(fs.existsSync(path.join(extracted, sample.selected)), false)
      native = { error: extraction.stderr.trim() }
    } else {
      const full = path.join(extracted, sample.selected)
      assert.ok(fs.realpathSync.native(full).startsWith(extracted + '/'))
      native = { body: fs.readFileSync(full, 'utf8') }
      assert.equal(native.body, sample.body)
      assert.equal(fs.statSync(full).nlink, 2)
    }
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    let reader
    try {
      const resolved = runtime.resolveTarLink(entries, entries.find(e => e.name === sample.selected))
      reader = { resolved: resolved.entry.name, body: Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString() }
    } catch (error) { reader = { error: error.message } }
    report.rows.push({ name: sample.name, format, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), native, reader, exact: sample.body === null ? Boolean(reader.error) : reader.body === native.body })
  }
  report.failures = report.rows.filter(row => !row.exact).map(row => row.format + '/' + row.name)
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: report.rows.length, failures: report.failures, report: path.join(out, 'report.json') }))
  assert.deepEqual(report.failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 })
