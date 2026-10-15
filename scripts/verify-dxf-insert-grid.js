'use strict'
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { readerPage } = require('../tests/helpers/reader-host')
const { chromeTestResult } = require('./chrome-test-result')
const { svgLines, compare } = require('./probe-dxf-insert-grid')
const originals = require('../tests/fixtures/dxf-insert-grid/before.json').rows
const reviewed = require('../tests/fixtures/dxf-insert-grid/reference-review.json').rows
const out = path.resolve(process.argv[2] || 'outputs/dxf-insert-grid/content')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')

function referenceSvg (lines) {
  const points = lines.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.06
  const width = maxX - minX + pad * 2, height = maxY - minY + pad * 2
  const n = value => Number(value.toFixed(4))
  const viewBox = [minX - pad, -maxY - pad, Math.max(1, width), Math.max(1, height)].map(n)
  const paths = lines.map(([a, b]) => `<path d="M ${n(a[0])} ${n(-a[1])} L ${n(b[0])} ${n(-b[1])}" fill="none"/>`).join('')
  // Common display styling; every geometric coordinate and viewport bound is
  // independently derived from reviewed native WCS lines, not the reader SVG.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}"><rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="#fffdf8"/><g stroke="#171715" stroke-width="${n(Math.max(width, height) / 500 < 0.05 ? 0.05 : Math.max(width, height) / 500)}" vector-effect="non-scaling-stroke">${paths}</g></svg>`
}

async function browserRun (sources) {
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  const render = async (svg, width, height) => {
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml')
    if (xml.querySelector('parsererror')) throw Error('Invalid SVG')
    const root = xml.documentElement; root.setAttribute('width', width); root.setAttribute('height', height)
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root)); await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height).data
    // Compare against the same SVG with all geometry removed. Thin antialiased
    // strokes can contain no RGB<100 pixels while still being visibly nonblank.
    for (const element of root.querySelectorAll('path,line,polyline,polygon,circle,ellipse,text')) element.remove()
    const blank = new Image(); blank.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root)); await blank.decode()
    const empty = document.createElement('canvas'); empty.width = width; empty.height = height
    const emptyCtx = empty.getContext('2d'); emptyCtx.drawImage(blank, 0, 0, width, height)
    const blankData = emptyCtx.getImageData(0, 0, width, height).data
    let inkPixels = 0
    for (let i = 0; i < data.length; i += 4) if (data.slice(i, i + 4).some((v, j) => v !== blankData[i + j])) inkPixels++
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3]) dark++
    return { canvas, hash: await hash(data), dark, inkPixels }
  }
  const rows = [], sheets = []
  for (const source of sources) {
    const natural = new Image(); natural.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source.svg); await natural.decode()
    const row = { name: source.name, naturalSize: [natural.naturalWidth, natural.naturalHeight], views: [] }
    for (const [width, height] of [[390, 260], [1280, 720]]) {
      const actual = await render(source.svg, width, height), native = await render(source.reference, width, height)
      row.views.push({ width, height, actualHash: actual.hash, nativeHash: native.hash, actualDark: actual.dark, nativeDark: native.dark, actualInkPixels: actual.inkPixels, nativeInkPixels: native.inkPixels, exact: actual.hash === native.hash })
    }
    if ((source.compareBefore || ['R2007-nonuniform', 'R2007-nested'].includes(source.name)) && source.before) {
      const canvas = document.createElement('canvas'); canvas.width = 990; canvas.height = 278
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '14px sans-serif'; ctx.fillStyle = '#171715'
      for (const [i, key, label] of [[0, 'before', 'Original reader'], [1, 'reference', 'Reviewed native reference'], [2, 'svg', 'Fixed reader']]) {
        const rendered = await render(source[key], 330, 240)
        ctx.drawImage(rendered.canvas, i * 330, 32); ctx.fillText(label, i * 330 + 10, 20)
      }
      sheets.push({ name: source.name, png: canvas.toDataURL('image/png').split(',')[1] })
    }
    rows.push(row)
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify({ rows, sheets })))
}

