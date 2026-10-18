'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const compat = require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/reader-journey')
const pause = ms => new Promise(r => setTimeout(r, ms))
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const aiOnly = process.argv.includes('--ai-only')
  const results = aiOnly ? JSON.parse(fs.readFileSync(path.join(out, 'entry-report.json'), 'utf8')).results.filter(r => r.first !== 'first.ai') : []
  async function until (read, label) { for (let n = 0; n < 150; n++) { const v = await read();if (v) return v;await pause(100) }throw Error(label) }
  async function ready (name, designPage) {
    return until(() => mini.evaluate(({ name, designPage }) => {
      const p = getCurrentPages().slice(-1)[0], c = p.selectComponent(designPage ? '#preview' : '#reader'), d = c && c.data
      if (!d || (designPage ? d.name !== name || d.loading : d.sourceName !== name || d.isLoading)) return null
      return { route: p.route, d }
    }, { name, designPage }), 'entry not ready: ' + name)
  }
  try {
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(payload => {
      const app = getApp(), key = 'rabbit-recent-session-v1'
      app.__entry = { globals: Object.assign({}, app.globalData), saved: wx.getStorageSync(key), choose: wx.chooseMessageFile, document: wx.openDocument, count: 0 }
      wx.removeStorageSync(key)
      app.__entry.files = payload.map((s, i) => { const filePath = wx.env.USER_DATA_PATH + '/entry-' + i + '.' + s.name.split('.').pop();const bytes = wx.base64ToArrayBuffer(s.base64);wx.getFileSystemManager().writeFileSync(filePath, bytes);return { name: s.name, path: filePath, size: bytes.byteLength } })
      wx.openDocument = o => { app.__entry.count++;o.success && o.success() }
    }, [
      ['first.svg', fs.readFileSync(path.join(root, 'scripts/assets/example-art/qin-shi-huang-bicycle.svg'))],
      ['first.fig', fs.readFileSync(path.join(root, 'tests/fixtures/design-packages/circle.fig'))],
      ['first.ai', fs.readFileSync(path.join(root, 'scripts/assets/example-art/firefox-classic.ai'))],
      ['next.html', Buffer.from('<h1>下一份正文</h1>')]
    ].map(([name, b]) => ({ name, base64: b.toString('base64') })))
    for (const [index, name, design] of [[0, 'first.svg', false], [1, 'first.fig', true], [2, 'first.ai', true]].filter(row => !aiOnly || row[0] === 2)) {
      await mini.reLaunch('/pages/home/home')
      await mini.evaluate(index => { const a = getApp();wx.chooseMessageFile = o => o.success({ tempFiles: [a.__entry.files[index], a.__entry.files[3]] }) }, index)
      await (await until(async () => (await mini.currentPage()).$('.file-button'), 'home missing')).tap()
      const first = await ready(name, design);assert.equal(first.d.error, '')
      if (index === 0) { assert.ok(first.d.standaloneSvgSource);await until(() => mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').data.standaloneSvgAnimationReady), 'SVG animation missing') }
      if (index === 1) assert.ok(first.d.previewPath)
      if (index === 2) {
        assert.ok(first.d.canOpenPdf)
        await until(() => mini.evaluate(() => getApp().__entry.count === 1), 'AI automatic open not called')
      }
      await mini.screenshot({ path: path.join(out, name + '.png') })
      let p = await mini.currentPage();await (await p.$$('.queue-button'))[1].tap()
      const next = await ready('next.html', false);assert.equal(next.d.error, '');assert.match(JSON.stringify(next.d.domTree), /下一份正文/)
      p = await mini.currentPage();await (await p.$$('.queue-button'))[0].tap()
      // Returning from the reader uses its embedded design component, not a second route.
      if (design) await until(() => mini.evaluate(name => { const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), c = r && r.selectComponent('#design-preview');return c && c.data.name === name && !c.data.loading && !c.data.error }, name), 'return design missing')
      else await ready(name, false)
      const row = { first: name, directContent: index !== 2, nativeViewerAutomatic: index === 2, nextAndPrevious: true }
      results.push(row);console.log(row)
    }
  } finally {
    fs.writeFileSync(path.join(out, 'entry-report.json'), JSON.stringify({ environment: 'WeChat DevTools; picker and native document opening stubbed', results }, null, 2))
    await mini.evaluate(() => { const a = getApp(), b = a.__entry;if (!b) return;require('utils/recent-session.js').clear();wx.chooseMessageFile = b.choose;wx.openDocument = b.document;a.globalData = b.globals;if (b.saved) wx.setStorageSync('rabbit-recent-session-v1', b.saved);delete a.__entry }).catch(() => {})
    await mini.reLaunch('/pages/home/home').catch(() => {});await mini.disconnect()
  }
}
main().catch(e => { console.error(e);process.exitCode = 1 })
