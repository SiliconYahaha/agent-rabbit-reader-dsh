'use strict'
// 本地开发者工具流程检查。故障通过临时替换族加载器注入，finally 恢复；不上传/分享。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { installAutomatorVersionCompatibility, automationPortForProject } = require('./miniprogram-automator-compat')
installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..'), output = path.join(root, 'outputs/contest-ui')
const port = Number(process.env.WECHAT_AUTOMATION_PORT || automationPortForProject(root))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settled (mini, requireSuccess = false) {
  for (let i = 0; i < 60; i++) {
    const page = await mini.currentPage(), reader = await page.$('#reader')
    if (reader) { const data = await reader.data(); if (!data.isLoading && (!requireSuccess || (!data.error && data.hasContent))) return { page, reader, data } }
    await delay(100)
  }
  throw new Error('阅读页6秒内未完成或明确失败')
}
;(async () => {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
  const results = []
  fs.mkdirSync(output, { recursive: true })
  try {
    for (let i = 0; i < 3; i++) {
      await mini.reLaunch('/pages/home/home')
      await (await mini.currentPage()).callMethod('loadSample')
      let gallery
      for (let turn = 0; turn < 50; turn++) {
        gallery = await mini.currentPage()
        if (gallery.path === 'examples/pages/gallery/gallery') break
        await delay(100)
      }
      assert.equal(gallery.path, 'examples/pages/gallery/gallery')
      await (await gallery.$('.example-card')).tap()
      const { reader, data } = await settled(mini)
      assert.equal(data.error, ''); assert.equal(data.hasContent, true)
      const diagnostic = await reader.callMethod('getReaderDiagnostics')
      assert.deepEqual(diagnostic.runtimeErrors, [])
      results.push({ case: 'sample-open-' + (i + 1), metrics: diagnostic.loadMetrics })
    }
    await mini.evaluate(() => {
      const families = require('file-reader/engine/core/families.js')
      const reader = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      getApp().__entryTestRestore = { families, get: families.get, loadAll: families.loadAll }
      families.get = () => null
      families.loadAll = () => Promise.reject(new Error("module 'file-reader/document/index.js' is not defined"))
      reader.openSelectedFile(getApp().globalData.fileQueue[0])
    })
    let state = await settled(mini)
    assert.match(state.data.error, /请点重试/); assert.equal(state.data.fileLoadRetry, true)
    await mini.screenshot({ path: path.join(output, 'sample-injected-error.png') })
    await mini.evaluate(() => { const old = getApp().__entryTestRestore; old.families.get = old.get; old.families.loadAll = old.loadAll })
    const status = await state.reader.$('#reader-status'), retry = await status.$('button')
    assert.ok(retry, '错误卡必须有可点击重试按钮')
    await retry.tap()
    state = await settled(mini, true)
    assert.equal(state.data.error, ''); assert.equal(state.data.hasContent, true); assert.equal(state.data.fileLoadRetry, false)
    results.push({ case: 'injected-load-failure-and-button-retry', passed: true })
    await mini.screenshot({ path: path.join(output, 'sample-recovered.png') })
    await mini.evaluate(() => {
      const old = getApp().__entryTestRestore, reader = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      old.families.get = () => null
      old.families.loadAll = () => new Promise((resolve, reject) => { old.reject = reject })
      reader.openSelectedFile({ name: 'old.html', inlineHtml: '<p>旧文件</p>' })
      old.families.get = old.get; old.families.loadAll = old.loadAll
      reader.openSelectedFile({ name: 'new.html', inlineHtml: '<p>新文件</p>' })
      old.reject(new Error('late package error'))
    })
    state = await settled(mini, true)
    assert.equal(state.data.error, ''); assert.equal(state.data.sourceName, 'new.html'); assert.equal(state.data.fileLoadRetry, false)
    results.push({ case: 'late-error-after-file-switch', passed: true })
    fs.writeFileSync(path.join(output, 'entry-verification.json'), JSON.stringify({ environment: 'WeChat DevTools; injected failures are not a Xiaomi device test', results }, null, 2))
    console.log(JSON.stringify(results))
  } finally {
    await mini.evaluate(() => { const old = getApp().__entryTestRestore; if (old) { old.families.get = old.get; old.families.loadAll = old.loadAll; delete getApp().__entryTestRestore } }).catch(() => {})
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.disconnect()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
