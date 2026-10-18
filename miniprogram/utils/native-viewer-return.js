'use strict'

// Native documents do not have an inline canvas. Returning should reveal the
// selected files (or the entry page), never a metadata-only intermediate page.
const { fileSessionState } = require('./file-session')
function leaveReader () {
  this._nativeReturn = null
  if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  } else wx.reLaunch({ url: '/pages/home/home' })
}
function finishReturn (page) {
  const state = page._nativeReturn
  if (!state || !state.opened || !state.hidden || !state.shown) return
  page._nativeReturn = null
  if (fileSessionState(getApp()).count < 2) { leaveReader.call(page);return }
  page.setData({ nativeReturned: false, queueOpen: true, queueClosing: false, queueSearch: '' })
  page.filterQueue('')
}
module.exports = {
  leaveReader,
  onNativeViewer (event) {
    const detail = event.detail || {}
    if (detail.phase === 'opening') this._nativeReturn = { id: detail.id, opened: false, hidden: false, shown: false }
    else if (this._nativeReturn && this._nativeReturn.id === detail.id) {
      if (detail.phase === 'failed') this._nativeReturn = null
      else if (detail.phase === 'opened') { this._nativeReturn.opened = true;finishReturn(this) }
    }
  },
  hideNativeViewer () { if (this._nativeReturn) this._nativeReturn.hidden = true },
  resumeNativeViewer () {
    if (!this._nativeReturn || !this._nativeReturn.hidden) return false
    this._nativeReturn.shown = true
    finishReturn(this)
    return true
  }
}
