'use strict'

// Native UnRAR is called directly, without the reader's shared header parser.
// bsdtar is an independent audit, not the authority for data-CRC rejection.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { samples } = require('../tests/helpers/rar-crc')
const { harness } = require('../tests/helpers/rar-reader')
const { createExtractorFromData } = require('../miniprogram/file-reader/archive/vendor/unrar')
const { inspectFileBytes, extractArchiveEntry } = require('../miniprogram/file-reader/engine/core/file-inspector')
const output = path.resolve(process.env.RAR_CRC_OUTPUT || 'outputs/rar-crc/oracle')
const wasm = zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br'))
const exactBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

async function main () {
  fs.mkdirSync(output, { recursive: true })
  const results = []
  for (const sample of samples()) {
    const target = path.join(output, sample.name + '.rar')
    fs.writeFileSync(target, sample.bytes)
    const result = { name: sample.name, sha256: crypto.createHash('sha256').update(sample.bytes).digest('hex'), bytes: sample.bytes.length, expected: sample.openable === false ? 'fallback-not-openable' : sample.accept ? 'byte-exact' : 'reject', baseline: sample.baseline?.fallback }
    try {
      const i = inspectFileBytes(sample.bytes, { name: 'input.rar' })
      result.fallback = i.entries[0].canOpen ? { accepted: true, hex: Buffer.from(extractArchiveEntry(sample.bytes, i.entries[0])).toString('hex') } : { accepted: false, openable: false }
    } catch (error) { result.fallback = { accepted: false, error: error.message } }
    if (sample.accept) assert.equal(result.fallback.hex, sample.hex, sample.name)
    else assert.equal(result.fallback.accepted, false, sample.name)
    try {
      const extractor = await createExtractorFromData({ wasmBinary: exactBuffer(wasm), data: exactBuffer(sample.bytes) })
      const files = Array.from(extractor.extract({ files: ['entry.txt'] }).files)
      const bytes = files.find(file => file.fileHeader.name === 'entry.txt')?.extraction
      if (!bytes) throw new Error('UnRAR returned no member bytes')
      result.unrarDirect = { accepted: true, hex: Buffer.from(bytes).toString('hex') }
    } catch (error) { result.unrarDirect = { accepted: false, error: error.message, reason: error.reason } }
    try {
      const extractor = await createExtractorFromData({ wasmBinary: exactBuffer(wasm), data: exactBuffer(sample.bytes) })
      result.unrarList = { accepted: true, names: Array.from(extractor.getFileList().fileHeaders).map(header => header.name) }
    } catch (error) { result.unrarList = { accepted: false, error: error.message, reason: error.reason } }
    if (sample.baseline || sample.accept) {
      assert.equal(result.unrarList.accepted && result.unrarDirect.accepted, sample.accept, sample.name)
      if (sample.accept) assert.equal(result.unrarDirect.hex, sample.hex, sample.name)
    }
    const native = spawnSync('/usr/bin/tar', ['-xOf', target, 'entry.txt'])
    result.libarchive = { status: native.status, hex: native.stdout.toString('hex'), stderr: native.stderr.toString(), error: native.error?.message }
    results.push(result)
  }
  const fullEntry = []
  const previous = global.WXWebAssembly
  try {
    for (const mode of ['no-wasm', 'native-wasm']) {
      if (mode === 'native-wasm') global.WXWebAssembly = { instantiate: (_path, imports) => WebAssembly.instantiate(wasm, imports) }
      else delete global.WXWebAssembly
      const h = harness()
      try {
        for (const sample of samples().filter(sample => !sample.nativeOnly)) {
          const before = h.writes.length
          await h.open(sample)
          const archiveType = h.page._inspectorVisibleEntries?.[0]?.archiveType || null
          const summary = h.page.data.inspectorSummary
          if (h.page._inspectorVisibleEntries?.[0]?.canOpen) await h.tap()
          const row = { name: sample.name, mode, archiveType, summary, writes: h.writes.length - before, error: h.page.data.error, text: h.page._htmlRuntime?.document.body.textContent || null, outputHex: h.writes.length > before ? h.writes.at(-1).toString('hex') : null }
          if (sample.accept) assert.equal(row.outputHex, sample.hex, sample.name)
          else { assert.equal(row.writes, 0, sample.name); assert.ok(row.error, sample.name) }
          fullEntry.push(row)
        }
      } finally { h.page._htmlRuntime?.destroy() }
    }
  } finally { if (previous === undefined) delete global.WXWebAssembly; else global.WXWebAssembly = previous }
  const report = { schemaVersion: 1, id: 'rar-crc', date: '2026-09-05', version: require('../package.json').version, source: 'tests/helpers/rar-crc.js plus retained 13 pre-fix exact archives', specification: 'https://www.rarlab.com/technote.htm', node: process.version, libarchiveVersion: spawnSync('/usr/bin/tar', ['--version'], { encoding: 'utf8' }).stdout.trim(), results, fullEntry, oracleAudit: 'Direct UnRAR data/header CRC errors are authoritative together with RARLAB field semantics. bsdtar -xO accepts the invalid data checksums in these fixtures. Native accepted malformed metadata, if any, is retained separately; explicit local header bounds remain required.', platforms: { nodeComponent: 'pass', wechatDevtools: 'not-run: existing compiler startup failure', ios: 'not-run', android: 'not-run' } }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ samples: results.length, fullEntry: fullEntry.length, directNativeDifferences: results.filter(row => row.expected === 'reject' && row.unrarList.accepted && row.unrarDirect.accepted).map(row => row.name), report: path.join(output, 'report.json') }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
