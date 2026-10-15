'use strict'
// Usage: node scripts/verify-markdown-list-tabs-browser.js PLAYWRIGHT_MODULE CHROME_PATH [OUTPUT_DIR]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { chromium } = require(path.resolve(process.argv[2]))
const out = path.resolve(process.argv[4] || 'outputs/markdown-list-tabs-browser')
const { cases, signature } = require('../tests/helpers/markdown-list-tabs')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function main () {
  fs.mkdirSync(out, { recursive: true })
  let bytes
  const host = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: options => options.success({ data: bytes }) }) })
  const views = []
  try {
    for (const sample of cases.filter(c => c.suite === 'content' || /^quote-prefix-list-fenced-/.test(c.name))) {
      bytes = Buffer.from(sample.source)
      host.openSelectedFile({ name: sample.name + '.md', path: '/local/list-tabs.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '', sample.name)
      const runtime = host._htmlRuntime
      const originalHtml = serializeNode(runtime.document.querySelector('article'))
      assert.deepEqual(signature(originalHtml, 'content'), signature(sample.referenceHtml, 'content'), sample.name)
      const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
      views.push({ name: sample.name, source: sample.source, actual: tree.nodes.map(serialize).join(''), reference: sample.referenceHtml })
    }
  } finally { host.disposeHtmlRuntime() }
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[3]), headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 420 } })
    const rows = await page.evaluate(async views => {
      const rows = []
      for (const view of views) {
        const row = { name: view.name }
        for (const key of ['actual', 'reference', 'referenceWithReaderWhitespace']) {
          const frame = document.createElement('iframe'); frame.width = 390; frame.height = 250
          document.body.append(frame)
          await new Promise(resolve => {
            frame.onload = resolve
            frame.srcdoc = '<style>pre,code{font:14px monospace!important;tab-size:4!important;padding:0!important;margin:0!important}</style>' + view[key === 'referenceWithReaderWhitespace' ? 'reference' : key]
          })
          const doc = frame.contentDocument
          row[key] = Array.from(doc.querySelectorAll('pre,code')).filter(n => n.localName === 'pre' || !n.closest('pre')).map((node, index) => {
            if (key === 'referenceWithReaderWhitespace') {
              node.style.setProperty('white-space', row.actual[index].whiteSpace, 'important')
              node.style.setProperty('word-break', row.actual[index].wordBreak, 'important')
            }
            const origin = node.getBoundingClientRect(), glyphs = [], walker = doc.createTreeWalker(node, 4)
            let textNode
            while ((textNode = walker.nextNode())) {
              for (let i = 0; i < textNode.length; i++) {
                if (/[ \t\r\n]/.test(textNode.data[i])) continue
                const range = doc.createRange(); range.setStart(textNode, i); range.setEnd(textNode, i + 1)
                const box = range.getBoundingClientRect()
                glyphs.push({ char: textNode.data[i], x: Math.round((box.x - origin.x) * 64) / 64, y: Math.round((box.y - origin.y) * 64) / 64 })
              }
            }
            const range = doc.createRange(); range.selectNodeContents(node)
            const selection = frame.contentWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range)
            return { domText: node.textContent, rangeText: range.toString(), userSelection: selection.toString(), glyphs, whiteSpace: frame.contentWindow.getComputedStyle(node).whiteSpace, wordBreak: frame.contentWindow.getComputedStyle(node).wordBreak }
          })
          frame.remove()
        }
        rows.push(row)
      }
      return rows
    }, views.filter(v => /^content-(?:list|quote-list|list-quote)-(?:fenced|indented|raw-pre|inline)-/.test(v.name) || /^quote-prefix-list-fenced-/.test(v.name)))
    let geometryExact = 0, geometrySameWhitespaceExact = 0, selectionExact = 0, rawRangeExact = 0
    for (const row of rows) {
      const compare = key => JSON.stringify(row.actual.map(n => n[key])) === JSON.stringify(row.reference.map(n => n[key]))
      if (compare('glyphs')) geometryExact++
      if (JSON.stringify(row.actual.map(n => n.glyphs)) === JSON.stringify(row.referenceWithReaderWhitespace.map(n => n.glyphs))) geometrySameWhitespaceExact++
      if (compare('userSelection')) selectionExact++
      if (compare('rangeText')) rawRangeExact++
    }
    const summary = { originalHostDocuments: views.length, browserCases: rows.length, geometryExact, geometrySameWhitespaceExact, selectionExact, rawRangeExact }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ chrome: await browser.version(), summary, rows, views, limits: 'Reader runtime DOM and rendered tree in Chrome. Inline white-space:normal collapses tabs for actual selection in both native and reader views; raw Range remains different. Native pre vs reader pre-wrap can differ by 1/64px in glyph rounding; original comparison is retained and a separate native reference adopts reader whitespace for the controlled geometry assertion. No WeChat WXML, system clipboard or physical devices.' }, null, 2) + '\n')
    assert.equal(views.length, 328)
    assert.equal(rows.length, 128)
    assert.equal(geometrySameWhitespaceExact, rows.length)
    assert.equal(selectionExact, rows.length)
    console.log(JSON.stringify(summary))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
