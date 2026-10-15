'use strict'
// Diagnostic only: reports observed failures; it does not certify game support.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const compat = require('./miniprogram-automator-compat')
const { testMaterialRoot } = require('./local-test-materials')
compat.installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..'), port = compat.automationPortForProject(root)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const automator = require('miniprogram-automator')
  let mp
  try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }) } catch (_) {
    execFileSync('/Applications/wechatwebdevtools.app/Contents/MacOS/cli', compat.automationCliArgs(root, port), { stdio: 'inherit', timeout: 60000 })
    for (let i = 0; i < 20 && !mp; i++) {
      try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }) } catch (_) { await delay(500) }
    }
  }
  if (!mp) throw Error('Developer Tools automation is unavailable')
  const rows = [], out = path.join(root, 'outputs/hard-html')
  fs.mkdirSync(out, { recursive: true })
  try {
    for (let i = 0; i < 60; i++) { if (await mp.evaluate(() => getCurrentPages().length > 0)) break; await delay(500) }
    await mp.reLaunch('/pages/index/index')
    for (let i = 0; i < 40; i++) { if (await mp.evaluate(() => !!getCurrentPages().slice(-1)[0]?.selectComponent('#reader'))) break; await delay(250) }
    const dir = path.resolve(process.argv[2] || testMaterialRoot())
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.html'))) {
      console.log('Inspecting ' + name)
      await mp.evaluate(({ name, base64 }) => {
        const bytes = wx.base64ToArrayBuffer(base64), filePath = wx.env.USER_DATA_PATH + '/' + name
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: filePath, size: bytes.byteLength })
      }, { name, base64: fs.readFileSync(path.join(dir, name)).toString('base64') })
      await delay(3000)
      const state = await mp.evaluate(() => {
        const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), d = r._htmlRuntime?.document
        const flat = ns => (ns || []).flatMap(n => [n, ...flat(n.children)])
        const view = flat(r.data.domTree)
        return {
          name: r.data.sourceName, error: r.data.error, loading: r.data.isLoading,
          runtimeErrors: (r._runtimeErrors || []).map(e => ({ phase: e.phase, message: e.message })),
          loadText: d?.getElementById('loadText')?.textContent,
          buttons: d?.querySelectorAll('button,[data-action]').map(n => ({ id: n.id, action: n.getAttribute('data-action'), text: n.textContent.slice(0, 80), nid: n._nid, disabled: n.disabled, inView: view.some(v => v.nid === n._nid) })),
          canvas: d?.querySelectorAll('canvas').map(n => ({ id: n.id, width: n.width, height: n.height, realWebGl: !!n._captureWebGlPixels })),
          images: d?.querySelectorAll('img').map(n => ({ id: n.id, complete: n.complete, width: n.naturalWidth }))
        }
      })
      rows.push(state)
      fs.writeFileSync(path.join(out, 'wechat.json'), JSON.stringify({ at: new Date().toISOString(), rows, physicalDevices: 'not run', interaction: 'not certified' }, null, 2) + '\n')
      console.log(JSON.stringify({ name, error: state.error, runtimeErrors: state.runtimeErrors, loadText: state.loadText, canvas: state.canvas }))
      await mp.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').disposeHtmlRuntime())
    }
  } finally { mp.disconnect() }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
