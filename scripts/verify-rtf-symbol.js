'use strict'
// Original source -> native Cocoa text and actual reader tree -> Chrome.
// Native differences are recorded; browser semantics do not certify RTF layout.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
const { cases } = require('../tests/helpers/rtf-symbol')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/rtf-symbol/verified')
  fs.mkdirSync(out, { recursive: true })
  const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT || 'playwright')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let bytes
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const rows = []
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    for (const c of cases) {
      bytes = Buffer.from(c.source)
      const row = { ...c, sourceBase64: bytes.toString('base64'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
      const file = path.join(out, c.name + '.rtf')
      fs.writeFileSync(file, bytes)
      try { row.cocoa = execFileSync(process.env.RTF_TEXTUTIL || '/usr/bin/textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8', timeout: 10000 }).trim() } catch (e) { row.cocoaError = e.message }
      host.openSelectedFile({ name: c.name + '.rtf', path: '/local/' + c.name + '.rtf', size: bytes.length })
      await new Promise(setImmediate)
      row.hostError = host.data.error
      row.hasContent = host.data.hasContent
      if (c.expected == null) {
        assert.match(row.hostError, /符号字体|字形/, c.name)
        assert.equal(row.hasContent, false)
      } else {
        assert.equal(row.hostError, '', c.name)
        const runtime = host._htmlRuntime
        row.hostText = runtime.document.body.textContent.trim()
        assert.equal(row.hostText, c.expected, c.name)
        const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
        const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;${escape(tree.wrapperStyle)}">${tree.nodes.map(serialize).join('')}</body>`
        fs.writeFileSync(path.join(out, c.name + '.html'), html)
        row.views = []
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 844 })
          await page.setContent(html)
          const view = await page.locator('pre').evaluate(pre => ({ text: pre.textContent.trim(), width: pre.getBoundingClientRect().width, scrollWidth: pre.scrollWidth, color: getComputedStyle(pre).color, font: getComputedStyle(pre).fontFamily }))
          assert.equal(view.text, c.expected, c.name)
          assert.ok(view.width > 250 && view.scrollWidth <= view.width + 1, c.name)
          row.views.push({ viewport: width, ...view })
        }
        if (c.name === 'ascii-greek' || c.name === 'math') await page.screenshot({ path: path.join(out, c.name + '.png') })
        row.nativeExact = row.cocoa === c.expected
      }
      rows.push(row)
    }
    const report = { schemaVersion: 1, testedAt: new Date().toISOString(), node: process.version, chrome: await browser.version(), rows, summary: { originalCases: rows.length, actualHostOpens: rows.length, rejected: rows.filter(r => r.expected == null).length, chromeViews: rows.reduce((n, r) => n + (r.views || []).length, 0), nativeExact: rows.filter(r => r.nativeExact).length, nativeDifferences: rows.filter(r => r.expected != null && !r.nativeExact).map(({ name, expected, cocoa }) => ({ name, expected, cocoa })) }, limits: ['Node mocked file API and Chrome rendered actual reader tree; no WeChat or physical device claim.', 'Cocoa differences are retained, not normalized into equality. Symbol font recognition, PUA representation and font variants can differ.', 'No rich RTF font/layout fidelity or other symbol face support is implied.'] }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(report.summary)
  } finally { host.detached(); await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
