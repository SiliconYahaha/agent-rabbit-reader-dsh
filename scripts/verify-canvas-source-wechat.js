'use strict'

// Original WPT bodies, actual DevTools reader and WXML Canvas pixels.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const { harness } = require('./verify-canvas-source')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(root, 'outputs/canvas-source-wechat'))
  const oracle = JSON.parse(fs.readFileSync(process.argv[3] || path.join(root, 'outputs/contest-ui/canvas-source-fixed/report.json'), 'utf8'))
  const port = process.env.WECHAT_AUTOMATION_PORT || 12492
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
  const results = []
  fs.mkdirSync(out, { recursive: true })
  try {
    await mini.reLaunch('/pages/index/index')
    for (const reference of oracle.publicResults) {
      const source = fs.readFileSync(path.join(root, 'tests/fixtures/canvas-source', reference.name), 'utf8')
      const reader = await (await mini.currentPage()).$('#reader')
      await reader.callMethod('openSelectedFile', { name: reference.name, inlineHtml: '<script>(' + harness + ')()</script>' + source })
      const state = await mini.evaluate(async () => {
        const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
        for (let i = 0; i < 100; i++) {
          const runtime = p._htmlRuntime
          if (runtime?.window.readTests?.length && !p.data.isLoading) {
            const c = runtime.document.getElementById('c')
            const frames = p._lastCanvasPresentation ? await p._lastCanvasPresentation : []
            if (frames.some(f => f.status === 'error')) throw Error(JSON.stringify(frames))
            if (frames.some(f => String(f.nid) === String(c._nid) && f.status === 'painted' && f.rev === (c._canvasState?.rev || 0))) {
              const target = await new Promise(resolve => wx.createSelectorQuery().in(p).select('#dom-canvas-' + c._nid).fields({ node: true }, resolve).exec())
              if (!target?.node) throw Error('Actual WXML Canvas unavailable')
              const canvas = target.node
              return { tests: runtime.window.readTests, pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), errors: p._runtimeErrors, error: p.data.error, direct: runtime.document._directCanvasFrames }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw Error('Current Canvas frame did not finish')
      })
      assert.equal(state.direct, true)
      assert.equal(state.error, '')
      assert.deepEqual(state.errors, [])
      assert.deepEqual(state.tests, reference.nativeTests, reference.name)
      const pixels = crypto.createHash('sha256').update(Buffer.from(state.pixels)).digest('hex')
      assert.equal(pixels, reference.nativePixels, reference.name + ' visible RGBA')
      results.push({ name: reference.name, tests: state.tests, visiblePixels: pixels, nativePixels: reference.nativePixels })
    }
    await mini.screenshot({ path: path.join(out, 'canvas.png') })
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'WeChat DevTools native Canvas, not a physical phone', results }, null, 2))
    console.log(JSON.stringify({ files: results.length, failures: 0, out }))
  } finally {
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await pause(100)
    await mini.disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
