'use strict'

// Reproducible Writer/PDF observations. The retained mismatch classifications
// are part of the oracle audit, never replacements for the source contracts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process')
const { cases, expectedText } = require('../tests/helpers/rtf-notes')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const out = path.resolve(process.argv[2] || 'outputs/rtf-notes-reference')
const compact = s => s.replace(/\s+/g, '')
fs.mkdirSync(out, { recursive: true })
let reference
if (process.argv.includes('--writer')) {
  const input = path.join(out, 'input'), pdf = path.join(out, 'pdf')
  fs.mkdirSync(input, { recursive: true }); fs.mkdirSync(pdf, { recursive: true })
  for (const c of cases) fs.writeFileSync(path.join(input, c.name + '.rtf'), c.source)
  const writer = process.env.RTF_SOFFICE || 'soffice'
  const python = process.env.RTF_PYTHON || 'python3'
  const writerVersion = execFileSync(writer, ['--version'], { encoding: 'utf8' }).trim()
  const log = execFileSync(writer, ['-env:UserInstallation=file://' + path.join(out, 'profile'), '--headless', '--convert-to', 'pdf', '--outdir', pdf, ...cases.map(c => path.join(input, c.name + '.rtf'))], { encoding: 'utf8', timeout: 180000 })
  fs.writeFileSync(path.join(out, 'writer.log'), log)
  const pages = JSON.parse(execFileSync(python, ['-c', 'import json,pathlib,sys\nfrom pypdf import PdfReader\np=pathlib.Path(sys.argv[1])\nprint(json.dumps({f.stem:[page.extract_text() for page in PdfReader(f).pages] for f in p.glob("*.pdf")}))', pdf], { encoding: 'utf8', timeout: 30000 }))
  reference = { writerVersion, scope: 'PDF extracted body/note order and text without whitespace; exact source whitespace checked separately at core, component and Chrome. Not page layout certification.', results: cases.map(c => ({ name: c.name, sourceSha256: crypto.createHash('sha256').update(c.source).digest('hex'), pages: pages[c.name] })) }
  fs.writeFileSync(path.join(out, 'writer-reference.json'), JSON.stringify(reference, null, 2) + '\n')
} else reference = require('../tests/fixtures/rtf-notes-reference.json')
const results = cases.map(c => {
  const r = reference.results.find(r => r.name === c.name)
  assert.ok(r && r.pages.length, c.name + ' native pages')
  assert.equal(r.sourceSha256, crypto.createHash('sha256').update(c.source).digest('hex'), c.name + ' source identity')
  const actual = rtfToText(Buffer.from(c.source))
  assert.equal(actual, expectedText(c), c.name + ' exact reader contract')
  const match = compact(r.pages.join('')) === compact([c.body, ...c.footnotes, ...c.endnotes].join(''))
  let category = 'native-content-match'
  if (!match) {
    if (c.name === 'custom-mark') category = 'handwritten-custom-reference-import-adds-number; Writer-produced original confirms actual custom marker'
    else if (c.name === 'note-unicode-alternative') category = 'Writer combines ANSI and Unicode alternatives; primary RTF specification remains authoritative'
    else if (c.name === 'unicode') category = 'Writer PDF font/text mapping substitutes second Chinese glyph; codepoints retained as source contract'
    else if (['writer-circle', 'writer-wide'].includes(c.name)) category = 'Writer native numbering representation differs from the named source format'
    else if (c.name.startsWith('section-') && c.name !== 'section-roman') category = 'Writer section pagination interleaves page footnotes; restart behavior also differs in minimal import'
    else if (['arabic-start', 'alpha-lower', 'alpha-upper', 'roman-lower', 'roman-upper', 'chicago', 'circle', 'wide', 'section-roman'].includes(c.name)) category = 'Writer minimal import ignores numbering controls; full Writer-produced structures retained separately'
    else throw new Error(c.name + ' unexpected native difference: ' + JSON.stringify(r.pages))
  }
  return { ...r, readerExact: true, nativeContentMatch: match, category }
})
const report = { cases: cases.length, readerExact: results.length, nativeContentMatches: results.filter(r => r.nativeContentMatch).length, nativeDifferences: results.filter(r => !r.nativeContentMatch).length, writerVersion: reference.writerVersion, scope: reference.scope, results }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ cases: report.cases, readerExact: report.readerExact, nativeContentMatches: report.nativeContentMatches, nativeDifferences: report.nativeDifferences, out }))
