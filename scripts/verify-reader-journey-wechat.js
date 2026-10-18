'use strict'
// Local journey audit. Picker return values are injected; rendering and UI taps run in DevTools.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/reader-journey')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const { GifWriter } = require('omggif')
const gifBuffer = Buffer.alloc(100000), gif = new GifWriter(gifBuffer, 240, 160, { loop: 0, palette: [0xf8f4ec, 0xb9e63b, 0xff624a, 0x222222] })
for (let frame = 0; frame < 2; frame++) {
  const pixels = new Uint8Array(240 * 160)
  for (let y = 25; y < 135; y++) for (let x = 25; x < 215; x++) pixels[y * 240 + x] = (x < 120) === (frame === 0) ? 1 : 2
  gif.addFrame(0, 0, 240, 160, pixels, { delay: 30 })
}
const html = '<!doctype html><body style="margin:16px"><h1>第一份：交互说明</h1><button id="count" onclick="this.textContent=Number(this.textContent)+1">0</button><p>点一下计数，然后查看下一份。</p><div style="height:2600px">长文阅读位置</div></body>'
const source = (name, data) => ({ name, base64: Buffer.from(data).toString('base64') })
const disk = (name, file) => source(name, fs.readFileSync(path.join(root, file)))
const samples = [source('交互说明.html', html), source('阅读笔记.md', '# 第二份：笔记\n\n| 项目 | 状态 |\n|---|---|\n| 连续阅读 | 正常 |'), source('双色动画.gif', gifBuffer.subarray(0, gif.end())), disk('秦始皇骑车.svg', 'scripts/assets/example-art/qin-shi-huang-bicycle.svg'), disk('设计画板.fig', 'tests/fixtures/design-packages/circle.fig'), disk('品牌标志.ai', 'scripts/assets/example-art/firefox-classic.ai'), source('损坏的图片.png', 'not an image'), source('最后一份.html', '<h1>最后一份正常显示</h1>')]
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const results = []
  const record = value => { results.push(value);console.log(JSON.stringify(value)) }
  async function until (read, label) {
    for (let n = 0; n < 150; n++) { const value = await read();if (value) return value;await pause(100) }
    throw Error(label)
  }
  async function state () { return mini.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0], reader = page.selectComponent('#reader')
    const design = reader && reader.selectComponent('#design-preview')
    return { route: page.route, page: page.data, reader: reader && reader.data, design: design && design.data, scroll: getApp().globalData.fileQueueScroll, restoring: page._restoringScroll }
  }) }
  async function ready (name, error = false) {
    return until(async () => {
      const d = await state(), r = d.reader
      if (!r || r.sourceName !== name || r.isLoading || (r.designMode && (!d.design || d.design.loading))) return null
      if (error) { assert.ok(r.error);return d }
      assert.equal(r.error, '')
      if (d.design && r.designMode) assert.equal(d.design.error, '')
      assert.ok(r.hasContent)
      return d
    }, 'Not ready: ' + name)
  }
  async function tapNext () { const p = await mini.currentPage();await (await p.$$('.queue-button'))[1].tap() }
  async function tapPrevious () { const p = await mini.currentPage();await (await p.$$('.queue-button'))[0].tap() }
  async function screenshot (name) { await mini.screenshot({ path: path.join(out, name + '.png') }) }
  try {
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(samples => {
      const app = getApp(), key = 'rabbit-recent-session-v1', fileSystem = wx.getFileSystemManager()
      app.__journey = { globals: Object.assign({}, app.globalData), saved: wx.getStorageSync(key), choose: wx.chooseMessageFile, preview: wx.previewImage, document: wx.openDocument, sheet: wx.showActionSheet, calls: [] }
      wx.removeStorageSync(key)
      const files = samples.map((s, i) => { const p = wx.env.USER_DATA_PATH + '/journey-' + i + '-' + s.name;const data = wx.base64ToArrayBuffer(s.base64);fileSystem.writeFileSync(p, data);return { name: s.name, path: p, size: data.byteLength } })
      app.__journey.files = files
      wx.chooseMessageFile = o => { o.success({ tempFiles: files });o.complete && o.complete() }
      wx.previewImage = o => { app.__journey.calls.push('image');o.success && o.success() }
      wx.openDocument = o => { app.__journey.calls.push('document');o.success && o.success() }
      wx.showActionSheet = () => app.__journey.calls.push('sheet')
    }, samples)
    let page = await mini.currentPage()
    await (await until(async () => (await mini.currentPage()).$('.file-button'), 'home file button missing')).tap()
    await ready(samples[0].name)
    page = await mini.currentPage()
    const nid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('count')._nid)
    await (await page.$('#reader >>> #dom-nid-' + nid)).tap()
    await until(() => mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('count').textContent === '1'), 'first file click did not update')
    await screenshot('01-first-file');record({ step: 'picker return → first HTML visible and button responds', pass: true })
    await mini.callWxMethod('pageScrollTo', { scrollTop: 650, duration: 0 });await pause(250)
    const initialScroll = await state();assert.ok(initialScroll.scroll[0] > 600, 'initial reading position not saved: ' + JSON.stringify({ scroll: initialScroll.scroll, restoring: initialScroll.restoring }))
    for (let i = 1; i < samples.length; i++) {
      await tapNext()
      const d = await ready(samples[i].name, i === 6)
      if (i === 1) assert.match(JSON.stringify(d.reader.domTree), /连续阅读/)
      if (i === 2) {
        assert.ok(d.reader.imagePath)
        const element = await (await mini.currentPage()).$('#reader >>> .local-image'), size = await element.size()
        assert.ok(size.width > 200 && size.height > 100)
        assert.equal(await (await mini.currentPage()).$('#reader >>> .reader-canvas'), null)
      }
      if (i === 3) {
        await until(async () => (await state()).reader.standaloneSvgAnimationReady, 'SVG first animation frame missing')
        const pixels = await mini.evaluate(() => new Promise(resolve => {
          const svg = getCurrentPages().slice(-1)[0].selectComponent('#reader').selectComponent('#standalone-svg-player')
          svg.createSelectorQuery().select('#svg-view-canvas').fields({ node: true }).exec(rows => {
            const c = rows[0].node, data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
            let painted = 0;for (let k = 3; k < data.length; k += 4) if (data[k]) painted++
            resolve({ painted, width: c.width, height: c.height })
          })
        }))
        assert.ok(pixels.painted > 1000)
      }
      if (i === 4) assert.ok(d.design.previewPath)
      if (i === 5) { assert.ok(d.design.canOpenPdf);assert.equal(d.design.previewPath, '') }
      await screenshot('0' + (i + 1) + '-file')
      record({ step: samples[i].name, pass: true, mode: i === 5 ? 'native PDF opens automatically; no inline canvas' : i === 6 ? 'visible error; next file available' : 'inline' })
    }
    assert.ok((await mini.evaluate(() => getApp().__journey.calls)).every(call => call === 'document'))
    // Reverse through the same GIF, SVG and design entries, using actual buttons.
    for (let i = samples.length - 2; i >= 0; i--) { await tapPrevious();await ready(samples[i].name, i === 6) }
    await pause(250)
    const viewport = await mini.evaluate(() => new Promise(resolve => wx.createSelectorQuery().selectViewport().scrollOffset().exec(r => resolve(r[0]))))
    assert.ok(Math.abs(Math.abs(viewport.scrollTop) - 650) < 10, 'viewport offset: ' + viewport.scrollTop)
    record({ step: 'reverse all files and restore original scroll', pass: true, scrollTop: viewport.scrollTop })
    page = await mini.currentPage()
    await (await page.$('.queue-position')).tap()
    await (await page.$('.queue-search')).input('动画')
    await until(async () => (await page.data('queueItems')).length === 1, 'search did not filter')
    await (await page.$('.queue-item')).tap()
    await ready(samples[2].name)
    record({ step: 'directory → search → GIF content', pass: true })
    // Rapid switches must settle on the final selection without old errors.
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0];[3,6,4,2,7].forEach(i => p.openQueueIndex(i)) })
    await ready(samples[7].name);await pause(600);assert.equal((await state()).reader.error, '')
    record({ step: 'five rapid mixed switches including bad image', pass: true })
    await until(() => mini.evaluate(() => !!getApp().globalData.recentSessionId), 'cache not saved')
    await mini.evaluate(() => require('utils/recent-session.js').checkpoint(getApp()))
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(() => { getApp().globalData.fileQueue = [];getApp().globalData.fileQueueIndex = -1 })
    page = await mini.currentPage()
    assert.equal((await page.data('recent')).count, samples.length)
    await (await page.$('.resume-button')).tap()
    await ready(samples[7].name)
    record({ step: 'return home → restore current file and full queue from local copies', pass: true })
    // A new session starting with a GIF must show it without needing Next.
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(() => { wx.chooseMessageFile = o => o.success({ tempFiles: [getApp().__journey.files[2], getApp().__journey.files[0]] }) })
    page = await mini.currentPage();await (await until(async () => (await mini.currentPage()).$('.file-button'), 'home file button missing')).tap();await ready(samples[2].name)
    await screenshot('09-first-gif');await tapNext();await ready(samples[0].name)
    record({ step: 'GIF as first file, then HTML', pass: true })
    assert.ok((await mini.evaluate(() => getApp().__journey.calls)).every(call => call === 'document'))
  } catch (error) {
    await screenshot('failure').catch(() => {})
    fs.writeFileSync(path.join(out, 'failure-state.json'), JSON.stringify(await state().catch(() => ({})), null, 2))
    throw error
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ environment: 'WeChat DevTools, injected picker response and native-viewer spies, real renderer and UI taps; not phone evidence', results }, null, 2))
    await mini.evaluate(() => {
      const app = getApp(), backup = app.__journey
      if (!backup) return
      require('utils/recent-session.js').clear()
      wx.chooseMessageFile = backup.choose;wx.previewImage = backup.preview;wx.openDocument = backup.document;wx.showActionSheet = backup.sheet
      app.globalData = backup.globals
      if (backup.saved) wx.setStorageSync('rabbit-recent-session-v1', backup.saved)
      delete app.__journey
    }).catch(() => {})
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.disconnect()
  }
  console.log(JSON.stringify(results, null, 2))
}
main().catch(error => { console.error(error);process.exitCode = 1 })
