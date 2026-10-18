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
    hasPreview: { type: Boolean, value: false },
    canOpenPdf: { type: Boolean, value: false },
    openPdfText: { type: String, value: '' }
  },
  data: { detailsOpen: false, previewNotice: '' },
  observers: {
    name () { this.setData({ detailsOpen: false }) },
    message (message) { this.setData({ previewNotice: /缩略|内嵌预览/.test(message || '') ? '当前显示内嵌预览，清晰度可能有限。' : '当前为兼容预览，部分细节可能与原稿不同。' }) }
  },
  methods: {
    toggleDetails () { this.setData({ detailsOpen: !this.data.detailsOpen }) },
    onOpenPdf () { this.triggerEvent('openpdf') }
  }
})
