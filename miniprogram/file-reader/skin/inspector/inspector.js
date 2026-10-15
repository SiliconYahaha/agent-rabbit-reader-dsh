'use strict'

// 皮肤 · 文件检查与压缩包目录：抬头、元数据卡、密码卡、文件名编码切换、内容清单与翻页。
// 可旋转模型 / 内嵌预览图属于内容，由引擎放进 preview 插槽。
// 事件：passwordinput(detail.value) unlock encoding(detail.value) back open(detail.index) prev next
Component({
  options: { styleIsolation: 'apply-shared', multipleSlots: true },
  properties: {
    kicker: { type: String, value: '' },
    title: { type: String, value: '' },
    summary: { type: String, value: '' },
    note: { type: String, value: '' },
    metadata: { type: Array, value: [] },
    hasPreview: { type: Boolean, value: false },
    needsPassword: { type: Boolean, value: false },
    passwordStatus: { type: String, value: '' },
    nameEncoding: { type: String, value: '' },
    nameEncodingOptions: { type: Array, value: [] },
    linkFolder: { type: String, value: '' },
    entries: { type: Array, value: [] },
    entryCount: { type: Number, value: 0 },
    page: { type: Number, value: 0 },
    pages: { type: Number, value: 0 },
    hasPreviousPage: { type: Boolean, value: false },
    hasNextPage: { type: Boolean, value: false }
  },
  methods: {
    onPasswordInput (event) { this.triggerEvent('passwordinput', { value: event.detail.value }) },
    onUnlock () { this.triggerEvent('unlock') },
    onEncoding (event) { this.triggerEvent('encoding', { value: event.currentTarget.dataset.value }) },
    onBack () { this.triggerEvent('back') },
    onOpen (event) { this.triggerEvent('open', { index: Number(event.currentTarget.dataset.index) }) },
    onPrevious () { this.triggerEvent('prev') },
    onNext () { this.triggerEvent('next') }
  }
})