async function main () {
  fs.mkdirSync(out, { recursive: true })
  const reads = [], report = { at: new Date().toISOString(), host: [], lifecycle: {}, limits: ['Node actual host definitions with mocked wx file API; Chrome renders returned SVG at explicit viewports. WeChat WXML and devices not run.', 'Only the authored 2D LINE block arrays are certified. OCS extrusion, layer visibility, large grids and other entities remain separate exploration.'] }
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  const open = async row => {
    const bytes = Buffer.from(row.base64, 'base64'); assert.equal(sha(bytes), row.sha256)
    host.openSelectedFile({ name: row.name + '.dxf', path: '/fixture/' + row.name + '.dxf', size: bytes.length })
    await reads.shift().success({ data: bytes }); await new Promise(setImmediate)
    assert.equal(host.data.error, '', row.name); assert.equal(host.data.hasContent, true, row.name)
    return Buffer.from(host.data.inspectorPreviewSource.split(',')[1], 'base64').toString()
  }
  const sources = []
  try {
    for (const row of originals) {
      const reference = reviewed.find(r => r.name === row.name); assert.equal(reference.sha256, row.sha256)
      const svg = await open(row); assert.equal(compare(svgLines(svg), reference.expandedBeforeParentLines).allExact, true, row.name)
      assert.equal(await open(row), svg, row.name + ' repeated open')
      fs.writeFileSync(path.join(out, row.name + '.svg'), svg)
      const referenceSource = referenceSvg(reference.expandedBeforeParentLines); fs.writeFileSync(path.join(out, row.name + '-native.svg'), referenceSource)
      const before = path.resolve('outputs/dxf-insert-grid/before', row.name + '.svg')
      sources.push({ name: row.name, svg, reference: referenceSource, before: fs.existsSync(before) ? fs.readFileSync(before, 'utf8') : '' })
      report.host.push({ name: row.name, sourceSha256: row.sha256, opens: 2, lines: reference.expandedBeforeParentLines.length, svgSha256: sha(svg), exact: true })
    }
    host.openSelectedFile({ name: 'bad.dxf', path: '/fixture/bad.dxf' })
    await reads.shift().success({ data: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\n\\U+0000\n0\nENDSEC\n0\nEOF\n') })
    assert.ok(host.data.error); assert.equal(host.data.hasContent, false); assert.equal(host.data.inspectorPreviewSource, '')
    await open(originals[0]); report.lifecycle.errorRecovery = true
    host.openSelectedFile({ name: 'stale.dxf', path: '/fixture/stale.dxf' })
    const stale = reads.shift(); const latest = await open(originals.at(-1))
    await stale.success({ data: Buffer.from(originals[0].base64, 'base64') })
    assert.equal(Buffer.from(host.data.inspectorPreviewSource.split(',')[1], 'base64').toString(), latest)
    report.lifecycle.staleReadIgnored = true
    host.openSelectedFile({ name: 'detached.dxf', path: '/fixture/detached.dxf' })
    const detached = reads.shift(); host.detached(); const count = host.patches.length
    await detached.success({ data: Buffer.from(originals[0].base64, 'base64') })
    assert.equal(host.patches.length, count); report.lifecycle.detachedReadIgnored = true
  } finally { host.detached() }
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<output></output><script>(' + browserRun.toString() + ')(' + JSON.stringify(sources).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").setAttribute("data-error",e.message))</script>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const html = await chromeTestResult('http://127.0.0.1:' + server.address().port); fs.writeFileSync(path.join(out, 'chrome.html'), html)
    const match = html.match(/data-result="([^"]+)"/); assert.ok(match, html.slice(-1500))
    const rendered = JSON.parse(decodeURIComponent(match[1])); report.chrome = rendered.rows
    for (const sheet of rendered.sheets) fs.writeFileSync(path.join(out, sheet.name + '-comparison.png'), Buffer.from(sheet.png, 'base64'))
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    assert.equal(report.chrome.length, originals.length)
    for (const row of report.chrome) for (const view of row.views) { assert.equal(view.exact, true, row.name + ':' + view.width); assert.ok(view.actualInkPixels > 0, row.name + ' nonblank pixels') }
    console.log(JSON.stringify({ originals: report.host.length, actualHostOpens: report.host.length * 2, nativePixelViews: report.chrome.reduce((sum, row) => sum + row.views.length, 0), lifecycle: report.lifecycle }))
  } finally { server.close() }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { referenceSvg, browserRun }
