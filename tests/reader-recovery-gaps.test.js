'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { loadReaderHost, flush } = require('./helpers/reader-host')
const { startFileSession, stageMaterialRoute } = require('../miniprogram/utils/file-session')

test('Markdown 分包失败可原地重试，不重选文件并保留宽表格', async () => {
  let reads = 0, attempts = 0
  const { reader, internals } = loadReaderHost({ getFileSystemManager: () => ({ readFile: o => {
    reads++; o.success({ data: Buffer.from('# 攻略\n\n| 地点 | 费用 |\n|---|---|\n| 平顶山 | 免费 |') })
  } }) })
  const load = internals.subpackage.load
  internals.subpackage.load = (...args) => ++attempts === 1 ? Promise.reject(new Error('module markdown is not defined')) : load(...args)
  try {
    reader.openSelectedFile({ name: '攻略.md', path: '/local/guide.md' })
    await flush()
    assert.equal(reader.data.fileLoadRetry, true)
    assert.equal(reader.data.isLoading, false)
    await reader.retryReading(); await flush()
    assert.equal(reader.data.error, '')
    assert.equal(reader.data.hasContent, true)
    assert.equal(reader.data.fileLoadRetry, false)
    assert.equal(reads, 1)
    assert.match(reader._htmlRuntime.document.body.textContent, /平顶山/)
  } finally { internals.subpackage.load = load; reader.detached() }
})

test('Markdown 旧重试在换文件或离开后无效', async () => {
  const { reader, internals } = loadReaderHost({ getFileSystemManager: () => ({ readFile: o => o.success({ data: Buffer.from('# 旧文') }) }) })
  const load = internals.subpackage.load
  let attempts = 0
  internals.subpackage.load = () => { attempts++;return Promise.reject(new Error('offline')) }
  try {
    reader.openSelectedFile({ name: '旧文.md', path: '/local/old.md' });await flush()
    const retry = reader._retryFamilyLoad
    assert.equal(typeof retry, 'function')
    reader.openSelectedFile({ name: '新文.html', inlineHtml: '<p>新文</p>' });await flush()
    await retry();assert.equal(attempts, 1)
    assert.equal(reader.data.sourceName, '新文.html');assert.equal(reader.data.fileLoadRetry, false)
    reader.detached();await retry();assert.equal(attempts, 1)
  } finally { internals.subpackage.load = load;reader.detached() }
})

function previewHost () {
  const app = { globalData: {} }, navigations = []
  const materials = [{ name: 'draft.psd', path: '/local/draft.psd' }, { name: 'one.html', path: '/local/one.html' }, { name: 'two.md', path: '/local/two.md' }]
  startFileSession(app, materials)
  let definition
  global.getApp = () => app
  global.wx = { showShareMenu () {}, pageScrollTo () {}, redirectTo: o => navigations.push(o) }
  global.Page = d => { definition = d }
  const modulePath = require.resolve('../miniprogram/pages/file-preview/file-preview')
  delete require.cache[modulePath];require(modulePath)
  const host = { ...definition, data: structuredClone(definition.data), setData (data) { Object.assign(this.data, data) } }
  host.onLoad()
  return { app, host, navigations, materials }
}

test('设计页切换跳转失败保留当前预览和序号，可再次点击下一份', () => {
  const { host, app, navigations } = previewHost()
  host.openNextFile()
  assert.equal(host.data.file.name, 'draft.psd', '跳转完成前不要清空当前画面')
  navigations[0].fail({ errMsg: 'route failed' })
  assert.equal(app.globalData.fileQueueIndex, 0)
  assert.equal(host.data.queuePosition, 1)
  assert.equal(host.data.hasNextFile, true)
  assert.equal(app.globalData.pendingMaterial, null)
  host.openNextFile()
  assert.equal(navigations.length, 2)
  assert.equal(app.globalData.pendingMaterial.name, 'one.html')
})

test('跨页跳转处理中，连续点下一份不会跳过文件', () => {
  const { host, app, navigations } = previewHost()
  host.openNextFile();host.openNextFile()
  assert.equal(navigations.length, 1)
  assert.equal(app.globalData.fileQueueIndex, 1)
  assert.equal(app.globalData.pendingMaterial.name, 'one.html')
})

test('旧跳转失败不能回滚新文件会话或更新已关闭的页面', () => {
  const { host, app, navigations } = previewHost()
  host.openNextFile()
  const fresh = startFileSession(app, [{ name: 'new.md', path: '/local/new.md' }])
  stageMaterialRoute(app, fresh)
  navigations[0].fail({ errMsg: 'late failure' })
  assert.equal(app.globalData.fileQueueIndex, 0)
  assert.equal(app.globalData.pendingMaterial.name, 'new.md')
  assert.equal(host.data.error, '')
  host.onUnload()
  navigations[0].fail({ errMsg: 'after unload' })
  assert.equal(host.data.error, '')
})

test('第一次跳转的重复失败回调不能打断第二次重试', () => {
  const { host, app, navigations } = previewHost()
  host.openNextFile()
  navigations[0].fail({ errMsg: 'first failure' })
  host.openNextFile()
  navigations[0].fail({ errMsg: 'duplicate failure' })
  assert.equal(app.globalData.fileQueueIndex, 1)
  assert.equal(app.globalData.pendingMaterial.name, 'one.html')
  assert.equal(host.data.error, '')
  host.openNextFile()
  assert.equal(navigations.length, 2)
  navigations[1].fail({ errMsg: 'second failure' })
  assert.equal(app.globalData.fileQueueIndex, 0)
})

test('设计页离开后迟到的跳转失败不修改页面和文件队列', () => {
  const { host, app, navigations } = previewHost()
  host.openNextFile()
  host.onUnload()
  const snapshot = structuredClone(host.data)
  navigations[0].fail({ errMsg: 'after unload' })
  assert.deepEqual(host.data, snapshot)
  assert.equal(app.globalData.fileQueueIndex, 1)
  assert.equal(app.globalData.pendingMaterial.name, 'one.html')
})
