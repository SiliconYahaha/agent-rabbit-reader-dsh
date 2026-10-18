'use strict'

const { primaryFormats, additionalFormats } = require('../../format-guide')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../../utils/share')
const presentation = {
  base: { label: 'BASE', title: '飞书多维表格', iconLabel: 'DATA', badge: '只读快照' },
  fig: { label: 'FIG / Sketch', title: '界面设计稿', iconLabel: 'FIG', badge: '内嵌预览' },
  json: { label: 'JSON / CSV', title: '数据文件', iconLabel: 'DATA' },
  jsonl: { label: 'Code', title: '源码与日志', iconLabel: '</>' },
  rar: { label: 'RAR / 7Z / TAR', title: '压缩包', iconLabel: 'ZIP' },
  dxf: { label: 'DXF / STEP', title: '工程图与模型', iconLabel: 'CAD', badge: '部分支持' },
  cdr: { label: 'CDR', title: '矢量设计稿', iconLabel: 'CDR', badge: '部分支持' },
  txt: { label: 'TXT / RTF', title: '文本', iconLabel: 'TXT' },
  pdf: { label: 'PDF', title: '版式文档', iconLabel: 'PDF' },
  doc: { label: 'Office', title: '办公文档', iconLabel: 'DOC', badge: '内容预览' },
  png: { label: 'Image', title: '图片', iconLabel: 'IMG' },
  flac: { label: 'Audio', title: '音频', iconLabel: 'MP3' },
  mp4: { label: 'Video', title: '视频', iconLabel: 'MP4' }
}
const formats = [
  ...primaryFormats,
  ...additionalFormats.filter(item => item.extensions[0] !== 'svg').map(item => ({ ...item, ...presentation[item.extensions[0]] })),
  { label: 'DWG', title: '图纸文件', iconLabel: 'DWG', extensions: ['dwg'], badge: '仅文件信息', usage: '不能显示图纸正文，仅识别版本或内嵌缩略图。查看图纸请先另存为 DXF。' }
].map((item, index) => ({ ...item, id: index, extensionText: item.extensions.join(' · ') }))

Page({
  data: { formats, expanded: -1 },
  toggleFormat (event) {
    const id = Number(event.currentTarget.dataset.id)
    this.setData({ expanded: this.data.expanded === id ? -1 : id })
  },
  onLoad (query = {}) {
    enableShareMenu()
    if (query.from === 'share') wx.reLaunch({ url: '/pages/home/home' })
  },
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
