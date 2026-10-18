'use strict'

const { cards, materialize } = require('../../catalog')
const { exampleUses } = require('../../format-guide')
const conciseCards = {
  meeting: ['HTML 综合测试', '按钮、深浅色切换与表格'],
  koi: ['HTML 锦鲤唱片机', '点水面添鱼，拖唱针听雨'],
  tank: ['HTML 坦克大战', '触屏操作，试试移动和开火'],
  clock: ['SVG 下班雷达', '跟随本机时间，拖动试试'],
  bicycle: ['SVG 秦始皇骑自行车', '矢量插画，按暂停试试'],
  final: ['专业设计文件', 'Ai / EPS · 标志、插画与海报'],
  change: ['PSD 图层设计稿', '海报与修图，查看合成画面'],
  secret: ['ZIP 压缩包', '浏览目录，直接打开包内文件'],
  markdown: ['Markdown 笔记与攻略', '清单、代码与表格']
}
const formatCards = cards.map(card => ({ ...card, ...exampleUses[card.id], shortTitle: conciseCards[card.id][0], shortDetail: conciseCards[card.id][1], iconLabel: ({ meeting: "HTML", koi: "HTML", tank: "HTML", clock: "SVG", bicycle: "SVG", final: "Ai", change: "PSD", secret: "ZIP", markdown: "MD" })[card.id], preview: `/examples/assets/${card.id}.jpg`, extensionText: exampleUses[card.id].extensions.join(' · ') }))
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
      await new Promise((resolve, reject) => wx.navigateTo({ url, success: resolve, fail: reject }))
    } catch (error) {
      if (this._active && request === this._request) {
        console.warn('示例打开失败', error)
        this.setData({ error: '没打开，再点一次试试。' })
      }
    } finally {
      if (this._active && request === this._request) this.setData({ opening: '' })
    }
  },
  showCredits () {
    wx.showModal({
      title: '示例素材来源',
      content: 'HTML：锦鲤唱片机，来自 Ann Nguyen 的 bubbbly.com；保留原页面与素材署名，原作标注 Built by Claude Fable 5 on TypingMind。\n来源：https://www.bubbbly.com/app/koi-pond.html\n\nHTML：霓虹坦克大战，来自用户提供的测试案例，保留原文件标识。\n\nAi：彩色兔子阅读器 Logo，用户提供并授权用于文件预览演示，保留原始 Ai 文件。\n\nPSD：Mozilla Indonesia 吉祥物发布海报，保留全部 21 个图层记录与合成画面，仅提高内嵌预览清晰度。\n\n来源：https://github.com/mozilla/OpenDesign\n素材仓库附 CC0 与 MPL 2.0 许可；商标权仍归 Mozilla 及原权利人。仅用于文件预览演示，不表示合作或背书。',
      showCancel: false,
      confirmText: '知道了'
    })
  },
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
