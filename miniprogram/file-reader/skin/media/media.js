'use strict'

// 皮肤 · 音视频：抬头、播放器外观。播放状态（InnerAudioContext）与诊断都在引擎里，这里只展示与转发事件。
// 事件：toggle（音频播放/暂停）、seek（detail.value 秒）、video*（原样转发 <video> 事件的 detail）。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    mode: { type: String, value: '' },
    kicker: { type: String, value: '' },
    name: { type: String, value: '' },
    type: { type: String, value: '' },
    sizeLabel: { type: String, value: '' },
    formatLabel: { type: String, value: '' },
    codecLabel: { type: String, value: '' },
    compatibility: { type: String, value: '' },
    diagnostic: { type: String, value: '' },
    details: { type: Array, value: [] },
    canPlay: { type: Boolean, value: false },
    path: { type: String, value: '' },
    playing: { type: Boolean, value: false },
    current: { type: Number, value: 0 },
    duration: { type: Number, value: 0 },
    currentLabel: { type: String, value: '' },
    durationLabel: { type: String, value: '' },
    note: { type: String, value: '' },
    unavailable: { type: String, value: '' }
  },
  methods: {
    onToggle () { this.triggerEvent('toggle') },
    onSeek (event) { this.triggerEvent('seek', event.detail) },
    onVideoPlay (event) { this.triggerEvent('videoplay', event.detail) },
    onVideoPause (event) { this.triggerEvent('videopause', event.detail) },
    onVideoLoadedMetadata (event) { this.triggerEvent('videoloadedmetadata', event.detail) },
    onVideoWaiting (event) { this.triggerEvent('videowaiting', event.detail) },
    onVideoEnded (event) { this.triggerEvent('videoended', event.detail) },
    onVideoError (event) { this.triggerEvent('videoerror', event.detail) }
  }
})
