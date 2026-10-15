'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const { resourceData, resourceBlock, documentWithResources } = require('../tests/helpers/psd-thumbnails')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
async function main () {
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/psd-thumbnails/wechat'), originals = path.join(root, 'outputs/psd-thumbnails/originals')
  fs.mkdirSync(out, { recursive: true })
  const references = JSON.parse(fs.readFileSync(path.join(originals, 'references.json')))
  const pillow = JSON.parse(fs.readFileSync(path.join(root, 'outputs/psd-thumbnails/verified/pillow.json')))
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const rows = []
  async function waitPreview (name) {
    for (let i = 0; i < 100; i++) {
      const state = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#preview')?.data)
      if (state && !state.loading && state.name === name) return state
      await pause(100)
    }
    throw Error('Preview did not finish: ' + name)
  }
  try {
    await mini.reLaunch('/pages/home/home')
    const materials = await mini.evaluate(samples => {
      const materials = samples.map(sample => {
        const data = wx.base64ToArrayBuffer(sample.base64), filePath = wx.env.USER_DATA_PATH + '/' + sample.name
        wx.getFileSystemManager().writeFileSync(filePath, data)
        return { name: sample.name, path: filePath, size: data.byteLength }
      })
      const app = getApp()
      app.globalData.fileQueue = [materials[0]]; app.globalData.fileQueueIndex = 0
      app.globalData.pendingFilePreview = materials[0]
      return materials
    }, references.samples.map(s => ({ name: s.name, base64: fs.readFileSync(path.join(originals, s.name)).toString('base64') })))
    await mini.reLaunch('/pages/file-preview/file-preview')
    const page = await mini.currentPage()
    for (const [i, sample] of references.samples.entries()) {
      if (i) await page.callMethod('openMaterial', materials[i])
      const state = await waitPreview(sample.name)
      assert.equal(state.error, ''); assert.match(state.previewPath, /psd-preview-/)
      const imageElement = await page.$('#preview >>> .preview-image')
      assert.ok(imageElement)
      const size = await imageElement.size()
      assert.ok(size.width > 0 && size.height > 0)
      assert.equal(await imageElement.attribute('src'), state.previewPath)
      const decoded = await mini.evaluate(async ({ width, height, sourceJpegBase64 }) => {
        const preview = getCurrentPages().slice(-1)[0].selectComponent('#preview')
        async function decode (filePath) {
          const canvas = wx.createOffscreenCanvas({ type: '2d', width, height }), image = canvas.createImage()
          await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = filePath })
          canvas.getContext('2d').drawImage(image, 0, 0)
          return { width: image.width, height: image.height, pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, width, height).data) }
        }
        const actual = await decode(preview.data.previewPath)
        let sourceControl = null
        if (sourceJpegBase64) {
          // This JPEG was extracted independently by psd-tools. Native WeChat
          // decoding of it is the control for platform chroma/IDCT differences.
          const filePath = wx.env.USER_DATA_PATH + '/independent-jpeg-control.jpg'
          wx.getFileSystemManager().writeFileSync(filePath, wx.base64ToArrayBuffer(sourceJpegBase64))
          sourceControl = (await decode(filePath)).pixels
        }
        return { ...actual, sourceControl, bytes: wx.arrayBufferToBase64(wx.getFileSystemManager().readFileSync(preview.data.previewPath)), error: preview.data.error }
      }, { width: sample.width, height: sample.height, sourceJpegBase64: sample.sourceJpegBase64 })
      const expected = pillow.rows[i]
      assert.equal(decoded.error, '')
      assert.deepEqual([decoded.width, decoded.height], [expected.width, expected.height])
      assert.equal(hash(Buffer.from(decoded.bytes, 'base64')), expected.sha256, sample.name + ' actual component JPEG')
      const expectedPixels = Buffer.from(expected.rgbaBase64, 'base64')
      const pillowDelta = Math.max(...decoded.pixels.map((v, n) => Math.abs(v - expectedPixels[n])))
      if (sample.sourceJpegBase64) assert.deepEqual(decoded.pixels, decoded.sourceControl, sample.name + ' native original JPEG control')
      else assert.deepEqual(Buffer.from(decoded.pixels), expectedPixels, sample.name + ' raw thumbnail native preview versus Pillow')
      rows.push({ name: sample.name, previewSha256: expected.sha256, nativeSourceControlExact: !!sample.sourceJpegBase64, pillowPixelsExact: pillowDelta === 0, pillowMaxChannelDelta: pillowDelta, visibleWxml: size, sourceResource: sample.resourceId })
      if (sample.name === 'modern-raw-after-legacy-jpeg.psb') await mini.screenshot({ path: path.join(out, 'modern-raw.png') })
    }
    // Exercise the actual queue buttons: a rejected file clears the previous
    // image, and the next supported document still displays its own preview.
    const raw = references.samples.find(s => s.name.startsWith('raw-1036-w7.'))
    const invalid = resourceData(Buffer.from(raw.resourcesBase64, 'base64'), 1036)
    invalid.writeUInt16BE(8, 24)
    const bad = documentWithResources(resourceBlock(1036, invalid))
    await mini.evaluate(({ base64, first, last }) => {
      const data = wx.base64ToArrayBuffer(base64), filePath = wx.env.USER_DATA_PATH + '/invalid-thumbnail.psd'
      wx.getFileSystemManager().writeFileSync(filePath, data)
      const queue = [first, { name: 'invalid-thumbnail.psd', path: filePath, size: data.byteLength }, last]
      const app = getApp(), page = getCurrentPages().slice(-1)[0]
      app.globalData.fileQueue = queue; app.globalData.fileQueueIndex = 0
      page.syncFileSession(); page.openMaterial(first)
    }, { base64: bad.toString('base64'), first: materials[0], last: materials[18] })
    await waitPreview(materials[0].name)
    await (await page.$$('.queue-button'))[1].tap()
    const failed = await waitPreview('invalid-thumbnail.psd')
    assert.equal(failed.previewPath, ''); assert.match(failed.message, /未找到可用缩略图/)
    assert.equal(await page.$('#preview >>> .preview-image'), null)
    await (await page.$$('.queue-button'))[1].tap()
    const recovered = await waitPreview(materials[18].name)
    assert.equal(recovered.error, ''); assert.ok(recovered.previewPath)
    await mini.screenshot({ path: path.join(out, 'queue-recovery.png') })
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'WeChat DevTools real component, WXML image and native offscreen JPEG decoder; not physical phones', rows, queue: { taps: 2, invalidImageCleared: true, recovered: recovered.name } }, null, 2) + '\n')
    console.log(JSON.stringify({ nativeImages: rows.length, visibleImages: rows.length, queueTaps: 2, recovery: true }))
  } finally { await mini.reLaunch('/pages/home/home').catch(() => {}); await mini.disconnect() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
