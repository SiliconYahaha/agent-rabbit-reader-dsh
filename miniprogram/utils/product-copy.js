'use strict'

// 兔子阅读器的入口文案。首页、分享与设计说明使用同一份口径。
// 格式为首页代表项，不等于完整能力清单；各格式限制在打开时说明。
const HOME_COPY = {
  coreFormats: '打开 HTML、SVG 文件',
  moreFormats: '也支持 Ai、PSD、ZIP 等格式',
  open: '打开文件',
  pickerNote: '从微信聊天选择，最多 10 个',
  paste: '粘贴 HTML',
  sample: '支持格式',
  share: '分享给朋友',
  placeholder: '粘贴 HTML 源码',
  openDraft: '直接打开',
  privacy: '本机处理 · 不上传原文件'
}

const SHARE_TITLE = '兔子阅读器｜微信里的文件阅读器'

module.exports = { HOME_COPY, SHARE_TITLE }
