'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const files = require('../miniprogram/examples/data/files')
const { cards, materialize } = require('../miniprogram/examples/catalog')
const { readerPage, flush } = require('./helpers/reader-host')
const { isPdfCompatibleAi, extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const { unzipSync } = require('fflate')
const fs = require('node:fs')
const path = require('node:path')

const bundledBytes = file => file.compressedPath ? require('node:zlib').brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram', file.compressedPath))) : Buffer.from(file.base64, 'base64')
test('九份示例为完整文件，示例分包低于 2 MB，卡片不传入 base64', () => {
  assert.deepEqual(cards.map(c => c.format), ['HTML', 'HTML', 'HTML', 'SVG', 'SVG', 'Ai', 'PSD', 'ZIP', 'MD'])
  assert.deepEqual(cards.slice(0, 3).map(c => c.id), ['meeting', 'koi', 'tank'])
  for (const card of cards) assert.equal(card.base64, undefined)
  for (const file of files) {
    assert.equal(bundledBytes(file).length, file.size)
  }
  const packageBytes = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? packageBytes(path.join(dir, item.name)) : fs.statSync(path.join(dir, item.name)).size), 0)
  assert.ok(packageBytes(path.join(__dirname, '../miniprogram/examples')) < 2 * 1024 * 1024)
})
test('用户提供的 Ai、分层 PSD 预览副本与骑车 SVG 的打包字节等于已登记素材', () => {
  const sources = { final: 'scripts/assets/example-art/rabbit-reader-color.ai',
    change: 'scripts/assets/example-art/mozilla-mascot-poster.psd',
    bicycle: 'scripts/assets/example-art/qin-shi-huang-bicycle.svg',
    clock: 'scripts/assets/example-art/off-work-radar.svg',
    koi: 'scripts/assets/example-art/koi-pond.html',
    tank: 'scripts/assets/example-art/neon-tank.html' }
  for (const [id, source] of Object.entries(sources)) {
    const bundled = bundledBytes(files.find(file => file.id === id))
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
test('Ai 含可解析的彩色矢量画板，PSD 含可解码的海报预览并保留原始图层', () => {
  const ai = Buffer.from(files.find(file => file.id === 'final').base64, 'base64')
  assert.equal(isPdfCompatibleAi(ai), false)
  const aiPreview = require('../miniprogram/file-reader/engine/core/design-file').extractLegacyAiPreview(ai)
  assert.ok(aiPreview.svg.includes('<path'))
  assert.ok(new Set([...aiPreview.svg.matchAll(/fill="([^"]+)"/g)].map(m => m[1])).size > 2)
  const { parsePsdHeader, extractPsdThumbnail } = require('../miniprogram/file-reader/engine/core/design-file')
  const bytes = bundledBytes(files.find(file => file.id === 'change')), header = parsePsdHeader(bytes)
  assert.deepEqual([header.width, header.height], [3508, 4961])
  const offset = header.resourceLengthOffset, size = bytes.readUInt32BE(offset)
  const preview = extractPsdThumbnail(bytes.subarray(offset + 4, offset + 4 + size))
  assert.deepEqual([preview.width, preview.height], [640, 905])
  const original = fs.readFileSync(path.join(__dirname, '../scripts/assets/example-art/mozilla-mascot-original.psd'))
  const originalEnd = offset + 4 + original.readUInt32BE(offset)
  assert.deepEqual(bytes.subarray(offset + 4 + size), original.subarray(originalEnd), '所有图层/蒙版/合成图字节保持原样')
  assert.equal(Math.abs(original.readInt16BE(originalEnd + 8)), 21)
})
test('ZIP 可独立解压，条目都是真实可读内容', () => {
  const archive = unzipSync(Buffer.from(files.find(file => file.id === 'secret').base64, 'base64'))
  assert.deepEqual(Object.keys(archive), ['你还是打开了.txt', '摸鱼许可证.html'])
  assert.match(Buffer.from(archive['摸鱼许可证.html']).toString(), /解释权归你的颈椎/)
})
test('写入的 bytes 与示例一致，失败不返回假路径，重复打开只占一个固定文件', async () => {
  const written = new Map()
  const host = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({
    readCompressedFile: o => o.success({ data: bundledBytes(files.find(f => f.compressedPath === o.filePath)) }),
    writeFile: o => {
    assert.ok(!o.encoding || ['utf8', 'base64'].includes(o.encoding));written.set(o.filePath, Buffer.from(o.data, o.encoding));o.success()
  } }) }
  for (const file of files) {
    const material = await materialize(file.id, host)
    const expected = file.id === 'clock' ? Buffer.from(require('../miniprogram/examples/clock-source').clockSource(bundledBytes(file).toString())) : bundledBytes(file)
    assert.deepEqual(written.get(material.path), expected)
    assert.equal(material.path.split('.').pop(), file.name.split('.').pop())
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

    getFileSystemManager: () => ({ readCompressedFile: o => o.success({ data: bundledBytes(files.find(f => f.compressedPath === o.filePath)) }), writeFile: o => { write = o } }),
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
  let opening = h.page.openExample(event);await flush()
  h.page.onHide();h.write().success();await opening
  assert.equal(h.navigation(), undefined)
  h.page.onShow();opening = h.page.openExample(event);await flush();h.write().fail({ errMsg: 'disk full' });await opening
  assert.match(h.page.data.error, /再点一次/);assert.equal(h.page.data.opening, '')
  opening = h.page.openExample(event);await flush();h.write().success();await opening
  assert.equal(h.navigation().url, '/pages/file-preview/file-preview')
  assert.equal(h.app.globalData.pendingFilePreview.name, files.find(file => file.id === 'change').name)
})

test('Ai 示例导航带画板预览标记，普通设计文件路由不受影响', async () => {
  const h = galleryHost()
  const opening = h.page.openExample({ currentTarget: { dataset: { id: 'final' } } })
  h.write().success()
  await opening
  assert.equal(h.navigation().url, '/pages/file-preview/file-preview')
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
    read.success({ data: bundledBytes(file) })
    await flush()
    assert.equal(page.data.error, '')
    assert.equal(page.data.domMode, true)
    const nodes = flatten(page.data.domTree), table = nodes.find(n => n.name === 'table')
    assert.equal(table.tableScroll, true)
    assert.equal(table.children.length, 24)
    assert.match(nodes.filter(n => n.type === 'text').map(n => n.text).join(''), /下班了但没完全下/)
  } finally { page.detached() }
})


test('复杂 HTML 示例保留原始单文件，生产运行器支持开局、暂停与恢复', async () => {
  const file = files.find(f => f.id === 'tank'), source = bundledBytes(file).toString()
  assert.doesNotMatch(source, /(?:src|href)=["']https?:/)
  const page = readerPage()
  try {
    page.openSelectedFile({ name: file.name, inlineHtml: source }); await flush()
    const runtime = page._htmlRuntime, doc = runtime.document
    assert.deepEqual(runtime.errors, [])
    const tap = action => runtime.dispatchTap(doc.querySelector('[data-action="' + action + '"]')._nid)
    tap('start'); assert.equal(doc.getElementById('home-screen').getAttribute('display'), 'none')
    assert.ok(doc.getElementById('terrain-layer').children.length > 100)
    assert.ok(doc.querySelector('[data-kind="player"]'))
    tap('pause'); assert.equal(doc.getElementById('overlay').getAttribute('display'), 'inline')
    assert.match(doc.getElementById('overlay-title').textContent, /暂停/)
    tap('primary'); assert.equal(doc.getElementById('overlay').getAttribute('display'), 'none')
    assert.deepEqual(runtime.errors, [])
  } finally { page.host.onUnload() }
})

test('分包海报读取损坏或无回调时不会打开假文件，并且可以重试', async t => {
  const env = { USER_DATA_PATH: '/private' }
  let wrote = false
  await assert.rejects(materialize('change', { env, getFileSystemManager: () => ({ readCompressedFile: o => o.success({ data: new Uint8Array(3) }), writeFile: () => { wrote = true } }) }), /不完整/)
  assert.equal(wrote, false)
  await assert.rejects(materialize('change', { env, getFileSystemManager: () => ({ readCompressedFile: o => o.fail(new Error('read failed')) }) }), /read failed/)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = materialize('change', { env, getFileSystemManager: () => ({ readCompressedFile () {} }) })
  const rejected = assert.rejects(pending, /超时/)
  t.mock.timers.tick(20000);await rejected
  const file = files.find(f => f.id === 'change')
  assert.ok((await materialize('change', { env, getFileSystemManager: () => ({ readCompressedFile: o => o.success({ data: bundledBytes(file) }), writeFile: o => o.success() }) })).path.endsWith('.psd'))
})
