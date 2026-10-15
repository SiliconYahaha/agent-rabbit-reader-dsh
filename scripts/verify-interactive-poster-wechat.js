'use strict'

// Open the unmodified user original through the HOME PICKER first. This gate
// deliberately refuses to inject HTML or bypass that route. Artifacts stay local.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

async function verify (mini, output, originalPath) {
  assert.ok(originalPath, 'Pass the unchanged local original as the final argument')
  const originalBytes = fs.readFileSync(originalPath)
  const originalSha256 = require('node:crypto').createHash('sha256').update(originalBytes).digest('hex')
  assert.equal(originalSha256, '6cbb4f8a4109e12d4559521429320ea32c4c9b0dec5755dc89b0c1bf863c2919', 'Use the unchanged regression original')
  const page = await mini.currentPage()
  assert.equal(page.path, 'pages/index/index', 'First open interactive-poster with the real homepage file picker')
  const info = await mini.evaluate(() => {
    const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), g = getApp().globalData, w = wx.getWindowInfo()
    return { file: g.fileQueue && g.fileQueue[g.fileQueueIndex], window: { width: w.windowWidth, height: w.windowHeight }, sdk: wx.getAppBaseInfo().SDKVersion, dom: p.data.domMode, error: p.data.error }
  })
  assert.equal(info.file && info.file.name, path.basename(originalPath))
  assert.equal(info.file.size, 16264632, 'Do not substitute a reduced or synthetic original')
  assert.equal(info.dom, true); assert.equal(info.error, '')
  const state = () => mini.evaluate(() => {
    const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), d = p._htmlRuntime.document
    return { error: p.data.error, errors: p._runtimeErrors, level: d.querySelector('[data-dashboard-app]').dataset.level,
      readout: d.querySelector('[data-current-readout]').textContent, modalHidden: d.querySelector('[data-export-modal]').hidden,
      exportReady: d.querySelector('[data-dashboard-app]').dataset.exportReady }
  })
  const wait = async test => {
    for (let i = 0; i < 100; i++) { const value = await state(); assert.equal(value.error, ''); assert.deepEqual(value.errors, []); if (test(value)) return value; await page.waitFor(100) }
    throw Error('Native WeChat state did not settle')
  }
  const tap = async selector => {
    const nid = await mini.evaluate(s => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector(s)._nid, selector)
    const element = await page.$('#reader >>> #dom-nid-' + nid)
    assert.ok(element, 'Missing WXML control: ' + selector)
    await element.tap()
  }
  const first = await state(); assert.equal(first.modalHidden, true)
  const boardNid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector('[data-dashboard-app]')._nid)
  const board = await page.$('#reader >>> #dom-nid-' + boardNid), size = await board.size(), offset = await board.offset()
  assert.ok(size.width > 0 && size.height > 0 && offset.left >= -1 && offset.left + size.width <= info.window.width + 1, 'Board is empty or horizontally cropped')
  await mini.screenshot({ path: path.join(output, 'native-open.png') })
  const levels = []
  for (const [level, expected] of [[5,'火力全开 / 卡神'],[4,'再测亿遍 / 爆肝卡'],[3,'工位服刑 / 牢卡'],[2,'轻松侧目 / 摸鱼卡'],[1,'低功耗 / 小卡拉米']]) {
    await tap('.scene-hotspot[data-level="' + level + '"]')
    levels.push(await wait(s => Number(s.level) === level && s.readout === expected))
  }
  await tap('[data-export]')
  await wait(s => s.exportReady === 'true' && !s.modalHidden)
  // Read the actual materialized WXML image, not just the author's data URL.
  let preview
  for (let i = 0; i < 100; i++) {
    preview = await mini.evaluate(() => new Promise(resolve => {
      const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), nid = p._htmlRuntime.document.querySelector('[data-export-preview]')._nid
      const find = nodes => { for (const n of nodes || []) { if (n.nid === nid) return n; const child = find(n.children); if (child) return child } }
      const n = find(p.data.domTree), src = n && n.attrs && n.attrs.src
      if (!src || /^data:/.test(src)) { resolve(null); return }
      // DevTools getImageInfo rejects its own http://usr filesystem namespace,
      // although WXML renders it. Decode that exact file with the native Canvas
      // image API instead; do not substitute the author's in-memory data URL.
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 })
      const image = canvas.createImage()
      const timer = setTimeout(() => resolve({ error: 'native image decode timeout' }), 3000)
      image.onload = () => { clearTimeout(timer); resolve({ width: image.width, height: image.height, decoder: 'WeChat OffscreenCanvas.createImage' }) }
      image.onerror = e => { clearTimeout(timer); resolve({ error: e.errMsg || e.message || 'native image decode failed' }) }
      image.src = src
    }))
    if (preview && preview.width) break
    await page.waitFor(100)
  }
  assert.ok(preview && !preview.error, JSON.stringify(preview))
  assert.equal(preview.width, 1536); assert.equal(preview.height, 1024)
  await mini.screenshot({ path: path.join(output, 'native-export.png') })
  await tap('[data-export-close]'); await wait(s => s.modalHidden)
  await tap('.scene-hotspot[data-level="3"]'); await wait(s => Number(s.level) === 3)
  const result = { checkedAt: new Date().toISOString(), sourceCommit: require('node:child_process').execFileSync('git', ['rev-parse','HEAD'], { cwd: path.join(__dirname,'..'), encoding:'utf8' }).trim(),
    version: require('../package.json').version, file: { fixture: 'interactive-poster-original', sha256: originalSha256, bytes: info.file.size }, sdk: info.sdk,
    window: info.window, board: { size, offset }, first, levels, preview, closedAndInteractive: true,
    boundary: 'Actual WeChat DevTools WXML; mouse drag checked separately. Not iOS/Android hardware validation. No source files uploaded.' }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2))
  return result
}

async function main () {
  assert.ok(process.argv[4], 'Usage: node scripts/verify-interactive-poster-wechat.js WS_ENDPOINT REPORT_DIR ORIGINAL.html')
  const output = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-poster-wechat-'))
  fs.mkdirSync(output, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: process.argv[2] || 'ws://127.0.0.1:17611' })
  try { console.log(JSON.stringify(await verify(mini, output, process.argv[4]), null, 2)) } finally { await mini.disconnect() }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { verify }
