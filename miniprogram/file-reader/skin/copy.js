'use strict'

// file-reader 皮肤 · 文案。宿主自有文件：模块同步不覆盖本目录。
// 引擎只给"事实"（文件种类、扩展名、数量、状态码），怎么称呼、怎么措辞由宿主决定。
// 每个函数都拿到引擎给的默认文案（defaults），宿主可以整体替换，也可以只改其中一项。

// 加载态：key 是引擎里的阶段名，params 是可用于插值的事实
const LOADING = {
  open: () => ({ label: '打开中…', detail: '' }),
  read: () => ({ label: '读取中…', detail: '' }),
  'family:document': () => ({ label: '文档加载中…', detail: '首次打开需稍候' }),
  'family:archive': () => ({ label: '压缩包加载中…', detail: '首次打开需稍候' }),
  'family:image': () => ({ label: '图片加载中…', detail: '首次打开需稍候' }),
  markdown: () => ({ label: 'Markdown 加载中…', detail: '首次打开需稍候' }),
  'html-parse': () => ({ label: '网页解析中…', detail: '' }),
  'html-run': () => ({ label: '网页准备中…', detail: '' }),
  'html-images': () => ({ label: '图片准备中…', detail: '' }),
  'html-chunks': () => ({ label: '网页排版中…', detail: '' }),
  volumes: params => ({ label: '分卷读取中…', detail: `${params.count} 个文件，本机合并` }),
  'volumes-merge': params => ({ label: '分卷合并中…', detail: params.name || '' }),
  'zip-verify': () => ({ label: '压缩包校验中…', detail: '尝试恢复目录，不改原文件' }),
  'zip-engine': () => ({ label: '解压准备中…', detail: '正在适配压缩方式' }),
  'rar-encoding': () => ({ label: '文件名调整中…', detail: '' }),
  sevenzip: () => ({ label: '解压准备中…', detail: '' }),
  unlock: () => ({ label: '解锁中…', detail: '' }),
  extract: params => ({ label: '文件解压中…', detail: params.name || '' })
}

function loading (key, params = {}, defaults = {}) {
  const builder = LOADING[key]
  const built = builder ? builder(params) : null
  return { label: (built && built.label) || defaults.label || '打开中…', detail: built && built.detail != null ? built.detail : defaults.detail || '' }
}

// 文件检查卡（压缩包、CAD、大文件等）的抬头。facts.kind 取值见引擎 presentInspection：
// 'zip' | 'rar' | '7z' | 'volume' | 'volume-incomplete' | 'large' | 'dwg' | 'dxf' | 'step' | 'cdr' | 'binary' | 'encrypted-zip' | 'encrypted-rar' | 'encrypted-volume'
function inspector (facts, defaults = {}) {
  return {
    kicker: '文件信息',
    title: defaults.title || facts.name || '文件信息',
    summary: defaults.summary || '',
    note: '本机处理 · 原文件不上传'
  }
}

// 音视频抬头
function media (facts, defaults = {}) {
  return {
    kicker: facts.mode === 'audio' ? '音频' : '视频',
    name: facts.name || '',
    note: '本机播放 · 原文件不上传',
    unavailable: '暂不能播放，原因见上方说明。'
  }
}

// Ai / PSD 预览抬头
function design (facts, defaults = {}) {
  return {
    mark: facts.extension === 'ai' ? 'Ai' : facts.extension ? facts.extension.toUpperCase() : 'FILE',
    name: facts.name || '',
    size: defaults.size || '',
    loading: '预览加载中…',
    metadataTitle: '文件信息',
    openPdf: '查看内嵌 PDF'
  }
}

// 其余所有用户可见文案（错误、状态、诊断、元数据标签、抬头）：引擎写
//   skinCopy.message('<code>', { 参数 }, '<默认文案>')
// code 由「文件.方法.类别.默认文案哈希」组成，全表见 ../MESSAGES.md；文案一改 code 就变，覆盖要跟着复核。
// 默认皮肤原样返回默认文案；宿主按 code 覆盖，可用 params 里的 name / detail / count 重新措辞。
const MESSAGES = {
  'design.loadAi.message.f0f1e9': '未能还原矢量，当前显示内嵌位图；可能分辨率较低，不代表完整内容。',
  'design.loadAi.message.4cb97a': '无内嵌 PDF，文件超过 {size} 解析上限。请在 Illustrator 中开启 PDF 兼容后重存。',
  'design.loadAi.message.26eb63': '已显示基础矢量{value}；渐变、蒙版、字体、链接图片和专有效果可能缺失。',
  'design.loadAi.message.8825e5': '无内嵌 PDF 或可用预览。请开启 Illustrator 的 PDF 兼容后重存。矢量：{detail}；位图：{detail2}。',
  'design.loadPsd.message.af05ff': '合成图读取失败：{detail}。现显示内嵌缩略图，分辨率或透明度可能不完整；原文件图层不变。',
  'inspector.inspectDwg.summary.edeac1': '暂不支持 DWG 图纸，仅显示版本和已有缩略图。查看图纸请先在 CAD 软件中另存为 DXF。',
  'reader.dispatchSelectedFile.error.5acbff': 'HTML 超过 20 MB，请精简或拆分后打开。',
  'reader.inspectArchiveVolumeSet.summary.e86c40': '缺少分卷：{value}。请一次选齐同组文件。',
  'reader.inspectLocalFile.summary.01ef2b': '文件超过 80 MB，为避免内存不足，本次仅显示文件信息。原文件不上传。',
  'reader.openSelectedFile.error.986623': '这是网络链接，请先把文件下载到微信聊天。',
  'reader.readRtfFile.error.907040': 'RTF 超过 5 MB，暂不能排版，请精简后重试。',
  'reader.readTextFile.error.d399e5': '文本超过 5 MB，暂不能排版，请精简后重试。',
  'reader.readSvgFile.error.9483d4': 'SVG 超过 20 MB，暂不能预览，请精简后重试。',
  'reader.startLoadingWatchdog.loading.5a9a79': '文件较复杂，请稍候…',
  'reader.startLoadingWatchdog.error.797798': '处理超时，请返回重试；仍失败可联系开发者。',
  'reader.file.media.a4c218': '准备播放…',
  'reader.resetReaderView.media.a4c218': '准备播放…',
  'reader.toggleAudio.media.4a1380': '准备播放…',
  'reader.openMediaFile.media.1f8a88': '可以播放',
  'reader.onVideoLoadedMetadata.media.0aa8fd': '可以播放',
  'reader.onVideoPlay.media.c3ab3b': '播放中',
  'reader.onVideoEnded.media.56cde1': '播放结束',
  'reader.onVideoWaiting.media.3498c2': '缓冲中…',
  'reader.openMediaFile.media.be6da4': '缓冲中…',
  'reader.openMediaFile.media.81ff6d': '跳转中…',
  'reader.openMediaFile.media.3bb669': '已跳转'
}

function message (code, params = {}, fallback = '') {
  const override = MESSAGES[code]
  if (typeof override === 'function') return override(params, fallback)
  if (typeof override === 'string') return override.replace(/\{(\w+)\}/g, (match, key) => (params[key] != null ? String(params[key]) : match))
  return fallback
}

module.exports = { MESSAGES, design, inspector, loading, media, message }
