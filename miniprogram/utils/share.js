'use strict'

const { SHARE_TITLE } = require('./product-copy')
const SHARE_PATH = '/pages/home/home'
const SHARE_IMAGE = '/assets/brand-hero-sketch-transparent.png'

function enableShareMenu (onError) {
  if (typeof wx.showShareMenu !== 'function') {
    if (typeof onError === 'function') onError({ errMsg: '当前微信版本不支持分享菜单' })
    return false
  }
  wx.showShareMenu({
    withShareTicket: false,
    menus: ['shareAppMessage', 'shareTimeline'],
    fail: error => {
      if (typeof onError === 'function') onError(error)
      else if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn('兔子阅读器分享菜单开启失败', error)
    }
  })
  return true
}

function shareAppMessage () {
  return {
    title: SHARE_TITLE,
    path: SHARE_PATH,
    imageUrl: SHARE_IMAGE
  }
}

function shareTimeline () {
  return {
    title: SHARE_TITLE,
    // 朋友圈固定分享当前页面；阅读页收到此标记后回到可正常使用的首页。
    query: 'from=share',
    imageUrl: SHARE_IMAGE
  }
}

module.exports = {
  SHARE_IMAGE,
  SHARE_PATH,
  SHARE_TITLE,
  enableShareMenu,
  shareAppMessage,
  shareTimeline
}
