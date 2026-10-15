'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url'), { createRequire } = require('node:module')
const vm = require('node:vm')
const { cases, seed } = require('../tests/helpers/rtf-korean-cases')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const out = path.resolve(process.argv[2] || 'outputs/rtf-korean/oracles')
const run = (program, args, input) => execFileSync(program, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
fs.mkdirSync(out, { recursive: true })
const converted = path.join(out, 'converted'); fs.mkdirSync(converted, { recursive: true })
const baseline = process.env.BASELINE_REF
if (!baseline) throw new Error('Set BASELINE_REF to a local comparison commit before running this historical comparison')
const filename = path.resolve(__dirname, '../miniprogram/file-reader/engine/core/rtf-reader.js')
const context = { module: { exports: {} }, require: createRequire(filename), Uint8Array }
vm.runInNewContext(run('git', ['show', baseline + ':miniprogram/file-reader/engine/core/rtf-reader.js']), context)
const files = cases.map(sample => {
  const file = path.join(out, sample.id + '.rtf')
  fs.writeFileSync(file, Buffer.from(sample.rtf, 'latin1'))
  return file
})
const writer = process.env.RTF_LIBREOFFICE || 'soffice'
const flags = ['-env:UserInstallation=' + pathToFileURL(path.join(out, 'writer-profile')).href, '--headless']
const version = run(writer, [...flags, '--version']).trim()
fs.writeFileSync(path.join(out, 'writer.log'), run(writer, [...flags, '--convert-to', 'txt:Text', '--outdir', converted, ...files]))
const results = cases.map(sample => {
  const bytes = Buffer.from(sample.rtf, 'latin1'), reader = rtfToText(bytes)
  let priorText, priorError
  try { priorText = context.module.exports.rtfToText(bytes) } catch (error) { priorError = error.message }
  const libreoffice = fs.readFileSync(path.join(converted, sample.id + '.txt'), 'utf8').replace(/^\ufeff/, '').replace(/\n$/, '')
  const cocoa = process.platform === 'darwin' ? run('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], bytes).replace(/\n$/, '') : null
  assert.equal(reader, sample.expected, sample.id + ' exact reader text')
  const writerDifference = ['extended-hangul-mixed-raw-hex', 'seeded-hangul-hanja-ascii-mixed-raw-hex'].includes(sample.id)
  const cocoaDifference = sample.id.endsWith('-font-codepage') || ['split-run-document', 'split-run-group-switch', 'split-run-mixed-raw-hex'].includes(sample.id)
  if (!writerDifference) assert.equal(libreoffice, sample.expected, sample.id + ' Writer reference')
  if (cocoa !== null && !cocoaDifference) assert.equal(cocoa, sample.expected, sample.id + ' Cocoa reference')
  // Differences are retained in full. No reference text is substituted for the
  // independent Python bytes or the normative font-codepage/fallback contract.
  return { id: sample.id, fileSha256: hash(bytes), expected: sample.expected, reader, priorText, priorError,
    libreoffice, libreofficeMatches: libreoffice === sample.expected, cocoa, cocoaMatches: cocoa === null ? null : cocoa === sample.expected }
})
const report = { at: new Date().toISOString(), seed, baseline, node: process.version, libreOffice: version,
  sources: ['https://docs.python.org/3/library/codecs.html#standard-encodings', 'https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf pp.12-14,19-20'],
  readerMatches: results.length, priorFailures: results.filter(r => r.priorError || r.priorText !== r.expected).length,
  libreofficeMatches: results.filter(r => r.libreofficeMatches).length, cocoaMatches: results.filter(r => r.cocoaMatches).length,
  results, boundary: 'Plain-text content and decoding, no rich RTF layout, pictures, or physical-device claim. Native-software differences retained.' }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ cases: results.length, priorFailures: report.priorFailures, readerMatches: report.readerMatches, libreofficeMatches: report.libreofficeMatches, cocoaMatches: report.cocoaMatches, out }))
