'use strict'

// 皮肤 · Ai / PSD 预览：文件抬头、状态、元数据、提示与"打开内嵌 PDF"按钮。预览图由引擎放进 preview 插槽。
// 事件：openpdf
Component({
  options: { styleIsolation: 'apply-shared', multipleSlots: true },
  properties: {
    mark: { type: String, value: '' },
    name: { type: String, value: '' },
    size: { type: String, value: '' },
    loading: { type: Boolean, value: false },
    loadingText: { type: String, value: '' },
    metadataTitle: { type: String, value: '' },
    metadata: { type: Array, value: [] },
    message: { type: String, value: '' },
    error: { type: String, value: '' },
    canOpenPdf: { type: Boolean, value: false },
    openPdfText: { type: String, value: '' }
  },
  methods: {
    onOpenPdf () { this.triggerEvent('openpdf') }
  }
})
