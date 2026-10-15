'use strict'
// Local fault injection only. Restores loader/navigation methods; never uploads.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until (read, description) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (value) return value; await pause(100) }
  throw new Error(description)
}
;(async () => {
  const port = process.env.WECHAT_AUTOMATION_PORT || require('./miniprogram-automator-compat').automationPortForProject(root)
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
  const results = []
  try {
    await mini.reLaunch('/pages/home/home')
    await (await mini.currentPage()).callMethod('loadSample')
    await until(async () => (await mini.currentPage()).path === 'examples/pages/gallery/gallery', 'gallery unavailable')
    await (await (await mini.currentPage()).$('[data-id="markdown"]')).tap()
    await until(async () => (await mini.currentPage()).path === 'pages/index/index', 'reader unavailable')
    const reader = await until(async () => (await mini.currentPage()).$('#reader'), 'reader not mounted')
    await until(async () => { const d = await reader.data(); return !d.isLoading && d.hasContent && !d.error }, 'initial Markdown failed')
    await mini.evaluate(() => {
      const loader = require('file-reader/engine/core/subpackage-loader.js')
      const old = { loader, load: loader.load }
      getApp().__recoveryTest = old
      loader.load = (entry, ...args) => entry.indexOf('markdown/runtime') >= 0 ? Promise.reject(new Error('injected Markdown load failure')) : old.load.call(loader, entry, ...args)
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile(getApp().globalData.fileQueue[0])
    })
    await until(async () => { const d = await reader.data(); return !d.isLoading && d.fileLoadRetry }, 'Markdown retry missing')
    await mini.evaluate(() => { const old = getApp().__recoveryTest; old.loader.load = old.load })
    await (await (await reader.$('#reader-status')).$('button')).tap()
    await until(async () => { const d = await reader.data(); return !d.isLoading && d.hasContent && !d.error && !d.fileLoadRetry }, 'Markdown retry failed')
    assert.match(await reader.data('sourceName'), /\.md$/)
    results.push('Markdown load failure -> actual retry button -> original file rendered')

    // Use real bundled PSD and HTML files, not fabricated previews.
    await mini.evaluate(async () => {
      const catalog = require('examples/catalog.js'), session = require('utils/file-session.js')
      const files = await Promise.all(['change', 'meeting'].map(id => catalog.materialize(id, wx)))
      session.stageMaterialRoute(getApp(), session.startFileSession(getApp(), files))
    })
    await mini.reLaunch('/pages/file-preview/file-preview')
    const previewPage = await mini.currentPage()
    const preview = await until(() => previewPage.$('#preview'), 'design preview missing')
    await until(async () => { const d = await preview.data();return !d.loading && d.previewPath && !d.error }, 'PSD not rendered')
    const originalFile = await previewPage.data('file'), originalPath = await preview.data('previewPath')
    await mini.evaluate(() => {
      const old = getApp().__recoveryTest
      old.redirectTo = wx.redirectTo; old.calls = []
      wx.redirectTo = options => old.calls.push(options)
    })
    await previewPage.callMethod('openNextFile')
    await previewPage.callMethod('openNextFile')
    assert.equal(await mini.evaluate(() => getApp().__recoveryTest.calls.length), 1)
    await mini.evaluate(() => getApp().__recoveryTest.calls[0].fail({ errMsg: 'injected navigation failure' }))
    assert.equal((await previewPage.data('file')).name, originalFile.name)
    assert.equal(await previewPage.data('queuePosition'), 1)
    assert.equal(await preview.data('previewPath'), originalPath)
    assert.equal(await mini.evaluate(() => getApp().globalData.pendingMaterial), null)
    await mini.evaluate(() => { wx.redirectTo = getApp().__recoveryTest.redirectTo })
    await previewPage.callMethod('openNextFile')
    await until(async () => (await mini.currentPage()).path === 'pages/index/index', 'next file navigation failed')
    const nextReader = await until(async () => (await mini.currentPage()).$('#reader'), 'next reader unavailable')
    await until(async () => { const d = await nextReader.data();return !d.isLoading && d.hasContent && !d.error }, 'next HTML failed')
    results.push('PSD -> duplicate navigation blocked -> failed navigation keeps preview and index -> retry opens HTML')
    const out = path.join(root, 'outputs/contest-ui/recovery-verification.json')
    fs.writeFileSync(out, JSON.stringify({ environment: 'WeChat DevTools; not a physical phone test', results }, null, 2))
    console.log(JSON.stringify(results))
  } finally {
    await mini.evaluate(() => {
      const old = getApp().__recoveryTest
      if (old) { old.loader.load = old.load; if (old.redirectTo) wx.redirectTo = old.redirectTo; delete getApp().__recoveryTest }
    }).catch(() => {})
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.disconnect()
  }
})().catch(error => { console.error(error);process.exitCode = 1 })
