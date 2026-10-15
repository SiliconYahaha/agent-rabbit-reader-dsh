'use strict'

// document 族分包入口：HTML / XHTML 沙盒运行时与 DOM 渲染、CSS 层叠、视图载荷压缩，
// 以及 Markdown / TXT / RTF 排版后的同一条展示链。reader 内核通过 families.load('document') 拿到 api。
// attach(kernel) 必须先于其他模块求值：模块顶层会从 ./kernel 解构内核函数。

function attach (kernel) {
  Object.assign(require('./kernel'), kernel)
  return require('./api')
}

module.exports = { attach }
