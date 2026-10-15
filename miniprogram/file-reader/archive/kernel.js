'use strict'

// 本分包对引擎内核（text-decoder、file-inspector、archive-members 等）的访问点。
// 微信里分包之间只能 require.async，所以内核由引擎在加载本分包后调用 index.js 的 attach() 注入到这里；
// Node（测试、脚本）没有这个限制，直接同步拿引擎的 kernel-exports，路径用变量避免小程序编译器做静态分析。
const kernel = {}

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  const enginePath = '../engine/core/kernel-exports'
  Object.assign(kernel, require(enginePath))
}

module.exports = kernel
