'use strict'
// Actual generated ZIP bytes are independently listed/read by Python zipfile.
// Node filesystem reads feed the production directory entry; no WeChat claim.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { zipMember } = require('../tests/helpers/zip-integrity')
const { inspectZip, extractZipEntry, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { readerPage } = require('../tests/helpers/reader-host')
const base = path.resolve(process.argv[2] || os.tmpdir()); fs.mkdirSync(base, { recursive: true })
const out = fs.mkdtempSync(path.join(base, 'zip-efs-'))
const content = 'UNIQUE VISIBLE BODY', samples = []
for (const prefix of ['ff', 'c3', 'c0af', 'eda080', 'f4908080', 'f09f9087']) for (const method of [0, 8]) for (const efs of [true, false]) {
  const name = `${prefix}-${method}-${efs}`, rawName = Buffer.concat([Buffer.from(prefix, 'hex'), Buffer.from('.txt')])
  const bytes = zipMember({ name: rawName, content, method })
  if (!efs) { bytes.writeUInt16LE(0, 6); bytes.writeUInt16LE(0, readZipDirectoryDescriptor(bytes).offset + 8) }
  const file = path.join(out, name + '.zip'); fs.writeFileSync(file, bytes, { flag: 'wx' })
  const sample = { name, prefix, method, efs, file, rawNameHex: rawName.toString('hex'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), expectedReject: efs && prefix !== 'f09f9087' }
  try {
    const row = inspectZip(bytes).entries.find(e => !e.isDirectory)
    sample.reader = { accepted: true, name: row.name, content: Buffer.from(extractZipEntry(bytes, row)).toString() }
  } catch (error) { sample.reader = { accepted: false, error: error.message, code: error.code } }
  samples.push(sample)
}
const python = `import sys,json,zipfile,platform\nrows=[]\nfor file in json.load(sys.stdin):\n try:\n  with zipfile.ZipFile(file) as z:\n   rows.append({'accepted':True,'names':z.namelist(),'content':z.read(z.namelist()[0]).decode('utf-8')})\n except Exception as e: rows.append({'accepted':False,'errorType':type(e).__name__,'error':str(e)})\nprint(json.dumps({'version':platform.python_version(),'results':rows}))\n`
const independent = JSON.parse(execFileSync(process.env.ZIP_PYTHON || 'python3', ['-c', python], { input: JSON.stringify(samples.map(s => s.file)), encoding: 'utf8', timeout: 30000 }))
async function main () {
  let pending, reads = []
  const page = readerPage({ getFileSystemManager: () => ({}) })
  page.readFileRange = async (file, start, length) => {
    reads.push({ start, length }); const fd = fs.openSync(file, 'r')
    try { const bytes = Buffer.alloc(length); assert.equal(fs.readSync(fd, bytes, 0, length, start), length); return bytes } finally { fs.closeSync(fd) }
  }
  const inspect = page.inspectZipFile
  page.inspectZipFile = function (...args) { return pending = inspect.apply(this, args) }
  try {
    for (const [index, sample] of samples.entries()) {
      sample.python = independent.results[index]
      assert.equal(sample.reader.accepted, !sample.expectedReject, sample.name)
      assert.equal(sample.python.accepted, !sample.expectedReject, sample.name + ': independent Python')
      if (!sample.expectedReject) {
        assert.equal(sample.reader.content, content); assert.equal(sample.python.content, content)
        if (sample.efs || sample.prefix !== 'f09f9087') assert.equal(sample.reader.name, sample.python.names[0], sample.name)
      } else assert.equal(sample.reader.code, 'ZIP_INVALID_UTF8_NAME')
      reads = []; page.openSelectedFile({ name: sample.name + '.zip', path: sample.file, size: fs.statSync(sample.file).size }); await pending
      sample.entry = { error: page.data.error, names: page.data.inspectorEntries.map(e => e.name), reads }
      assert.equal(reads.length, 2, sample.name + ': no unrelated whole-archive recovery')
      if (sample.expectedReject) { assert.match(sample.entry.error, /UTF-8/); assert.equal(sample.entry.names.length, 0) }
      else { assert.equal(sample.entry.error, ''); assert.deepEqual(sample.entry.names, [sample.reader.name]) }
    }
  } finally { page.detached() }
  const report = { testedAt: new Date().toISOString(), seed: null, rules: 'Six name-byte prefixes x stored/deflate x EFS set/clear; CRC-valid identical visible payloads',
    node: process.version, python: independent.version, cases: samples.length, malformedEfsRejected: samples.filter(s => s.expectedReject).length,
    validOrLegacyPayloads: samples.filter(s => !s.expectedReject).length, productionFileEntries: samples.length,
    results: samples.map(({ file, ...sample }) => sample), references: ['https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT section 4.4.4 and Appendix D.2'],
    limitations: ['Node filesystem and real production entry; not WeChat or physical devices.', 'Unflagged valid UTF-8 can be ambiguous: reader auto selects UTF-8, Python defaults CP437. Both payloads are checked; no false filename equality claimed.', 'Comments are not displayed or newly decoded.'] }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, cases: report.cases, malformedEfsRejected: report.malformedEfsRejected, validOrLegacyPayloads: report.validOrLegacyPayloads, productionFileEntries: report.productionFileEntries }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
