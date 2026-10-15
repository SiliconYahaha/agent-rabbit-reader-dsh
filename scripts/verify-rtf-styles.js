'use strict'

// Run the actual RTF files through Writer twice: PDF and unmodified HTML.
// PDF is essential: Writer's HTML export drops some explicit v0 overrides.
// Requires LibreOffice and a Python interpreter with pdfplumber installed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict'), crypto = require('node:crypto'), vm = require('node:vm')
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url'), { execFileSync } = require('node:child_process')
const { chromeTestResult } = require('./chrome-test-result')
const { cases, rules, seed } = require('../tests/fixtures/rtf-styles/samples.json')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const base = path.resolve(process.argv[2] || os.tmpdir())
fs.mkdirSync(base, { recursive: true })
const out = fs.mkdtempSync(path.join(base, 'rtf-styles-'))
const run = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const baselineCommit = process.env.BASELINE_REF
if (!baselineCommit) throw new Error('Set BASELINE_REF to a local comparison commit before running this historical comparison')
const filename = path.resolve(__dirname, '../miniprogram/file-reader/engine/core/rtf-reader.js')
const context = { module: { exports: {} }, require: createRequire(filename), Uint8Array }
vm.runInNewContext(run('git', ['show', baselineCommit + ':miniprogram/file-reader/engine/core/rtf-reader.js']), context)
const samples = cases.map(sample => {
  const bytes = Buffer.from(sample.source), file = path.join(out, sample.name + '.rtf')
  assert.equal(hash(bytes), sample.sha256, sample.name)
  fs.writeFileSync(file, bytes, { flag: 'wx' })
  return { ...sample, file, reader: rtfToText(bytes), baseline: context.module.exports.rtfToText(bytes) }
})
const executable = process.env.RTF_LIBREOFFICE || 'soffice'
const flags = ['-env:UserInstallation=' + pathToFileURL(path.join(out, 'profile')).href, '--headless']
const writer = run(executable, [...flags, '--version']).trim()
for (const format of ['html', 'pdf']) fs.writeFileSync(path.join(out, format + '.log'), run(executable, [...flags, '--convert-to', format, '--outdir', out, ...samples.map(s => s.file)]))
const pdfScript = `import json,sys,pdfplumber\nrows=[]\nfor file in json.load(sys.stdin):\n with pdfplumber.open(file) as doc:\n  rows.append({'text':'\\n'.join(page.extract_text() or '' for page in doc.pages).strip(),'pages':len(doc.pages)})\nprint(json.dumps(rows))\n`
const pdf = JSON.parse(run(process.env.RTF_PYTHON || 'python3', ['-c', pdfScript], JSON.stringify(samples.map(s => path.join(out, s.name + '.pdf')))))
const views = samples.map(s => ({ name: s.name, html: fs.readFileSync(path.join(out, s.name + '.html'), 'utf8') }))
async function browserRunner (views) {
  const frame = document.querySelector('iframe'), rows = []
  for (const view of views) {
    await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = view.html })
    rows.push({ name: view.name, text: [...frame.contentDocument.querySelectorAll('p')].map(p => p.innerText.trim()).join('\n').trim() })
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  const html = '<!doctype html><output></output><iframe sandbox="allow-same-origin"></iframe><script>(' + browserRunner + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>'
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let dump
  try { dump = await chromeTestResult('http://127.0.0.1:' + server.address().port) } finally { server.close() }
  const found = dump.match(/data-result="([^"]+)"/)
  assert.ok(found, dump.slice(-2000))
  const visible = JSON.parse(decodeURIComponent(found[1]))
  assert.equal(visible.length, samples.length)
  assert.equal(pdf.length, samples.length)
  const results = samples.map((s, index) => ({ name: s.name, sourceSha256: s.sha256, expected: s.expected, oracle: s.oracle, expectedBasis: s.expectedBasis, reader: s.reader, baseline: s.baseline,
    writerPdf: pdf[index], writerHtmlChrome: visible[index].text,
    pdfSha256: hash(fs.readFileSync(path.join(out, s.name + '.pdf'))), htmlSha256: hash(fs.readFileSync(path.join(out, s.name + '.html'))),
    pdfMatchesExpected: pdf[index].text === s.expected, htmlMatchesExpected: visible[index].text === s.expected }))
  const report = { testedAt: new Date().toISOString(), seed, rules, baselineCommit, writer, node: process.version,
    cases: results.length, baselineWrong: results.filter(r => r.baseline !== r.expected).length,
    readerMatches: results.filter(r => r.reader === r.expected).length, pdfMatches: results.filter(r => r.pdfMatchesExpected).length,
    htmlMatches: results.filter(r => r.htmlMatchesExpected).length, results,
    references: ['https://latex2rtf.sourceforge.net/rtfspec_6.html'],
    limitations: ['PDF text checks do not certify rich layout. Separately record rendered-page visual review.', 'Writer HTML export differences remain explicit; expected text is not replaced with its lossy output.', 'Mid-paragraph paragraph-style binding differences remain separate exploration work.', 'No WeChat DevTools or physical-device result.'] }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  for (const r of results) {
    assert.equal(r.reader, r.expected, r.name + ': reader')
    if (r.oracle === 'writer-html') assert.equal(r.writerHtmlChrome, r.expected, r.name + ': actual Writer HTML/Chrome')
    else assert.equal(r.writerPdf.text, r.expected, r.name + ': actual Writer PDF')
  }
  console.log(JSON.stringify({ out, cases: report.cases, baselineWrong: report.baselineWrong, readerMatches: report.readerMatches, pdfMatches: report.pdfMatches, htmlMatches: report.htmlMatches }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
