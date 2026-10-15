'use strict'

// Run prepare, restart the actual DevTools JS runtime, then finish. A page
// reLaunch is intentionally insufficient: finish requires the old App gone.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { execFileSync } = require('node:child_process')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const { png } = require('../tests/helpers/inline-poster')
const samples = require('../tests/fixtures/inline-cache-recovery/wpt-images.json').concat({ path: 'generated.png', base64: png().split(',')[1] })
const commit = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

async function prepare (mini, output) {
  const result = await mini.evaluate(async samples => {
    const native = wx.getFileSystemManager()
    const store = require('utils/inline-image-store.js').createInlineImageStore(native, wx.env.USER_DATA_PATH)
    getApp()._inlineLifecycleQa = { store }
    const rows = []
    for (const sample of samples) {
      const filePath = await store.resource('data:image/png;base64,' + sample.base64, true)
      if (!filePath.includes('/reader-inline-cache-v1/')) throw Error('Current lifecycle source not loaded')
      const data = await new Promise((resolve, reject) => native.readFile({ filePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }))
      if (data !== sample.base64) throw Error('Native source bytes differ')
      rows.push({ name: sample.path, filePath })
    }
    return { rows, sdk: wx.getAppBaseInfo().SDKVersion }
  }, samples)
  const report = { preparedAt: new Date().toISOString(), sourceCommit: commit(), ...result }
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'prepared.json'), JSON.stringify(report, null, 2))
  return { ...report, next: 'Restart actual DevTools JS runtime without graceful store disposal, then run finish' }
}

async function finish (mini, output, chrome) {
  const prepared = JSON.parse(fs.readFileSync(path.join(output, 'prepared.json'), 'utf8'))
  assert.equal(prepared.sourceCommit, commit(), 'Do not change source between preparation and restart')
  const result = await mini.evaluate(async (samples, prepared) => {
    if (getApp()._inlineLifecycleQa) throw Error('Actual JS restart required; page navigation is not a cold boot')
    const native = wx.getFileSystemManager(), root = wx.env.USER_DATA_PATH
    const read = filePath => new Promise((resolve, reject) => native.readFile({ filePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }))
    for (let i = 0; i < samples.length; i++) if (await read(prepared.rows[i].filePath) !== samples[i].base64) throw Error('Expected persisted interrupted bytes missing')
    const create = require('utils/inline-image-store.js').createInlineImageStore
    const current = create(native, root), other = create(native, root)
    getApp()._inlineLifecycleQa = { current, other }
    const rows = [], paths = []
    for (const sample of samples) {
      const filePath = await current.resource('data:image/png;base64,' + sample.base64, true)
      if (await read(filePath) !== sample.base64) throw Error('Recreated bytes differ')
      rows.push({ name: sample.path, filePath, exactBytes: true }); paths.push(filePath)
    }
    for (const row of prepared.rows) {
      let missing = false; try { await read(row.filePath) } catch (_) { missing = true }
      if (!missing) throw Error('Interrupted owned image not reclaimed')
    }
    const otherPath = await other.resource('data:image/png;base64,' + samples[0].base64, true)
    for (let i = 0; i < paths.length; i++) if (await read(paths[i]) !== samples[i].base64) throw Error('New store removed an active image')
    if (await read(otherPath) !== samples[0].base64) throw Error('Second lease image differs')
    return { sdk: wx.getAppBaseInfo().SDKVersion, rows, interruptedFilesReclaimed: prepared.rows.length, activeFilesPreserved: paths.length + 1 }
  }, samples, prepared)
  const decode = source => mini.evaluate(source => new Promise((resolve, reject) => {
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }), image = canvas.createImage()
    const timer = setTimeout(() => reject(Error('native decode timeout')), 5000)
    image.onload = () => {
      try {
        canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let hash = 2166136261
        for (const byte of data) hash = Math.imul(hash ^ byte, 16777619) >>> 0
        clearTimeout(timer); resolve({ width: image.width, height: image.height, rgbaFnv32: hash })
      } catch (error) { clearTimeout(timer); reject(error) }
    }
    image.onerror = () => { clearTimeout(timer); reject(Error('native decode failed')) }; image.src = source
  }), source)
  const expected = name => {
    const s = chrome.result.find(row => row.name === name).source
    return { width: s.width, height: s.height, rgbaFnv32: s.rgbaFnv32 }
  }
  try {
    for (const row of result.rows) { row.pixels = await decode(row.filePath); assert.deepEqual(row.pixels, expected(row.name), row.name) }
    await mini.evaluate(async () => { const q = getApp()._inlineLifecycleQa; await q.current.dispose(); await q.other.dispose(); delete getApp()._inlineLifecycleQa })
    let page = await mini.currentPage()
    if (page.path !== 'pages/index/index') page = await mini.navigateTo('/pages/index/index')
    const views = []
    for (let cycle = 0; cycle < 3; cycle++) {
      const file = { name: 'inline-image-lifecycle.html', inlineHtml: '<h1>图片缓存生命周期测试</h1><img id="picture" style="width:192px;height:128px" src="' + png() + '"><button id="count">点击验证</button><p id="result">0</p><script>document.getElementById("count").onclick=()=>document.getElementById("result").textContent="1"</script>' }
      await mini.evaluate(file => getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile(file), file)
      for (let i = 0; i < 80; i++) {
        if (await mini.evaluate(() => { const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'); return p.data.domMode && p._htmlAssets && p._htmlAssets.size === 1 })) break
        await page.waitFor(100)
      }
      assert.equal(await (await page.$('#reader')).data('error'), ''); assert.equal(await (await page.$('#reader')).data('domMode'), true)
      const state = await mini.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), d = p._htmlRuntime.document
        const find = nodes => { for (const n of nodes || []) { if (n.nid === d.getElementById('picture')._nid) return n; const r = find(n.children); if (r) return r } }
        return { source: find(p.data.domTree).attrs.src, button: d.getElementById('count')._nid, label: d.getElementById('result')._nid }
      })
      assert.ok(state.source.includes('/reader-inline-cache-v1/'))
      const pixels = await decode(state.source); assert.deepEqual(pixels, expected('generated.png'))
      const button = await page.$('#reader >>> #dom-nid-' + state.button); assert.ok(button); await button.tap(); await page.waitFor(100)
      const label = await page.$('#reader >>> #dom-nid-' + state.label); assert.equal(await label.text(), '1')
      views.push({ cycle, nativePixels: pixels, actualWxmlTap: true })
    }
    const report = { checkedAt: new Date().toISOString(), sourceCommit: commit(), version: require('../package.json').version,
      ...result, views, boundary: 'Actual DevTools process restart, native persistent file bytes/decoded pixels and three WXML button taps. No physical iOS/Android or system chat picker proof. No automator screenshot-storage fix claimed.' }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); return report
  } finally {
    await mini.evaluate(async () => { const q = getApp()._inlineLifecycleQa; if (q) { if (q.current) await q.current.dispose(); if (q.other) await q.other.dispose() }; delete getApp()._inlineLifecycleQa })
  }
}

async function main () {
  const [stage, endpoint, output, chromePath] = process.argv.slice(2)
  assert.ok(['prepare', 'finish'].includes(stage) && endpoint && output, 'Usage: prepare|finish WS OUTPUT [CHROME_REPORT]')
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  try { console.log(JSON.stringify(await (stage === 'prepare' ? prepare(mini, output) : finish(mini, output, JSON.parse(fs.readFileSync(chromePath, 'utf8')))), null, 2)) } finally { await mini.disconnect() }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { prepare, finish }
