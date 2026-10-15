'use strict'

const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT || 'playwright')
const { cases, dataCases } = require('../tests/helpers/ai-dsc')
const { designPreview } = require('../tests/helpers/reader-host')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/ai-dsc/browser')
  fs.mkdirSync(out, { recursive: true })
  let input, writes = [], pdfOpens = 0
  const host = designPreview({ env: { USER_DATA_PATH: '/fixture' }, openDocument: () => pdfOpens++, getFileSystemManager: () => ({
    readFile: o => o.success({ data: input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)) }),
    writeFile: o => { writes.push(o); o.success() }, copyFile: o => o.success()
  }) })
  const views = [], hostRows = []
  const gsRoot = process.env.HTML_READER_GHOSTSCRIPT_RESULTS
  const gsRows = gsRoot ? JSON.parse(fs.readFileSync(path.join(gsRoot, 'report.json'))).rows : []
  try {
    for (const sample of [...cases(), ...dataCases()]) {
      input = sample.bytes; writes = []
      host.open({ name: sample.name + '.ai', path: '/fixture/input.ai', size: input.length })
      for (let i = 0; i < 8; i++) await new Promise(setImmediate)
      assert.equal(host.data.loading, false)
      assert.equal(pdfOpens, 0)
      const expectsPreview = Boolean(sample.box || sample.preview)
      assert.equal(writes.length, expectsPreview ? 1 : 0, sample.name)
      hostRows.push({ name: sample.name, expectedPreview: expectsPreview, actualPreview: Boolean(host.data.previewPath), pdfOpens })
      if (!expectsPreview) continue
      const svg = Boolean(sample.box), data = Buffer.from(writes[0].data)
      const file = sample.name + (svg ? '.svg' : '.jpg'); fs.writeFileSync(path.join(out, file), data)
      const gs = gsRows.find(r => r.name === sample.name)
      if (gsRoot && svg) { assert.ok(gs && gs.status === 0 && gs.png, sample.name + ' Ghostscript output'); assert.equal(gs.base64, input.toString('base64'), 'original source identity') }
      views.push({ name: sample.name, src: 'data:' + (svg ? 'image/svg+xml' : 'image/jpeg') + ';base64,' + data.toString('base64'), expectedSize: svg ? sample.box : [1, 1], colors: sample.colors || [svg ? [255, 0, 0, 255] : [0, 0, 0, 255]], ...(gs ? { referenceSrc: 'data:image/png;base64,' + fs.readFileSync(path.join(gsRoot, gs.png.file)).toString('base64'), referenceFraming: gs.framing } : {}) })
    }
  } finally { host.detached() }
  const browser = await chromium.launch({ executablePath: process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  let rows, chrome
  try {
    chrome = browser.version()
    const page = await browser.newPage()
    rows = await page.evaluate(async views => {
      const rows = []
      for (const view of views) {
        const img = document.createElement('img'); img.style.width = '80px'; img.style.height = 'auto'
        document.body.append(img)
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = view.src })
        const rect = img.getBoundingClientRect(), canvas = document.createElement('canvas')
        canvas.width = view.expectedSize[0]; canvas.height = view.expectedSize[1]
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const pixels = Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
        const expected = pixels.map((_, i) => view.colors[Math.min(view.colors.length - 1, Math.floor((Math.floor(i / 4) % canvas.width) * view.colors.length / canvas.width))][i % 4])
        let referencePixels
        if (view.referenceSrc) {
          const reference = new Image()
          await new Promise((resolve, reject) => { reference.onload = resolve; reference.onerror = reject; reference.src = view.referenceSrc })
          ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(reference, 0, 0, canvas.width, canvas.height)
          referencePixels = Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
        }
        rows.push({ name: view.name, rasterWidth: canvas.width, rasterHeight: canvas.height, width: rect.width, height: rect.height, expectedHeight: 80 * view.expectedSize[1] / view.expectedSize[0], expected, pixels, exactPixels: pixels.every((v, i) => v === expected[i]), ...(referencePixels ? { referenceFraming: view.referenceFraming, referencePixels, ghostscriptPixelsExact: pixels.every((v, i) => v === referencePixels[i]) } : {}) })
        img.remove()
      }
      return rows
    }, views)
  } finally { await browser.close() }
  const failures = rows.filter(r => r.width !== 80 || r.height !== r.expectedHeight || !r.exactPixels || r.ghostscriptPixelsExact === false).map(r => r.name)
  // Preserve every RGBA byte without thousands of one-number JSON lines.
  for (const row of rows) {
    row.rgbaEncoding = 'base64, row-major RGBA8'
    row.pixelCount = row.pixels.length / 4
    for (const key of ['pixels', 'expected', 'referencePixels']) if (row[key]) {
      const bytes = Buffer.from(row[key]), encoded = bytes.toString('base64')
      assert.deepEqual([...Buffer.from(encoded, 'base64')], row[key])
      row[key + 'Base64'] = encoded
      delete row[key]
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), chrome, hostCases: hostRows.length, browserViews: rows.length, ghostscriptViews: rows.filter(r => r.referencePixelsBase64).length, failures, scope: 'Actual Node design-component SVG/JPEG output decoded and laid out in Chrome. Parent rectangles, imported red/blue artwork and EPSI black references. Optional Ghostscript original-byte artwork comparisons retain framing limitations. No arbitrary artwork, WeChat WXML, native PDF viewer or physical-device claim.', hostRows, rows }, null, 2) + '\n')
  console.log(JSON.stringify({ hostCases: hostRows.length, browserViews: rows.length, failures }))
  assert.deepEqual(failures, [])
}
main().catch(e => { console.error(e); process.exitCode = 1 })
