'use strict'

// archive 族分包入口：ZIP / RAR / 7z 的目录读取、成员解压、分卷与包内链接。
// RAR 内核（vendor/unrar）随本分包下载；7z 内核仍在 file-reader/sevenzip 分包按需加载。
// attach(kernel) 必须先于其他模块求值：模块顶层会从 ./kernel 解构内核函数。

function attach (kernel) {
  Object.assign(require('./kernel'), kernel)
  return require('./api')
}

module.exports = { attach }
