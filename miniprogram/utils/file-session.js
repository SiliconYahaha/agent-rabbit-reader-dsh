'use strict'

const { fileKind } = require('../file-reader/shared/file-types')

function normalizeMaterial (file = {}) {
  return {
    name: file.name || '未命名文件',
    path: file.path || file.tempFilePath || '',
    size: Number(file.size || 0),
    type: file.type || '',
    inlineHtml: typeof file.inlineHtml === 'string' ? file.inlineHtml : undefined
  }
}

function ensureGlobalData (app) {
  if (!app) return null
  app.globalData = app.globalData || {}
  return app.globalData
}

function startFileSession (app, files) {
  const globalData = ensureGlobalData(app)
  if (!globalData) return null
  const queue = (files || []).map(normalizeMaterial)
  globalData.fileQueueScroll = {}
  globalData.recentSessionId = null
  globalData.fileQueue = queue
  globalData.fileQueueIndex = queue.length ? 0 : -1
  require('./recent-session').save(app, queue).catch(() => {})
  return queue[0] || null
}

function fileSessionState (app) {
  const globalData = ensureGlobalData(app)
  const queue = globalData && Array.isArray(globalData.fileQueue) ? globalData.fileQueue : []
  const rawIndex = globalData ? Number(globalData.fileQueueIndex) : -1
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < queue.length ? rawIndex : -1
  return {
    queue,
    index,
    current: index >= 0 ? queue[index] : null,
    count: queue.length,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < queue.length - 1
  }
}

function selectFileAt (app, index) {
  const state = fileSessionState(app)
  const nextIndex = Number(index)
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.queue.length) return null
  app.globalData.fileQueueIndex = nextIndex
  return state.queue[nextIndex]
}

function stageMaterialRoute (app, material) {
  const globalData = ensureGlobalData(app)
  if (!globalData || !material) return ''
  if (fileKind(material) === 'design') {
    globalData.pendingFilePreview = material
    globalData.pendingMaterial = null
    return '/pages/file-preview/file-preview'
  }
  globalData.pendingMaterial = material
  globalData.pendingFilePreview = null
  return '/pages/index/index'
}

module.exports = {
  fileSessionState,
  normalizeMaterial,
  selectFileAt,
  stageMaterialRoute,
  startFileSession
}
