'use strict'

// Dedicated DevTools QA session: intentionally inject one filesystem failure,
// restore the native API in finally, then inspect real WXML/native file pixels.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const fixtures = require('../tests/fixtures/inline-cache-recovery/wpt-images.json')
const { png } = require('../tests/helpers/inline-poster')
async function verify (mini, output, chromeReport) {
  fs.mkdirSync(output, { recursive: true })
  const samples = fixtures.concat({ path: 'generated.png', base64: png().split(',')[1] }), results = []
  const decode = async src => mini.evaluate(source => new Promise((resolve, reject) => {
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }), image = canvas.createImage()
    const timer = setTimeout(() => reject(Error('native decode timeout')), 5000)
    image.onload = () => {
      try {
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        let hash = 2166136261
        for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619) >>> 0
        clearTimeout(timer); resolve({ width: image.width, height: image.height, rgbaFnv32: hash })
      } catch (error) { clearTimeout(timer); reject(error) }
    }
    image.onerror = error => { clearTimeout(timer); reject(Error(error.errMsg || 'native decode failed')) }
    image.src = source
  }), src)
  const expected = name => { const row = chromeReport.result.find(row => row.name === name).source; return { width: row.width, height: row.height, rgbaFnv32: row.rgbaFnv32 } }
  try {
    for (const sample of samples) {
      const result = await mini.evaluate(async sample => {
        const native = wx.getFileSystemManager(), app = getApp()
        let failing = true, writes = 0, message
        const store = require('utils/inline-image-store.js').createInlineImageStore({
          writeFile: o => { writes++; if (failing) o.fail({ errMsg: 'injected cache QA failure' }); else native.writeFile(o) },
          mkdir: o => native.mkdir(o), readdir: o => native.readdir(o), unlink: o => native.unlink(o)
        }, wx.env.USER_DATA_PATH)
        app._cacheRecoveryQaStore = store
        const url = 'data:image/png;base64,' + sample.base64
        try { await store.resource(url, true) } catch (error) { message = error.message }
        const failed = { message, entries: store.size, bytes: store.bytes }
        failing = false
        const source = await store.resource(url, true)
        const actual = await new Promise((resolve, reject) => native.readFile({ filePath: source, encoding: 'base64', success: r => resolve(r.data), fail: reject }))
        return { failed, writes, source, exactBytes: actual === sample.base64 }
      }, sample)
      assert.match(result.failed.message, /injected/); assert.equal(result.failed.entries, 0); assert.equal(result.failed.bytes, 0)
      assert.equal(result.writes, 2); assert.equal(result.exactBytes, true)
      const pixels = await decode(result.source); assert.deepEqual(pixels, expected(sample.path), sample.path)
      results.push({ name: sample.path, failed: result.failed, writes: result.writes, exactBytes: true, pixels })
      await mini.evaluate(() => { getApp()._cacheRecoveryQaStore.dispose(); delete getApp()._cacheRecoveryQaStore })
    }
    // First-load failures must expose a working retry. For dynamic images the
    // native decoder may fail first and presentation may then perform the retry.
    // Either way require two writes and the actual original pixels, not a banner.
    let page = await mini.currentPage()
    if (page.path !== 'pages/index/index') page = await mini.navigateTo('/pages/index/index')
    const pageResults = []
    for (const initial of [true, false]) {
      try {
        const url = png()
        const html = initial ? '<img id="out" src="' + url + '">' : '<img id="out"><button id="again">显示图片</button><script>document.getElementById("again").onclick=()=>document.getElementById("out").src=' + JSON.stringify(url) + '</script>'
        await mini.evaluate(file => {
          const nativeGet = wx.getFileSystemManager, native = nativeGet()
          const qa = { native, fail: true, writes: 0 }; getApp()._cacheRecoveryQa = qa
          const wrapped = () => ({ writeFile: o => { qa.writes++; if (qa.fail) { qa.fail = false; o.fail({ errMsg: 'injected cache QA failure' }) } else native.writeFile(o) },
            mkdir: o => native.mkdir(o), readdir: o => native.readdir(o), unlink: o => native.unlink(o) })
          // Restore synchronously; only this Page's new store captures the
          // wrapper. Do not leave a global SDK mock active across navigation.
          try {
            wx.getFileSystemManager = wrapped
            if (wx.getFileSystemManager !== wrapped) throw Error('Native test wrapper unavailable')
            const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
            if (typeof p.retryHtmlPresentation !== 'function') throw Error('Current reader source not loaded')
            p.openSelectedFile(file)
          } finally { wx.getFileSystemManager = nativeGet }
        }, { name: 'cache-recovery-qa.html', inlineHtml: html })
        await page.waitFor(300)
        if (!initial) {
          const nid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('again')._nid)
          await (await page.$('#reader >>> #dom-nid-' + nid)).tap()
        }
        for (let i = 0; i < 50; i++) {
          const settled = await mini.evaluate(() => { const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'); return p.data.htmlPresentationRetry || p._htmlAssets && p._htmlAssets.size === 1 })
          if (settled) break
          await page.waitFor(100)
        }
        const offeredRetry = await (await page.$('#reader')).data('htmlPresentationRetry')
        if (initial) assert.equal(offeredRetry, true)
        if (offeredRetry) {
          assert.match(await (await page.$('#reader')).data('error'), /injected/)
          if (initial) await mini.screenshot({ path: path.join(output, 'native-retry-before.png') })
          const button = await page.$('#reader >>> .error-card button'); assert.ok(button); await button.tap()
        }
        for (let i = 0; i < 50 && (await (await page.$('#reader')).data('error')); i++) await page.waitFor(100)
        assert.equal(await (await page.$('#reader')).data('error'), ''); assert.equal(await (await page.$('#reader')).data('domMode'), true)
        const state = await mini.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), img = p._htmlRuntime.document.getElementById('out')
          const find = nodes => { for (const n of nodes || []) { if (n.nid === img._nid) return n; const found = find(n.children); if (found) return found } }
          return { source: find(p.data.domTree).attrs.src, authorSource: img.src, writes: getApp()._cacheRecoveryQa.writes }
        })
        assert.equal(state.authorSource, url); assert.equal(state.writes, 2)
        const pixels = await decode(state.source); assert.deepEqual(pixels, expected('generated.png'))
        pageResults.push({ initial, recovery: offeredRetry ? 'actual WXML retry button' : 'native decoder failure followed by presentation retry', writes: state.writes, domMode: true, error: '', authorSourcePreserved: true, pixels })
        if (initial) await mini.screenshot({ path: path.join(output, 'native-retry-after.png') })
      } finally { await mini.evaluate(() => { delete getApp()._cacheRecoveryQa }) }
    }
    const report = { checkedAt: new Date().toISOString(), sourceCommit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: require('../package.json').version,
      sdk: await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion), samples: results, pageResults,
      boundary: 'Actual DevTools native files, WXML retry button and Canvas pixels. I/O failure is intentionally injected; no hardware validation.' }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); return report
  } finally {
    await mini.evaluate(() => { const a = getApp(); if (a._cacheRecoveryQaStore) a._cacheRecoveryQaStore.dispose(); delete a._cacheRecoveryQaStore; delete a._cacheRecoveryQa })
  }
}
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: process.argv[2] || 'ws://127.0.0.1:17611' })
  try { console.log(JSON.stringify(await verify(mini, process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'inline-cache-wechat-')), JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))), null, 2)) } finally { await mini.disconnect() }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { verify }
