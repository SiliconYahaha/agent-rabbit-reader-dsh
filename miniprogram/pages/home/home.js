'use strict'

const recent = require('../../utils/recent-session')
const { stageMaterialRoute, startFileSession } = require('../../utils/file-session')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')

const { HOME_COPY } = require('../../utils/product-copy')

const MAX_BATCH_FILES = 10

Page({
  data: {
    copy: HOME_COPY,
    inputMode: '',
    draftHtml: '',
    recent: null,
    error: ''
  },

  onLoad () {
    enableShareMenu()
  },

  onShow () {
    enableShareMenu()
    wx.setNavigationBarTitle({ title: '兔子阅读器' })
    const saved = recent.read()
    this.setData({ inputMode: '', error: '', recent: saved ? { count: saved.files.length, name: saved.files[saved.index] && saved.files[saved.index].name || saved.files[0].name } : null }, () => {
      if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    })
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail () {} })
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
    if (selection !== this._selectionRevision) return
    this.openFileSession(files)
  },

  async resumeReading () {
    if (this._resuming) return
    this._resuming = true
    const selection = (this._selectionRevision || 0) + 1
    this._selectionRevision = selection
    const app = getApp()
    try {
      if (!await recent.restore(app)) { this.setData({ recent: null, error: '上次文件已过期或被清理，请重新选择。' });return }
      if (selection !== this._selectionRevision) return
      const url = stageMaterialRoute(app, app.globalData.fileQueue[app.globalData.fileQueueIndex])
      wx.navigateTo({ url, fail: () => this.setData({ error: '未能恢复，请重试。' }) })
    } finally { this._resuming = false }
  },

  clearRecent () {
    recent.clear()
    this.setData({ recent: null })
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
      if (this.data.inputMode === 'paste') wx.pageScrollTo({ selector: '.input-box', duration: 180 })
    })
  },

  closePaste () {
    this.setData({ inputMode: '', error: '' })
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail () {} })
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
    wx.navigateTo({
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
