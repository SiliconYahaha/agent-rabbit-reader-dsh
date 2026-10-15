'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases } = require('../tests/helpers/rtf-korean-cases')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/rtf-korean')
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const rows = []
  try {
    await mini.reLaunch('/pages/index/index')
    const page = await mini.currentPage()
    for (const sample of cases) {
      const name = sample.id + '.rtf'
      await mini.evaluate(({ name, base64 }) => {
        const data = wx.base64ToArrayBuffer(base64), filePath = wx.env.USER_DATA_PATH + '/' + name
        wx.getFileSystemManager().writeFileSync(filePath, data)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: filePath, size: data.byteLength })
      }, { name, base64: Buffer.from(sample.rtf, 'latin1').toString('base64') })
      let state
      for (let i = 0; i < 100; i++) {
        state = await mini.evaluate(() => {
          const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
          const pre = p._htmlRuntime?.document.querySelector('pre')
          return { name: p.data.sourceName, error: p.data.error, ready: p.data.hasContent && !p.data.isLoading, text: pre?.textContent, nid: pre?._nid }
        })
        if (state.error || state.ready && state.name === name) break
        await pause(100)
      }
      assert.equal(state.error, '', name)
      assert.equal(state.name, name)
      assert.equal(state.text, sample.expected, name + ' parsed content')
      const element = await page.$('#reader >>> #dom-nid-' + state.nid)
      assert.ok(element, name + ' real WXML view')
      const rendered = await element.text(), size = await element.size()
      assert.equal(rendered, sample.expected, name + ' visible content')
      assert.ok(size.width > 0 && size.height > 0)
      rows.push({ name, characters: rendered.length, visibleTextSha256: crypto.createHash('sha256').update(rendered).digest('hex'), size })
    }
    await mini.screenshot({ path: path.join(out, 'wechat.png') })
    fs.writeFileSync(path.join(out, 'wechat.json'), JSON.stringify({ at: new Date().toISOString(), rows, physicalDevices: 'not run' }, null, 2))
    console.log(JSON.stringify({ files: rows.length, failures: 0, out }))
  } finally {
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
