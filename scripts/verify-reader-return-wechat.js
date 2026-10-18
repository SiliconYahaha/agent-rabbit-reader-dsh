'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const compat = require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/reader-journey')
const pause = ms => new Promise(r => setTimeout(r, ms))
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const results = []
  async function until (read, label) { for (let n = 0; n < 100; n++) { if (await read()) return;await pause(100) }throw Error(label) }
  async function select (indices) {
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(indices => { const a = getApp();a.__return.calls = 0;wx.chooseMessageFile = o => o.success({ tempFiles: indices.map(i => a.__return.files[i]) }) }, indices)
    await (await (await mini.currentPage()).$('.file-button')).tap()
    await until(() => mini.evaluate(() => !!getCurrentPages().slice(-1)[0]._nativeReturn), 'native lifecycle event not bound')
  }
  try {
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(base64 => {
      const a = getApp(), key = 'rabbit-recent-session-v1', f = wx.getFileSystemManager(), p = wx.env.USER_DATA_PATH + '/return-document.pdf'
      a.__return = { globals: Object.assign({}, a.globalData), saved: wx.getStorageSync(key), choose: wx.chooseMessageFile, document: wx.openDocument }
      wx.removeStorageSync(key);f.writeFileSync(p, wx.base64ToArrayBuffer(base64))
      a.__return.files = [{ name: '第一份.pdf', path: p }, { name: '第二份.html', inlineHtml: '<h1>第二份正文</h1>', path: wx.env.USER_DATA_PATH + '/return-next.html' }, { name: '画板.ai', path: p }]
      f.writeFileSync(a.__return.files[1].path, '<h1>第二份正文</h1>', 'utf8')
      wx.openDocument = o => { a.__return.open = o;a.__return.calls++ }
    }, fs.readFileSync(path.join(root, 'scripts/assets/example-art/firefox-classic.ai')).toString('base64'))
    await select([0, 1])
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0];p.onHide();getApp().__return.open.success();p.onShow() })
    let p = await mini.currentPage()
    await until(async () => await p.data('nativeReturned') && await p.data('queueOpen'), 'multi return did not reveal queue')
    assert.equal((await p.$$('.queue-item')).length, 2)
    await mini.screenshot({ path: path.join(out, 'native-return-queue.png') })
    await (await p.$$('.queue-item'))[1].tap()
    await until(() => mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0], r = p.selectComponent('#reader');return !p.data.nativeReturned && !p.data.queueOpen && r && !r.data.isLoading && JSON.stringify(r.data.domTree).includes('第二份正文') }), 'next HTML not visible')
    assert.equal(await mini.evaluate(() => getApp().__return.calls), 1)
    await mini.navigateBack()
    await until(async () => (await mini.currentPage()).path === 'pages/home/home', 'Back did not reach home')
    results.push('PDF auto opens once; return shows selected list; select HTML; one Back reaches home')
    await select([2])
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0];p.onHide();p.onShow();getApp().__return.open.success() })
    await until(async () => (await mini.currentPage()).path === 'pages/home/home', 'single AI return did not reach home')
    assert.equal(await mini.evaluate(() => getApp().__return.calls), 1)
    results.push('Single Ai: real component event reaches page; late success after return skips details and reaches home')
    await select([0])
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0];p.onHide();getApp().__return.open.fail({ errMsg: 'fixture invalid document' });p.onShow() })
    assert.equal((await mini.currentPage()).path, 'pages/index/index')
    assert.match(await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').data.error), /fixture invalid/)
    results.push('Native open failure stays visible and retryable, without navigating away')
    console.log(results)
  } finally {
    fs.writeFileSync(path.join(out, 'return-report.json'), JSON.stringify({ environment: 'WeChat DevTools real page stack/UI/component events; native viewer callbacks and hide/show simulated, not phone evidence', results }, null, 2))
    await mini.evaluate(() => { const a = getApp(), b = a.__return;if (!b) return;require('utils/recent-session.js').clear();wx.chooseMessageFile = b.choose;wx.openDocument = b.document;a.globalData = b.globals;if (b.saved) wx.setStorageSync('rabbit-recent-session-v1', b.saved);delete a.__return }).catch(() => {})
    await mini.reLaunch('/pages/home/home').catch(() => {});await mini.disconnect()
  }
}
main().catch(e => { console.error(e);process.exitCode = 1 })
