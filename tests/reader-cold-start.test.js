'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { readerPage, flush } = require('./helpers/reader-host')
const families = require('../miniprogram/file-reader/engine/core/families')

// 普通宿主测试预热了全部格式族；这里故意撤掉预热视图，覆盖真机首次异步加载。
test('首次文档分包失败后原地重试，保留原文并进入真实排版链', async () => {
  const get = families.get, loadAll = families.loadAll
  let ready = false, attempts = 0
  const page = readerPage()
  families.get = name => ready ? get(name) : null
  families.loadAll = () => ++attempts === 1 ? Promise.reject(new Error('module document is not defined')) : (ready = true, Promise.resolve())
  try {
    page.openSelectedFile({ name: 'sample.html', inlineHtml: '<h1>原文仍在</h1><button id="count">0</button><script>document.getElementById("count").onclick=function(){this.textContent="1"}</script>' })
    await flush()
    assert.match(page.data.error, /请点重试/)
    assert.match(page._packageLoadError, /not defined/)
    assert.equal(page.data.fileLoadRetry, true)
    assert.equal(page.data.isLoading, false)
    await page.retryReading()
    await flush()
    assert.equal(attempts, 2)
    assert.equal(page.data.error, '')
    assert.equal(page.data.fileLoadRetry, false)
    assert.equal(page.data.hasContent, true)
    assert.match(page._htmlRuntime.document.body.textContent, /原文仍在/)
    const button = page._htmlRuntime.document.getElementById('count')
    page._htmlRuntime.dispatchTap(button._nid)
    assert.equal(button.textContent, '1')
  } finally { families.get = get; families.loadAll = loadAll; page.host.onUnload() }
})

test('切换文件后，迟到的首次加载失败与旧重试均不能覆盖新内容', async () => {
  const get = families.get, loadAll = families.loadAll
  let rejectFirst, ready = false
  const page = readerPage()
  families.get = name => ready ? get(name) : null
  families.loadAll = () => new Promise((resolve, reject) => { rejectFirst = reject })
  try {
    page.openSelectedFile({ name: 'old.html', inlineHtml: '<p>旧文</p>' })
    ready = true
    page.openSelectedFile({ name: 'new.html', inlineHtml: '<p>新文</p>' })
    rejectFirst(new Error('late download failure'))
    await flush()
    assert.equal(page.data.sourceName, 'new.html')
    assert.equal(page.data.error, '')
    assert.equal(page.data.fileLoadRetry, false)
    await page.retryReading()
    assert.match(page._htmlRuntime.document.body.textContent, /新文/)
  } finally { families.get = get; families.loadAll = loadAll; page.host.onUnload() }
})

test('失败后离开阅读页会清除重试回调，不重新打开已销毁页面', async () => {
  const get = families.get, loadAll = families.loadAll
  const page = readerPage()
  families.get = () => null
  families.loadAll = () => Promise.reject(new Error('offline'))
  try {
    page.openSelectedFile({ name: 'old.html', inlineHtml: '<p>旧文</p>' })
    await flush()
    assert.equal(page.data.fileLoadRetry, true)
    page.host.onUnload()
    assert.equal(page._retryFamilyLoad, null)
    assert.equal(page.data.fileLoadRetry, false)
  } finally { families.get = get; families.loadAll = loadAll }
})
