'use strict'
// Install playwright outside the product tree and set HTML_READER_PLAYWRIGHT.
// Browser check measures the actual reader DOM tree, with identical typography
// on the independent reference, to isolate code bytes and tab placement.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT || 'playwright')
const { cases } = require('../tests/helpers/markdown-quote-tabs')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/markdown-quote-tabs-browser')
  fs.mkdirSync(out, { recursive: true })
  let bytes
  const host = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const views = []
  try {
    for (const sample of cases.filter(c => !c.source.includes('<script>') && !c.source.includes('<style>'))) {
      bytes = Buffer.from(sample.source)
      host.openSelectedFile({ name: sample.name + '.md', path: '/local/quote.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '', sample.name)
      const runtime = host._htmlRuntime
      const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
      views.push({ name: sample.name, actual: tree.nodes.map(serialize).join(''), reference: sample.referenceHtml })
    }
  } finally { host.disposeHtmlRuntime() }
  const browser = await chromium.launch({ executablePath: process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  let rows, version
  try {
    version = browser.version()
    const page = await browser.newPage()
    rows = await page.evaluate(async views => {
      const rows = []
      for (const view of views) {
        const row = { name: view.name }
        for (const key of ['actual', 'reference']) {
          const frame = document.createElement('iframe'); frame.width = '1000'; frame.height = '844'; document.body.append(frame)
          await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = '<style>pre,code{font:14px monospace!important;tab-size:4!important;padding:0!important;margin:0!important}</style>' + view[key] })
          const d = frame.contentDocument
          row[key] = { quotes: d.querySelectorAll('blockquote').length, code: [...d.querySelectorAll('pre')].map(pre => {
            const range = d.createRange(); range.selectNodeContents(pre)
            const selected = range.toString(), glyphs = [], walker = d.createTreeWalker(pre, 4)
            let node, origin
            while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++) {
              range.setStart(node, i); range.setEnd(node, i + 1)
              const r = range.getBoundingClientRect()
              if (!origin && r.height) origin = r
              if (/[^ \t\r\n]/.test(node.data[i])) glyphs.push({ char: node.data[i], x: Math.round((r.x - origin.x) * 64) / 64, y: Math.round((r.y - origin.y) * 64) / 64 })
            }
            return { text: pre.textContent, selected, glyphs }
          }) }
          frame.remove()
        }
        rows.push(row)
      }
      return rows
    }, views)
  } finally { await browser.close() }
  // Blink LayoutUnit uses six fractional bits. Subtracting independently
  // rounded range edges can differ by one unit when the host splits text nodes.
  // Preserve exact geometry mismatches and measured deltas; text is exact.
  // https://chromium.googlesource.com/chromium/src/+/96b04b8744c3300c980cd87bc41cc3444d463fb0/third_party/blink/renderer/platform/geometry/layout_unit.h
  let maxGlyphDelta = 0
  const failures = rows.filter(row => {
    if (row.actual.quotes !== row.reference.quotes || row.actual.code.length !== row.reference.code.length) return true
    return row.actual.code.some((a, i) => {
      const b = row.reference.code[i]
      if (a.text !== b.text || a.selected !== b.selected || a.glyphs.length !== b.glyphs.length) return true
      return a.glyphs.some((g, j) => {
        const h = b.glyphs[j], delta = Math.max(Math.abs(g.x - h.x), Math.abs(g.y - h.y))
        maxGlyphDelta = Math.max(maxGlyphDelta, delta)
        return g.char !== h.char || delta > 1 / 64
      })
    })
  }).map(row => row.name)
  const exactGeometryDifferences = rows.filter(row => JSON.stringify(row.actual) !== JSON.stringify(row.reference)).map(row => row.name)
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), chrome: version, cases: rows.length, failures, maxGlyphDelta, exactGeometryDifferences, scope: 'Native Chrome rendering of actual reader trees; exact code/selection, glyph placement within one Blink layout unit (1/64px). Not pixel equality or WeChat WXML/device proof.', rows }, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, failures, maxGlyphDelta, exactGeometryDifferences: exactGeometryDifferences.length }))
  assert.deepEqual(failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 })
