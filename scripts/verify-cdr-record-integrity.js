'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { sources, capture } = require('../tests/helpers/cdr-record-host')
const native = require('../tests/fixtures/cdr-record-integrity/native-reference.json')
const baseline = process.argv.includes('--before')
const out = path.resolve(process.argv[2] || 'outputs/cdr-record-integrity/verified')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
async function inspect (views) {
  const rows = []
  async function pixels (svg) {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))) })
    const canvas = document.createElement('canvas'); canvas.width = 224; canvas.height = 224
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 224, 224)
    return { ratio: image.naturalWidth / image.naturalHeight, data: [...ctx.getImageData(0, 0, 224, 224).data] }
  }
  for (const view of views) {
    if (view.reject) {
      rows.push({ name: view.name, kind: 'structural-error', pass: !view.actual && /记录头不完整|长度超过所属列表/.test(view.summary) })
      continue
    }
    const doc = new DOMParser().parseFromString(view.nativeSvg, 'image/svg+xml'), root = doc.documentElement
    if (doc.querySelector('parsererror')) throw Error(view.name + ' native SVG syntax')
    const [pageX, pageY, pageW, pageH] = root.getAttribute('viewBox').split(/\s+/).map(Number)
    if (pageX !== 0 || pageY !== 0 || pageW !== 612 || pageH !== 792) throw Error('unexpected native default page')
    const paths = root.querySelectorAll('path')
    if (paths.length !== 1) throw Error(view.name + ' native path count')
    const values = paths[0].getAttribute('d').match(/[-+]?\d+(?:\.\d+)?/g).map(Number)
    const [x, y] = view.translation, expected = [(x + 4.25) * 72, (-y + 5.5) * 72, (x + 5.25) * 72, (-y + 5.5) * 72, (x + 4.25) * 72, (-y + 4.5) * 72]
    const geometryExact = values.length === expected.length && values.every((n, i) => Math.abs(n - expected[i]) < 0.000001)
    const colorExact = paths[0].getAttribute('style').includes('fill: ' + view.color + ';')
    // The reader fits content in inches; libcdr emits a default Letter page in
    // points. Compare artwork in the same declared fit view, retaining native
    // path/style bytes and recording this presentation-only coordinate mapping.
    const box = [x - 0.06, -y - 1.06, 1.12, 1.12]
    const children = [...root.children].map(el => new XMLSerializer().serializeToString(el)).join('')
    const reference = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box.join(' ') + '"><rect x="' + box[0] + '" y="' + box[1] + '" width="1.12" height="1.12" fill="#fffdf8"/><g transform="translate(-4.25 -5.5) scale(0.013888888888888888)">' + children + '</g></svg>'
    const ref = await pixels(reference), actual = view.actual ? await pixels(view.actual) : null
    let different = null
    if (actual) different = actual.data.reduce((sum, n, i) => sum + (n !== ref.data[i] ? 1 : 0), 0)
    rows.push({ name: view.name, kind: 'native-artwork', nativeGeometryExact: geometryExact, nativeColorExact: colorExact, missing: !actual, differentChannels: different, pass: geometryExact && colorExact && !!actual && actual.ratio === ref.ratio && different === 0 })
    const panel = document.createElement('section'); panel.innerHTML = '<h3>' + view.name + '</h3><div class="pair"><article>Actual reader<div>' + (view.actual || '<p>No artwork preview</p>') + '</div></article><article>Native artwork, same fit view<div>' + reference + '</div></article></div>'
    if (['literal-all-z0', 'mixed-zeros-literals-red', 'prefix-zero-3-blue'].includes(view.name)) document.querySelector('main').appendChild(panel)
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const captured = baseline ? require('../tests/fixtures/cdr-record-integrity/host-before.json').rows : await capture()
  const views = sources().map(source => {
    const ref = native.rows.find(x => x.name === source.name), actual = captured.find(x => x.name === source.name)
    assert.equal(sha(Buffer.from(source.base64, 'base64')), ref.sourceSha256)
    assert.equal(actual.sourceSha256, ref.sourceSha256)
    assert.equal(sha(ref.xhtml.stdout), ref.xhtml.sha256)
    const reject = source.category.startsWith('malformed')
    if (!reject) assert.equal(ref.xhtml.status, 0, source.name)
    const nativeSvg = ref.xhtml.stdout.match(/<svg:svg\b[\s\S]*?<\/svg:svg>/)?.[0].replace(/svg:/g, '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    return { name: source.name, reject, nativeSvg, actual: actual.svg, summary: actual.summary, translation: source.translation || [2, 3], color: '#' + (source.color ?? 0xff5b43).toString(16).padStart(6, '0') }
  })
  const html = '<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:24px}.pair{display:flex;gap:24px}article{width:320px}article>div{height:224px;background:#fffdf8}svg{width:224px;height:224px}h3{margin-top:24px}</style><output></output><main></main><script>(' + inspect + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>'
  const file = path.join(out, 'comparison.html'); fs.writeFileSync(file, html)
  const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const match = /data-results="([^"]+)"/.exec(dom); assert.ok(match, dom.slice(-2000))
  const rows = JSON.parse(decodeURIComponent(match[1])); assert.equal(rows.length, 50)
  const result = { at: new Date().toISOString(), baseline, hostOpens: captured.length, nativeArtworkViews: rows.filter(x => x.kind === 'native-artwork').length, structuralErrorContracts: rows.filter(x => x.kind === 'structural-error').length, failures: rows.filter(x => !x.pass).map(x => x.name), rows, scope: 'Actual Node host preview SVGs rendered in Chrome. Original-byte libcdr output in points on its default Letter page is mapped to the same source-declared content-fit view in inches. Native path coordinates/colors also checked before this presentation mapping. This is artwork geometry/color fidelity, not page-layout or WeChat/device certification. Seven native-tolerated out-of-bounds streams have explicit structural-error contracts, not a claimed native rejection.' }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  assert.ok(rows.filter(x => x.kind === 'native-artwork').every(x => x.nativeGeometryExact && x.nativeColorExact))
  if (!baseline) assert.deepEqual(result.failures, [])
  execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=760,1100', '--virtual-time-budget=10000', '--screenshot=' + path.join(out, 'comparison.png'), pathToFileURL(file).href], { timeout: 60000, stdio: 'ignore' })
  console.log(JSON.stringify({ hostOpens: result.hostOpens, nativeArtworkViews: result.nativeArtworkViews, structuralErrorContracts: result.structuralErrorContracts, failures: result.failures.length }))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
