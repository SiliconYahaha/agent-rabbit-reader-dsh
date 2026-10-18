'use strict'

const types = require('../file-reader/shared/file-types')

// Purpose first; each action still opens the bundled file in its real format.
const exampleUses = {
  meeting: { icon: '〈〉', tone: 'web', usage: '网页报告与互动工具', detail: '点按钮，看看网页如何回应', extensions: [...types.HTML_EXTENSIONS], limit: '复杂网页、外部资源及浏览器专有功能可能无法运行。' },
  koi: { icon: '◉', tone: 'web', usage: '画布动画与音乐互动', detail: '点水面添鱼，拖唱针听雨', extensions: [...types.HTML_EXTENSIONS], limit: '声音需点击后播放；流畅度因设备而异。' },
  tank: { icon: '✥', tone: 'web', usage: '互动游戏与复杂页面', detail: '地图、动画、计分和触屏操控', extensions: [...types.HTML_EXTENSIONS], limit: '本例已做模拟器交互验证；性能因设备而异，不代表所有网页游戏都能运行。' },
  clock: { icon: '◇', tone: 'web', usage: '矢量图与动画', detail: '真实时钟，18 点切换下班动画', extensions: [...types.SVG_EXTENSIONS], limit: '按本机时间播放；暂停后继续会重新对时，不提供后台提醒。' },
  bicycle: { icon: '✦', tone: 'web', usage: '插画也能动起来', detail: '看秦始皇骑车，试试暂停', extensions: [...types.SVG_EXTENSIONS], limit: '外部资源、脚本及部分动画效果不支持。' },
  final: { icon: '◈', tone: 'design', usage: '查看品牌 Logo', detail: '收到 Ai 源稿，先看标志长什么样', extensions: ['ai', 'ait', 'eps'], limit: '支持 PDF 兼容画板、部分旧式矢量或内嵌预览；不能编辑。' },
  change: { icon: '▧', tone: 'design', usage: '预览 Photoshop 设计稿', detail: '插画、海报、修图稿，先看完整画面', extensions: ['psd', 'psb', 'psdt'], limit: '不提供图层编辑；复杂效果、色彩与超大画布可能受限。' },
  secret: { icon: '▣', tone: 'archive', usage: '查看压缩包', detail: '先看目录，再点开里面的文件', extensions: ['zip'], limit: '密码、分卷、压缩方式及文件大小有兼容限制。' },
  markdown: { icon: '≡', tone: 'text', usage: '阅读笔记与攻略', detail: '清单、代码、宽表格都能看', extensions: ['md', 'markdown'], limit: '不完整还原所有公式与图表语法。' }
}

// Format categories are independent of the demo's story and filename.
const primaryFormats = [
  { label: 'HTML', title: '网页', iconLabel: 'HTML', extensions: [...types.HTML_EXTENSIONS], usage: '可阅读页面并运行已适配的交互；外部资源、浏览器专有功能及复杂网页可能受限。' },
  { label: 'SVG', title: '矢量图', iconLabel: 'SVG', extensions: [...types.SVG_EXTENSIONS], usage: '查看矢量图与已支持的动画；部分滤镜、外部资源和脚本可能无法还原。' },
  { label: 'Ai / EPS', title: '专业设计文件', iconLabel: 'Ai', extensions: ['ai', 'ait', 'eps'], badge: '兼容预览', usage: '可看 PDF 兼容画板、部分旧式矢量或内嵌预览；适用于标志、插画和印刷设计稿，不提供编辑。' },
  { label: 'PSD', title: '图层设计稿', iconLabel: 'PSD', extensions: ['psd', 'psb', 'psdt'], badge: '画面预览', usage: '查看合成画面或内嵌缩略图，不编辑图层；复杂效果、色彩与超大画布可能受限。' },
  { label: 'ZIP', title: '压缩包', iconLabel: 'ZIP', extensions: ['zip'], usage: '浏览目录并打开支持的文件；密码、分卷、压缩方式及大小有兼容限制。' },
  { label: 'Markdown', title: '排版文档', iconLabel: 'MD', extensions: ['md', 'markdown'], usage: '支持标题、清单、代码与表格；部分公式与图表语法不能完整还原。' }
]

// These are capability descriptions, not buttons pretending to have sample files.
const additionalFormats = [
  { title: 'Figma 与 Sketch 设计稿', icon: '▧', extensions: ['fig', 'sketch'], usage: '查看源文件保存的缩略图或最后编辑页预览，不是全部画板；无预览时请导出 SVG、PNG 或 PDF。' },
  { title: '设计软件导出的成品', icon: '◇', extensions: ['svg', 'png', 'jpg', 'pdf'], usage: 'Figma、Sketch、Adobe 导出的图形、图片和 PDF 可走现有预览；不等于支持所有软件源工程。' },
  { title: '飞书多维表格', extensions: ['base'], usage: '本机展开表格快照，显示记录、字段及选项；附件仅显示名称，不恢复在线协作或复杂视图。' },
  { title: '数据文件', extensions: ['json', 'csv'], usage: 'JSON 缩进阅读，CSV 表格查看；可切换原文。格式无效或排版超限时显示完整原文。' },
  { title: '源码、配置与日志', extensions: [...types.SOURCE_TEXT_EXTENSIONS].filter(extension => !['base', 'json', 'csv'].includes(extension)), usage: '只读查看原文，不运行代码、公式或外部实体。文本文件上限 5 MB。' },
  { title: '其他压缩包', extensions: ['rar', '7z', 'tar'], usage: '浏览目录，打开支持的成员；TAR 仅指未压缩包。密码、分卷和大小有限制。' },
  { title: '工程图与模型', extensions: ['dxf', 'stp', 'step'], usage: '查看已支持的二维图元或旋转三维模型，复杂实体和装配可能不完整。' },
  { title: 'CorelDRAW 设计稿', extensions: ['cdr'], usage: '查看部分旧式矢量、文档包内容或内嵌预览，不提供完整编辑能力。' },
  { title: '文本与富文本', extensions: ['txt', 'rtf'], usage: '阅读文字；RTF 提取正文与段落，不完整还原复杂版式。' },
  { title: 'PDF 文档', extensions: ['pdf'], usage: '在当前页面阅读、翻页、放大和输入密码。' },
  { title: '办公文档', extensions: [...types.NATIVE_DOCUMENT_EXTENSIONS].filter(extension => extension !== 'pdf'), usage: '在当前页阅读 Word 正文、Excel 工作表和演示文稿内容；复杂版式会简化，不执行宏。' },
  { title: '常见图片', extensions: [...types.IMAGE_EXTENSIONS], usage: '在当前页查看和放大图片，直接切换下一份。' },
  { title: '音频', extensions: [...types.AUDIO_EXTENSIONS], usage: '当前设备与编码支持时可播放；Android 和 iOS 的兼容范围不同。' },
  { title: '视频与播放列表', extensions: [...types.VIDEO_EXTENSIONS], usage: '当前设备与编码支持时可播放；单独的 M3U8 只显示资源引用。' }
].map(group => ({ ...group, extensionText: group.extensions.join(' · ') }))

module.exports = { exampleUses, primaryFormats, additionalFormats }
