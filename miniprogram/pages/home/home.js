'use strict'

const { fileKind } = require('../../file-reader/shared/file-types')
const { stageMaterialRoute, startFileSession } = require('../../utils/file-session')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')

const { HOME_COPY } = require('../../utils/product-copy')

const MAX_BATCH_FILES = 10

Page({
  data: {
    copy: HOME_COPY,
    inputMode: '',
    draftHtml: '',
    error: ''
  },

  onLoad () {
    enableShareMenu()
  },

  onShow () {
    enableShareMenu()
    wx.setNavigationBarTitle({ title: '兔子阅读器' })
  },

  chooseFile () {
    const selection = (this._selectionRevision || 0) + 1
    this._selectionRevision = selection
    this.setData({ error: '' })
    wx.chooseMessageFile({
      count: MAX_BATCH_FILES,
      // `all` 才会把聊天中的图片和视频一起返回；格式判断由本机路由完成。
      type: 'all',
      success: result => {
        if (selection !== this._selectionRevision) return
        const selected = (result.tempFiles || []).filter(file => file && (file.path || file.tempFilePath))
        if (!selected.length) {
          this.setData({ error: '未选中文件，请重新选择。' })
          return
        }
        this.resolvePickedFiles(selected, selection)
      },
      fail: error => {
        if (selection === this._selectionRevision && !String(error.errMsg || '').includes('cancel')) {
          this.setData({ error: `选择文件失败：${error.errMsg || '未知错误'}` })
        }
      }
    })
  },

  resolvePickedFiles (files, selection) {
    const prepared = []
    const next = index => {
      if (selection !== this._selectionRevision) return
      if (index === files.length) { this.openFileSession(prepared); return }
      const file = files[index]
      if (fileKind(file) !== 'unsupported') { prepared.push(file); next(index + 1); return }
      // A picker can supply a display name without a usable extension. Keep
      // the original path/name, and let the user choose how to read the bytes.
      this.setData({ error: `无法识别“${file.name || '未命名文件'}”，请选择打开方式。` })
      wx.showActionSheet({
        itemList: ['按 Markdown 打开', '按纯文本打开'],
        success: result => {
          if (selection !== this._selectionRevision) return
          if (result.tapIndex !== 0 && result.tapIndex !== 1) return
          prepared.push({ ...file, type: result.tapIndex === 0 ? 'text/markdown' : 'text/plain' })
          next(index + 1)
        },
        fail: error => {
          if (selection !== this._selectionRevision) return
          this.setData({ error: String(error.errMsg || '').includes('cancel') ? '已取消，可重新选文件。' : '无法选择打开方式，请重试。' })
        }
      })
    }
    next(0)
  },

  loadSample () {
    if (this._openingExamples) return
    this._openingExamples = true
    this.setData({ error: '' })
    wx.navigateTo({
      url: '/examples/pages/gallery/gallery',
      fail: () => this.setData({ error: '示例未打开，请重试。' }),
      complete: () => { this._openingExamples = false }
    })
  },

  showPaste () {
    this.setData({ inputMode: 'paste', error: '' }, () => {
      wx.pageScrollTo({ selector: '.input-box', duration: 180 })
    })
  },

  onHtmlInput (event) {
    this.setData({ draftHtml: event.detail.value })
  },

  parseDraft () {
    const html = this.data.draftHtml.trim()
    if (!html) {
      this.setData({ error: '请先粘贴 HTML。' })
      return
    }
    this.openFileSession([{
      name: '粘贴的 HTML',
      type: 'text/html',
      size: html.length,
      inlineHtml: html
    }])
  },

  openFileSession (files) {
    const app = getApp()
    const first = startFileSession(app, files)
    const url = stageMaterialRoute(app, first)
    if (!url) {
      this.setData({ error: '无法读取文件，请重新进入小程序。' })
      return
    }
    this.setData({ error: '' })
    wx.redirectTo({
      url,
      fail: error => this.setData({ error: `无法打开文件：${error.errMsg || '未知错误'}` })
    })
  },

  onShareAppMessage () {
    return shareAppMessage()
  },

  onShareTimeline () {
    return shareTimeline()
  }
})

module.exports = { MAX_BATCH_FILES }
