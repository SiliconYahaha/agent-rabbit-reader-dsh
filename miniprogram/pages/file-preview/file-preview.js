'use strict'

// 设计文件页只负责产品层：文件队列、分享菜单和路由。
// Ai/PSD 的读取与画面还原由 /file-reader/engine/components/design-preview 组件完成。
const { fileSessionState, selectFileAt, stageMaterialRoute, startFileSession } = require('../../utils/file-session')
const recent = require('../../utils/recent-session')
const { fileKind } = require('../../file-reader/shared/file-types')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')

const nativeViewer = require('../../utils/native-viewer-return')

Page({
  ...nativeViewer,
  data: {
    file: null,
    nativeReturned: false,
    queueOpen: false,
    queueItems: [],
    queueSearch: '',
    error: '',
    queueCount: 0,
    queuePosition: 0,
    hasPreviousFile: false,
    hasNextFile: false
  },

  onLoad (query = {}) {
    enableShareMenu()
    if (query.from === 'share') {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
    const app = getApp()
    const material = app && app.globalData && (app.globalData.pendingFilePreview || fileSessionState(app).current)
    if (app && app.globalData) app.globalData.pendingFilePreview = null
    if (material && !fileSessionState(app).count) startFileSession(app, [material])
    this.syncFileSession()
    if (!material || !material.path) {
      this.setData({ error: '没有收到可读取的文件，请返回后重新选择。' })
      return
    }
    this.openMaterial(material)
  },

  onShow () {
    if (this.resumeNativeViewer()) return
    // 从微信文档查看器返回时再次开启分享，避免原生页面改变菜单状态。
    enableShareMenu()
  },

  openMaterial (material) {
    clearTimeout(this._queueCloseTimer)
    this.setData({ queueClosing: false })
    this._nativeReturn = null
    this.setData({ nativeReturned: false, queueOpen: false })
    this._materialRevision = (this._materialRevision || 0) + 1
    const file = { name: material.name, path: material.path, size: Number(material.size || 0), type: material.type || '' }
    this.setData({
      error: '',
      file
    })
  },

  toggleQueue () {
    if (this.data.queueOpen) { this.closeQueue();return }
    clearTimeout(this._queueCloseTimer)
    this.setData({ queueOpen: true, queueClosing: false, nativeReturned: false, queueSearch: '' })
    this.filterQueue('')
  },
  closeQueue () {
    clearTimeout(this._queueCloseTimer)
    this.setData({ queueClosing: true, nativeReturned: false })
    this._queueCloseTimer = setTimeout(() => this.setData({ queueOpen: false, queueClosing: false }), 180)
  },
  stopQueueTouch () {},
  searchQueue (event) { this.filterQueue(event.detail.value) },
  filterQueue (query) {
    const state = fileSessionState(getApp()), text = String(query || '').toLowerCase()
    this.setData({ queueSearch: String(query || ''), queueItems: state.queue.map((file, index) => ({ name: file.name || '未命名文件', index, active: index === state.index })).filter(file => file.name.toLowerCase().includes(text)) })
  },
  chooseQueueFile (event) {
    const index = Number(event.currentTarget.dataset.index)
    if (index === fileSessionState(getApp()).index) { this.closeQueue();return }
    this.setData({ queueOpen: false })
    this.openQueueIndex(index)
  },

  syncFileSession () {
    const state = fileSessionState(getApp())
    this.setData({
      queueCount: state.count,
      queuePosition: state.index >= 0 ? state.index + 1 : 0,
      hasPreviousFile: state.hasPrevious,
      hasNextFile: state.hasNext
    })
    return state
  },

  openQueueIndex (index) {
    if (this._queueRouting) return
    const app = getApp()
    const previous = fileSessionState(app)
    const material = selectFileAt(app, index)
    if (!material) return
    if (fileKind(material) === 'design') {
      this.syncFileSession()
      this.openMaterial(material)
      if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      return
    }
    const url = stageMaterialRoute(app, material)
    this._materialRevision = (this._materialRevision || 0) + 1
    const revision = this._materialRevision
    const routing = {}
    this._queueRouting = routing
    this.setData({ error: '' })
    wx.redirectTo({
      url,
      fail: error => {
        if (revision !== this._materialRevision || this._queueRouting !== routing) return
        this._queueRouting = null
        const current = fileSessionState(app)
        // A forwarded file may start a new session while navigation is pending.
        if (current.queue !== previous.queue || current.current !== material || app.globalData.pendingMaterial !== material) return
        app.globalData.fileQueueIndex = previous.index
        app.globalData.pendingMaterial = null
        this.syncFileSession()
        this.setData({ error: `无法打开文件：${error.errMsg || '未知错误'}` })
      }
    })
  },

  openPreviousFile () {
    const state = fileSessionState(getApp())
    if (state.hasPrevious) this.openQueueIndex(state.index - 1)
  },

  openNextFile () {
    const state = fileSessionState(getApp())
    if (state.hasNext) this.openQueueIndex(state.index + 1)
  },

  onHide () { this.hideNativeViewer();recent.checkpoint(getApp()) },

  onUnload () { clearTimeout(this._queueCloseTimer);
    recent.checkpoint(getApp())
    this._queueRouting = null
    this._materialRevision = (this._materialRevision || 0) + 1
  },

  onShareAppMessage () {
    return shareAppMessage()
  },

  onShareTimeline () {
    return shareTimeline()
  }
})
