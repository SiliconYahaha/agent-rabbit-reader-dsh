'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

for (const route of ['pages/index/index', 'pages/file-preview/file-preview', 'examples/pages/gallery/gallery', 'examples/pages/formats/formats']) {
  test(`朋友圈打开 ${route} 时回到首页，不尝试读取发送者的本地文件`, () => {
    const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp }
    let definition
    let destination = ''
    let appRead = false
    try {
      global.Page = page => { definition = page }
      global.getApp = () => { appRead = true; return { globalData: {} } }
      global.wx = {
        showShareMenu () {},
        reLaunch ({ url }) { destination = url }
      }
      const modulePath = require.resolve(`../miniprogram/${route}`)
      delete require.cache[modulePath]
      require(modulePath)
      definition.onLoad({ from: 'share' })
      assert.equal(destination, '/pages/home/home')
      assert.equal(appRead, false)
    } finally {
      global.Page = previous.Page
      global.wx = previous.wx
      global.getApp = previous.getApp
    }
  })
}
