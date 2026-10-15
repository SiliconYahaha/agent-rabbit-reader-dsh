'use strict'

// Writer imports the actual generated RTF files and exports unmodified HTML.
// Chrome innerText checks what that independent document visibly displays.
// Cocoa plain-text export is recorded as a difference, never a display oracle.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const http = require('node:http'), crypto = require('node:crypto'), vm = require('node:vm')
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url')
const { execFileSync, execFile } = require('node:child_process'), { promisify } = require('node:util')
const assert = require('node:assert/strict')
const { cases, malformed, seed } = require('../tests/helpers/rtf-hidden')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const out = fs.mkdtempSync(path.join(path.resolve(process.argv[2] || os.tmpdir()), 'rtf-hidden-'))
const converted = path.join(out, 'converted'), profile = path.join(out, 'profile')
fs.mkdirSync(converted); fs.mkdirSync(profile)
const run = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
const baselineCommit = process.env.BASELINE_REF
if (!baselineCommit) throw new Error('Set BASELINE_REF to a local comparison commit before running this historical comparison')
const filename = path.resolve(__dirname, '../miniprogram/file-reader/engine/core/rtf-reader.js')
const context = { module: { exports: {} }, require: createRequire(filename), Uint8Array }
vm.runInNewContext(run('git', ['show', baselineCommit + ':miniprogram/file-reader/engine/core/rtf-reader.js']), context)
const samples = cases.map(sample => {
  const bytes = Buffer.from(sample.source), file = path.join(out, sample.name + '.rtf')
  fs.writeFileSync(file, bytes)
  return { ...sample, file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    reader: rtfToText(bytes), baseline: context.module.exports.rtfToText(bytes) }
})
const executable = process.env.RTF_LIBREOFFICE || 'soffice'
const flags = ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless']
const version = run(executable, [...flags, '--version']).trim()
fs.writeFileSync(path.join(out, 'writer.log'), run(executable, [...flags, '--convert-to', 'html', '--outdir', converted, ...samples.map(s => s.file)]))
const views = samples.map(s => ({ name: s.name, html: fs.readFileSync(path.join(converted, s.name + '.html'), 'utf8') }))
async function browserRunner (views) {
  const frame = document.querySelector('iframe'), results = []
  for (const view of views) {
    await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = view.html })
    const d = frame.contentDocument
    // Paragraph boundaries are explicit, excluding browser margins between p's.
    const paragraphs = Array.from(d.body.querySelectorAll('p')).map(p => p.innerText.trim())
    results.push({ name: view.name, visibleText: paragraphs.join('\n').trim(),
      hiddenSpans: Array.from(d.body.querySelectorAll('span')).filter(n => frame.contentWindow.getComputedStyle(n).display === 'none').length })
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
async function main () {
  const html = '<!doctype html><output></output><iframe sandbox="allow-same-origin"></iframe><script>(' + browserRunner + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>'
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let stdout
  try {
    ({ stdout } = await promisify(execFile)(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ['--headless=new', '--disable-gpu', '--virtual-time-budget=10000', '--dump-dom', 'http://127.0.0.1:' + server.address().port],
      { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }))
  } finally { server.close() }
  const found = stdout.match(/data-results="([^"]+)"/)
  assert.ok(found, stdout.slice(-2000))
  const visible = JSON.parse(decodeURIComponent(found[1]))
  assert.equal(visible.length, views.length)
  const results = samples.map(s => ({
    name: s.name, sha256: s.sha256, expected: s.expected, baseline: s.baseline, reader: s.reader,
    writerChrome: visible.find(v => v.name === s.name) || null,
    cocoaText: process.platform === 'darwin' ? run('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], Buffer.from(s.source)).trim() : null,
    assertWriterMatch: s.oracle,
    oracleScope: s.oracle ? 'Writer actual RTF import -> unmodified HTML -> Chrome visible paragraph text'
      : s.name === 'binary-braces' ? 'Binary token isolation only; deliberately non-image bytes. Writer inserts an unsupported-image placeholder space.'
        : 'RTF Unicode fallback/upr specification; independent software differences recorded without changing the expected result'
  }))
  const report = { testedAt: new Date().toISOString(), seed, node: process.version, baselineCommit,
    libreOffice: version, chrome: run(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']).trim(),
    results, baselineFailures: results.filter(r => r.baseline !== r.expected).length,
    readerMatches: results.filter(r => r.reader === r.expected).length,
    writerChromeMatches: results.filter(r => r.writerChrome && r.writerChrome.visibleText === r.expected).length,
    writerChromeCases: visible.length, malformed: malformed.map(s => s.name),
    limitations: ['Not a WeChat or physical-device oracle', 'No RTF rich layout, style-table inheritance or show-hidden-text UI claim', 'Cocoa text export loses hidden formatting and is not the expected display'] }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  for (const s of malformed) assert.throws(() => rtfToText(Buffer.from(s.source)), /RTF/, s.name)
  for (const r of results) {
    assert.equal(r.reader, r.expected, r.name)
    if (r.assertWriterMatch) assert.equal(r.writerChrome.visibleText, r.expected, 'Writer/Chrome: ' + r.name)
  }
  console.log(JSON.stringify({ out, baselineFailures: report.baselineFailures, readerMatches: report.readerMatches, writerChromeMatches: report.writerChromeMatches, writerChromeCases: report.writerChromeCases }, null, 2))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
