'use strict'

// Original, deterministic archives. Python reads members without creating links
// on disk; bsdtar streams regular members to stdout. No user files are used.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { header, paxField, tar } = require('../tests/helpers/tar-fixtures')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const wasmBinary = require('node:zlib').brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
function checksum (bytes) {
  bytes.fill(32, 148, 156)
  bytes.write(bytes.subarray(0, 512).reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return bytes
}
function cases () {
  const result = []
  for (const format of ['ustar', 'gnu', 'pax', 'base256', 'pax-size']) for (const size of [0, 1, 511, 512, 513, 4095, 4096]) {
    const body = Buffer.from(Array.from({ length: size }, (_, i) => (i * 73 + 19) & 255))
    let bytes
    if (format === 'base256' || format === 'pax-size') {
      const block = header('body.bin', body)
      if (format === 'base256') {
        block.fill(0, 124, 136); block[124] = 128; block.writeBigUInt64BE(BigInt(size), 128)
      } else block.write('00000000000\0', 124)
      checksum(block)
      bytes = Buffer.concat([...(format === 'pax-size' ? [header('PaxHeader', paxField('size', String(size)), 'x')] : []), block, header('after.txt', 'AFTER'), Buffer.alloc(1024)])
    } else bytes = tar([{ name: 'body.bin', body }, { name: 'after.txt', body: 'AFTER' }], format)
    result.push({ name: format + '-' + size, bytes, expected: [{ name: 'body.bin', body }, { name: 'after.txt', body: Buffer.from('AFTER') }], bsd: true })
  }
  for (const format of ['ustar', 'gnu', 'pax']) result.push({
    name: format + '-hard-snapshot',
    bytes: tar([{ name: 'body.txt', body: 'FIRST' }, { name: 'first.txt', type: '1', target: 'body.txt' }, { name: 'body.txt', body: 'SECOND' }, { name: 'second.txt', type: '1', target: 'body.txt' }], format),
    expected: [{ name: 'first.txt', body: Buffer.from('FIRST') }, { name: 'second.txt', body: Buffer.from('SECOND') }], bsd: false
  })
  return result
}
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/tar-entry/extended-boundaries')
  fs.mkdirSync(out, { recursive: true })
  const rows = []
  for (const sample of cases()) {
    const filename = path.join(out, sample.name + '.tar'); fs.writeFileSync(filename, sample.bytes)
    const row = { name: sample.name, sha256: hash(sample.bytes), base64: sample.bytes.toString('base64'), members: [] }
    let info
    try { info = await runtime.inspectTarArchive(sample.bytes, { wasmBinary }) } catch (e) { row.readerError = e.message }
    for (const expected of sample.expected) {
      const member = { name: expected.name, size: expected.body.length, expectedSha256: hash(expected.body) }
      const python = spawnSync('python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1]) as t: sys.stdout.buffer.write(t.extractfile(sys.argv[2]).read())', filename, expected.name])
      member.python = { status: python.status, sha256: hash(python.stdout), exact: python.status === 0 && python.stdout.equals(expected.body), error: python.stderr.toString().trim() }
      if (sample.bsd) {
        const bsd = spawnSync('/usr/bin/tar', ['-xOf', filename, expected.name])
        member.bsdtar = { status: bsd.status, sha256: hash(bsd.stdout), exact: bsd.status === 0 && bsd.stdout.equals(expected.body), error: bsd.stderr.toString().trim() }
      }
      if (info) try {
        const selected = info.entries.find(e => e.name === expected.name)
        const resolved = selected.isLink ? runtime.resolveTarLink(info.entries, selected).entry : selected
        const actual = Buffer.from(await runtime.extractTarEntry(sample.bytes, resolved, { wasmBinary }))
        member.reader = { sha256: hash(actual), exact: actual.equals(expected.body), size: actual.length }
      } catch (e) { member.reader = { exact: false, error: e.message } }
      row.members.push(member)
    }
    rows.push(row)
  }
  const failures = rows.filter(r => r.readerError || r.members.some(m => !m.python.exact || (m.bsdtar && !m.bsdtar.exact) || !m.reader?.exact)).map(r => r.name)
  const report = { testedAt: new Date().toISOString(), generator: 'scripts/probe-tar-boundaries.js; deterministic byte i: (i*73+19)&255', node: process.version, python: spawnSync('python3', ['--version']).stdout.toString().trim(), bsdtar: spawnSync('/usr/bin/tar', ['--version']).stdout.toString().trim(), scope: 'Raw TAR body bytes and header offsets; Python reads hard-link bodies, bsdtar independently reads regular bodies. No filesystem link extraction or WeChat proof.', cases: rows.length, failures, rows }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, failures }))
  if (failures.length) process.exitCode = 1
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { cases }
