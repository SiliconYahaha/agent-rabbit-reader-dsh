'use strict'

// 引擎分包按需加载兄弟分包（7z 内核、Markdown 渲染器）的唯一入口。
// 微信里跨分包只能 require.async；Node（测试、脚本）没有 require.async，用同步 require 顶替，
// 让分包代码路径在测试里也被真实执行。relativePath 相对本文件所在目录 file-reader/engine/core/。
// 测试桩可以整体替换 load（reader 组件通过 _internals.subpackage 暴露同一个对象）。
const PACKAGE_NAMES = {
  '../../office/index.js': 'file-reader-office',
  '../../office-word/index.js': 'file-reader-office-word',
  '../../document/index.js': 'file-reader-document',
  '../../archive/index.js': 'file-reader-archive',
  '../../image/index.js': 'file-reader-image',
  '../../markdown/runtime/index.js': 'file-reader-markdown',
  '../../sevenzip/runtime/7zz.js': 'file-reader-sevenzip',
  '../../sevenzip/runtime/native-listing.js': 'file-reader-sevenzip'
}
const pending = Object.create(null)

function importModule (relativePath) {
  if (relativePath === '../../office/index.js') return require.async('../../office/index.js')
  if (relativePath === '../../office-word/index.js') return require.async('../../office-word/index.js')
  // 必须保留字面量路径，确保上传编译器把入口及依赖打入分包。
  if (relativePath === '../../markdown/runtime/index.js') return require.async('../../markdown/runtime/index.js')
  if (relativePath === '../../sevenzip/runtime/7zz.js') return require.async('../../sevenzip/runtime/7zz.js')
  if (relativePath === '../../sevenzip/runtime/native-listing.js') return require.async('../../sevenzip/runtime/native-listing.js')
  if (relativePath === '../../document/index.js') return require.async('../../document/index.js')
  if (relativePath === '../../archive/index.js') return require.async('../../archive/index.js')
  if (relativePath === '../../image/index.js') return require.async('../../image/index.js')
  return require.async(relativePath)
}

function loadInWechat (relativePath) {
  if (pending[relativePath]) return pending[relativePath]
  // 从未回调的下载也必须释放 pending；否则后续打开永远复用挂起的 Promise。
  let timer
  let expired = false
  const operation = Promise.resolve().then(() => importModule(relativePath)).catch(error => {
    const message = String(error && (error.errMsg || error.message) || error)
    const name = PACKAGE_NAMES[relativePath]
    const transient = /module .* is not defined|download|loadSubpackage|network|timeout|下载|超时/i.test(message)
    if (expired || !transient || !name || typeof wx === 'undefined' || typeof wx.loadSubpackage !== 'function') throw error
    // 针对异步入口暂未注册的失败，尝试显式加载该包后只重试一次，
    // 不把同步跨包 require 当作后备，也不无限重试永久缺失的上传文件。
    return new Promise((resolve, reject) => wx.loadSubpackage({ name, success: resolve, fail: reject }))
      .then(() => { if (expired) throw error; return importModule(relativePath) })
  })
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('阅读组件加载超时，请重试')) }, 15000)
  })
  const result = Promise.race([operation, deadline]).then(value => {
    clearTimeout(timer)
    delete pending[relativePath]
    return value
  }, error => {
    clearTimeout(timer)
    delete pending[relativePath]
    throw error
  })
  pending[relativePath] = result
  return result
}

const subpackage = {
  load (relativePath, label) {
    if (typeof require.async === 'function') return loadInWechat(relativePath)
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      return Promise.resolve().then(() => require(relativePath))
    }
    return Promise.reject(new Error(`当前微信基础库不支持${label}按需分包`))
  }
}

module.exports = subpackage
