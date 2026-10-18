'use strict'
// Local DevTools evidence only; uses downloaded, source-attributed fixtures.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { unzipSync } = require('fflate'), { PNG } = require('pngjs')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const pause = ms => new Promise(r => setTimeout(r, ms))
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/design-packages/wechat')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const samples = [['circle.fig', 'thumbnail.png'], ['image.sketch', 'previews/preview.png']].map(([name, entry]) => {
    const bytes = fs.readFileSync(path.join(root, 'tests/fixtures/design-packages', name))
    const png = Buffer.from(unzipSync(bytes)[entry]), decoded = PNG.sync.read(png)
    return { name, base64: bytes.toString('base64'), expected: hash(png), width: decoded.width, height: decoded.height }
  })
  const rows = []
  async function wait (name) {
    for (let n = 0; n < 100; n++) {
      const d = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#preview')?.data)
      if (d && d.name === name && !d.loading) return d
      await pause(100)
    }
    throw Error('Preview timeout: ' + name)
  }
  try {
    await mini.reLaunch('/pages/home/home')
    const materials = await mini.evaluate(samples => {
      const m = samples.map(s => {
        const data = wx.base64ToArrayBuffer(s.base64), filePath = wx.env.USER_DATA_PATH + '/design-verification-' + s.name
        wx.getFileSystemManager().writeFileSync(filePath, data)
        return { name: s.name, path: filePath, size: data.byteLength }
      })
      getApp().globalData.fileQueue = m;getApp().globalData.fileQueueIndex = 0;getApp().globalData.pendingFilePreview = m[0]
      return m
    }, samples.map(({ name, base64 }) => ({ name, base64 })))
    await mini.reLaunch('/pages/file-preview/file-preview')
    const page = await mini.currentPage()
    for (const [i, sample] of samples.entries()) {
      if (i) await (await page.$$('.queue-button'))[1].tap()
      const d = await wait(sample.name)
      assert.equal(d.error, '');assert.ok(d.previewPath)
      const element = await page.$('#preview >>> .preview-image'), size = await element.size()
      assert.ok(size.width > 100 && size.height > 100)
      const result = await mini.evaluate(async () => {
        const p = getCurrentPages().slice(-1)[0].selectComponent('#preview').data.previewPath
        const c = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }), image = c.createImage()
        await new Promise((resolve, reject) => { image.onload = resolve;image.onerror = reject;image.src = p })
        return { bytes: wx.arrayBufferToBase64(wx.getFileSystemManager().readFileSync(p)), width: image.width, height: image.height }
      })
      assert.equal(hash(Buffer.from(result.bytes, 'base64')), sample.expected)
      assert.deepEqual([result.width, result.height], [sample.width, sample.height])
      await mini.screenshot({ path: path.join(out, sample.name + '.png') })
      rows.push({ name: sample.name, exactSourcePreview: true, width: result.width, height: result.height, message: d.message, visibleWxml: size })
    }
    const bad = await mini.evaluate(() => {
      const p = wx.env.USER_DATA_PATH + '/design-verification-bad.fig'
      wx.getFileSystemManager().writeFileSync(p, 'not a design file', 'utf8')
      return { name: 'bad.fig', path: p, size: 17 }
    })
    await page.callMethod('openMaterial', bad)
    const failure = await wait('bad.fig');assert.ok(failure.error);assert.equal(failure.previewPath, '')
    await page.callMethod('openMaterial', materials[0]);const recovered = await wait(samples[0].name)
    assert.equal(recovered.error, '');assert.ok(recovered.previewPath)
    const report = { environment: 'WeChat DevTools, actual component and native PNG decode; not physical phones', rows, queueNextTap: true, invalidClearedAndRecovered: true }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally { await mini.reLaunch('/pages/home/home').catch(() => {});await mini.disconnect() }
}
main().catch(e => { console.error(e);process.exitCode = 1 })
