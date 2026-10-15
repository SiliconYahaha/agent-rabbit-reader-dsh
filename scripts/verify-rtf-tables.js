'use strict'

// Original RTF bytes -> independent Cocoa/LibreOffice exports. Differences in
// list numbering and cell terminators are explicit, never erased globally.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const samples = require('../tests/fixtures/rtf-tables/samples.json')
assert.equal(process.platform, 'darwin', 'Cocoa oracle requires macOS')
assert.ok(process.argv[2], 'Supply an existing task scratch directory')
const out = fs.mkdtempSync(path.join(path.resolve(process.argv[2]), 'rtf-table-evidence-'))
const profile = path.join(out, 'profile'), converted = path.join(out, 'converted')
fs.mkdirSync(profile); fs.mkdirSync(converted)
const files = samples.map(c => path.join(__dirname, '../tests/fixtures/rtf-tables', c.name))
const normalize = text => String(text).replace(/^\ufeff/, '').trim()
function run (command, args, input) {
  const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  if (r.error) throw r.error
  assert.equal(r.status, 0, r.stderr)
  return r
}
const executable = process.env.RTF_LIBREOFFICE || 'soffice'
const profileFlag = '-env:UserInstallation=' + pathToFileURL(profile).href
const version = run(executable, [profileFlag, '--headless', '--version']).stdout.trim()
const conversion = run(executable, [profileFlag, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', converted, ...files])
fs.writeFileSync(path.join(out, 'libreoffice-log.txt'), conversion.stdout + conversion.stderr)
const results = samples.map((sample, i) => {
  const bytes = fs.readFileSync(files[i]), sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, sample.sha256, sample.name)
  const reader = rtfToText(bytes)
  const cocoa = normalize(run('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], bytes).stdout)
  const libreOffice = normalize(fs.readFileSync(path.join(converted, sample.name.replace(/\.rtf$/, '.txt')), 'utf8'))
  assert.equal(reader, sample.expected, sample.name)
  assert.equal(cocoa, sample.cocoa, 'Cocoa output changed: ' + sample.name)
  assert.equal(libreOffice, sample.libreOffice, 'LibreOffice output changed: ' + sample.name)
  return { name: sample.name, sha256, reader, cocoa, libreOffice, scope: sample.scope, fullCocoaMatch: reader === cocoa, fullLibreOfficeMatch: reader === libreOffice }
})
const report = { testedAt: new Date().toISOString(), node: process.version, libreOfficeVersion: version, cocoaVersion: run('/usr/bin/sw_vers', ['-productVersion']).stdout.trim(), results, note: 'Output contracts and independent differences verified; not full RTF layout or WeChat validation.' }
const file = path.join(out, 'report.json')
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ file, publicOriginals: 3, writerGenerated: 1, expectedOutputContracts: results.length, fullCocoaMatches: results.filter(r => r.fullCocoaMatch).length, fullLibreOfficeMatches: results.filter(r => r.fullLibreOfficeMatch).length, differencesAreDocumented: true }, null, 2))
