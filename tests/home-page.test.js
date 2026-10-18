'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function loadHomePage (wxOverrides = {}) {
  let definition
  const app = { globalData: {} }
  let redirectedTo = ''
  global.Page = page => { definition = page }
  global.getApp = () => app
  global.wx = {
    setNavigationBarTitle () {},
    navigateTo: options => { redirectedTo = options.url },
    ...wxOverrides
  }
  const pagePath = require.resolve('../miniprogram/pages/home/home')
  delete require.cache[pagePath]
  const homeModule = require(pagePath)
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData (updates, callback) { Object.assign(this.data, updates); if (callback) callback() }
  }
  return { page, app, homeModule, redirectedTo: () => redirectedTo }
}

test('首页一次最多选择 10 个聊天文件，并把整批文件保留在当前会话', () => {
  let pickerOptions
  const { page, app, redirectedTo } = loadHomePage({
    chooseMessageFile: options => {
      pickerOptions = options
      options.success({ tempFiles: [
        { name: '一.html', path: '/tmp/one.html', size: 100 },
        { name: '二.html', path: '/tmp/two.html', size: 200 }
      ] })
    }
  })

  page.chooseFile()

  assert.equal(pickerOptions.count, 10)
  assert.equal(pickerOptions.type, 'all')
  assert.equal(app.globalData.fileQueue.length, 2)
  assert.equal(app.globalData.fileQueueIndex, 0)
  assert.equal(app.globalData.pendingMaterial.name, '一.html')
  assert.equal(redirectedTo(), '/pages/index/index')
})

test('首页文件选择器使用 all，避免聊天图片和视频被 file 类型过滤', () => {
  let pickerOptions
  const { page } = loadHomePage({ chooseMessageFile: options => { pickerOptions = options } })

  page.chooseFile()

  assert.equal(pickerOptions.type, 'all')
  assert.equal('extension' in pickerOptions, false)
})

test('首页和运行时导航标题统一使用兔子阅读器品牌名', () => {
  let title = ''
  const { page } = loadHomePage({ setNavigationBarTitle: options => { title = options.title } })

  page.onShow()

  assert.equal(title, '兔子阅读器')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.json'), 'utf8'))
  assert.equal(config.navigationBarTitleText, '兔子阅读器')
})

test('粘贴 HTML 会在本机组成单文件会话并进入独立阅读页', () => {
  let uploadCalled = false
  const { page, app, redirectedTo } = loadHomePage({ uploadFile: () => { uploadCalled = true } })
  page.onHtmlInput({ detail: { value: '<button onclick="run()">运行</button>' } })

  page.parseDraft()

  assert.equal(uploadCalled, false)
  assert.equal(app.globalData.fileQueue.length, 1)
  assert.equal(app.globalData.pendingMaterial.inlineHtml, '<button onclick="run()">运行</button>')
  assert.equal(redirectedTo(), '/pages/index/index')
})

test('展开粘贴后定位输入框；空内容不跳转并在输入区提示', () => {
  let scrolled = false
  const { page, redirectedTo } = loadHomePage({ pageScrollTo: options => {
    assert.equal(page.data.inputMode, 'paste')
    assert.equal(options.selector, '.input-box')
    scrolled = true
  } })
  page.showPaste()
  assert.equal(scrolled, true)
  page.parseDraft()
  assert.match(page.data.error, /粘贴 HTML/)
  assert.equal(redirectedTo(), '')
})

test('首页保留三个文件入口，分享使用微信菜单', () => {
  const home = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8')
  const reader = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.wxml'), 'utf8')

  for (const action of ['chooseFile', 'showPaste', 'loadSample']) assert.match(home, new RegExp(`bindtap="${action}"`))
  assert.match(home, /brand-hero-sketch-transparent\.png/)
  assert.doesNotMatch(home, /open-type="share"/)
  const { page } = loadHomePage()
  assert.ok(page.onShareAppMessage().path)
  assert.equal(reader.includes('brand-hero-sketch-transparent.png'), false)
})

