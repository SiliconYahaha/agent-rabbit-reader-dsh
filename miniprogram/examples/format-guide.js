'use strict'

const types = require('../file-reader/shared/file-types')

// Purpose first; each action still opens the bundled file in its real format.
const exampleUses = {
  meeting: { icon: '〈〉', tone: 'web', usage: '网页报告与互动工具', detail: '点按钮，看看网页如何回应', extensions: [...types.HTML_EXTENSIONS], limit: '复杂网页、外部资源及浏览器专有功能可能无法运行。' },
  clock: { icon: '◇', tone: 'web', usage: '矢量图与动画', detail: '指针会转动的 SVG 图', extensions: [...types.SVG_EXTENSIONS], limit: '外部资源、脚本及部分动画效果不支持。' },
  bicycle: { icon: '✦', tone: 'web', usage: '插画也能动起来', detail: '看鹧鸪骑车，试试暂停', extensions: [...types.SVG_EXTENSIONS], limit: '外部资源、脚本及部分动画效果不支持。' },
  final: { icon: '◈', tone: 'design', usage: '看矢量标志源稿', detail: '四种标志形态，放大依然清晰', extensions: ['ai'], limit: '支持 PDF 兼容画板、部分旧式矢量或内嵌预览；不能编辑。' },
  change: { icon: '▧', tone: 'design', usage: '预览分层海报', detail: '直接看 PSD 保存的完整画面', extensions: ['psd', 'psb'], limit: '不提供图层编辑；复杂效果、色彩与超大画布可能受限。' },
  secret: { icon: '▣', tone: 'archive', usage: '查看压缩包', detail: '先看目录，再点开里面的文件', extensions: ['zip'], limit: '密码、分卷、压缩方式及文件大小有兼容限制。' },
  markdown: { icon: '≡', tone: 'text', usage: '阅读笔记与攻略', detail: '清单、代码、宽表格都能看', extensions: ['md', 'markdown'], limit: '不完整还原所有公式与图表语法。' }
}

// These are capability descriptions, not buttons pretending to have sample files.
const additionalFormats = [
  { title: '数据文件', extensions: ['json', 'csv'], usage: 'JSON 缩进阅读，CSV 表格查看；可切换原文。格式无效或排版超限时显示完整原文。' },
  { title: '源码、配置与日志', extensions: [...types.SOURCE_TEXT_EXTENSIONS].filter(extension => !['json', 'csv'].includes(extension)), usage: '只读查看原文，不运行代码、公式或外部实体。文本文件上限 5 MB。' },
  { title: '其他压缩包', extensions: ['rar', '7z', 'tar'], usage: '浏览目录，打开支持的成员；TAR 仅指未压缩包。密码、分卷和大小有限制。' },
  { title: '工程图与模型', extensions: ['dxf', 'stp', 'step'], usage: '查看已支持的二维图元或旋转三维模型，复杂实体和装配可能不完整。' },
  { title: 'CorelDRAW 设计稿', extensions: ['cdr'], usage: '查看部分旧式矢量、文档包内容或内嵌预览，不提供完整编辑能力。' },
  { title: '文本与富文本', extensions: ['txt', 'rtf'], usage: '阅读文字；RTF 提取正文与段落，不完整还原复杂版式。' },
  { title: '办公文档', extensions: [...types.NATIVE_DOCUMENT_EXTENSIONS], usage: '交给微信原生查看器，兼容性由微信决定；不执行宏。' },
  { title: '常见图片', extensions: [...types.IMAGE_EXTENSIONS], usage: '使用微信图片预览查看，解码能力由微信决定。' },
  { title: '音频', extensions: [...types.AUDIO_EXTENSIONS], usage: '当前设备与编码支持时可播放；Android 和 iOS 的兼容范围不同。' },
  { title: '视频与播放列表', extensions: [...types.VIDEO_EXTENSIONS], usage: '当前设备与编码支持时可播放；单独的 M3U8 只显示资源引用。' }
].map(group => ({ ...group, extensionText: group.extensions.join(' · ') }))

module.exports = { exampleUses, additionalFormats }
