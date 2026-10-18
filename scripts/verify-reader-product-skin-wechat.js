'use strict'
// Focused UI regression: real gallery taps, fixed chrome, details and archive members.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { installAutomatorVersionCompatibility, automationPortForProject } = require('./miniprogram-automator-compat')
installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/reader-product-skin')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until (read, label) {
  for (let i = 0; i < 150; i++) { const value = await read(); if (value) return value; await sleep(200) }
  throw new Error(label)
}
;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(root)}` })
  const saved = await mini.evaluate(() => JSON.stringify(getApp().globalData))
  const result = []
  try {
    await mini.reLaunch('/pages/home/home'); await sleep(500)
    await mini.screenshot({ path: path.join(out, 'home.png') })
    await mini.navigateTo('/examples/pages/gallery/gallery'); await sleep(800)
    await mini.screenshot({ path: path.join(out, 'gallery.png') })
    await mini.navigateTo('/examples/pages/formats/formats'); await sleep(500)
    const formats = await mini.currentPage()
    await mini.screenshot({ path: path.join(out, 'formats.png') })
    await (await formats.$('[data-id="2"]')).tap(); await sleep(200)
    assert.equal((await formats.data()).expanded, 2)
    await mini.screenshot({ path: path.join(out, 'formats-ai.png') })
    await mini.navigateBack(); await sleep(300)
    for (const id of ['change', 'secret', 'markdown', 'meeting', 'clock', 'final']) {
      const gallery = await mini.currentPage()
      await (await gallery.$(`[data-id="${id}"]`)).tap()
      await until(async () => /pages\/(index|file-preview)\//.test((await mini.currentPage()).path), id + ': route')
      const page = await mini.currentPage(), design = page.path.includes('file-preview')
      const reader = await until(() => page.$(design ? '#preview' : '#reader'), id + ': component')
      await until(async () => { const d = await reader.data(); if (d.error) throw Error(d.error); return design ? !d.loading : !d.isLoading }, id + ': ready')
      await sleep(1000)
      const skin = design ? await reader.$('skin-design') : reader
      const filebar = await until(() => skin.$('skin-filebar'), id + ': filebar component')
      const bar = await filebar.$('.filebar')
      const initial = await bar.offset()
      await mini.screenshot({ path: path.join(out, id + '.png') })
      await mini.callWxMethod('pageScrollTo', { scrollTop: 400, duration: 0 }); await sleep(400)
      const scrolled = await bar.offset()
      // Automator bounds are viewport-relative. A fixed bar remains at zero.
      assert.ok(Math.abs(scrolled.top - initial.top) < 3, `${id}: toolbar moved with content`)
      await mini.screenshot({ path: path.join(out, id + '-scrolled.png') })
      await (await filebar.$('.filebar-toggle')).tap(); await sleep(200)
      assert.ok(await filebar.$('.filebar-details'), id + ': missing details')
      await mini.screenshot({ path: path.join(out, id + '-info.png') })
      await (await filebar.$('.filebar-toggle')).tap()
      if (id === 'secret') {
        const inspector = await reader.$('#reader-inspector')
        await (await inspector.$('.entry-row-actionable')).tap()
        await until(async () => { const d = await reader.data(); return !d.isLoading && d.hasContent && !d.inspectorMode }, 'archive member')
      }
      result.push({ id, initial, scrolled, passed: true })
      await mini.navigateBack(); await sleep(400)
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } finally {
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.evaluate(value => { getApp().globalData = JSON.parse(value) }, saved).catch(() => {})
    await mini.disconnect()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
