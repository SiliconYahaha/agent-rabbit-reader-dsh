'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const files = require('../miniprogram/examples/data/files')
const { cards, materialize } = require('../miniprogram/examples/catalog')
const { readerPage, flush } = require('./helpers/reader-host')
const { isPdfCompatibleAi, extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const { unzipSync } = require('fflate')
const fs = require('node:fs')
const path = require('node:path')

test('七份示例为完整文件，示例分包低于 2 MB，卡片不传入 base64', () => {
  assert.deepEqual(cards.map(c => c.format), ['HTML', 'SVG', 'SVG', 'Ai', 'PSD', 'ZIP', 'MD'])
  for (const card of cards) assert.equal(card.base64, undefined)
  for (const file of files) {
    assert.equal(Buffer.from(file.base64, 'base64').length, file.size)
  }
  assert.ok(require('node:fs').statSync(require.resolve('../miniprogram/examples/data/files')).size < 2 * 1024 * 1024)
})
test('公开 Ai、原创 PSD 与现有骑车 SVG 的打包字节等于已登记原件', () => {
  const sources = { final: 'scripts/assets/example-art/logo-variants.ai',
    change: 'scripts/assets/example-art/rabbit-courier-poster.psd',
    bicycle: 'tests/fixtures/svg-animated/partridge-bike.svg' }
  for (const [id, source] of Object.entries(sources)) {
    const bundled = Buffer.from(files.find(file => file.id === id).base64, 'base64')
    assert.deepEqual(bundled, fs.readFileSync(path.join(__dirname, '..', source)))
  }
})
test('HTML 走生产隔离运行器，按钮真实改变内容', async () => {
  const page = readerPage()
  try {
    page.openSelectedFile({ name: files[0].name, inlineHtml: Buffer.from(files[0].base64, 'base64').toString() })
    await flush()
    assert.equal(page.data.error, '')
    const runtime = page._htmlRuntime, doc = runtime.document
    runtime.dispatchTap(doc.getElementById('again')._nid)
    assert.equal(doc.getElementById('cost').textContent, '6 杯奶茶')
    runtime.dispatchTap(doc.getElementById('done')._nid)
    assert.match(doc.getElementById('verdict').textContent, /散会/)
  } finally { page.host.onUnload() }
})
test('Ai 含原生 PDF 兼容画板，PSD 含可解码的海报合成画面', () => {
  const ai = Buffer.from(files.find(file => file.id === 'final').base64, 'base64')
  assert.equal(isPdfCompatibleAi(ai), true)
  assert.equal(ai.subarray(0, 8).toString(), '%PDF-1.6')
  const psd = extractPsdComposite(Buffer.from(files.find(file => file.id === 'change').base64, 'base64'))
  assert.equal(psd.width, 360); assert.equal(psd.height, 480)
  assert.deepEqual(Array.from(psd.rgba.slice(0, 4)), [246, 237, 217, 255])
  assert.ok(new Set(psd.rgba).size > 100)
})
test('ZIP 可独立解压，条目都是真实可读内容', () => {
  const archive = unzipSync(Buffer.from(files.find(file => file.id === 'secret').base64, 'base64'))
  assert.deepEqual(Object.keys(archive), ['你还是打开了.txt', '摸鱼许可证.html'])
  assert.match(Buffer.from(archive['摸鱼许可证.html']).toString(), /解释权归你的颈椎/)
})
test('写入的 bytes 与示例一致，失败不返回假路径，重复打开只占一个固定文件', async () => {
  const written = new Map()
  const host = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ writeFile: o => {
    assert.equal(o.encoding, 'base64');written.set(o.filePath, Buffer.from(o.data, o.encoding));o.success()
  } }) }
  for (const file of files) {
    const material = await materialize(file.id, host)
    assert.deepEqual(written.get(material.path), Buffer.from(file.base64, 'base64'))
    assert.equal(material.inlineHtml, undefined)
    assert.equal((await materialize(file.id, host)).path, material.path)
  }
  assert.equal(written.size, files.length)
  await assert.rejects(materialize('../not-a-file', host), /不存在/)
  await assert.rejects(materialize('meeting', { env: host.env, getFileSystemManager: () => ({ writeFile: o => o.fail({ errMsg: 'disk full' }) }) }), /disk full/)
})
function galleryHost () {
  let definition, write, navigation
  global.Page = d => { definition = d }
  global.getApp = () => app
  const app = { globalData: {} }
  global.wx = { env: { USER_DATA_PATH: '/private' }, showShareMenu () {},
    getFileSystemManager: () => ({ writeFile: o => { write = o } }),
    navigateTo: o => { navigation = o; o.success() }
  }
  delete require.cache[require.resolve('../miniprogram/examples/pages/gallery/gallery')]
  require('../miniprogram/examples/pages/gallery/gallery')
  const page = { ...definition, data: structuredClone(definition.data), setData (d) { Object.assign(this.data, d) } }
  page.onLoad()
  return { page, app, write: () => write, navigation: () => navigation }
}
test('示例离开后迟到写入不导航，存储失败后可重试并走正常设计文件路由', async () => {
  const h = galleryHost(), event = { currentTarget: { dataset: { id: 'change' } } }
  let opening = h.page.openExample(event)
  h.page.onHide();h.write().success();await opening
  assert.equal(h.navigation(), undefined)
  h.page.onShow();opening = h.page.openExample(event);h.write().fail({ errMsg: 'disk full' });await opening
  assert.match(h.page.data.error, /再点一次/);assert.equal(h.page.data.opening, '')
  opening = h.page.openExample(event);h.write().success();await opening
  assert.equal(h.navigation().url, '/pages/file-preview/file-preview')
  assert.equal(h.app.globalData.pendingFilePreview.name, files.find(file => file.id === 'change').name)
})

test('Ai 示例导航带画板预览标记，普通设计文件路由不受影响', async () => {
  const h = galleryHost()
  const opening = h.page.openExample({ currentTarget: { dataset: { id: 'final' } } })
  h.write().success()
  await opening
  assert.equal(h.navigation().url, '/pages/file-preview/file-preview?example=final')
})

test('存储无回调时不永久卡在准备中', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const promise = materialize('meeting', { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ writeFile () {} }) })
  const rejected = assert.rejects(promise, /超时/)
  t.mock.timers.tick(10000)
  await rejected
})

test('Markdown 示例通过正常文件入口显示清单和可横向滚动的完整表格', async () => {
  let read
  const page = readerPage({ getFileSystemManager: () => ({ readFile: options => { read = options } }) })
  const file = files.find(f => f.id === 'markdown')
  const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children || [])])
  try {
    page.openSelectedFile({ name: file.name, path: '/local/example.md' })
    read.success({ data: Buffer.from(file.base64, 'base64') })
    await flush()
    assert.equal(page.data.error, '')
    assert.equal(page.data.domMode, true)
    const nodes = flatten(page.data.domTree), table = nodes.find(n => n.name === 'table')
    assert.equal(table.tableScroll, true)
    assert.equal(table.children.length, 24)
    assert.match(nodes.filter(n => n.type === 'text').map(n => n.text).join(''), /下班了但没完全下/)
  } finally { page.detached() }
})
