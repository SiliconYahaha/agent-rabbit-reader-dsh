'use strict'
// Template extension dispatch is checked with compatible Ai/PSD payloads.
// These renamed fixtures are not claimed as independently authored AIT/PSDT exports.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/design-packages/adobe-wechat')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const pause = ms => new Promise(r => setTimeout(r, ms))
const eps = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n1 0 0 setrgbcolor\n0 0 moveto\n40 0 lineto\n40 20 lineto\n0 20 lineto\nclosepath\nfill\nshowpage\n%%EOF')
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const psd = fs.readFileSync(path.join(root, 'scripts/assets/example-art/mozilla-mascot-poster.psd'))
  const resourceStart = 30 + psd.readUInt32BE(26)
  const resourceEnd = resourceStart + 4 + psd.readUInt32BE(resourceStart)
  let savedJpeg
  for (let cursor = resourceStart + 4; cursor < resourceEnd;) {
    assert.equal(psd.subarray(cursor, cursor + 4).toString(), '8BIM')
    const id = psd.readUInt16BE(cursor + 4);cursor += 6
    cursor += Math.ceil((psd[cursor] + 1) / 2) * 2
    const length = psd.readUInt32BE(cursor);cursor += 4
    if (id === 1036) savedJpeg = psd.subarray(cursor + 28, cursor + length)
    cursor += length + length % 2
  }
  assert.ok(savedJpeg)
  const ai = fs.readFileSync(path.join(root, 'scripts/assets/example-art/firefox-classic.ai'))
  const samples = [{ name: 'vector.eps', bytes: eps }, { name: 'poster.psdt', bytes: psd }, { name: 'brand.ait', bytes: ai }]
  const rows = []
  async function wait (name) {
    for (let n = 0; n < 120; n++) {
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
        const bytes = wx.base64ToArrayBuffer(s.base64), p = wx.env.USER_DATA_PATH + '/adobe-extension-check-' + s.name
        wx.getFileSystemManager().writeFileSync(p, bytes)
        return { name: s.name, path: p, size: bytes.byteLength }
      })
      getApp().globalData.fileQueue = m;getApp().globalData.fileQueueIndex = 0;getApp().globalData.pendingFilePreview = m[0]
      return m
    }, samples.map(s => ({ name: s.name, base64: s.bytes.toString('base64') })))
    await mini.reLaunch('/pages/file-preview/file-preview')
    const page = await mini.currentPage()
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      const priorPdfs = i === 2 ? await mini.evaluate(() => wx.getFileSystemManager().readdirSync(wx.env.USER_DATA_PATH).filter(n => /^illustrator-preview-.*\.pdf$/.test(n))) : []
      if (i) await (await page.$$('.queue-button'))[1].tap()
      const d = await wait(sample.name)
      assert.equal(d.error, '')
      if (i < 2) {
        assert.ok(d.previewPath)
        const el = await page.$('#preview >>> .preview-image'), size = await el.size()
        assert.ok(size.width > 100 && size.height > 100)
        const bytes = Buffer.from(await mini.evaluate(() => wx.arrayBufferToBase64(wx.getFileSystemManager().readFileSync(getCurrentPages().slice(-1)[0].selectComponent('#preview').data.previewPath))), 'base64')
        if (i === 0) { assert.match(bytes.toString(), /<path/);assert.match(bytes.toString(), /rgb\(255,0,0\)/) }
        else assert.equal(hash(bytes), hash(savedJpeg))
        await mini.screenshot({ path: path.join(out, sample.name + '.png') })
        rows.push({ name: sample.name, visibleImage: size, previewSha256: hash(bytes), evidence: i === 0 ? 'generated EPS path fixture, visible SVG preview' : 'real layered PSD bytes using PSDT extension; saved JPEG matches source' })
      } else {
        assert.equal(d.canOpenPdf, true)
        await pause(1500)
        const pdfs = await mini.evaluate(prior => {
          const fs = wx.getFileSystemManager(), names = fs.readdirSync(wx.env.USER_DATA_PATH).filter(n => /^illustrator-preview-.*\.pdf$/.test(n) && !prior.includes(n)).sort()
          return names.slice(-3).map(n => ({ name: n, data: wx.arrayBufferToBase64(fs.readFileSync(wx.env.USER_DATA_PATH + '/' + n)) }))
        }, priorPdfs)
        assert.ok(pdfs.some(p => hash(Buffer.from(p.data, 'base64')) === hash(ai)))
        const after = await wait(sample.name)
        assert.equal(after.error, '')
        rows.push({ name: sample.name, pdfCopyExact: true, canOpenPdf: true, viewerError: after.error, evidence: 'PDF-compatible Ai bytes using AIT extension; document copy and handoff only, native PDF visual rendering not asserted' })
      }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ environment: 'WeChat DevTools, not physical phones', rows }, null, 2) + '\n')
    console.log(JSON.stringify(rows))
  } finally { await mini.reLaunch('/pages/home/home').catch(() => {});await mini.disconnect() }
}
main().catch(e => { console.error(e);process.exitCode = 1 })
