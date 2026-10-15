'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { bundle } = require('./verify-inline-poster'), { chromeTestResult } = require('./chrome-test-result')
const { scene, htmlFor, harness } = require('../tests/helpers/canvas-live-budget')
const fixtures = require('../tests/fixtures/canvas-live-budget/wpt.json')
async function browserRun (fixtures, htmls, sceneSource, harnessSource) {
  let definition, activePage
  window.Page = p => { definition = p }; window.Component=c=>{definition=window.readerComponentDefinition(c)};window.getApp = () => ({ globalData: {} })
  const factory = config => { const c = document.createElement('canvas'); c.width = config.width; c.height = config.height; return c }
  window.wx = { setNavigationBarTitle () {}, pageScrollTo () {}, createOffscreenCanvas: factory, createSelectorQuery () { let cb, selector; const q = { in (p) { activePage = p; return q }, select (s) { selector = s; return { fields (_o, fn) { cb = fn }, boundingClientRect (fn) { cb = fn } } }, exec () { cb?.({ node: activePage?.surfaces.get(selector) }) } }; return q } }
  readerRequire('miniprogram/file-reader/engine/components/reader/reader.js')
  const page = () => { const p = { ...definition, data: structuredClone(definition.data), surfaces: new Map(), setData (updates, callback) {
    for (const [key, value] of Object.entries(updates)) { const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let d = this.data; for (const part of parts.slice(0, -1)) d = d[part]; d[parts.at(-1)] = value }
    const visit = nodes => (nodes || []).forEach(n => { if (n.name === 'canvas' && !this.surfaces.has('#dom-canvas-' + n.nid)) this.surfaces.set('#dom-canvas-' + n.nid, factory({ width: 1, height: 1 })); visit(n.children) }); visit(this.data.domTree); callback?.()
  } }; activePage = p; return p }
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
  const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const exported = async url => { const img = new Image(); img.src = url; await img.decode(); const c = factory({ width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); return hash(pixels(c)) }
  const nativeScene = Function('return (' + sceneSource + ')')(), generated = [], publicResults = []
  for (let variant = 0; variant < htmls.length; variant++) {
    document.querySelector('output').setAttribute('data-progress', 'generated:' + variant)
    const p = page(), native = factory({ width: 64, height: 48 }), phases = []
    try {
      p.openSelectedFile({ name: 'canvas-budget.html', inlineHtml: htmls[variant] })
      for (let phase = 0; phase < 2; phase++) {
        if (phase) p.onDomTap({ currentTarget: { dataset: { nid: p._htmlRuntime.document.getElementById('again')._nid } } })
        p._htmlRuntime.flush(true); await p._lastCanvasPresentation
        const s = p._htmlRuntime.window, c = p._htmlRuntime.document.getElementById('c'), target = p.surfaces.get('#dom-canvas-' + c._nid)
        const expected = nativeScene(native.getContext('2d'), variant + phase)
        phases.push({ expected, result: s.result, error: s.failure || p.data.error, runtimeErrors: p._runtimeErrors, nativePixels: await hash(pixels(native)), visiblePixels: await hash(pixels(target)), exportedPixels: s.exported ? await exported(s.exported) : null })
      }
      generated.push({ variant, phases })
    } finally { p.onUnload() }
  }
  for (const fixture of fixtures) {
    const iframe = document.createElement('iframe'); iframe.src = '/original/' + fixture.name
    await new Promise(resolve => { iframe.onload = resolve; document.body.appendChild(iframe) })
    const p = page()
    try {
      p.openSelectedFile({ name: fixture.name, inlineHtml: '<script>(' + harnessSource + ')()</script>' + fixture.source })
      p._htmlRuntime.flush(true); await p._lastCanvasPresentation
      const c = p._htmlRuntime.document.getElementById('c'), target = p.surfaces.get('#dom-canvas-' + c._nid)
      publicResults.push({ name: fixture.name, nativeTests: iframe.contentWindow.readTests, readerTests: p._htmlRuntime.window.readTests, nativePixels: await hash(pixels(iframe.contentDocument.getElementById('c'))), visiblePixels: await hash(pixels(target)), width: c.width, height: c.height, runtimeErrors: p._runtimeErrors })
    } finally { p.onUnload(); iframe.remove() }
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify({ generated, publicResults })))
}
async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-budget-')); fs.mkdirSync(out, { recursive: true })
  fixtures.forEach(f => assert.equal(crypto.createHash('sha256').update(f.source).digest('hex'), f.sha256))
  const code = bundle(['miniprogram/file-reader/engine/components/reader/reader.js']), htmls = Array.from({ length: 8 }, (_, i) => htmlFor(i))
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/bundle') { res.setHeader('Content-Type', 'text/javascript'); res.end(code); return }
    if (req.url === '/resources/testharness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('(' + harness + ')()'); return }
    if (/testharnessreport.js|canvas-tests.js/.test(req.url)) { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return }
    const f = fixtures.find(f => req.url === '/original/' + f.name); if (f) { res.end(f.source); return }
    if (req.url === '/') { res.end('<!doctype html><output></output><script src="/bundle"></script><script>(' + browserRun.toString().replace(/<\/script/gi, '<\\/script') + ')(' + [fixtures, htmls, scene.toString(), harness.toString()].map(x => JSON.stringify(x).replace(/</g, '\\u003c')).join(',') + ').catch(e=>document.querySelector("output").setAttribute("data-error",e.stack||e.message))</script>'); return }
    res.statusCode = 404; res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const dom = await chromeTestResult('http://127.0.0.1:' + server.address().port + '/', { timeoutMs: 60000 }); fs.writeFileSync(path.join(out, 'browser-dom.html'), dom)
    const match = dom.match(/data-result="([^"]+)"/); assert.ok(match, (dom.match(/data-error="([^"]+)"/) || [])[1])
    const result = JSON.parse(decodeURIComponent(match[1])); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 2))
    assert.equal(result.generated.length, 8); assert.equal(result.publicResults.length, 3)
    for (const row of result.generated) for (const state of row.phases) { assert.equal(state.error, ''); assert.deepEqual(state.runtimeErrors, []); assert.deepEqual(state.result, state.expected); assert.equal(state.visiblePixels, state.nativePixels); assert.equal(state.exportedPixels, state.nativePixels) }
    for (const row of result.publicResults) { assert.deepEqual(row.nativeTests, [{ pass: true }]); assert.deepEqual(row.readerTests, row.nativeTests); assert.equal(row.visiblePixels, row.nativePixels); assert.deepEqual(row.runtimeErrors, []) }
    console.log(JSON.stringify({ generatedStates: 16, resizeCycles: 640, publicFiles: 3, failures: 0, out }))
  } finally { server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