test('空选择提示重新选择，不进入空文件会话', () => {
  let pickerOptions
  const { page, redirectedTo } = loadHomePage({ chooseMessageFile: options => { pickerOptions = options } })
  page.chooseFile()
  pickerOptions.success({ tempFiles: [] })

  assert.match(page.data.error, /重新选择/)
  assert.equal(redirectedTo(), '')
})

test('首页开放好友转发和朋友圈分享并统一回到首页', () => {
  let shareOptions
  const { page } = loadHomePage({ showShareMenu: options => { shareOptions = options } })

  page.onLoad()

  assert.deepEqual(shareOptions.menus, ['shareAppMessage', 'shareTimeline'])
  assert.equal(shareOptions.withShareTicket, false)
  page.onShow()
  assert.deepEqual(shareOptions.menus, ['shareAppMessage', 'shareTimeline'])
  assert.equal(page.onShareAppMessage().path, '/pages/home/home')
  assert.match(page.onShareAppMessage().title, /兔子阅读器/)
  assert.equal(page.onShareAppMessage().title, require('../miniprogram/utils/product-copy').SHARE_TITLE)
  assert.equal(page.onShareTimeline().query, 'from=share')
  assert.equal(page.onShareAppMessage().imageUrl, '/assets/brand-hero-sketch-transparent.png')
  assert.equal(page.onShareTimeline().imageUrl, '/assets/brand-hero-sketch-transparent.png')
  assert.ok(fs.existsSync(path.join(__dirname, '../miniprogram', page.onShareAppMessage().imageUrl.slice(1))))
})

test('Markdown 正常后缀直接进入阅读页，不需要选择打开方式', () => {
  for (const name of ['平顶山市.md', 'HANDBOOK（1）.md', '攻略.MD', 'notes.markdown']) {
    const { page, app, redirectedTo } = loadHomePage({
      chooseMessageFile: o => o.success({ tempFiles: [{ name, path: '/tmp/original', type: 'file', size: 100 }] }),
      showActionSheet: () => assert.fail('正常 Markdown 不应多弹一次选择')
    })
    page.chooseFile()
    assert.equal(app.globalData.pendingMaterial.name, name)
    assert.equal(redirectedTo(), '/pages/index/index')
  }
})

test('未知名称与已知文件一起按原顺序进入阅读器，不弹格式选择', () => {
  const files = [{ name: '攻略', path: '/tmp/a', type: 'file', size: 100 }, { name: '二.md', path: '/tmp/b', size: 20 }]
  const { page, app, redirectedTo } = loadHomePage({ chooseMessageFile: o => o.success({ tempFiles: files }), showActionSheet: () => assert.fail('不得弹出格式选择') })
  page.chooseFile()
  assert.deepEqual(app.globalData.fileQueue.map(f => f.name), ['攻略', '二.md'])
  assert.equal(redirectedTo(), '/pages/index/index')
})

test('旧文件选择回调不能覆盖新会话', () => {
  const calls = []
  const { page, app } = loadHomePage({ chooseMessageFile: o => calls.push(o) })
  page.chooseFile();page.chooseFile()
  calls[1].success({ tempFiles: [{ name: '新.html', path: '/tmp/new' }] })
  calls[0].success({ tempFiles: [{ name: '旧.html', path: '/tmp/old' }] })
  assert.equal(app.globalData.pendingMaterial.name, '新.html')
})

test('示例入口进入卡片页，不直接运行综合压力测试页；导航失败可重新点开', () => {
  let calls = 0, options
  const { page } = loadHomePage({ navigateTo: o => { calls++; options = o } })
  page.loadSample(); page.loadSample()
  assert.equal(calls, 1)
  assert.equal(options.url, '/examples/pages/gallery/gallery')
  options.fail(); options.complete()
  assert.match(page.data.error, /重试/)
  page.loadSample()
  assert.equal(calls, 2)
})
