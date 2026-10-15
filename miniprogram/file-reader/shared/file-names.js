'use strict'

// 文件名与大小的纯函数。放在主包 shared/ 里：宿主在路由和入口判断时就要用到，
// 不能等引擎分包加载；引擎内的 design-file 也从这里取，避免两份实现。

function extensionOf (name) {
  // Ignore trailing display whitespace for routing only; never rename the
  // original archive member or filesystem path used to read its bytes.
  const match = String(name || '').trimEnd().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

function formatBytes (size) {
  const value = Number(size || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`
  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

module.exports = { extensionOf, formatBytes }
