'use strict'

// 文件类型族分包的加载与缓存。reader 内核按文件种类按需 load()；同一族只加载一次。
// 微信里 load() 是异步的（require.async + attach）；Node 里 loader 退回同步 require，
// warmSync() 让测试与脚本在构造 reader 前就把族装好，reader 的同步路径（inlineHtml 等）不需要 await。
const subpackage = require('./subpackage-loader')
const kernel = require('./kernel-exports')

const FAMILIES = {
  office: { path: '../../office/index.js', label: ' Office 文档 ' },
  document: { path: '../../document/index.js', label: ' 文档排版 ' },
  archive: { path: '../../archive/index.js', label: ' 压缩包 ' },
  image: { path: '../../image/index.js', label: ' 图片 ' }
}

const loaded = Object.create(null)
const pending = Object.create(null)

function describe (name) {
  const family = FAMILIES[name]
  if (!family) throw new Error(`未知的文件类型族：${name}`)
  return family
}

function attachModule (name, module) {
  const api = module && typeof module.attach === 'function' ? module.attach(kernel) : module
  loaded[name] = api
  return api
}

function get (name) {
  return loaded[name] || null
}

function load (name) {
  if (loaded[name]) return Promise.resolve(loaded[name])
  if (pending[name]) return pending[name]
  const family = describe(name)
  pending[name] = subpackage.load(family.path, family.label).then(module => {
    delete pending[name]
    return attachModule(name, module)
  }).catch(error => {
    delete pending[name]
    throw error
  })
  return pending[name]
}

function loadAll (names) {
  return Promise.all(names.map(load)).then(() => names.map(get))
}

// 同步装载（Node 测试/脚本、Chrome 对照页的打包器）。微信里跨分包只有 require.async，调用会抛错。
function warmSync (names) {
  if (typeof require.async === 'function') throw new Error('微信里分包只能异步加载，warmSync 只供 Node 与浏览器对照使用')
  for (const name of names) {
    if (loaded[name]) continue
    const family = describe(name)
    const modulePath = family.path
    attachModule(name, require(modulePath))
  }
}

module.exports = { FAMILIES, get, load, loadAll, warmSync }
