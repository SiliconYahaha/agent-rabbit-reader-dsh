'use strict'

// 历史入口：readerPage() 返回真实的阅读器组件实例（带 patches 记录），
// 宿主页面实例挂在 reader.host 上。实现见 reader-host.js。
const { flush, readerPage } = require('./reader-host')

module.exports = { readerPage, flush }
