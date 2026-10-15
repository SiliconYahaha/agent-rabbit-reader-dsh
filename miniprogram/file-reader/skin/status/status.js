'use strict'

// 皮肤 · 状态：加载中 / 错误 / 原生查看器提示。宿主自有，模块同步不覆盖。
// 契约：properties 由引擎给，只发 retry 事件。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    loading: { type: Boolean, value: false },
    label: { type: String, value: '' },
    detail: { type: String, value: '' },
    error: { type: String, value: '' },
    retryable: { type: Boolean, value: false },
    native: { type: String, value: '' }
  },
  methods: {
    onRetry () { this.triggerEvent('retry') }
  }
})
