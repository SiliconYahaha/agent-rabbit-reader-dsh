'use strict'

// Independent, local text extraction. External differences are saved, not silently
// promoted to a successful oracle match. This does not exercise WeChat's views.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases } = require('../tests/helpers/rtf-alternatives')
const samples = require('../tests/fixtures/rtf-alternatives/samples.json')

assert.equal(process.platform, 'darwin', 'This independent Cocoa check requires macOS')
assert.ok(process.argv[2], 'Supply an existing task scratch directory')
const dir = fs.mkdtempSync(path.join(path.resolve(process.argv[2]), 'rtf-evidence-'))
const inputDir = path.join(dir, 'input')
const outputDir = path.join(dir, 'libreoffice')
const profileDir = path.join(dir, 'profile')
for (const directory of [inputDir, outputDir, profileDir]) fs.mkdirSync(directory)
const normalize = value => String(value).replace(/^\ufeff/, '').trim()
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function run (command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result
}
function cocoa (bytes) {
  return normalize(run('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], bytes).stdout)
}
const originals = samples.map(sample => {
  const bytes = fs.readFileSync(path.join(__dirname, '../tests/fixtures/rtf-alternatives', sample.name))
  assert.equal(hash(bytes), sample.sha256)
  assert.equal(rtfToText(bytes), sample.expected, sample.name)
  assert.equal(cocoa(bytes), sample.expected, 'Cocoa ' + sample.name)
  fs.writeFileSync(path.join(inputDir, sample.name), bytes)
  return { ...sample, bytes: bytes.length, readerMatch: true, cocoaMatch: true }
})
const selectedNames = new Set(['body-alternative', 'no-duplicate-ascii', 'inline-ud', 'nested-selected', 'empty-selected', 'discarded-font-table'])
const selected = cases.filter(c => selectedNames.has(c.name))
for (const c of selected) fs.writeFileSync(path.join(inputDir, c.name + '.rtf'), c.source)
const executable = process.env.RTF_LIBREOFFICE || 'soffice'
const profile = '-env:UserInstallation=' + pathToFileURL(profileDir).href
const version = run(executable, [profile, '--headless', '--version']).stdout.trim()
const conversion = run(executable, [profile, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', outputDir,
  ...originals.map(c => path.join(inputDir, c.name)), ...selected.map(c => path.join(inputDir, c.name + '.rtf'))])
fs.writeFileSync(path.join(dir, 'libreoffice-log.txt'), conversion.stdout + conversion.stderr)
for (const sample of originals) {
  const text = normalize(fs.readFileSync(path.join(outputDir, sample.name.replace(/\.rtf$/, '.txt')), 'utf8'))
  assert.equal(text, sample.expected, 'LibreOffice ' + sample.name)
  sample.libreOfficeMatch = true
}
const generated = cases.map(c => {
  const reader = rtfToText(c.source)
  assert.equal(reader, c.expected, c.name)
  const result = { name: c.name, inputSHA256: hash(c.source), expected: c.expected, reader, cocoa: cocoa(Buffer.from(c.source)) }
  result.cocoaMatch = result.cocoa === c.expected
  if (selectedNames.has(c.name)) {
    result.libreOffice = normalize(fs.readFileSync(path.join(outputDir, c.name + '.txt'), 'utf8'))
    result.libreOfficeMatch = result.libreOffice === c.expected
  }
  return result
})
const report = {
  testedAt: new Date().toISOString(), node: process.version, libreOfficeVersion: version,
  cocoaVersion: run('/usr/bin/sw_vers', ['-productVersion']).stdout.trim(),
  interpretation: 'Public originals must match both independent exports. Generated upr expected text follows MSFT-RTF pp.15-16; disagreements with converters remain explicit. No WeChat validation claimed.',
  originals, generated,
  summary: { publicMatches: originals.length, generatedReaderMatches: generated.length, cocoaDifferences: generated.filter(c => !c.cocoaMatch).length, libreOfficeCases: selected.length, libreOfficeDifferences: generated.filter(c => c.libreOfficeMatch === false).length }
}
const file = path.join(dir, 'report.json')
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ file, software: version, ...report.summary }, null, 2))
