'use strict'
const assert = require('node:assert/strict'), test = require('node:test'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const loaderPath = path.resolve(__dirname, '../miniprogram/file-reader/engine/core/subpackage-loader.js')
const source = fs.readFileSync(loaderPath, 'utf8')
const { FAMILIES } = require('../miniprogram/file-reader/engine/core/families')
const entries = ['../../markdown/runtime/index.js', '../../sevenzip/runtime/7zz.js', '../../sevenzip/runtime/native-listing.js', ...Object.values(FAMILIES).map(family => family.path)]

test('every asynchronous runtime entry is visible to the upload dependency scanner', () => {
  const acorn = require('acorn')
  const tree = acorn.parse(source, { ecmaVersion: 'latest' }), found = []
  function walk (node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'require' && node.callee.property.name === 'async' && node.arguments[0]?.type === 'Literal') found.push(node.arguments[0].value)
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value)
  }
  walk(tree)
  for (const entry of entries) { assert.ok(found.includes(entry), entry); assert.ok(fs.existsSync(path.resolve(path.dirname(loaderPath), entry))) }
})
test('literal entries retain asynchronous loading and error propagation without synchronous cross-package imports', async () => {
  const calls = [], load = () => assert.fail('must not synchronously load another WeChat package')
  load.async = name => { calls.push(name); return name.includes('native-listing') ? Promise.reject(new Error('download failed')) : Promise.resolve({ entry: name }) }
  const context = { require: load, module: { exports: {} }, setTimeout, clearTimeout }
  vm.runInNewContext(source, context)
  for (const entry of entries) {
    if (entry.includes('native-listing')) await assert.rejects(context.module.exports.load(entry), /download failed/)
    else assert.equal((await context.module.exports.load(entry)).entry, entry)
  }
  assert.deepEqual(calls, entries)
})

function wechatLoader (asyncRequire, wx = {}, timers = {}) {
  const load = () => assert.fail('禁止同步跨包 require')
  load.async = asyncRequire
  const context = { require: load, wx, module: { exports: {} }, setTimeout, clearTimeout, ...timers }
  vm.runInNewContext(source, context)
  return context.module.exports
}
const documentEntry = '../../document/index.js'
const missingModule = () => new Error("module 'file-reader/document/index.js' is not defined, require args is 'file-reader/document/index.js'")

test('小米截图中的缺失模块错误：显式加载目标包后重试，同一入口并发只恢复一次', async () => {
  let imports = 0, downloads = 0
  const loader = wechatLoader(() => { if (++imports === 1) throw missingModule(); return Promise.resolve({ ready: true }) }, {
    loadSubpackage (options) { downloads++; assert.equal(options.name, 'file-reader-document'); options.success() }
  })
  const first = loader.load(documentEntry), second = loader.load(documentEntry)
  assert.equal(first, second)
  assert.equal((await first).ready, true)
  assert.equal(imports, 2)
  assert.equal(downloads, 1)
})

test('永久缺失只自动重试一次，失败后不缓存 rejected Promise，可再次加载', async () => {
  let imports = 0, recovered = false
  const loader = wechatLoader(() => { imports++; return recovered ? Promise.resolve('ok') : Promise.reject(missingModule()) }, {
    loadSubpackage: options => options.success()
  })
  await assert.rejects(loader.load(documentEntry), /not defined/)
  assert.equal(imports, 2)
  recovered = true
  assert.equal(await loader.load(documentEntry), 'ok')
  assert.equal(imports, 3)
})

test('下载失败保留原因；模块执行异常不被当成网络故障无限重跑', async () => {
  let downloads = 0
  const loader = wechatLoader(() => Promise.reject(missingModule()), {
    loadSubpackage (options) { downloads++; options.fail(new Error('download offline')) }
  })
  await assert.rejects(loader.load(documentEntry), /offline/)
  assert.equal(downloads, 1)
  const broken = wechatLoader(() => { throw new Error('bad module initialization') }, {
    loadSubpackage: () => assert.fail('不应重跑模块逻辑错误')
  })
  await assert.rejects(broken.load(documentEntry), /bad module initialization/)
})

test('没有回调的加载会超时释放，迟到结果不能影响新的加载', async () => {
  let timeout, completeOld, count = 0
  const loader = wechatLoader(() => ++count === 1 ? new Promise(resolve => { completeOld = resolve }) : Promise.resolve('new'), {}, {
    setTimeout (fn) { timeout = fn; return 1 }, clearTimeout () {}
  })
  const first = loader.load(documentEntry)
  await Promise.resolve()
  timeout()
  await assert.rejects(first, /加载超时/)
  assert.equal(await loader.load(documentEntry), 'new')
  completeOld('old')
  assert.equal(await loader.load(documentEntry), 'new')
})
