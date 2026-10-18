'use strict'
// Actual WXML taps through the gallery and normal reader; no upload or user files.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { installAutomatorVersionCompatibility, automationPortForProject } = require('./miniprogram-automator-compat')
installAutomatorVersionCompatibility()
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/contest-ui/examples')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor (read, description) {
  for (let n = 0; n < 100; n++) { const result = await read(); if (result) return result; await sleep(100) }
  throw new Error(description)
}
;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(root)}` })
  const results = []
  try {
    await mini.reLaunch('/pages/home/home')
    await sleep(500)
    await mini.screenshot({ path: path.join(out, 'home.png') })
    await (await (await mini.currentPage()).$$('.source-button'))[1].tap()
    await waitFor(async () => (await mini.currentPage()).path === 'examples/pages/gallery/gallery', '未进入示例页')
    await sleep(700)
    const gallery = await mini.currentPage()
    const cardSize = await (await gallery.$('.example-card')).size()
    assert.ok(cardSize.width > 280, '卡片被微信默认按钮宽度覆盖')
    await mini.screenshot({ path: path.join(out, 'gallery.png') })
    const selectedIds = process.argv.length > 2 ? process.argv.slice(2) : ['meeting', 'tank', 'clock', 'bicycle', 'change', 'secret', 'markdown', 'final']
    for (const id of selectedIds) {
      await sleep(350)
      const page = await mini.currentPage(), start = Date.now()
      await (await page.$(`[data-id="${id}"]`)).tap()
      const design = ['final', 'change'].includes(id)
      const target = design ? 'pages/file-preview/file-preview' : 'pages/index/index'
      await waitFor(async () => (await mini.currentPage()).path === target, id + ' 未进入阅读页')
      const reading = await mini.currentPage()
      const component = await waitFor(() => reading.$(design ? '#preview' : '#reader'), '阅读组件未装载')
      const data = await waitFor(async () => { const d = await component.data();return (design ? !d.loading : !d.isLoading) ? d : null }, id + ' 超时')
      assert.equal(data.error, '', JSON.stringify(data))
      if (id === 'final') {
        assert.equal(data.canOpenPdf, false)
        assert.ok(data.previewPath, '原始 Ai 必须生成预览')
        const preview = await component.$('.preview-image')
        assert.ok((await preview.size()).height > 100, 'Ai 示例画板未显示')
      }
      else if (id === 'change') assert.ok(data.previewPath)
      else if (id === 'clock' || id === 'bicycle') { assert.ok(data.standaloneSvgSource || data.standaloneSvgPath);assert.ok(data.standaloneSvgAnimatedSource) }
      else if (id === 'secret') assert.equal(data.inspectorEntries.length, 2)
      else assert.equal(data.hasContent, true)
      await sleep(700)
      await mini.screenshot({ path: path.join(out, id + '.png') })
      if (id === 'tank') {
        const snapshot = () => mini.evaluate(() => {
          const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), d = r._htmlRuntime.document
          return { errors: r._htmlRuntime.errors, home: d.getElementById('home-screen').getAttribute('display'), overlay: d.getElementById('overlay').getAttribute('display'),
            position: d.querySelector('[data-kind="player"]').getAttribute('transform'), terrain: d.getElementById('terrain-layer').children.length }
        })
        const nid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('arcade')._nid)
        const canvas = await component.$('#dom-nid-' + nid), offset = await canvas.offset(), size = await canvas.size()
        assert.equal(String(await canvas.attribute('show-menu-by-longpress')), 'false', '交互 SVG 不应弹出图片长按菜单')
        const scale = size.width / 720, top = offset.top + (size.height - 1280 * scale) / 2
        const point = (x, y) => ({ identifier: 1, pageX: offset.left + x * scale, pageY: top + y * scale, clientX: offset.left + x * scale, clientY: top + y * scale })
        const tap = (x, y) => canvas.trigger('tap', { x: point(x, y).clientX, y: point(x, y).clientY })
        const hold = async (x, y, duration) => { const p = point(x, y); await canvas.touchstart({ touches: [p], changeTouches: [p] }); await sleep(duration); await canvas.touchend({ touches: [], changeTouches: [p] }) }
        await tap(360, 1026)
        await waitFor(async () => (await snapshot()).home === 'none', '坦克未进入战场')
        const before = await snapshot()
        await hold(607, 1068, 1000)
        await waitFor(async () => (await snapshot()).terrain < before.terrain, '开火后砖墙未被击破')
        await hold(142, 998, 600)
        await waitFor(async () => (await snapshot()).position !== before.position, '触屏方向键未移动车辆')
        // Synthetic touchend can be classified as a scroll; let the 600 ms tap guard expire.
        await sleep(650)
        await tap(399, 1020)
        await waitFor(async () => (await snapshot()).overlay === 'inline', '暂停未生效')
        assert.deepEqual((await snapshot()).errors, [])
        await mini.screenshot({ path: path.join(out, 'tank-paused.png') })
        await tap(263, 698)
        await waitFor(async () => (await snapshot()).overlay === 'none', '继续作战未生效')
        await sleep(700)
        await mini.screenshot({ path: path.join(out, 'tank-playing.png') })
      } else if (id === 'meeting') {
        const nid = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('again')._nid)
        await (await component.$('#dom-nid-' + nid)).tap()
        await waitFor(() => mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('cost').textContent === '6 杯奶茶'), 'HTML 按钮未更新内容')
      } else if (id === 'clock' || id === 'bicycle') {
        const player = await component.$('#standalone-svg-player')
        await waitFor(async () => (await player.data()).ready, 'SVG 画布未准备好')
        await (await player.$('button')).tap()
        await waitFor(async () => (await player.data()).paused, 'SVG 暂停失败')
        await (await player.$('button')).tap()
        await waitFor(async () => !(await player.data()).paused, 'SVG 继续失败')
        if (id === 'clock') {
          assert.equal((await player.data()).hasWallclock, true)
          await (await player.$('slider')).trigger('change', { value: 1080 })
          await waitFor(async () => (await player.data()).clockLabel === '18:00', 'SVG 时间预览未更新')
          await sleep(400)
          await mini.screenshot({ path: path.join(out, 'clock-six.png') })
          await (await player.$('.svg-time-preview button')).tap()
          await waitFor(async () => !(await player.data()).previewingTime, 'SVG 未恢复实时时间')
        }
      } else if (id === 'markdown') {
        const scroller = await component.$('.dom-table-scroll')
        assert.ok(scroller, 'Markdown 表格缺少横向滚动容器')
        const size = await scroller.size(), width = await scroller.scrollWidth()
        assert.ok(width > size.width, '示例表格需要横向溢出才能验证滑动')
        const offset = await scroller.offset()
        await mini.callWxMethod('pageScrollTo', { scrollTop: Math.max(0, offset.top - 50), duration: 0 })
        await scroller.scrollTo(width, 0)
        await waitFor(async () => (await scroller.property('scrollLeft')) > 20, 'Markdown 表格未横向移动')
        await sleep(500)
        await mini.screenshot({ path: path.join(out, 'markdown-scrolled.png') })
      } else if (id === 'secret') {
        const inspector = await component.$('#reader-inspector')
        const entries = await inspector.$$('.entry-row-actionable')
        assert.equal(entries.length, 2)
        await entries[1].tap()
        await waitFor(async () => { const d = await component.data(); return !d.isLoading && d.hasContent && d.sourceName === '摸鱼许可证.html' && !d.error }, 'ZIP 成员未打开')
        await sleep(700)
        await mini.screenshot({ path: path.join(out, 'secret-member.png') })
      }
      results.push({ id, elapsedMs: Date.now() - start, interaction: ['meeting', 'tank', 'clock', 'bicycle', 'secret', 'markdown'].includes(id), preview: id === 'final' ? 'parsed original colorful Rabbit Reader Ai' : design ? data.previewPath : undefined })
      await mini.navigateBack()
      await waitFor(async () => (await mini.currentPage()).path === 'examples/pages/gallery/gallery', '返回示例页失败')
      assert.equal((await (await mini.currentPage()).data()).opening, '')
    }
    fs.writeFileSync(path.join(out, process.argv.length > 2 ? 'verification-' + selectedIds.join('-') + '.json' : 'verification.json'), JSON.stringify({ environment: 'WeChat DevTools, not physical phone', results }, null, 2))
    console.log(JSON.stringify(results))
  } finally { await mini.reLaunch('/pages/home/home').catch(() => {});await mini.disconnect() }
})().catch(error => { console.error(error);process.exitCode = 1 })
