'use strict'

// Exercise the production file entry and render its resulting tree in Chrome.
// Expected text is independent; this is not a WeChat device or rich-RTF oracle.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict'), { execFile } = require('node:child_process'), { promisify } = require('node:util')
const { wrap, pair, unicode } = require('../tests/helpers/rtf-alternatives')
const { encodedRtf, windowsCodepageCases } = require('../tests/helpers/rtf-samples')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-rtf-views-'))
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
const { readerPage } = require('../tests/helpers/reader-host')
let bytes
const wxStub = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }),
  getFileSystemManager: () => ({ readFile: options => options.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) })
}
const text = '中文正文：只保留这一份\nČeská republika\n<script>alert(1)</script> & 原样保留\n' + '这是一段用于检查手机宽度下自动换行的正文。'.repeat(5)
const samples = [{ name: 'generated', bytes: Buffer.from(wrap(pair('OLD PLACEHOLDER', unicode(text)))), expected: text },
  ...require('../tests/fixtures/rtf-styles/samples.json').cases.filter(c => c.expected).map(c => ({ name: 'style-' + c.name, bytes: Buffer.from(c.source), expected: c.expected })),
  ...require('../tests/helpers/rtf-hidden').cases.filter(c => c.expected).map(c => ({ name: 'hidden-' + c.name, bytes: Buffer.from(c.source), expected: c.expected })),
  ...windowsCodepageCases.map(({ encoding, codepage, source }) => ({ name: `codepage-${codepage}`, bytes: encodedRtf(source, encoding, codepage, 2), expected: source })),
  ...require('../tests/fixtures/rtf-alternatives/samples.json').map(c => ({ name: c.name.replace(/\.rtf$/, ''), bytes: fs.readFileSync(path.join(__dirname, '../tests/fixtures/rtf-alternatives', c.name)), expected: c.expected })),
  ...require('../tests/fixtures/rtf-tables/samples.json').map(c => ({ name: c.name.replace(/\.rtf$/, ''), bytes: fs.readFileSync(path.join(__dirname, '../tests/fixtures/rtf-tables', c.name)), expected: c.expected }))]
samples.push(...require('../tests/helpers/rtf-control-case').cases.filter(c => !c.knownGap).map(c => ({ name: 'control-case-' + c.name, bytes: Buffer.from(c.source), expected: c.expected })))
samples.push(...require('../tests/helpers/rtf-notes').cases.map(c => ({ name: 'notes-' + c.name, bytes: Buffer.from(c.source), expected: c.body, expectedPres: [c.body, ...c.footnotes, ...c.endnotes] })))
const views = samples.map(c => {
  bytes = c.bytes
  const page = readerPage(wxStub)
  page.openSelectedFile({ name: c.name + '.rtf', path: '/local/fixture.rtf', size: bytes.length })
  assert.equal(page.data.error, '', c.name)
  assert.equal(page.data.hasContent, true, c.name)
  const runtime = page._htmlRuntime
  try {
    if (c.expectedPres) assert.deepEqual(Array.from(runtime.document.querySelectorAll('pre')).map(n => n.textContent), c.expectedPres, c.name)
    else assert.equal(runtime.document.body.textContent.trim().normalize('NFC'), c.expected.normalize('NFC'), c.name)
    assert.equal(runtime.document.querySelector('script'), null)
    const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;${escape(tree.wrapperStyle)}">${tree.nodes.map(serialize).join('')}</body>`
    fs.writeFileSync(path.join(out, c.name + '.html'), html, { flag: 'wx' })
    return { name: c.name, expected: c.expected, expectedPres: c.expectedPres, html }
  } finally { runtime.destroy() }
})
async function runner (views) {
  const frame = document.querySelector('iframe'), results = []
  for (const view of views) {
    await new Promise(resolve => { frame.onload = resolve; frame.src = '/view/' + encodeURIComponent(view.name) })
    const d = frame.contentDocument, pre = d.querySelector('pre'), style = frame.contentWindow.getComputedStyle(pre)
    const pres = Array.from(d.querySelectorAll('pre')), anchors = Array.from(d.querySelectorAll('a[href^="#"]'))
    const anchorResults = []
    for (const a of anchors) {
      const id = a.getAttribute('href').slice(1)
      a.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      anchorResults.push(Boolean(d.getElementById(id)) && frame.contentWindow.location.hash === '#' + id)
    }
    results.push({ preTexts: pres.map(p => p.textContent), expectedPres: view.expectedPres, anchorResults, allPresFit: pres.every(p => p.scrollWidth <= p.getBoundingClientRect().width + 1), name: view.name, text: pre.textContent.trim(), expected: view.expected, color: style.color,
      lineHeight: style.lineHeight, width: pre.getBoundingClientRect().width, scrollWidth: pre.scrollWidth,
      background: frame.contentWindow.getComputedStyle(pre.parentElement).backgroundColor, scriptElements: d.querySelectorAll('script').length })
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
const html = `<!doctype html><output></output><iframe style="width:390px;height:844px" sandbox="allow-same-origin"></iframe><script>(${runner})(${JSON.stringify(views).replace(/</g, '\\u003c')}).catch(e=>document.querySelector('output').textContent=e.stack)</script>`
async function main () {
  const pages = new Map(views.map(view => ['/view/' + encodeURIComponent(view.name), view.html]))
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pages.get(req.url) || html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let stdout
  try {
    ({ stdout } = await promisify(execFile)(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--virtual-time-budget=3000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { timeout: 60000, maxBuffer: 3 * 1024 * 1024 }))
  } finally { server.close() }
  const found = stdout.match(/data-results="([^"]+)"/)
  assert.ok(found, 'No browser result: ' + stdout.slice(-1500))
  const result = JSON.parse(decodeURIComponent(found[1]))
  assert.equal(result.length, samples.length)
  for (const r of result) {
    assert.equal(r.text.normalize('NFC'), r.expected.normalize('NFC'), r.name)
    if (r.expectedPres) { assert.deepEqual(r.preTexts, r.expectedPres, r.name + ' all note content'); assert.ok(r.anchorResults.length && r.anchorResults.every(Boolean), r.name + ' reciprocal anchors') }
    assert.equal(r.allPresFit, true, r.name + ' notes horizontal clipping')
    assert.equal(r.scriptElements, 0, r.name)
    assert.equal(r.background, 'rgb(255, 255, 255)', r.name)
    assert.notEqual(r.color, r.background, r.name)
    assert.ok(r.width >= 300 && r.width <= 390 && r.scrollWidth <= r.width + 1, r.name + ' horizontal clipping')
    assert.ok(parseFloat(r.lineHeight) >= 24, r.name + ' line height')
  }
  fs.writeFileSync(path.join(out, 'views.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ checked: result.length, output: out, result }, null, 2))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
