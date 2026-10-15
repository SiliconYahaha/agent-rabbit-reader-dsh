'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { readerPage } = require('../tests/helpers/reader-host')
const base = require('../tests/fixtures/dxf-text/samples.json').rows
const extra = require('../tests/fixtures/dxf-text/combinations.json').rows
const knownGaps = new Set(['mtext-double-slash', 'mtext-triple-slash', 'mtext-escaped-braces', 'mtext-format-unicode'])
const rejected = new Set(['text-nul', 'text-unpaired'])
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/dxf-text/verified')
  fs.mkdirSync(out, { recursive: true })
  const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT || 'playwright')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let bytes
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const rows = []
  try {
    const page = await browser.newPage()
    for (const c of [...base, ...extra]) {
      bytes = Buffer.from(c.sourceBase64, 'base64')
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), c.sha256)
      host.openSelectedFile({ name: c.name + '.dxf', path: '/local/' + c.name + '.dxf', size: bytes.length })
      await new Promise(setImmediate)
      const row = { name: c.name, sourceSha256: c.sha256, error: host.data.error, hasContent: host.data.hasContent, knownGap: knownGaps.has(c.name), expectedTexts: c.expectedTexts || [c.explicitHelper] }
      if (rejected.has(c.name)) {
        assert.match(row.error, /控制字符|完整字符/)
        assert.equal(row.hasContent, false)
        assert.equal(host.data.inspectorPreviewSource, '')
        rows.push(row)
        continue
      }
      assert.equal(row.error, '', c.name)
      assert.equal(row.hasContent, true)
      const uri = host.data.inspectorPreviewSource
      assert.match(uri, /^data:image\/svg\+xml;base64,/)
      row.svg = Buffer.from(uri.split(',')[1], 'base64').toString()
      fs.writeFileSync(path.join(out, c.name + '.svg'), row.svg)
      row.views = []
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 })
        const xmlValid = await page.evaluate(svg => !new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'), row.svg)
        assert.equal(xmlValid, true, c.name + ' valid SVG XML')
        await page.setContent(row.svg)
        const view = await page.locator('svg').evaluate(svg => {
          const v = svg.viewBox.baseVal
          return { viewBox: { x: v.x, y: v.y, width: v.width, height: v.height }, texts: [...svg.querySelectorAll('text')].map(t => t.textContent), labels: [...svg.querySelectorAll('text')].map(t => { const b = t.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height, fits: b.x >= v.x && b.y >= v.y && b.x + b.width <= v.x + v.width && b.y + b.height <= v.y + v.height } }), scripts: svg.querySelectorAll('script').length }
        })
        assert.equal(view.scripts, 0)
        assert.ok(view.labels.length && view.labels.every(b => b.fits), c.name + ' full glyph bounds')
        if (!row.knownGap) assert.deepEqual(view.texts, row.expectedTexts, c.name)
        view.contentExact = JSON.stringify(view.texts) === JSON.stringify(row.expectedTexts)
        await page.setContent('<img style="display:block;width:100%;height:auto" alt="DXF preview">')
        const raster = await page.locator('img').evaluate(async (img, src) => { img.src = src; await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight, complete: img.complete } }, uri)
        assert.ok(raster.complete && raster.width > 0 && raster.height > 0, c.name + ' actual image decode')
        row.views.push({ viewport: width, ...view, raster })
        if (width === 390 && ['R2000-gbk', 'text-pair', 'text-markup'].includes(c.name)) await page.screenshot({ path: path.join(out, c.name + '.png') })
      }
      rows.push(row)
    }
    const report = { schemaVersion: 1, testedAt: new Date().toISOString(), node: process.version, chrome: await browser.version(), rows, summary: { originalDrawings: rows.length, actualHostOpens: rows.length, rejected: rows.filter(r => !r.views).length, chromeViews: rows.reduce((n, r) => n + (r.views || []).length, 0), certifiedContentViews: rows.filter(r => !r.knownGap).reduce((n, r) => n + (r.views || []).length, 0), knownGapViews: rows.filter(r => r.knownGap).reduce((n, r) => n + (r.views || []).length, 0), glyphBoundsPass: rows.every(r => !r.views || r.views.every(v => v.labels.every(l => l.fits))) }, limits: ['Node mocked file API, Chrome rendering of actual returned SVG and data-image decoding; not WeChat WXML or physical devices.', 'Conservative Unicode text bounds avoid clipping; no CAD font/rotation/anchor fidelity is implied.', 'Four MTEXT literal/format combinations remain uncertified. Native regular/slow/recover/explicit Unicode helper differ; raw comparisons are in original fixtures.', 'Text-only long labels fit the viewBox, but full-drawing fit can make long text small; no device zoom/readability claim.'] }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(report.summary)
  } finally { host.detached(); await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
