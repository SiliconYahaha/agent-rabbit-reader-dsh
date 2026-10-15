'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readerPage } = require('./helpers/reader-page')

function selectedHomeRoute (path, overrides = {}) {
  const app = { globalData: {} }, reads = []
  const content = Buffer.from('<h1>真实入口正文</h1>')
  const page = readerPage({
    env: { USER_DATA_PATH: 'http://usr' },
    getFileSystemManager: () => ({
      stat: options => options.success({ stats: { size: content.length } }),
      readFile: options => { reads.push(options.filePath); options.success({ data: content }) }
    }),
    ...overrides
  })
  global.getApp = () => app
  let homeDefinition
  global.Page = value => { homeDefinition = value }
  const target = require.resolve('../miniprogram/pages/home/home')
  delete require.cache[target]
  require(target)
  const home = { ...homeDefinition, data: structuredClone(homeDefinition.data), setData (patch) { Object.assign(this.data, patch) } }
  global.wx.chooseMessageFile = options => options.success({ tempFiles: [{ name: 'chosen.html', path, size: 128 }] })
  global.wx.redirectTo = options => { assert.equal(options.url, '/pages/index/index'); page.host.onLoad(); page.host.onShow() }
  home.chooseFile()
  return { page, app, reads }
}

test('real home picker to reader route accepts WeChat local virtual paths', () => {
  for (const path of ['http://tmp/ePSwNnuYTBEN126627071948a2b4376f0ed399c81c9e.html', 'http://usr/local.html', 'wxfile://tmp_123.html', '/tmp/local.html']) {
    const { page, app, reads } = selectedHomeRoute(path)
    try {
      assert.deepEqual(reads, [path])
      assert.equal(page.data.error, '')
      assert.equal(page.data.domMode, true)
      assert.match(page._htmlRuntime.document.body.textContent, /真实入口正文/)
      assert.equal(app.globalData.pendingMaterial, null)
    } finally { page.host.onUnload() }
  }
})

test('network URLs and lookalike local authorities are never read through any file entry', () => {
  for (const path of ['https://example.com/a.html', 'http://example.com/a.html', 'http://tmp.evil/a.html', 'http://tmp@evil/a.html', 'http://tmp:80/a.html', 'https://tmp/a.html', 'http://usr.evil/a.html']) {
    const { page, reads } = selectedHomeRoute(path)
    try {
      assert.deepEqual(reads, [])
      assert.match(page.data.error, /网络链接/)
      page.openSelectedFile({ name: 'direct.html', path })
      assert.deepEqual(reads, [], 'queue/direct paths must not skip the network guard')
      assert.match(page.data.error, /网络链接/)
    } finally { page.host.onUnload() }
  }
})

test('a rejected URL keeps the queue usable for the following local file', () => {
  const { page, app, reads } = selectedHomeRoute('https://example.com/a.html')
  try {
    app.globalData.fileQueue.push({ name: 'next.html', path: 'http://tmp/next.html' })
    page.host.syncFileSession()
    assert.equal(page.host.data.hasNextFile, true)
    page.host.openNextFile()
    assert.deepEqual(reads, ['http://tmp/next.html'])
    assert.equal(page.data.error, '')
    assert.equal(page.host.data.queuePosition, 2)
  } finally { page.host.onUnload() }
})
