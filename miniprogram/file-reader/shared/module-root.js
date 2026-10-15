'use strict'

// 模块在小程序包内的根目录（相对 miniprogramRoot，不带首尾斜杠）。
// WXWebAssembly.instantiate 只接受包内绝对路径，两个 WASM 内核的位置都从这里派生。
//   - 直接复制目录接入：默认 'file-reader'；
//   - 通过 npm 接入（构建 npm 后）：宿主在使用前调用 setModuleRoot('miniprogram_npm/mp-file-reader')。
let moduleRoot = 'file-reader'

function normalizeRoot (value) {
  return String(value || '').replace(/^\/+|\/+$/g, '')
}

function setModuleRoot (root) {
  const next = normalizeRoot(root)
  if (!next) throw new Error('模块根目录不能为空')
  moduleRoot = next
  return moduleRoot
}

function getModuleRoot () {
  return moduleRoot
}

function modulePath (relative) {
  return `${moduleRoot}/${String(relative || '').replace(/^\/+/, '')}`
}

module.exports = { getModuleRoot, modulePath, setModuleRoot }
