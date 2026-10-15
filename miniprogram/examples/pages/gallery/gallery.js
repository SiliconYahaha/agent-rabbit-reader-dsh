'use strict'

const { cards, materialize } = require('../../catalog')
const { exampleUses } = require('../../format-guide')
const formatCards = cards.map(card => ({ ...card, ...exampleUses[card.id], preview: `/examples/assets/${card.id}.jpg`, extensionText: exampleUses[card.id].extensions.join(' · ') }))
const { startFileSession, stageMaterialRoute } = require('../../../utils/file-session')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../../utils/share')

Page({
  data: { cards: formatCards, opening: '', error: '' },
  onLoad (query = {}) {
    enableShareMenu()
    if (query.from === 'share') {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
    this._active = true
  },
  onShow () { this._active = true },
  onHide () { this._active = false; this._request = (this._request || 0) + 1; this.setData({ opening: '' }) },
  onUnload () { this._active = false; this._request = (this._request || 0) + 1 },
  async openExample (event) {
    if (this.data.opening) return
    const id = event.currentTarget.dataset.id
    if (!cards.some(card => card.id === id)) return
    const request = this._request = (this._request || 0) + 1
    this.setData({ opening: id, error: '' })
    try {
      const material = await materialize(id, wx)
      if (!this._active || request !== this._request) return
      const app = getApp()
      const url = stageMaterialRoute(app, startFileSession(app, [material]))
      if (!url) throw new Error('未能建立阅读会话')
      await new Promise((resolve, reject) => wx.navigateTo({ url: id === 'final' ? `${url}?example=final` : url, success: resolve, fail: reject }))
    } catch (error) {
      if (this._active && request === this._request) {
        console.warn('示例打开失败', error)
        this.setData({ error: '没打开，再点一次试试。' })
      }
    } finally {
      if (this._active && request === this._request) this.setData({ opening: '' })
    }
  },
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
