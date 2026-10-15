'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { originalCases, expandedCases } = require('../tests/helpers/ai-lexical')
const { designPreview } = require('../tests/helpers/reader-host')
const reference = require('../tests/fixtures/ai-lexical/native-reference.json')
const out = path.resolve(process.argv[2] || 'outputs/ai-lexical/verified')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
async function inspect (views) {
  const rows = []
  async function pixels (src) {
    const img = new Image()
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src })
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 40, 20); ctx.drawImage(img, 0, 0, 40, 20)
    return { ratio: img.naturalWidth / img.naturalHeight, pixels: [...ctx.getImageData(0, 0, 40, 20).data] }
  }
  for (const view of views) {
    const ref = await pixels(view.reference), actual = view.actual ? await pixels(view.actual) : null
    const expected = ref.pixels.every((n, i) => n === (view.blank || i % 4 === 3 ? 255 : i % 4 === 0 ? (Math.floor(i / 4) % 40 < 20 ? 255 : 0) : i % 4 === 2 ? (Math.floor(i / 4) % 40 < 20 ? 0 : 255) : 0))
    rows.push({ name: view.name, nativeArtworkExact: expected && ref.ratio === 2, pass: view.blank ? actual === null : !!actual && actual.ratio === ref.ratio && JSON.stringify(actual.pixels) === JSON.stringify(ref.pixels), expectedNoPreview: view.blank })
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  fs.mkdirSync(out, { recursive: true })
  let input, writes = []
  const actual = new Map(), sources = [...originalCases, ...expandedCases()]
  const page = designPreview({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => o.success({ data: input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)) }),
    writeFile: o => { writes.push(o); o.success() }
  }) })
  try {
    for (const source of sources) {
      input = Buffer.from(source.source); writes = []
      page.open({ name: source.name + '.ai', path: '/fixture/input.ai', size: input.length })
      for (let i = 0; i < 8; i++) await new Promise(setImmediate)
      assert.equal(page.data.loading, false, source.name)
      assert.equal(!!page.data.previewPath, !source.expected.noPreview, source.name)
      assert.equal(writes.length, source.expected.noPreview ? 0 : 1, source.name)
      const data = writes.length ? Buffer.from(writes[0].data) : null
      actual.set(source.name, data)
      if (data) fs.writeFileSync(path.join(out, source.name + (source.expected.rasterPreview ? '.jpg' : '.svg')), data)
    }
  } finally { page.detached() }
  const views = reference.cases.map(ref => {
    const source = sources.find(x => x.name === ref.name), png = Buffer.from(ref.pngBase64, 'base64')
    assert.equal(sha(Buffer.from(source.source)), ref.sourceSha256, ref.name)
    assert.equal(sha(png), ref.pngSha256, ref.name)
    return { name: ref.name, blank: ref.expectedBlank, actual: actual.get(ref.name) ? 'data:image/svg+xml;base64,' + actual.get(ref.name).toString('base64') : null, reference: 'data:image/png;base64,' + ref.pngBase64 }
  })
  const file = path.join(out, 'browser.html')
  fs.writeFileSync(file, '<!doctype html><output></output><script>(' + inspect + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>')
  const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const match = /data-results="([^"]+)"/.exec(dom); assert.ok(match, dom.slice(-2000))
  const rows = JSON.parse(decodeURIComponent(match[1])); assert.equal(rows.length, reference.cases.length)
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), hostOpens: sources.length, nativeViews: rows.length, rows, scope: 'Actual Node design component output decoded in Chrome against retained original-byte Ghostscript pixels and aspect ratio. One native-blank no-artwork file correctly has no fabricated EPSI preview. No WeChat or physical device claim.' }, null, 2) + '\n')
  assert.deepEqual(rows.filter(x => !x.pass || !x.nativeArtworkExact), [])
  const chosen = views.filter(x => ['eof-literal-lf', 'hires-literal-lf', 'ascii85VectorProse-lf'].includes(x.name))
  const screenshotHtml = path.join(out, 'comparison.html')
  fs.writeFileSync(screenshotHtml, '<!doctype html><style>body{font:16px sans-serif;margin:24px}.row{display:flex;gap:30px}img{width:320px;height:160px;border:1px solid #aaa}</style>' + chosen.map(v => '<h3>' + v.name + '</h3><div class="row"><div>Actual reader<br><img src="' + v.actual + '"></div><div>Ghostscript reference<br><img src="' + v.reference + '"></div></div>').join(''))
  execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=760,900', '--virtual-time-budget=2000', '--screenshot=' + path.join(out, 'comparison.png'), pathToFileURL(screenshotHtml).href], { timeout: 60000, stdio: 'ignore' })
  console.log(JSON.stringify({ hostOpens: sources.length, nativeViews: rows.length, exactImages: rows.filter(x => !x.expectedNoPreview).length, nativeBlankNoFalsePreview: rows.filter(x => x.expectedNoPreview).length }))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
