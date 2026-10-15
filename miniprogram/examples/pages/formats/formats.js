'use strict'

const { exampleUses, additionalFormats } = require('../../format-guide')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../../utils/share')
const primaryFormats = ['meeting', 'clock', 'final', 'change', 'secret', 'markdown']
const otherIcons = ['▦', '⌘', '▣', '⌖', '◈', '≡', '▤', '▧', '♫', '▶']
const formats = [
  ...primaryFormats.map(id => { const item = exampleUses[id]; return { title: item.usage, icon: item.icon, tone: item.tone, extensionText: item.extensions.join(' · '), usage: item.limit } }),
  ...additionalFormats.map((item, index) => ({ ...item, icon: otherIcons[index], tone: index < 2 ? 'text' : index < 5 ? 'design' : index < 8 ? 'web' : 'media' }))
]

Page({
  data: { formats },
  onLoad (query = {}) {
    enableShareMenu()
    if (query.from === 'share') wx.reLaunch({ url: '/pages/home/home' })
  },
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
