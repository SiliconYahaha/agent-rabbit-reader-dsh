'use strict'

const { isSupportedMaterial } = require('./file-reader/shared/file-types')
const { startFileSession } = require('./utils/file-session')

App({
  globalData: {
    fileQueue: [],
    fileQueueIndex: -1,
    pendingMaterial: null,
    pendingFilePreview: null
  },

  onShow (options = {}) {
    if (String(options.scene || '') !== '1173') return
    const materials = Array.isArray(options.forwardMaterials) ? options.forwardMaterials : []
    const material = materials.find(isSupportedMaterial)
    if (!material) return

    const normalized = {
      type: material.type || '',
      name: material.name || '聊天中的文件',
      path: material.path,
      size: Number(material.size || 0)
    }
    startFileSession(this, [normalized])
    this.globalData.pendingMaterial = normalized
  }
})

module.exports = { isSupportedMaterial }
