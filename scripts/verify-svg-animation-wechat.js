'use strict'
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { automationPortForProject, installAutomatorVersionCompatibility } = require('./miniprogram-automator-compat')
installAutomatorVersionCompatibility()
const input = path.resolve(process.argv[2] || 'tests/fixtures/svg-player')
// Keep artifacts outside the project while running: DevTools recompiles on writes.
const output = path.resolve(process.argv[3] || '/tmp/html-reader-svg-animation-wechat')
const files = fs.readdirSync(input).filter(name => name.endsWith('.svg')).sort()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const watchdog = setTimeout(() => { console.error('WeChat SVG verification exceeded 150 seconds'); process.exit(2) }, 150000)
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(process.cwd())}` })
  const results = []
  fs.mkdirSync(output, { recursive: true })
  try {
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p && p.loadSample) setTimeout(() => p.loadSample(), 100) })
    for (let i = 0; i < 60; i++) {
      if (await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && p.selectComponent('#reader')) })) break
      await delay(100)
    }
    for (const name of files) {
      const bytes = fs.readFileSync(path.join(input, name))
      await mini.evaluate(({ name, base64 }) => {
        const buffer = wx.base64ToArrayBuffer(base64), file = wx.env.USER_DATA_PATH + '/' + name
        wx.getFileSystemManager().writeFileSync(file, buffer)
        const reader = getCurrentPages().slice(-1)[0].selectComponent('#reader')
        if (!reader) throw Error('Reader is not mounted; open the sample from home first')
        reader.openSelectedFile({ name, path: file, size: buffer.byteLength })
      }, { name, base64: bytes.toString('base64') })
      let state
      for (let i = 0; i < 60; i++) {
        state = await mini.evaluate(() => {
          const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r && r.selectComponent('#standalone-svg-player')
          return r ? { name: r.data.sourceName, ready: !!(v && v._ctx && v.data.ready), loading: r.data.isLoading, error: r.data.error, notice: r.data.standaloneSvgAnimationNotice } : { missing: true }
        })
        if (state.ready && !state.loading) break
        await delay(100)
      }
      assert.ok(state.ready && !state.loading, name + ': ' + JSON.stringify(state))
      const read = () => mini.evaluate(() => {
        const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r.selectComponent('#standalone-svg-player')
        if (!v || !v._ctx) return { missing: true }
        const pixels = v._ctx.getImageData(0, 0, v._canvas.width, v._canvas.height).data
        let hash = 2166136261, ink = 0
        for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0; if (i % 4 === 3 && pixels[i]) ink++ }
        return { hash, ink, timeMs: v._pausedAt, playing: v._playing, paused: v.data.paused, width: v._canvas.width, height: v._canvas.height }
      })
      const frames = []
      for (let i = 0; i < 3; i++) { frames.push(await read()); await delay(330) }
      assert.ok(frames.every(f => f.playing && f.ink > 0), name + ': blank or paused')
      assert.equal(new Set(frames.map(f => f.hash)).size, 3, name + ': static frames')
      await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').selectComponent('#standalone-svg-player').onTap())
      const paused = [await read()]; await delay(330); paused.push(await read())
      assert.equal(paused[0].hash, paused[1].hash, name + ': pause did not freeze pixels')
      assert.equal(paused[1].paused, true)
      await mini.evaluate(() => { const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'); r.setData({ standaloneSvgAnimatedSource: r.data.standaloneSvgAnimatedSource + '\n' }) })
      await delay(400)
      const replaced = await read(); assert.equal(replaced.playing, true, name + ': replacement inherited pause')
      await saveSvgCanvasSnapshot(mini, path.join(output, name + '.png'))
      const row = { name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), state, frames, paused, replaced }
      results.push(row); console.log(JSON.stringify({ name, frameHashes: frames.map(f => f.hash), pause: true, sourceReplacementResumed: replaced.playing }))
    }
    // Force a recoverable component failure; assert the real parent fallback and retry.
    const fallback = await mini.evaluate(() => {
      const r = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      r.onStandaloneSvgAnimatedError({ detail: { message: 'verification: controlled Canvas failure' } })
      return { sourceEmpty: !r.data.standaloneSvgAnimatedSource, notice: r.data.standaloneSvgAnimationNotice, canRetry: r.data.standaloneSvgAnimationCanRetry }
    })
    assert.ok(fallback.sourceEmpty && fallback.canRetry); assert.match(fallback.notice, /静态预览/)
    await delay(200)
    await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').retryStandaloneSvgAnimation())
    await delay(600)
    const recovered = await mini.evaluate(() => { const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r.selectComponent('#standalone-svg-player'); return { ready: !!(v && v.data.ready && v._playing), notice: r.data.standaloneSvgAnimationNotice } })
    assert.ok(recovered.ready && !recovered.notice)
    const system = await mini.evaluate(() => { const i = wx.getSystemInfoSync(); return { SDKVersion: i.SDKVersion, platform: i.platform, version: i.version } })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), scope: 'Actual WX file read and visible Canvas temporal pixels; simulator only, not physical devices', system, results, controlledFallback: fallback, recovered }, null, 2) + '\n')
  } finally { await mini.disconnect() }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
