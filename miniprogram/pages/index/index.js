'use strict'

// 阅读页只负责产品层：文件队列、分享菜单、导航标题。
// 文件识别、读取、解析和展示全部由 /file-reader/engine/components/reader 组件完成。
const { fileSessionState, selectFileAt, startFileSession } = require('../../utils/file-session')
const recent = require('../../utils/recent-session')
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
    siblings: [],
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
    this.syncFileSession()
  },

  onShow () {
    if (getApp().globalData.pendingMaterial) this._nativeReturn = null
    if (this.resumeNativeViewer()) return
    // 从聊天、原生查看器或后台返回时重新声明分享菜单，避免微信页面复用后
    // 保留上一个页面的菜单状态。
    enableShareMenu()
    // 微信可能复用上一个文档留下的标题；进入阅读器时始终恢复产品标题。
    wx.setNavigationBarTitle({ title: '兔子阅读器' })
    this.openForwardedMaterial()
  },

  onPageScroll (event) {
    const app = getApp(), state = fileSessionState(app)
    app.globalData.fileQueueScroll = app.globalData.fileQueueScroll || {}
    if (state.index >= 0 && !this._restoringScroll) app.globalData.fileQueueScroll[state.index] = Number(event && event.scrollTop || 0)
    const reader = this.reader()
    if (reader && typeof reader.syncPageScroll === 'function') reader.syncPageScroll(Number(event && event.scrollTop || 0))
  },

  reader () {
    return typeof this.selectComponent === 'function' ? this.selectComponent('#reader') : null
  },

  openForwardedMaterial () {
    if (typeof getApp !== 'function') return
    const app = getApp()
    const globalData = app && app.globalData
    const material = globalData && (globalData.pendingMaterial || (!this._opened && fileSessionState(app).current))
    if (!material) return

    // 先消费，避免页面再次显示时重复打开同一份文件。
    globalData.pendingMaterial = null
    if (!Array.isArray(globalData.fileQueue) || !globalData.fileQueue.length) startFileSession(app, [material])
    this.openMaterial(material)
  },

  openMaterial (material) {
    clearTimeout(this._queueCloseTimer)
    this.setData({ queueClosing: false })
    this._nativeReturn = null
    this.setData({ nativeReturned: false, queueOpen: false })
    clearTimeout(this._scrollTimer)
    this._opened = true
    this._restoringScroll = true
    const state = this.syncFileSession()
    // 每次都传入新对象，保证同一队列项被重新选择时组件也会重新打开。
    this.setData({
      siblings: state.queue.map(file => ({ name: file.name, path: file.path, size: file.size, type: file.type })),
      file: {
        name: material.name || '聊天中的文件',
        path: material.path,
        size: material.size || 0,
        type: material.type || '',
        inlineHtml: material.inlineHtml
      }
    })
  },

  onReaderReady () {
    if (!this._restoringScroll) return
    const app = getApp(), state = fileSessionState(app)
    const scrollTop = Number((app.globalData.fileQueueScroll || {})[state.index]) || 0
    clearTimeout(this._scrollTimer)
    this._scrollTimer = setTimeout(() => {
      if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop, duration: 0 })
      this._restoringScroll = false
    }, 100)
  },

  onHide () { this.hideNativeViewer();recent.checkpoint(getApp()) },
  onUnload () { clearTimeout(this._queueCloseTimer); clearTimeout(this._scrollTimer);recent.checkpoint(getApp()) },

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
    const material = selectFileAt(getApp(), index)
    if (!material) return
    clearTimeout(this._scrollTimer)
    this.openMaterial(material)
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  openPreviousFile () {
    const state = fileSessionState(getApp())
    if (state.hasPrevious) this.openQueueIndex(state.index - 1)
  },

  openNextFile () {
    const state = fileSessionState(getApp())
    if (state.hasNext) this.openQueueIndex(state.index + 1)
  },

  onShareAppMessage () {
    return shareAppMessage()
  },

  onShareTimeline () {
    return shareTimeline()
  }
})
