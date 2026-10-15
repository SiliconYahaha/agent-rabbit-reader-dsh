'use strict'

// Actual DevTools Canvas nodes and real WXML taps; no native API mocks.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const { htmlFor, harness } = require('../tests/helpers/canvas-live-budget')
const fixtures = require('../tests/fixtures/canvas-live-budget/wpt.json')
const hash = data => crypto.createHash('sha256').update(Buffer.from(data)).digest('hex')
async function verify (mini, output, oracle) {
  fs.mkdirSync(output, { recursive: true })
  await mini.reLaunch('/pages/index/index')
  let page = await mini.currentPage()
  assert.equal(page.path, 'pages/index/index')
  const capture = variant => mini.evaluate(async variant => {
    const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
    const w = p._htmlRuntime.window, c = p._htmlRuntime.document.getElementById('c')
    // Automator acknowledges a tap before its native event is dispatched.
    if (variant != null) {
      for (let i = 0; i < 100 && (!w.ready || !w.result || w.result.variant !== variant); i++) await new Promise(resolve => setTimeout(resolve, 50))
      if (!w.ready || !w.result || w.result.variant !== variant) throw Error('WXML tap did not execute the requested scene')
    }
    // The script finishes before the scheduled DOM/Canvas flush. Do not read
    // the previous frame, force a flush, or turn stale pixels into a pass.
    let painted = false
    for (let i = 0; i < 100; i++) {
      const frames = p._lastCanvasPresentation ? await p._lastCanvasPresentation : []
      if (frames.some(f => f.status === 'error')) throw Error(JSON.stringify(frames))
      if (frames.some(f => String(f.nid) === String(c._nid) && f.status === 'painted' && f.rev === c._canvasState.rev)) { painted = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!painted) throw Error('Current native Canvas revision did not complete')
    const target = await new Promise(resolve => wx.createSelectorQuery().in(p).select('#dom-canvas-' + c._nid).fields({ node: true, size: true }, resolve).exec())
    if (!target || !target.node) throw Error('Actual WXML Canvas unavailable')
    const canvas = target.node, pixels = Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
    let exportedPixels = null
    if (w.exported) exportedPixels = await new Promise((resolve, reject) => {
      const tmp = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }), img = tmp.createImage()
      const timer = setTimeout(() => reject(Error('export decode timeout')), 8000)
      img.onload = () => {
        try { tmp.width = img.width; tmp.height = img.height; const ctx = tmp.getContext('2d'); ctx.drawImage(img, 0, 0); const data = Array.from(ctx.getImageData(0, 0, tmp.width, tmp.height).data); tmp.width = 0; tmp.height = 0; clearTimeout(timer); resolve(data) } catch (e) { clearTimeout(timer); reject(e) }
      }
      img.onerror = e => { clearTimeout(timer); reject(Error(e.errMsg || 'export decode failed')) }; img.src = w.exported
    })
    return { width: canvas.width, height: canvas.height, pixels, exportedPixels, result: w.result || null, tests: w.readTests || null, error: w.failure || p.data.error, runtimeErrors: p._runtimeErrors, domMode: p.data.domMode }
  }, variant == null ? null : variant)
  const open = async html => {
    await (await page.$('#reader')).callMethod('openSelectedFile', { name: 'canvas-budget-qa.html', inlineHtml: html })
    for (let i = 0; i < 80; i++) {
      const done = await mini.evaluate(() => { const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'); return p._htmlRuntime && (p._htmlRuntime.window.ready || p._htmlRuntime.window.readTests) && !p.data.isLoading })
      if (done) return
      await page.waitFor(100)
    }
    throw Error('Reader initialization timed out')
  }
  const generated = [], publicResults = []
  for (let variant = 0; variant < 8; variant++) {
    await open(htmlFor(variant)); const phases = []
    for (let phase = 0; phase < 2; phase++) {
      if (phase) {
        const nid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('again')._nid)
        const button = await page.$('#reader >>> #dom-nid-' + nid); assert.ok(button); await button.tap()
      }
      const state = await capture(variant + phase), expected = oracle.generated[variant].phases[phase]
      assert.equal(state.error, ''); assert.deepEqual(state.runtimeErrors, []); assert.equal(state.domMode, true)
      assert.deepEqual(state.result, expected.expected); assert.equal(state.width, 64); assert.equal(state.height, 48)
      const visible = hash(state.pixels), exported = hash(state.exportedPixels)
      assert.equal(visible, expected.nativePixels, 'native visible ' + variant + ':' + phase)
      assert.equal(exported, expected.nativePixels, 'native export ' + variant + ':' + phase)
      phases.push({ result: state.result, visiblePixels: visible, exportedPixels: exported, error: '', tap: phase ? 'actual WXML button' : 'initial script' })
    }
    generated.push({ variant, phases })
  }
  await mini.screenshot({ path: path.join(output, 'native-resize.png') })
  for (const fixture of fixtures) {
    assert.equal(crypto.createHash('sha256').update(fixture.source).digest('hex'), fixture.sha256)
    await open('<script>(' + harness + ')()</script>' + fixture.source)
    const state = await capture(), expected = oracle.publicResults.find(r => r.name === fixture.name)
    assert.deepEqual(state.tests, expected.nativeTests); assert.deepEqual(state.runtimeErrors, []); assert.equal(state.error, '')
    assert.equal(hash(state.pixels), expected.nativePixels)
    publicResults.push({ name: fixture.name, tests: state.tests, visiblePixels: hash(state.pixels), width: state.width, height: state.height })
  }
  const report = { checkedAt: new Date().toISOString(), sourceCommit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: require('../package.json').version, sdk: await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion), generated, publicResults, boundary: 'DevTools native pixels and WXML taps, not physical iOS/Android. No API mocks. Original private interactive-poster checked separately.' }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); return report
}
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: process.argv[2] })
  try { const report = await verify(mini, process.argv[3], JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))); console.log(JSON.stringify({ version: report.version, sourceCommit: report.sourceCommit, sdk: report.sdk, states: 16, cycles: 640, publicFiles: 3, failures: 0 })) } finally { await mini.disconnect() }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { verify }
