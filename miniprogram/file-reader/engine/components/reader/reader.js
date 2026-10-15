'use strict'

const { extensionOf } = require('../../core/design-file')
const families = require('../../core/families')
// 宿主皮肤：文案与卡片外观。skin/ 属于宿主，模块同步不覆盖；这里只拿文案。
const skinCopy = require('../../../skin/copy')
const { atobSafe, bytesToBase64, payloadBytes, utf8Decode, utf8Encode } = require('../../core/text-codec')
// 文档族 / 压缩包族在分包里，按需加载后才能同步调用；入口方法先 ensureFamilies 再进入这些路径。
function documentFamily () {
  const api = families.get('document')
  if (!api) throw new Error('文档排版组件尚未加载')
  return api
}
function archiveFamily () {
  const api = families.get('archive')
  if (!api) throw new Error('压缩包组件尚未加载')
  return api
}
// 打开某种文件前必须就位的族：HTML/文本/RTF/SVG 走文档排版链；压缩包成员也可能是网页，所以两族都要
const FAMILIES_BY_KIND = {
  html: ['document'],
  text: ['document'],
  rtf: ['document'],
  svg: ['document'],
  archive: ['archive', 'document']
}
const FAMILY_LABELS = { document: '文档排版', archive: '压缩包', image: '图片' }
const { collectArchiveVolumeSet } = require('../../../shared/archive-volumes')
const { fileKind, htmlContentType, isMarkdownFile, mimeTypeOf, textDataFormat } = require('../../../shared/file-types')
const {
  buildArchiveTree,
  extractArchiveEntry,
  extractZipEntryPayload,
  inspectFileBytes,
  inspectZipCentral,
  MAX_ZIP_RECOVERY_BYTES,
  recoverZipDirectory,
  readZip64DirectoryDescriptor,
  readZipDirectoryDescriptor,
  rtfToHtml,
  zipLocalHeaderLength,
  zipEntryDataOffset
} = require('../../core/file-inspector')
const { decodeText } = require('../../core/text-decoder')
const { inspectMediaHeader, mediaPlatformCompatibility } = require('../../core/media-inspector')

const MAX_FILE_SIZE = 20 * 1024 * 1024
// Inline documents have no filesystem stat. Count their UTF-8 bytes without
// allocating an encoded copy; UTF-16 length alone undercounts CJK and emoji.
function htmlSourceExceedsLimit (source) {
  if (source.length > MAX_FILE_SIZE) return true
  let bytes = 0
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length &&
      source.charCodeAt(index + 1) >= 0xdc00 && source.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index++
    } else bytes += 3
    if (bytes > MAX_FILE_SIZE) return true
  }
  return false
}
const MAX_GENERAL_FILE_SIZE = 200 * 1024 * 1024
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024
const MAX_SVG_FILE_SIZE = 20 * 1024 * 1024
const MAX_SVG_DATA_URI_BYTES = 600 * 1024
const MAX_INSPECTOR_FILE_SIZE = 80 * 1024 * 1024
const MAX_ZIP_CENTRAL_DIRECTORY_SIZE = 32 * 1024 * 1024
const ZIP_TAIL_SIZE = 0xffff + 22 + 20
const SMIL_SUPPORT_STORAGE_KEY = 'html-reader:svg-smil-support'
// 与 image 分包 svg-animation.looksAnimated 同一判据：内核只看文本决定要不要请 <svg-view>（Canvas 播放）。
const ANIMATED_SVG_PATTERN = /<(?:animate|animateTransform|animateMotion|set)\b|@(?:-webkit-)?keyframes\b|\banimation(?:-name)?\s*:/i
// setData 一次带上整份 SVG 文本给 <svg-view>；超过这个大小仍走静态 <image>
const MAX_ANIMATED_SVG_BYTES = 512 * 1024
// 单次 setData 仍按 160 KB 分片；这里限制的是整页常驻视图数据，而不是
// 一次通信体积。2 MB 可覆盖常见 AI 生成长页，同时避免异常文档耗尽内存。
const MAX_DOM_PAYLOAD_BYTES = 2 * 1024 * 1024
const PROGRESSIVE_DOM_THRESHOLD_BYTES = 220 * 1024
const FIXED_CANVAS_SIDE_INSET = 0
// Markdown 扩展元素的排版兜底；颜色跟随正文，避免覆盖深色主题。
const MARKDOWN_STYLE = '<style>' +
  '.md-formula{font-family:"Times New Roman",Georgia,serif;white-space:pre-wrap}' +
  '.md-formula-display{display:block;text-align:center;margin:8px 0}' +
  '.md-formula-block{margin:14px 0;padding:12px 14px;border-radius:10px;background:#f7f7f4;overflow:auto}' +
  '.md-formula-block .md-formula{margin:0;font-size:16px;line-height:1.7}' +
  '.md-code{padding:14px;border-radius:10px;background:#111827;color:#e5e7eb;overflow:auto;white-space:pre-wrap;word-break:break-word}' +
  '.md-diff-add{display:block;background:rgba(74,222,128,.22)}.md-diff-del{display:block;background:rgba(248,113,113,.22)}.md-diff-text{display:block}' +
  '.md-mermaid{margin:16px 0;text-align:center}.md-mermaid-image{max-width:100%;height:auto}' +
  '.md-diagram-placeholder{margin:14px 0;padding:12px 14px;border:1px dashed #9b9588;border-radius:10px;background:#f7f3ec}' +
  '.md-diagram-label{display:block;margin-bottom:6px;font-weight:700}.md-diagram-source{margin:0;white-space:pre-wrap;font-size:12px;color:#504d46}' +
  '.md-deflist dt{font-weight:700;margin-top:8px}.md-deflist dd{margin:2px 0 6px 1.2em}' +
  '.md-footnotes{margin-top:24px;padding-top:12px;border-top:1px solid #d9e0ea;font-size:14px;color:#4b5563}' +
  '.md-footnote-list{padding-left:0;list-style:none}.md-footnote{margin:4px 0}.md-footnote-num{margin-right:6px}' +
  '.md-footnote-ref a{text-decoration:none}' +
  'mark{background:#fde68a;padding:0 2px}' +
  '</style>'

const DOCUMENT_TYPE_BY_MIME = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
}

function escapeForHtml (value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 网页文件的元信息：<meta name="…" content="…"> 与 <title>，以 meta 事件交给宿主
//（AGI Bar 的 HTML 导出用 agi_bar_version / wx_miniapp_path 做站内深链）。组件本身不解释。
function extractHtmlDocumentMeta (html) {
  const meta = {}
  const head = String(html || '').slice(0, 64 * 1024)
  const attribute = (tag, name) => {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
    return match ? (match[1] || match[2] || match[3] || '').trim() : ''
  }
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = attribute(tag, 'name').toLowerCase()
    if (name && !(name in meta)) meta[name] = attribute(tag, 'content')
  }
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (title && !meta.title) meta.title = title[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return meta
}

function isDevelopmentBuild () {
  if (typeof wx.getAccountInfoSync !== 'function') return false
  try {
    const account = wx.getAccountInfoSync()
    return account && account.miniProgram && account.miniProgram.envVersion === 'develop'
  } catch (_) { return false }
}

// 兄弟分包按需加载（路径相对 engine/core/subpackage-loader.js）。7z 封装在引擎分包内，
// 只有内核与 Markdown 渲染器在各自分包里；测试桩通过 _internals.subpackage 替换 load。
const subpackage = require('../../core/subpackage-loader')

function loadSevenZipRuntime () {
  return families.load('archive').then(api => api.sevenzip)
}

function loadMarkdownRuntime () {
  return subpackage.load('../../markdown/runtime/index.js', ' Markdown ')
}

// 文件检查卡与音视频抬头、加载态的文案来自宿主皮肤；引擎给事实与默认值，皮肤决定措辞
function inspectorCopyFields (kind, facts, defaults) {
  const copy = skinCopy.inspector({ kind, ...facts }, defaults) || {}
  return { inspectorKicker: copy.kicker || '', inspectorTitle: copy.title != null ? copy.title : defaults.title || '', inspectorSummary: copy.summary != null ? copy.summary : defaults.summary || '', inspectorNote: copy.note || '' }
}
function mediaCopyFields (mode, name) {
  const copy = skinCopy.media({ mode, name }) || {}
  return { mediaKicker: copy.kicker || (mode === 'audio' ? '音频' : '视频'), mediaNote: copy.note || '', mediaUnavailable: copy.unavailable || '' }
}
function loadingCopy (key, params = {}, defaults = {}) {
  const copy = skinCopy.loading(key, params, defaults) || {}
  return { loadingLabel: copy.label != null ? copy.label : defaults.label || '', loadingDetail: copy.detail != null ? copy.detail : defaults.detail || '' }
}

function isArchivePasswordError (error) {
  if (error && typeof error.archiveFailure === 'string') {
    return error.archiveFailure === 'password-required' || error.archiveFailure === 'password-or-corrupt'
  }
  const message = String(error && (error.reason || error.errMsg || error.message) || error || '')
  return /password|ERAR_MISSING_PASSWORD|ERAR_BAD_PASSWORD|密码|口令/i.test(message)
}

// 从渲染出的正文包裹样式里取 background/background-color；透明或没有时返回空串。
function documentBackgroundColor (style) {
  let value = ''
  for (const declaration of String(style || '').split(';')) {
    const match = declaration.match(/^\s*background(?:-color)?\s*:\s*(.+?)\s*$/i)
    if (!match) continue
    const color = match[1].match(/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+\b)/i)
    if (!color) continue
    const token = color[1]
    if (/^(?:transparent|none|inherit|initial|unset|url|linear|radial)$/i.test(token)) continue
    const alpha = token.match(/^rgba?\([^)]*,\s*(0?\.\d+|0)\s*\)$/i)
    if (alpha && Number(alpha[1]) < 0.05) continue
    value = token
  }
  return value
}

function currentColorScheme () {
  try {
    const info = typeof wx.getAppBaseInfo === 'function'
      ? wx.getAppBaseInfo()
      : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null
    return info && String(info.theme).toLowerCase() === 'dark' ? 'dark' : 'light'
  } catch (_) { return 'light' }
}

function diffDomValue (previous, next, path, patch, limit = 64) {
  if (patch.__overflow) return
  if (previous === next) return
  if (path.endsWith('.textFragments') && Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length === next.length && previous.every((fragment, index) => fragment.index === next[index].index && fragment.text === next[index].text)) return
    patch[path] = next
    if (Object.keys(patch).length > limit) patch.__overflow = true
    return
  }
  if (next === undefined) {
    // 微信 setData 会忽略 undefined；用 null 才能真正清掉已经上屏的旧字段。
    patch[path] = null
    if (Object.keys(patch).length > limit) patch.__overflow = true
    return
  }
  if (previous == null || next == null || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) {
    patch[path] = next
  } else if (Array.isArray(next)) {
    if (previous.length !== next.length) patch[path] = next
    else for (let index = 0; index < next.length; index++) diffDomValue(previous[index], next[index], `${path}[${index}]`, patch, limit)
  } else {
    const keys = new Set(Object.keys(previous).concat(Object.keys(next)))
    for (const key of keys) diffDomValue(previous[key], next[key], `${path}.${key}`, patch, limit)
  }
  if (Object.keys(patch).length > limit) patch.__overflow = true
}

function domTreePatch (previous, next) {
  const patch = {}
  diffDomValue(previous || [], next || [], 'domTree', patch)
  if (patch.__overflow) return { domTree: next }
  delete patch.__overflow
  return patch
}

const ARCHIVE_ENTRY_PAGE_SIZE = 500

function archiveEntriesForView (entries) {
  return (entries || []).slice(0, ARCHIVE_ENTRY_PAGE_SIZE).map(({ zipRawName, nativeName, nativeDuplicateIndex, nativeDuplicateCount, zipCentralIndex, zipHidden, ...entry }) => entry)
}

function archiveEntryPage (entries, requestedPage = 0) {
  const source = entries || []
  const total = source.length
  const pages = total ? Math.ceil(total / ARCHIVE_ENTRY_PAGE_SIZE) : 0
  const page = pages ? Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0)) : 0
  const start = page * ARCHIVE_ENTRY_PAGE_SIZE
  const rawEntries = source.slice(start, start + ARCHIVE_ENTRY_PAGE_SIZE)
  return {
    rawEntries,
    entries: archiveEntriesForView(rawEntries),
    total,
    pages,
    page,
    hasPrevious: page > 0,
    hasNext: page + 1 < pages
  }
}

Component({
  options: {
    // 宿主页面（app.wxss / 页面 wxss）的样式可以进入阅读器，阅读器自身样式不外泄。
    styleIsolation: 'apply-shared'
  },

  properties: {
    // 要打开的文件：{ name, path, size, type, inlineHtml }。每次设置都会重新打开。
    file: { type: Object, value: null },
    // 同一批选中的其他文件，用于识别分卷压缩包；宿主可不传。
    siblings: { type: Array, value: [] }
  },

  observers: {
    file (file) {
      // 空路径也要交给 open()，由阅读器给出明确错误，而不是静默不动。
      if (file && typeof file === 'object') this.open(file)
    }
  },

  lifetimes: {
    attached () { this.restoreSmilSupport() },
    detached () { this.dispose() }
  },

  pageLifetimes: {
    show () { if (this._htmlRuntime) this._htmlRuntime.setVisible(true) },
    hide () { this._domActiveTouches = null; this._lastDomTouchKey = ''; if (this._htmlRuntime) this._htmlRuntime.setVisible(false) }
  },

  data: {
    hasContent: false,
    designMode: false,
    designFile: null,
    renderedHtml: '',
    domMode: false,
    domTree: [],
    domStyles: [''],
    domWrapperStyle: '',
    domFrameStyle: '',
    domClipStyle: '',
    sourceName: '',
    report: null,
    notes: [],
    error: '',
    htmlPresentationRetry: false,
    fileLoadRetry: false,
    nativeStatus: '',
    standaloneSvgPath: '',
    standaloneSvgSource: '',
    standaloneSvgAnimatedSource: '',
    standaloneSvgAnimationNotice: '',
    standaloneSvgAnimationCanRetry: false,
    mediaMode: '',
    mediaSessions: [],
    mediaKicker: '',
    mediaNote: '',
    mediaUnavailable: '',
    mediaPath: '',
    mediaType: '',
    mediaName: '',
    mediaSizeLabel: '',
    mediaPlaying: false,
    mediaCurrent: 0,
    mediaDuration: 0,
    mediaCurrentLabel: '0:00',
    mediaDurationLabel: '0:00',
    mediaFormatLabel: '正在识别容器…',
    mediaCodecLabel: '',
    mediaDiagnostic: skinCopy.message('reader.file.media.a4c218', {}, '等待播放器读取媒体轨道…'),
    mediaCompatibility: '',
    mediaDetails: [],
    mediaCanPlay: true,
    inspectorMode: false,
    inspectorKicker: '',
    inspectorTitle: '',
    inspectorSummary: '',
    inspectorNote: '',
    inspectorLinkFolder: '',
    inspectorMetadata: [],
    inspectorEntries: [],
    inspectorEntryCount: 0,
    inspectorEntryPage: 0,
    inspectorEntryPages: 0,
    inspectorHasPreviousPage: false,
    inspectorHasNextPage: false,
    inspectorPreviewSource: '',
    inspectorPreviewPath: '',
    inspectorModelMode: '',
    inspectorModelReady: false,
    inspectorModelStatus: '',
    inspectorModelView: 'isometric',
    inspectorModelRevision: 0,
    inspectorNeedsPassword: false,
    inspectorPasswordStatus: '',
    inspectorNameEncoding: '',
    inspectorNameEncodingOptions: [],
    isLoading: false,
    loadingLabel: '',
    loadingDetail: '',
    queueCount: 0,
    queuePosition: 0,
    hasPreviousFile: false,
    hasNextFile: false,
    tagStyle: {
      body: 'box-sizing:border-box;width:100%;max-width:100%;margin:0;overflow:hidden',
      // 标题只提供排版兜底，颜色必须继承原网页，避免覆盖深色区块中的浅色标题。
      h1: 'font-size:30px;line-height:1.25;margin:24px 0 14px',
      h2: 'font-size:24px;line-height:1.3;margin:24px 0 12px',
      h3: 'font-size:20px;line-height:1.35;margin:20px 0 10px',
      p: 'margin:10px 0',
      a: 'color:#c9432b;text-decoration:underline',
      blockquote: 'margin:16px 0;padding:10px 14px;border-left:4px solid #e85d3f;background:#fff3e8',
      pre: 'padding:14px;border-radius:10px;background:#111827;color:#e5e7eb;overflow:auto;white-space:pre-wrap',
      code: 'font-family:monospace;background:#f1f5f9;padding:2px 4px;border-radius:4px',
      table: 'width:100%;border-collapse:collapse;margin:14px 0',
      th: 'padding:9px;border:1px solid #d9e0ea;background:#f8fafc;font-weight:bold',
      td: 'padding:9px;border:1px solid #d9e0ea',
      img: 'max-width:100%;height:auto',
      li: 'margin:5px 0',
      figure: 'margin:16px 0',
      figcaption: 'color:#667085;font-size:14px;text-align:center'
    }
  },

  methods: {
    // 宿主可以直接调用 open(file, siblings)，也可以通过 file/siblings 属性驱动。
    open (file, siblings) {
      if (Array.isArray(siblings)) this.setData({ siblings })
      this.openSelectedFile(file)
    },

    emit (name, detail) {
      if (typeof this.triggerEvent === 'function') this.triggerEvent(name, detail || {})
    },

    restoreSmilSupport () {
      if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return
      try {
        const cached = wx.getStorageSync(SMIL_SUPPORT_STORAGE_KEY)
        if (cached === 'supported' || cached === 'unsupported') this._smilSupport = cached
      } catch (_) {}
    },

    dispose () {
      this._fileOpenRevision = (this._fileOpenRevision || 0) + 1
      clearTimeout(this._loadingSlowTimer)
      clearTimeout(this._loadingTimeoutTimer)
      this.disposeMedia()
      this.disposeHtmlRuntime()
      this._inspectorModel = null
      this._stepCanvasState = null
      this._stepTouch = null
    },

    hasSelectorQuery () {
      return typeof this.createSelectorQuery === 'function'
    },

    selectorQuery () {
      return (this.hasSelectorQuery() && this.createSelectorQuery()) || null
    },

    openDesignFile (file, revision = this._fileOpenRevision) {
      if (revision !== this._fileOpenRevision) return
      if (!(file.path || file.tempFilePath)) {
        this.stopLoadingWithError(skinCopy.message('reader.openDesignFile.error.425bb4', {}, '微信没有返回可读取的设计文件路径，请重新选择。'))
        return
      }
      // Ai/PSD 由内嵌的 design-preview 组件在本组件内显示，不再跳转宿主页面。
      this.finishLoading()
      this.setData({
        hasContent: true,
        designMode: true,
        designFile: {
          name: file.name || '设计文件',
          path: file.path || file.tempFilePath || '',
          size: Number(file.size || 0),
          type: file.type || ''
        },
        error: ''
      })
    },

    // 分包族按需加载：已加载则同步执行 run；否则先下载（显示加载态），打开的修订号变了就放弃
    withFamilies (names, revision, run) {
      this._packageLoadError = ''
      const missing = (names || []).filter(name => !families.get(name))
      if (!missing.length) return run()
      const label = missing.map(name => FAMILY_LABELS[name] || name).join('与')
      const familyDefaults = { label: `正在加载${label}组件…`, detail: '首次使用会按需下载分包' }
      this.setData({ isLoading: true, ...(missing.length === 1 ? loadingCopy(`family:${missing[0]}`, {}, familyDefaults) : { loadingLabel: familyDefaults.label, loadingDetail: familyDefaults.detail }), error: '' })
      return families.loadAll(missing).then(() => {
        if (revision != null && revision !== this._fileOpenRevision) return undefined
        return run()
      }).catch(error => {
        if (revision == null || revision === this._fileOpenRevision) {
          this._retryFamilyLoad = () => {
            if (revision != null && revision !== this._fileOpenRevision) return
            this.startLoadingWatchdog(this._fileOpenRevision)
            return this.withFamilies(names, revision, run)
          }
          this.setData({ fileLoadRetry: true })
          // Keep actionable copy on screen; retain the underlying error for diagnostics.
          this._packageLoadError = String(error && (error.errMsg || error.message) || error)
          console.warn('reader package load failed', this._packageLoadError)
          this.stopLoadingWithError(skinCopy.message('reader.withFamilies.error.159ddf', {}, '阅读组件没加载好，请点重试。'))
        }
        return undefined
      })
    },

    openSelectedFile (file) {
      const kind = fileKind(file)
      const volumeSet = kind === 'archive' ? collectArchiveVolumeSet(Array.isArray(this.data.siblings) ? this.data.siblings : [], file) : null
      const revision = (this._fileOpenRevision || 0) + 1
      this._fileOpenRevision = revision
      this.resetReaderView(file.name)
      const filePath = String(file.path || file.tempFilePath || '')
      // WeChat DevTools returns local picker files as http://tmp/... and exposes
      // USER_DATA_PATH as http://usr. These are filesystem namespaces, not network
      // requests. Keep the authority boundary exact; tmp.evil and tmp@evil are URLs.
      const userRoot = wx.env && wx.env.USER_DATA_PATH
      const localHttpPath = filePath.startsWith('http://tmp/') ||
        (typeof userRoot === 'string' && /^http:\/\//.test(userRoot) && filePath.startsWith(userRoot.replace(/\/$/, '') + '/'))
      if (/^https?:\/\//i.test(filePath) && !localHttpPath) {
        this.stopLoadingWithError(skinCopy.message('reader.openSelectedFile.error.986623', {}, '当前收到的是网络链接，不是微信可直接读取的本地文件。请先把文件下载到聊天中再打开。'))
        return
      }
      if (kind === 'unsupported') {
        this.stopLoadingWithError(skinCopy.message('reader.openSelectedFile.error.88db26', {}, '微信没有提供可识别的文件类型。请确认文件扩展名完整后重试。'))
        return
      }
      // HTML/text bounded readers check the real local size; picker metadata
      // may be stale even beyond this general threshold. Other routes retain it.
      const isZip = kind === 'archive' && (extensionOf(file.name) === 'zip' || mimeTypeOf(file) === 'application/zip')
      if (kind !== 'html' && kind !== 'text' && !isZip && Number(file.size || 0) > MAX_GENERAL_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.openSelectedFile.error.a9ad18', {}, '文件超过 200 MB，暂时无法在小程序内预览。'))
        return
      }
      const needed = volumeSet ? FAMILIES_BY_KIND.archive : FAMILIES_BY_KIND[kind] || []
      this.withFamilies(needed, revision, () => this.dispatchSelectedFile(file, kind, volumeSet, revision))
    },

    dispatchSelectedFile (file, kind, volumeSet, revision) {
      if (kind === 'html') {
        if (typeof file.inlineHtml === 'string' && htmlSourceExceedsLimit(file.inlineHtml)) {
          this.stopLoadingWithError(skinCopy.message('reader.dispatchSelectedFile.error.5acbff', {}, 'HTML 文件超过 20 MB。建议先移除无关数据，或分成多个文件后打开。'))
          return
        }
        if (typeof file.inlineHtml === 'string') this.parseContent(file.inlineHtml, file.name, revision, htmlContentType(file))
        else this.readSafeFile(file, revision)
      } else if (kind === 'design') this.openDesignFile(file)
      else if (kind === 'document') this.openNativeDocument(file, revision)
      else if (kind === 'svg') this.readSvgFile(file, revision)
      else if (kind === 'image') this.openImageFile(file, revision)
      else if (kind === 'text') this.readTextFile(file, revision)
      else if (kind === 'rtf') this.readRtfFile(file, revision)
      else if (kind === 'audio' || kind === 'video') this.openMediaFile(file, kind)
      else if (volumeSet) this.inspectArchiveVolumeSet(volumeSet, revision)
      else if (kind === 'archive' || kind === 'cad' || kind === 'binary') this.inspectLocalFile(file, revision)
    },

    resetReaderView (sourceName) {
      this._standaloneSvgAnimatedOriginal = ''
      this._standaloneSvgAnimation = null
      this.disposeMedia()
      this.disposeHtmlRuntime()
      this._inspectorBytes = null
      this._inspectorEntries = null
      this._inspectorVisibleEntries = null
      this._inspectorEntryPage = 0
      this._archiveLinkRoot = null
      this._archiveLinkRootPage = 0
      this._inspectorArchivePath = ''
      this._inspectorArchiveSize = 0
      this._inspectorRarBytes = null
      this._inspectorSevenZipBytes = null
      this._inspectorArchiveVolumes = null
      this._inspectorArchiveVolumeMainName = ''
      this._inspectorArchiveVolumeFormat = ''
      this._inspectorArchiveKind = ''
      this._inspectorZipCentral = null
      this._inspectorZipDescriptor = null
      this._inspectorZipIdentityEntries = null
      this._inspectorZipNativeInspection = null
      this._inspectorZipLegacyEncoding = 'auto'
      this._inspectorRarLegacyEncoding = 'auto'
      this._archivePassword = ''
      this._archivePasswordDraft = ''
      this._archivePasswordRequiredForDirectory = false
      this._archivePasswordVerified = false
      this._inspectorModel = null
      this._stepCanvasState = null
      this._stepTouch = null
      this._stepView = { yaw: -0.72, pitch: 0.48, zoom: 1 }
      this._loadMetrics = { startedAt: Date.now(), sourceName: sourceName || '未命名文件' }
      this._documentBackground = undefined
      this.setData({
        hasContent: false,
        designMode: false,
        designFile: null,
        renderedHtml: '',
        domMode: false,
        domTree: [],
        domStyles: [''],
        domWrapperStyle: '',
        domFrameStyle: '',
        domClipStyle: '',
        sourceName: sourceName || '未命名文件',
        report: null,
        notes: [],
        error: '',
        nativeStatus: '',
        standaloneSvgPath: '',
        standaloneSvgSource: '',
        standaloneSvgAnimatedSource: '',
        standaloneSvgAnimationNotice: '',
        standaloneSvgAnimationCanRetry: false,
        mediaMode: '',
        mediaSessions: [],
    mediaKicker: '',
    mediaNote: '',
    mediaUnavailable: '',
        mediaPath: '',
        mediaType: '',
        mediaName: '',
        mediaSizeLabel: '',
        mediaPlaying: false,
        mediaCurrent: 0,
        mediaDuration: 0,
        mediaCurrentLabel: '0:00',
        mediaDurationLabel: '0:00',
        mediaFormatLabel: '正在识别容器…',
        mediaCodecLabel: '',
        mediaDiagnostic: skinCopy.message('reader.resetReaderView.media.a4c218', {}, '等待播放器读取媒体轨道…'),
        mediaCompatibility: '',
        mediaDetails: [],
        mediaCanPlay: true,
        inspectorMode: false,
        inspectorKicker: '',
        inspectorTitle: '',
        inspectorSummary: '',
        inspectorNote: '',
        inspectorLinkFolder: '',
        inspectorMetadata: [],
        inspectorEntries: [],
        inspectorEntryCount: 0,
        inspectorEntryPage: 0,
        inspectorEntryPages: 0,
        inspectorHasPreviousPage: false,
        inspectorHasNextPage: false,
        inspectorPreviewSource: '',
        inspectorPreviewPath: '',
        inspectorModelMode: '',
        inspectorModelReady: false,
        inspectorModelStatus: '',
        inspectorModelView: 'isometric',
        inspectorModelRevision: 0,
        inspectorNeedsPassword: false,
        inspectorPasswordStatus: '',
        inspectorNameEncoding: '',
        inspectorNameEncodingOptions: [],
        isLoading: true,
        ...loadingCopy('read', {}, { label: '正在读取文件…', detail: '' }),
        loadingDetail: ''
      })
      this.startLoadingWatchdog(this._fileOpenRevision)
    },

    startLoadingWatchdog (revision) {
      clearTimeout(this._loadingSlowTimer)
      clearTimeout(this._loadingTimeoutTimer)
      this._loadingSlowTimer = setTimeout(() => {
        if (revision !== this._fileOpenRevision || !this.data.isLoading) return
        this.setData({ loadingDetail: skinCopy.message('reader.startLoadingWatchdog.loading.5a9a79', {}, '文件内容较多，正在分段排版，请稍候…') })
      }, 3000)
      if (this._loadingSlowTimer && typeof this._loadingSlowTimer.unref === 'function') this._loadingSlowTimer.unref()
      this._loadingTimeoutTimer = setTimeout(() => {
        if (revision !== this._fileOpenRevision || !this.data.isLoading) return
        this.setData({
          isLoading: false,
          error: skinCopy.message('reader.startLoadingWatchdog.error.797798', {}, '这个文件处理时间异常，已停止等待。可以返回后重试；若仍失败，请把原文件发给开发者排查。')
        })
      }, 30000)
      if (this._loadingTimeoutTimer && typeof this._loadingTimeoutTimer.unref === 'function') this._loadingTimeoutTimer.unref()
    },

    finishLoading () {
      clearTimeout(this._loadingSlowTimer)
      clearTimeout(this._loadingTimeoutTimer)
      if (this._loadMetrics) this._loadMetrics.readyAt = Date.now()
      this.setData({ isLoading: false, loadingLabel: '', loadingDetail: '' })
      this.emit('ready', { name: this.data.sourceName })
    },

    stopLoadingWithError (message) {
      clearTimeout(this._loadingSlowTimer)
      clearTimeout(this._loadingTimeoutTimer)
      this.setData({ isLoading: false, loadingLabel: '', loadingDetail: '', error: message })
      this.emit('error', { name: this.data.sourceName, message })
    },

    openNativeDocument (file, revision = this._fileOpenRevision) {
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.openNativeDocument.error.039094', {}, '微信没有返回可读取的文档路径，请重新选择。'))
        return
      }
      const extension = extensionOf(file.name)
      const typeAliases = { docm: 'docx', xlsm: 'xlsx' }
      const mimeType = mimeTypeOf(file)
      this.finishLoading()
      this.setData({ nativeStatus: skinCopy.message('reader.openNativeDocument.status.2cc103', { name: file.name || '文档' }, `${file.name || '文档'} 已交给微信文档查看器打开。返回后可继续查看已选文件。`) })
      this.emit('handoff', { kind: 'document', name: file.name || '' })
      wx.openDocument({
        filePath,
        fileType: typeAliases[extension] || extension || DOCUMENT_TYPE_BY_MIME[mimeType],
        showMenu: true,
        fail: error => {
          if (revision !== this._fileOpenRevision) return
          // 微信官方 openDocument 未列出 docm/xlsm，但聊天素材入口会把它们交给
          // 小程序。先尝试兼容别名，失败后仍可读取其 OOXML ZIP 目录，而非白屏。
          if (extension === 'docm' || extension === 'xlsm') {
            this.setData({ nativeStatus: '' })
            this.inspectLocalFile({ ...file, type: 'application/zip' }, revision)
          } else this.stopLoadingWithError(skinCopy.message('reader.openNativeDocument.error.b24571', { detail: error.errMsg || '未知错误' }, `文档打开失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    openImageFile (file, revision = this._fileOpenRevision) {
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.openImageFile.error.41dd2f', {}, '微信没有返回可读取的图片路径，请重新选择。'))
        return
      }
      this.finishLoading()
      this.setData({ nativeStatus: skinCopy.message('reader.openImageFile.status.cc915a', { name: file.name || '图片' }, `${file.name || '图片'} 已交给微信图片查看器打开。返回后可继续查看已选文件。`) })
      this.emit('handoff', { kind: 'image', name: file.name || '' })
      wx.previewImage({
        current: filePath,
        urls: [filePath],
        fail: error => { if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.openImageFile.error.774cc4', { detail: error.errMsg || '未知错误' }, `图片预览失败：${error.errMsg || '未知错误'}`)) }
      })
    },

    openMediaFile (file, kind) {
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.openMediaFile.error.61bf51', {}, '微信没有返回可播放的本地文件路径，请重新选择。'))
        return
      }
      const size = Number(file.size || 0)
      const sizeLabel = size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
      const platform = (() => {
        try {
          const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {}
          return info.platform || info.system || ''
        } catch (_) { return '' }
      })()
      const compatibility = mediaPlatformCompatibility(file, kind, platform)
      this.setData({
        hasContent: true,
        mediaMode: kind,
        mediaSessions: [{ id: this._mediaGeneration }],
        mediaPath: filePath,
        mediaType: file.type || '',
        mediaName: file.name || (kind === 'audio' ? '音频' : '视频'),
        ...mediaCopyFields(kind, file.name),
        mediaSizeLabel: sizeLabel,
        mediaPlaying: false,
        mediaFormatLabel: '正在识别容器…',
        mediaCodecLabel: '',
        mediaDiagnostic: compatibility.canAttempt ? '等待播放器读取媒体轨道…' : compatibility.message,
        mediaCompatibility: compatibility.message,
        mediaDetails: [],
        mediaCanPlay: compatibility.canAttempt
      })
      this.inspectMediaFileHeader(file, kind)
      if (!compatibility.canAttempt) {
        this.finishLoading()
        return
      }
      if (kind === 'video') {
        this.finishLoading()
        return
      }
      if (typeof wx.createInnerAudioContext !== 'function') {
        this.stopLoadingWithError(skinCopy.message('reader.openMediaFile.error.f536fa', {}, '当前微信版本没有提供音频播放能力，请更新微信后再试。'))
        return
      }
      const audio = wx.createInnerAudioContext()
      this._audioContext = audio
      const revision = this._fileOpenRevision
      const generation = this._mediaGeneration
      const isCurrent = () => this._audioContext === audio &&
        this._fileOpenRevision === revision && this._mediaGeneration === generation
      const on = (name, callback) => {
        if (typeof audio[name] === 'function') audio[name]((...args) => {
          if (isCurrent()) callback(...args)
        })
      }
      audio.autoplay = false
      audio.obeyMuteSwitch = false
      on('onCanplay', () => {
        this.setData({ mediaCanPlay: true, mediaDiagnostic: skinCopy.message('reader.openMediaFile.media.1f8a88', {}, '微信已读取音频轨道，可以播放。') })
        this.finishLoading()
        if (!isCurrent()) return
        clearTimeout(this._audioProgressTimer)
        this._audioProgressTimer = setTimeout(() => { if (isCurrent()) this.syncAudioProgress(audio) }, 120)
      })
      on('onTimeUpdate', () => this.syncAudioProgress(audio))
      on('onWaiting', () => this.setData({ mediaDiagnostic: skinCopy.message('reader.openMediaFile.media.be6da4', {}, '音频正在读取或缓冲本地轨道…') }))
      on('onSeeking', () => this.setData({ mediaDiagnostic: skinCopy.message('reader.openMediaFile.media.81ff6d', {}, '正在定位音频播放位置…') }))
      on('onSeeked', () => this.setData({ mediaDiagnostic: skinCopy.message('reader.openMediaFile.media.3bb669', {}, '已定位到新的播放位置。') }))
      on('onPlay', () => this.setData({ mediaPlaying: true }))
      on('onPause', () => this.setData({ mediaPlaying: false }))
      on('onStop', () => this.setData({ mediaPlaying: false }))
      on('onEnded', () => this.setData({ mediaPlaying: false, mediaCurrent: 0, mediaCurrentLabel: '0:00' }))
      on('onError', error => {
        const message = this.mediaErrorMessage(error, '音频')
        this.setData({ mediaPlaying: false, mediaCanPlay: false, mediaDiagnostic: message, error: skinCopy.message('reader.openMediaFile.error.6c1e8c', { detail: message }, `音频播放失败：${message}`) })
        this.finishLoading()
      })
      // Register before assigning src so an immediate native failure is reported.
      audio.src = filePath
      if (!isCurrent()) return
      // 部分安卓机不会回调 canplay，但设置 src 后已经可以点击播放。
      this._audioLoadingTimer = setTimeout(() => {
        if (isCurrent() && this.data.isLoading) this.finishLoading()
      }, 800)
    },

    inspectMediaFileHeader (file, kind) {
      if (typeof wx.getFileSystemManager !== 'function') return
      const revision = this._fileOpenRevision
      const generation = this._mediaGeneration
      const isCurrent = () => this._fileOpenRevision === revision && this._mediaGeneration === generation
      const filePath = file.path || file.tempFilePath
      const size = Number(file.size || 0)
      if (!filePath || !size) return
      wx.getFileSystemManager().readFile({
        filePath,
        position: 0,
        length: Math.min(size, 256 * 1024),
        success: result => {
          if (!isCurrent()) return
          try {
            const inspection = inspectMediaHeader(result.data, file, kind)
            this.setData({
              mediaFormatLabel: inspection.format,
              mediaCodecLabel: inspection.codecs.length ? inspection.codecs.join(' · ') : '轨道编码待播放器确认',
              mediaDetails: inspection.details || [],
              mediaCanPlay: inspection.playable !== false && this.data.mediaCanPlay,
              mediaDiagnostic: inspection.playable === false
                ? inspection.reason
                : inspection.recognized ? this.data.mediaDiagnostic : '文件头与常见媒体容器不匹配，文件可能损坏或后缀名不正确。'
            })
          } catch (_) {}
        },
        fail: () => { if (isCurrent()) this.setData({ mediaFormatLabel: file.type || extensionOf(file.name).toUpperCase() || '未知容器' }) }
      })
    },

    formatMediaTime (seconds) {
      const value = Math.max(0, Math.floor(Number(seconds) || 0))
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
    },

    syncAudioProgress (audio = this._audioContext) {
      if (!audio || audio !== this._audioContext) return
      const current = Number(audio.currentTime || 0)
      const duration = Number(audio.duration || 0)
      this.setData({
        mediaCurrent: current,
        mediaDuration: duration,
        mediaCurrentLabel: this.formatMediaTime(current),
        mediaDurationLabel: this.formatMediaTime(duration)
      })
    },

    isCurrentMediaEvent (event, kind) {
      const dataset = event && event.currentTarget && event.currentTarget.dataset
      return this.data.mediaMode === kind && dataset &&
        Number(dataset.mediaSession) === this._mediaGeneration
    },

    toggleAudio (event) {
      if (event && !this.isCurrentMediaEvent(event, 'audio')) return
      const audio = this._audioContext
      if (!audio || !this.data.mediaCanPlay) return
      if (this.data.mediaPlaying) audio.pause()
      else {
        this.setData({ error: '', mediaDiagnostic: skinCopy.message('reader.toggleAudio.media.4a1380', {}, '已请求播放，正在等待微信播放器解码…') })
        audio.play()
      }
    },

    seekAudio (event) {
      if (!this.isCurrentMediaEvent(event, 'audio')) return
      const audio = this._audioContext
      if (!audio || !this.data.mediaCanPlay || typeof audio.seek !== 'function') return
      audio.seek(Number(event.detail && event.detail.value || 0))
    },

    onVideoPlay (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      this.setData({ mediaPlaying: true, error: '', mediaDiagnostic: skinCopy.message('reader.onVideoPlay.media.c3ab3b', {}, '视频正在播放。') })
    },

    onVideoPause (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      this.setData({ mediaPlaying: false })
    },

    onVideoLoadedMetadata (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      const duration = Number(event && event.detail && event.detail.duration || 0)
      this.setData({
        mediaDuration: duration,
        mediaDurationLabel: this.formatMediaTime(duration),
        mediaDiagnostic: skinCopy.message('reader.onVideoLoadedMetadata.media.0aa8fd', {}, '微信已读取视频轨道，可以播放。')
      })
    },

    onVideoWaiting (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      this.setData({ mediaDiagnostic: skinCopy.message('reader.onVideoWaiting.media.3498c2', {}, '视频正在读取或缓冲本地轨道…') })
    },

    onVideoEnded (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      this.setData({ mediaPlaying: false, mediaDiagnostic: skinCopy.message('reader.onVideoEnded.media.56cde1', {}, '视频播放完成。') })
    },

    onVideoError (event) {
      if (!this.isCurrentMediaEvent(event, 'video')) return
      const message = this.mediaErrorMessage(event && event.detail || event, '视频')
      this.setData({ mediaPlaying: false, mediaCanPlay: false, error: skinCopy.message('reader.onVideoError.error.3d11b9', { detail: message }, `视频播放失败：${message}`), mediaDiagnostic: message })
    },

    mediaErrorMessage (error, label) {
      const code = Number(error && error.errCode)
      const known = {
        10001: '微信播放器发生系统错误',
        10002: '播放器无法读取资源',
        10003: '文件已失效、损坏或路径不可读',
        10004: '当前设备不支持文件里的封装或编码'
      }
      const detail = known[code] || error && error.errMsg || (Number.isFinite(code) ? `播放器错误 ${code}` : '')
      return `${detail || `当前设备未能解码${label}`}。${this.data.mediaCompatibility || '请核对文件扩展名与实际编码。'}`
    },

    disposeMedia () {
      this._mediaGeneration = (this._mediaGeneration || 0) + 1
      clearTimeout(this._audioLoadingTimer)
      clearTimeout(this._audioProgressTimer)
      const audio = this._audioContext
      this._audioContext = null
      if (audio && typeof audio.destroy === 'function') {
        try { audio.destroy() } catch (_) {}
      }
    },

    readTextFile (file, revision) {
      const fs = wx.getFileSystemManager()
      if (typeof fs.stat !== 'function' && Number(file.size || 0) > MAX_TEXT_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.readTextFile.error.d399e5', {}, '文本文件超过 5 MB，为避免页面卡顿暂时不直接排版。'))
        return
      }
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.readTextFile.error.4edfc3', {}, '微信没有返回可读取的文本路径，请重新选择。'))
        return
      }
      documentFamily().readHtmlFileBytes(fs, {
        filePath,
        // Real WeChat has stat: it determines allocation and catches growth.
        // Legacy hosts without stat retain their previous whole-text callback,
        // bounded on returned bytes, rather than trusting stale picker hints.
        size: typeof fs.stat === 'function' ? file.size : 0,
        maxBytes: MAX_TEXT_FILE_SIZE,
        label: '文本',
        allowTextResult: true,
        isCurrent: () => revision === this._fileOpenRevision,
        success: result => {
          if (revision !== this._fileOpenRevision) return
          try {
            const isMarkdown = isMarkdownFile(file)
            const decoded = documentFamily().decodeTextData(typeof result.decodedText === 'string' ? result.decodedText : result.data, file, isMarkdown ? 'markdown' : 'text')
            if (!isMarkdown) {
              const format = textDataFormat(file)
              const rendered = documentFamily().renderTextData(decoded.text, { format, labels: {
                original: skinCopy.message('reader.readTextFile.label.46145c', {}, '查看原文'),
                formatted: skinCopy.message('reader.readTextFile.label.2ef7ba', {}, '查看排版')
              } })
              const detail = rendered.diagnostic
                ? skinCopy.message('reader.readTextFile.message.d82499', {}, '暂时无法排版，以下显示完整原文。')
                : ''
              this.parseContent((detail ? `<p>${escapeForHtml(detail)}</p>` : '') + rendered.html, file.name, revision)
              return
            }
            const renderMarkdown = () => {
              if (revision !== this._fileOpenRevision) return
              this.setData({ isLoading: true, error: '', ...loadingCopy('markdown', {}, { label: '正在加载 Markdown 排版组件…', detail: '首次使用会按需下载分包' }) })
              return loadMarkdownRuntime().then(runtime => {
                if (revision !== this._fileOpenRevision) return
                const rendered = runtime.renderMarkdownDocument(decoded.text)
                // front-matter 交给宿主（AGI Bar 用它做文档深链横幅），组件本身不解释。
                if (Object.keys(rendered.meta).length) this.emit('meta', { name: file.name || '', meta: rendered.meta })
                this.parseContent(`<article class="markdown-document" style="box-sizing:border-box;padding:20px;line-height:1.75;background:#fff">${MARKDOWN_STYLE}${rendered.html}</article>`, file.name, revision)
              }).catch(error => {
                if (revision !== this._fileOpenRevision) return
                this._retryFamilyLoad = () => {
                  if (revision !== this._fileOpenRevision) return
                  this.startLoadingWatchdog(revision)
                  return renderMarkdown()
                }
                this.setData({ fileLoadRetry: true })
                this.stopLoadingWithError(skinCopy.message('reader.readTextFile.error.adc1d3', { detail: error.errMsg || error.message || error }, `Markdown 排版组件加载失败：${error.errMsg || error.message || error}`))
              })
            }
            renderMarkdown()
          } catch (error) {
            this.stopLoadingWithError(skinCopy.message('reader.readTextFile.error.ca1b85', { detail: error.message || error }, `文本解析失败：${error.message || error}`))
          }
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readTextFile.error.cbac2f', { detail: error.errMsg || '未知错误' }, `文本读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    readRtfFile (file, revision) {
      if (Number(file.size || 0) > MAX_TEXT_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.readRtfFile.error.907040', {}, 'RTF 文件超过 5 MB，为避免页面卡顿暂时不直接排版。'))
        return
      }
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.readRtfFile.error.d80986', {}, '微信没有返回可读取的 RTF 路径，请重新选择。'))
        return
      }
      wx.getFileSystemManager().readFile({
        filePath,
        success: result => {
          if (revision !== this._fileOpenRevision) return
          try {
            const html = rtfToHtml(result.data)
            if (!html) throw new Error('没有提取到可读正文')
            this.parseContent(html, file.name, revision)
          } catch (error) {
            this.stopLoadingWithError(skinCopy.message('reader.readRtfFile.error.0fd2e7', { detail: error.message || error }, `RTF 解析失败：${error.message || error}`))
          }
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readRtfFile.error.b231c1', { detail: error.errMsg || '未知错误' }, `RTF 读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    inspectLocalFile (file, revision) {
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.inspectLocalFile.error.a54c95', {}, '微信没有返回可读取的本地文件路径，请重新选择。'))
        return
      }
      const type = mimeTypeOf(file)
      if (extensionOf(file.name) === 'tar' || ['application/x-tar', 'application/tar', 'application/x-gtar'].includes(type)) {
        this.inspectSevenZipFile(file, revision, 'tar')
        return
      }
      if (extensionOf(file.name) === 'zip' || type === 'application/zip') {
        this.inspectZipFile(file, revision)
        return
      }
      if (extensionOf(file.name) === 'rar' || type === 'application/vnd.rar') {
        this.inspectRarFile(file, revision)
        return
      }
      if (extensionOf(file.name) === '7z' || type === 'application/x-7z-compressed') {
        this.inspectSevenZipFile(file, revision)
        return
      }
      if (Number(file.size || 0) > MAX_INSPECTOR_FILE_SIZE) {
        this.finishLoading()
        this.setData({
          hasContent: true,
          inspectorMode: true,
          ...inspectorCopyFields('large', { name: file.name, extension: extensionOf(file.name) }, { title: skinCopy.message('reader.inspectLocalFile.title.78acb5', {}, '大型文件信息'), summary: skinCopy.message('reader.inspectLocalFile.summary.01ef2b', {}, '文件已成功接收，但超过 80 MB。为避免微信内存不足，本次不展开内部目录或工程实体。原文件不会上传。') }),
          inspectorMetadata: [
            { label: skinCopy.message('reader.inspectLocalFile.label.49deaf', {}, '文件'), value: file.name || '未命名文件' },
            { label: skinCopy.message('reader.inspectLocalFile.label.e4e46c', {}, '类型'), value: file.type || extensionOf(file.name) || '未知' },
            { label: skinCopy.message('reader.inspectLocalFile.label.fd2070', {}, '大小'), value: `${(Number(file.size || 0) / 1024 / 1024).toFixed(1)} MB` }
          ],
          inspectorEntries: []
        })
        return
      }
      wx.getFileSystemManager().readFile({
        filePath,
        success: result => {
          if (revision !== this._fileOpenRevision) return
          try {
            const inspection = inspectFileBytes(result.data, file)
            this._inspectorBytes = inspection.archiveType ? result.data : null
            this._inspectorArchivePath = ''
            this.presentInspection(inspection, revision)
          } catch (error) {
            this.stopLoadingWithError(skinCopy.message('reader.inspectLocalFile.error.242ee2', { detail: error.message || error }, `文件检查失败：${error.message || error}`))
          }
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.inspectLocalFile.error.99d68f', { detail: error.errMsg || '未知错误' }, `文件读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    async inspectArchiveVolumeSet (volumeSet, revision) {
      if (volumeSet.missingNames.length) {
        this.finishLoading()
        this.setData({
          hasContent: true,
          inspectorMode: true,
          ...inspectorCopyFields('volume-incomplete', { name: volumeSet.mainName, extension: extensionOf(volumeSet.mainName), missing: volumeSet.missingNames }, { title: skinCopy.message('reader.inspectArchiveVolumeSet.title.b91e70', {}, '分卷压缩包不完整'), summary: skinCopy.message('reader.inspectArchiveVolumeSet.summary.e86c40', { value: volumeSet.missingNames.join('、') }, `已识别同组分卷，但缺少：${volumeSet.missingNames.join('、')}。请一次选择这一组的全部分卷后重试。`) }),
          inspectorMetadata: [
            { label: skinCopy.message('reader.inspectArchiveVolumeSet.label.743aaf', {}, '已选择'), value: `${volumeSet.files.length} 个分卷` },
            { label: skinCopy.message('reader.inspectArchiveVolumeSet.label.568323', {}, '缺少'), value: volumeSet.missingNames.join('、') }
          ],
          inspectorEntries: [],
          error: ''
        })
        return
      }
      if (volumeSet.totalSize > MAX_INSPECTOR_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.inspectArchiveVolumeSet.error.873a7a', {}, '分卷合计超过 80 MB，当前本机解压内核不会整组载入。'))
        return
      }
      this.setData({ ...loadingCopy('volumes', { count: volumeSet.files.length }, { label: '正在读取压缩分卷…', detail: `${volumeSet.files.length} 个文件，仅在本机合并` }) })
      try {
        const manager = wx.getFileSystemManager()
        const volumes = await Promise.all(volumeSet.files.map(volume => new Promise((resolve, reject) => {
          const filePath = volume.path || volume.tempFilePath
          if (!filePath) {
            reject(new Error(`微信没有返回分卷路径：${volume.volumeName}`))
            return
          }
          manager.readFile({
            filePath,
            success: result => resolve({ name: volume.volumeName, bytes: result.data }),
            fail: error => reject(new Error(`${volume.volumeName} 读取失败：${error.errMsg || '未知错误'}`))
          })
        })))
        if (revision !== this._fileOpenRevision) return
        this.setData({ ...loadingCopy('volumes-merge', { name: volumeSet.mainName }, { label: '正在合并并读取分卷目录…', detail: volumeSet.mainName }) })
        const runtime = await loadSevenZipRuntime()
        this._inspectorArchiveVolumes = volumes
        this._inspectorArchiveVolumeMainName = volumeSet.mainName
        this._inspectorArchiveVolumeFormat = volumeSet.format
        this._inspectorArchiveKind = 'volume'
        const inspection = await runtime.inspectArchiveVolumes(volumes, {
          mainName: volumeSet.mainName,
          format: volumeSet.format,
          maxEntrySize: MAX_FILE_SIZE
        })
        if (revision !== this._fileOpenRevision) return
        inspection.entries = buildArchiveTree(inspection.entries)
        this.presentInspection(inspection, revision)
      } catch (error) {
        if (revision !== this._fileOpenRevision) return
        if (isArchivePasswordError(error) && this._inspectorArchiveVolumes) {
          this.presentArchivePasswordPrompt('volume', revision)
          return
        }
        this.stopLoadingWithError(skinCopy.message('reader.inspectArchiveVolumeSet.error.0a6b1d', { detail: error.errMsg || error.message || error }, `压缩分卷读取失败：${error.errMsg || error.message || error}。请确认已经一次选中同组全部分卷。`))
      }
    },

    readFileRange (filePath, position, length) {
      if (!length) return Promise.resolve(new ArrayBuffer(0))
      return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
        filePath,
        position,
        length,
        success: result => {
          if (!result.data || result.data.byteLength !== length) reject(new Error('压缩包读取长度不一致，文件可能已改变或未下载完整'))
          else resolve(result.data)
        },
        fail: reject
      }))
    },

    async inspectZipFile (file, revision) {
      if (!families.get('archive')) return this.withFamilies(FAMILIES_BY_KIND.archive, revision, () => this.inspectZipFile(file, revision))
      const filePath = file.path || file.tempFilePath
      try {
        const manager = wx.getFileSystemManager()
        const size = await archiveFamily().zipFileSize(manager, file, MAX_GENERAL_FILE_SIZE)
        if (revision !== this._fileOpenRevision) return
        const tailLength = Math.min(size, ZIP_TAIL_SIZE)
        const tailStart = size - tailLength
        const tail = await this.readFileRange(filePath, tailStart, tailLength)
        let descriptor = readZipDirectoryDescriptor(tail, tailStart)
        if (descriptor.zip64) {
          const record = await this.readFileRange(filePath, descriptor.zip64RecordOffset, 56)
          descriptor = readZip64DirectoryDescriptor(record)
        }
        if (descriptor.centralSize > MAX_ZIP_CENTRAL_DIRECTORY_SIZE) throw new Error(`中央目录超过 ${(MAX_ZIP_CENTRAL_DIRECTORY_SIZE / 1024 / 1024).toFixed(0)} MB，暂不展开`)
        if (descriptor.offset + descriptor.centralSize > size) throw new Error('中央目录位置超出文件范围，压缩包可能损坏')
        let central = await this.readFileRange(filePath, descriptor.offset, descriptor.centralSize)
        if (revision !== this._fileOpenRevision) return
        let inspection
        try {
          inspection = inspectZipCentral(central, descriptor, { legacyEncoding: 'auto' })
        } catch (error) {
          if (descriptor.zip64 || error.code === 'ZIP_INVALID_UTF8_NAME') throw error
          if (size > MAX_ZIP_RECOVERY_BYTES) throw new Error('目录位置异常；超过 8 MB 安全恢复上限，未整包载入')
          this.setData({ ...loadingCopy('zip-verify', {}, { label: '正在核对压缩包内容…', detail: '尝试恢复目录位置，不修改原文件' }) })
          const archive = await this.readFileRange(filePath, 0, size)
          if (revision !== this._fileOpenRevision) return
          const recovered = recoverZipDirectory(archive)
          central = recovered.central
          descriptor = recovered.descriptor
          inspection = inspectZipCentral(central, descriptor, { legacyEncoding: 'auto' })
        }
        const needsCompatibilityRuntime = inspection.entries.some(entry => !entry.isDirectory && !entry.canOpen)
        this._inspectorZipCentral = central
        this._inspectorZipDescriptor = descriptor
        this._inspectorZipIdentityEntries = inspection.zipIdentityEntries
        this._inspectorZipLegacyEncoding = 'auto'
        this._inspectorZipNativeInspection = null
        if (needsCompatibilityRuntime && size <= MAX_INSPECTOR_FILE_SIZE) {
          this.setData({ ...loadingCopy('zip-engine', {}, { label: '正在加载 ZIP 兼容解压组件…', detail: '用于加密或非常见压缩方法' }) })
          try {
            const archive = await this.readFileRange(filePath, 0, size)
            const runtime = await loadSevenZipRuntime()
            const nativeInspection = await runtime.inspect7zArchive(archive, {
              maxEntrySize: MAX_FILE_SIZE,
              archiveExtension: '.zip',
              archiveType: 'zip-engine'
            })
            if (revision !== this._fileOpenRevision) return
            if (await archiveFamily().zipFileSize(manager, file, MAX_GENERAL_FILE_SIZE) !== size) throw new Error('ZIP 文件读取期间大小发生变化')
            if (revision !== this._fileOpenRevision) return
            this._inspectorZipNativeInspection = nativeInspection
            const compatible = archiveFamily().mergeZipEngineInspection(nativeInspection, inspection)
            this._inspectorZipIdentityEntries = compatible.zipIdentityEntries
            compatible.entries = buildArchiveTree(compatible.entries)
            this._inspectorBytes = null
            this._inspectorArchivePath = ''
            this._inspectorArchiveSize = size
            this._inspectorSevenZipBytes = archive
            this._inspectorArchiveKind = 'zip'
            this.presentInspection(compatible, revision)
            return
          } catch (runtimeError) {
            inspection.summary = `${inspection.summary} 兼容解压内核未能接管：${runtimeError.errMsg || runtimeError.message || runtimeError}`
          }
        } else if (needsCompatibilityRuntime) {
          inspection.summary = `${inspection.summary} 文件超过 80 MB，未整包载入兼容解压内核。`
        }
        if (await archiveFamily().zipFileSize(manager, file, MAX_GENERAL_FILE_SIZE) !== size) throw new Error('ZIP 文件读取期间大小发生变化')
        if (revision !== this._fileOpenRevision) return
        this._inspectorBytes = null
        this._inspectorArchivePath = filePath
        this._inspectorArchiveSize = size
        this._inspectorSevenZipBytes = null
        this._inspectorArchiveKind = ''
        this.presentInspection(inspection, revision)
      } catch (error) {
        if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.inspectZipFile.error.3e4215', { detail: error.errMsg || error.message || error }, `ZIP 目录读取失败：${error.errMsg || error.message || error}`))
      }
    },

    selectArchiveNameEncoding (event) {
      const detail = event && event.detail && event.detail.value
      const dataset = event && event.currentTarget && event.currentTarget.dataset
      this.applyArchiveNameEncoding(String(detail || (dataset && (dataset.value || dataset.encoding)) || ''))
    },

    async applyArchiveNameEncoding (next) {
      if (!['auto', 'utf-8', 'cp437', 'gb18030', 'shift_jis', 'cp949', 'big5'].includes(next)) return
      const revision = this._fileOpenRevision
      if (this._inspectorArchiveKind === 'rar' && this._inspectorRarBytes) {
        this.setData({ isLoading: true, ...loadingCopy('rar-encoding', {}, { label: '正在切换 RAR 路径编码…', detail: '' }), error: '' })
        try {
          const inspection = await archiveFamily().inspectRarArchive(this._inspectorRarBytes, {
            maxEntrySize: MAX_FILE_SIZE,
            password: this._archivePassword,
            legacyEncoding: next
          })
          if (revision !== this._fileOpenRevision) return
          this._inspectorRarLegacyEncoding = next
          this._archiveLinkRoot = null
          this.presentInspection(inspection, revision)
        } catch (error) {
          if (revision !== this._fileOpenRevision) return
          this.finishLoading()
          this.setData({ error: skinCopy.message('reader.applyArchiveNameEncoding.error.820783', { detail: error.message || error }, `RAR 路径编码切换失败：${error.message || error}`) })
        }
        return
      }
      if (!this._inspectorZipCentral || !this._inspectorZipDescriptor) return
      try {
        const decodedInspection = inspectZipCentral(this._inspectorZipCentral, this._inspectorZipDescriptor, { legacyEncoding: next })
        this._inspectorZipIdentityEntries = decodedInspection.zipIdentityEntries
        const inspection = this._inspectorZipNativeInspection
          ? { ...archiveFamily().mergeZipEngineInspection(this._inspectorZipNativeInspection, decodedInspection) }
          : decodedInspection
        this._inspectorZipIdentityEntries = inspection.zipIdentityEntries || decodedInspection.zipIdentityEntries
        if (this._inspectorZipNativeInspection) inspection.entries = buildArchiveTree(inspection.entries)
        this._inspectorZipLegacyEncoding = next
        this.presentInspection(inspection, revision)
      } catch (error) {
        this.setData({ error: skinCopy.message('reader.applyArchiveNameEncoding.error.411e06', { detail: error.message || error }, `ZIP 文件名编码切换失败：${error.message || error}`) })
      }
    },

    inspectRarFile (file, revision) {
      if (!families.get('archive')) return this.withFamilies(FAMILIES_BY_KIND.archive, revision, () => this.inspectRarFile(file, revision))
      const filePath = file.path || file.tempFilePath
      if (Number(file.size || 0) > MAX_INSPECTOR_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.inspectRarFile.error.77e71e', {}, 'RAR 文件超过 80 MB，当前本机解压内核不会整包载入。'))
        return
      }
      wx.getFileSystemManager().readFile({
        filePath,
        success: async result => {
          if (revision !== this._fileOpenRevision) return
          this._inspectorRarBytes = result.data
          this._inspectorArchiveKind = 'rar'
          try {
            const inspection = await archiveFamily().inspectRarArchive(result.data, { maxEntrySize: MAX_FILE_SIZE, legacyEncoding: this._inspectorRarLegacyEncoding })
            if (revision !== this._fileOpenRevision) return
            this._inspectorBytes = null
            this._inspectorRarBytes = result.data
            this._inspectorArchivePath = ''
            this.presentInspection(inspection, revision)
          } catch (runtimeError) {
            if (revision !== this._fileOpenRevision) return
            if (isArchivePasswordError(runtimeError)) {
              this.presentArchivePasswordPrompt('rar', revision)
              return
            }
            try {
              if (runtimeError.code !== 'RAR_ENGINE_UNAVAILABLE') throw runtimeError
              const fallback = inspectFileBytes(result.data, file)
              fallback.summary = `${fallback.summary} RAR 解压内核未能启动：${runtimeError.errMsg || runtimeError.message || runtimeError}`
              this._inspectorBytes = result.data
              this._inspectorRarBytes = null
              this._inspectorArchiveKind = ''
              this.presentInspection(fallback, revision)
            } catch (error) {
              this.stopLoadingWithError(skinCopy.message('reader.inspectRarFile.error.ef0da8', { detail: error.message || error }, `RAR 读取失败：${error.message || error}`))
            }
          }
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.inspectRarFile.error.86606d', { detail: error.errMsg || '未知错误' }, `RAR 文件读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    inspectSevenZipFile (file, revision, format = '7z') {
      if (!families.get('archive')) return this.withFamilies(FAMILIES_BY_KIND.archive, revision, () => this.inspectSevenZipFile(file, revision, format))
      const isTar = format === 'tar', label = isTar ? 'TAR' : '7z'
      const filePath = file.path || file.tempFilePath
      if (Number(file.size || 0) > MAX_INSPECTOR_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.inspectSevenZipFile.error.ed5b06', { label }, `${label} 文件超过 80 MB，当前本机解压内核不会整包载入。`))
        return
      }
      this.setData({ ...loadingCopy(isTar ? 'tar' : 'sevenzip', {}, { label: `正在加载 ${label} 归档组件…`, detail: '' }), loadingDetail: '首次使用会按需下载本机解压分包' })
      wx.getFileSystemManager().readFile({
        filePath,
        success: async result => {
          if (revision !== this._fileOpenRevision) return
          this._inspectorSevenZipBytes = result.data
          this._inspectorArchiveKind = format
          try {
            const runtime = await loadSevenZipRuntime()
            const inspection = isTar
              ? await archiveFamily().inspectTarArchive(result.data, { maxEntrySize: MAX_FILE_SIZE })
              : await runtime.inspect7zArchive(result.data, { maxEntrySize: MAX_FILE_SIZE })
            if (revision !== this._fileOpenRevision) return
            inspection.entries = buildArchiveTree(inspection.entries)
            this._inspectorBytes = null
            this._inspectorRarBytes = null
            this._inspectorSevenZipBytes = result.data
            this._inspectorArchivePath = ''
            this.presentInspection(inspection, revision)
          } catch (runtimeError) {
            if (revision !== this._fileOpenRevision) return
            if (isTar) {
              this._inspectorSevenZipBytes = null
              this.stopLoadingWithError(skinCopy.message('reader.inspectSevenZipFile.error.d0f1f0', { detail: runtimeError.message || runtimeError }, `TAR 读取失败：${runtimeError.message || runtimeError}`))
              return
            }
            if (isArchivePasswordError(runtimeError)) {
              this.presentArchivePasswordPrompt('7z', revision)
              return
            }
            try {
              const fallback = inspectFileBytes(result.data, file)
              fallback.summary = `${fallback.summary} 7z 解压组件未能启动：${runtimeError.errMsg || runtimeError.message || runtimeError}`
              this._inspectorBytes = result.data
              this._inspectorRarBytes = null
              this._inspectorSevenZipBytes = null
              this._inspectorArchiveKind = ''
              this.presentInspection(fallback, revision)
            } catch (error) {
              this.stopLoadingWithError(skinCopy.message('reader.inspectSevenZipFile.error.ccf1cd', { detail: error.message || error }, `7z 读取失败：${error.message || error}`))
            }
          }
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.inspectSevenZipFile.error.140123', { label, detail: error.errMsg || '未知错误' }, `${label} 文件读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    presentInspection (inspection, revision) {
      const allEntries = inspection.entries || []
      const archivePaging = archiveEntryPage(allEntries, 0)
      const visibleEntries = archivePaging.rawEntries
      this._inspectorEntries = inspection.archiveType ? allEntries : null
      this._inspectorVisibleEntries = inspection.archiveType ? visibleEntries : null
      this._inspectorEntryPage = 0
      this._inspectorModel = inspection.interactiveModel && ['step-wireframe', 'engineering-wireframe'].includes(inspection.interactiveModel.kind) ? inspection.interactiveModel : null
      if (this._inspectorModel) this._stepView = { yaw: -0.72, pitch: 0.48, zoom: 1 }
      const updates = {
        hasContent: true,
        inspectorMode: true,
        ...inspectorCopyFields(inspection.archiveType || (this._inspectorModel ? this._inspectorModel.kind : inspection.kind || 'binary'), { name: inspection.name || this.data.sourceName || '', extension: inspection.extension || extensionOf(inspection.name || this.data.sourceName || ''), entryCount: (inspection.entries || []).length }, { title: inspection.title, summary: inspection.summary }),
        inspectorMetadata: inspection.metadata || [],
        // Keep raw ZIP identity in logic memory, not in the rendered setData
        // payload (binary name bytes can be large and contain control characters).
        inspectorEntries: archiveEntriesForView(visibleEntries),
        inspectorEntryCount: allEntries.length,
        inspectorEntryPage: inspection.archiveType && archivePaging.pages ? 1 : 0,
        inspectorEntryPages: inspection.archiveType ? archivePaging.pages : 0,
        inspectorHasPreviousPage: false,
        inspectorHasNextPage: Boolean(inspection.archiveType && archivePaging.hasNext),
        inspectorPreviewSource: inspection.previewSvg ? `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(inspection.previewSvg))}` : '',
        inspectorPreviewPath: '',
        inspectorModelMode: this._inspectorModel ? this._inspectorModel.kind : '',
        inspectorModelReady: false,
        inspectorModelStatus: this._inspectorModel ? `正在准备可旋转模型 · ${this._inspectorModel.points.length} 点 / ${this._inspectorModel.edges.length} 边 / ${(this._inspectorModel.faces || []).length} 面片` : '',
        inspectorModelView: this._inspectorModel ? 'isometric' : '',
        inspectorModelRevision: 0,
        inspectorNeedsPassword: Boolean(inspection.passwordRequired && !inspection.passwordProvided),
        inspectorPasswordStatus: '',
        inspectorNameEncoding: inspection.filenameEncodingLabel || '',
        inspectorNameEncodingOptions: inspection.filenameEncodingOptions || [],
        error: ''
      }
      const finish = () => {
        if (revision !== this._fileOpenRevision) return
        this.setData(updates, () => {
          if (this._inspectorModel) setTimeout(() => this.drawStepModel(), 0)
          this.finishLoading()
        })
      }
      if (inspection.preview && inspection.preview.bytes && inspection.preview.bytes.length) {
        const previewPath = `${wx.env.USER_DATA_PATH}/html-reader-inspector-${revision}.${inspection.preview.extension}`
        const previewBytes = inspection.preview.bytes
        wx.getFileSystemManager().writeFile({
          filePath: previewPath,
          data: previewBytes.buffer.slice(previewBytes.byteOffset, previewBytes.byteOffset + previewBytes.byteLength),
          success: () => { updates.inspectorPreviewPath = previewPath; finish() },
          fail: finish
        })
      } else finish()
    },

    presentArchivePasswordPrompt (kind, revision) {
      if (revision !== this._fileOpenRevision) return
      this._inspectorArchiveKind = kind
      this._inspectorEntries = []
      this._inspectorVisibleEntries = []
      this._inspectorEntryPage = 0
      this._archivePasswordRequiredForDirectory = true
      this._archivePasswordVerified = false
      this.setData({
        hasContent: true,
        inspectorMode: true,
        ...inspectorCopyFields(`encrypted-${kind}`, { name: this.data.sourceName || '', extension: extensionOf(this.data.sourceName || '') || kind }, { title: kind === 'rar' ? 'RAR 加密压缩包' : kind === 'zip' ? 'ZIP 加密压缩包' : kind === 'volume' ? `${String(this._inspectorArchiveVolumeFormat || '分卷').toUpperCase()} 加密分卷压缩包` : '7z 加密压缩包', summary: kind === 'volume' ? '分卷目录受到密码保护。密码仅用于当前设备内合并这些分卷、解锁目录并打开包内文件。' : '压缩包目录受到密码保护。输入密码后会在当前设备内解锁目录并打开包内文件。' }),
        inspectorMetadata: [
          { label: skinCopy.message('reader.presentArchivePasswordPrompt.label.e19841', {}, '保护方式'), value: '密码加密' },
          { label: skinCopy.message('reader.presentArchivePasswordPrompt.label.8085eb', {}, '处理方式'), value: '仅本机内存' }
        ],
        inspectorEntries: [],
        inspectorEntryCount: 0,
        inspectorEntryPage: 0,
        inspectorEntryPages: 0,
        inspectorHasPreviousPage: false,
        inspectorHasNextPage: false,
        inspectorPreviewSource: '',
        inspectorPreviewPath: '',
        inspectorModelMode: '',
        inspectorNeedsPassword: true,
        inspectorPasswordStatus: '',
        error: ''
      }, () => this.finishLoading())
    },

    onArchivePasswordInput (event) {
      this._archivePasswordDraft = String(event && event.detail && event.detail.value || '')
    },

    async unlockArchive () {
      const password = String(this._archivePasswordDraft || '')
      if (!password) {
        this.setData({ inspectorPasswordStatus: skinCopy.message('reader.unlockArchive.password.9a104a', {}, '请输入压缩包密码。') })
        return
      }
      const kind = this._inspectorArchiveKind
      if ((kind === 'rar' && !this._inspectorRarBytes) || ((kind === '7z' || kind === 'zip') && !this._inspectorSevenZipBytes) || (kind === 'volume' && !this._inspectorArchiveVolumes)) {
        this.setData({ inspectorPasswordStatus: skinCopy.message('reader.unlockArchive.password.7be364', {}, '当前压缩包数据已失效，请重新选择文件。') })
        return
      }
      const revision = this._fileOpenRevision
      this.setData({ isLoading: true, ...loadingCopy('unlock', {}, { label: '正在本机解锁压缩包…', detail: '' }), loadingDetail: '', inspectorPasswordStatus: '', error: '' })
      try {
        let inspection
        if (kind === 'rar') {
          inspection = await archiveFamily().inspectRarArchive(this._inspectorRarBytes, { maxEntrySize: MAX_FILE_SIZE, password, legacyEncoding: this._inspectorRarLegacyEncoding })
        } else if (kind === 'volume') {
          const runtime = await loadSevenZipRuntime()
          inspection = await runtime.inspectArchiveVolumes(this._inspectorArchiveVolumes, {
            mainName: this._inspectorArchiveVolumeMainName,
            format: this._inspectorArchiveVolumeFormat,
            maxEntrySize: MAX_FILE_SIZE,
            password
          })
          inspection.entries = buildArchiveTree(inspection.entries)
        } else {
          const runtime = await loadSevenZipRuntime()
          const zipOptions = kind === 'zip' ? { archiveExtension: '.zip', archiveType: 'zip-engine' } : {}
          inspection = await runtime.inspect7zArchive(this._inspectorSevenZipBytes, { maxEntrySize: MAX_FILE_SIZE, password, ...zipOptions })
          if (kind === 'zip' && this._inspectorZipCentral && this._inspectorZipDescriptor) {
            this._inspectorZipNativeInspection = inspection
            const decodedInspection = inspectZipCentral(this._inspectorZipCentral, this._inspectorZipDescriptor, { legacyEncoding: this._inspectorZipLegacyEncoding })
            inspection = archiveFamily().mergeZipEngineInspection(inspection, decodedInspection)
            this._inspectorZipIdentityEntries = inspection.zipIdentityEntries
          }
          inspection.entries = buildArchiveTree(inspection.entries)
        }
        if (revision !== this._fileOpenRevision) return
        this._archivePassword = password
        this._archivePasswordVerified = Boolean(this._archivePasswordRequiredForDirectory)
        this.presentInspection(inspection, revision)
      } catch (error) {
        if (revision !== this._fileOpenRevision) return
        this._archivePassword = ''
        this._archivePasswordVerified = false
        this.finishLoading()
        this.setData({ inspectorNeedsPassword: true, inspectorPasswordStatus: skinCopy.message('reader.unlockArchive.password.f3e93c', {}, '密码不正确或压缩包已损坏，请重新输入。') })
      }
    },

    drawStepModel () {
      if (!this._inspectorModel || !['step-wireframe', 'engineering-wireframe'].includes(this._inspectorModel.kind)) return false
      if (this._stepCanvasState && this.renderStepModelCanvas(this._stepCanvasState)) return true
      const query = this.selectorQuery()
      if (!query || typeof query.select !== 'function') return false
      const selection = query.select('#step-model-canvas')
      if (!selection || typeof selection.fields !== 'function') return false
      selection.fields({ node: true, size: true }, result => {
        if (!result || !result.node || !result.width || !result.height) return
        this._stepCanvasState = { canvas: result.node, width: Number(result.width), height: Number(result.height) }
        this.renderStepModelCanvas(this._stepCanvasState)
      })
      query.exec()
      return true
    },

    renderStepModelCanvas (state) {
      const model = this._inspectorModel
      const canvas = state && state.canvas
      if (!model || !canvas || typeof canvas.getContext !== 'function' || !state.width || !state.height) return false
      const context = canvas.getContext('2d')
      if (!context) return false
      let ratio = 1
      try { ratio = Math.max(1, Number(typeof wx.getWindowInfo === 'function' && wx.getWindowInfo().pixelRatio || 1)) } catch (_) {}
      canvas.width = Math.round(state.width * ratio)
      canvas.height = Math.round(state.height * ratio)
      if (typeof context.setTransform === 'function') context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, state.width, state.height)
      context.fillStyle = '#fffdf8'
      context.fillRect(0, 0, state.width, state.height)
      const points = model.points || []
      if (!points.length) return false
      const bounds = [0, 1, 2].map(axis => ({ min: Math.min(...points.map(point => point[axis])), max: Math.max(...points.map(point => point[axis])) }))
      const center = bounds.map(bound => (bound.min + bound.max) / 2)
      const extent = Math.max(...bounds.map(bound => bound.max - bound.min), 1)
      const view = this._stepView || { yaw: -0.72, pitch: 0.48, zoom: 1 }
      const cosY = Math.cos(view.yaw); const sinY = Math.sin(view.yaw)
      const cosP = Math.cos(view.pitch); const sinP = Math.sin(view.pitch)
      const scale = Math.min(state.width, state.height) * 0.76 / extent * Math.max(0.4, Math.min(3, view.zoom || 1))
      const projected = points.map(point => {
        const x = point[0] - center[0]; const y = point[1] - center[1]; const z = point[2] - center[2]
        const rx = x * cosY + z * sinY
        const rz = -x * sinY + z * cosY
        const ry = y * cosP - rz * sinP
        const depth = y * sinP + rz * cosP
        return { x: state.width / 2 + rx * scale, y: state.height / 2 - ry * scale, depth }
      })
      const visibleFaces = (model.faces || []).map(face => ({
        face,
        depth: face.reduce((sum, index) => sum + Number(projected[index] && projected[index].depth || 0), 0) / Math.max(1, face.length)
      })).sort((first, second) => first.depth - second.depth).slice(0, 5000)
      context.fillStyle = 'rgba(185,230,59,.28)'
      for (const item of visibleFaces) {
        const triangle = item.face.map(index => projected[index])
        if (triangle.some(point => !point)) continue
        context.beginPath()
        context.moveTo(triangle[0].x, triangle[0].y)
        context.lineTo(triangle[1].x, triangle[1].y)
        context.lineTo(triangle[2].x, triangle[2].y)
        if (typeof context.closePath === 'function') context.closePath()
        else context.lineTo(triangle[0].x, triangle[0].y)
        context.fill()
      }
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = 1.6
      context.strokeStyle = '#171715'
      context.beginPath()
      for (const edge of model.edges || []) {
        const first = projected[edge[0]]; const second = projected[edge[1]]
        if (!first || !second) continue
        context.moveTo(first.x, first.y)
        context.lineTo(second.x, second.y)
      }
      context.stroke()
      context.fillStyle = '#b9e63b'
      context.strokeStyle = '#171715'
      context.lineWidth = 1
      for (const point of projected.slice(0, 1500)) {
        context.beginPath()
        context.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
      context.fillStyle = '#68645c'
      context.font = '12px sans-serif'
      context.fillText('拖动旋转', 12, state.height - 12)
      if (!this.data.inspectorModelReady) this.setData({ inspectorModelReady: true, inspectorModelStatus: skinCopy.message('reader.renderStepModelCanvas.model.0ee199', { count: points.length, count2: (model.edges || []).length, count3: (model.faces || []).length }, `可拖动旋转 · ${points.length} 点 / ${(model.edges || []).length} 边 / ${(model.faces || []).length} 面片`) })
      return true
    },

    stepTouchPoint (event) {
      const list = event && (event.touches && event.touches.length ? event.touches : event.changedTouches || event.changeTouches) || []
      const touch = list[0]
      if (!touch) return null
      return { x: Number(touch.clientX != null ? touch.clientX : touch.pageX), y: Number(touch.clientY != null ? touch.clientY : touch.pageY) }
    },

    onStepModelTouchStart (event) {
      const point = this.stepTouchPoint(event)
      if (point) this._stepTouch = point
    },

    onStepModelTouchMove (event) {
      const point = this.stepTouchPoint(event)
      if (!point || !this._stepTouch) return
      const dx = point.x - this._stepTouch.x; const dy = point.y - this._stepTouch.y
      const view = this._stepView || { yaw: 0, pitch: 0, zoom: 1 }
      view.yaw += dx * 0.012
      view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + dy * 0.012))
      this._stepView = view
      this._stepTouch = point
      this.renderStepModelCanvas(this._stepCanvasState)
      this.setData({ inspectorModelView: 'custom', inspectorModelRevision: this.data.inspectorModelRevision + 1 })
    },

    onStepModelTouchEnd () { this._stepTouch = null },

    setStepModelView (event) {
      const name = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.view || 'isometric'
      const views = {
        isometric: { yaw: -0.72, pitch: 0.48, zoom: 1 },
        front: { yaw: 0, pitch: 0, zoom: 1 },
        top: { yaw: 0, pitch: Math.PI / 2, zoom: 1 }
      }
      this._stepView = { ...(views[name] || views.isometric) }
      this.setData({ inspectorModelView: name, inspectorModelRevision: this.data.inspectorModelRevision + 1 }, () => this.drawStepModel())
    },

    showInspectorEntryPage (requestedPage, extra = {}) {
      if (!this._inspectorEntries) return false
      const paging = archiveEntryPage(this._inspectorEntries, requestedPage)
      this._inspectorEntryPage = paging.page
      this._inspectorVisibleEntries = paging.rawEntries
      this.setData({
        inspectorEntries: paging.entries,
        inspectorEntryCount: paging.total,
        inspectorEntryPage: paging.pages ? paging.page + 1 : 0,
        inspectorEntryPages: paging.pages,
        inspectorHasPreviousPage: paging.hasPrevious,
        inspectorHasNextPage: paging.hasNext,
        ...extra
      })
      return true
    },

    previousInspectorEntryPage () {
      this.showInspectorEntryPage(this._inspectorEntryPage - 1)
    },

    nextInspectorEntryPage () {
      this.showInspectorEntryPage(this._inspectorEntryPage + 1)
    },

    returnToArchiveRoot () {
      if (!this._archiveLinkRoot) return
      this._inspectorEntries = this._archiveLinkRoot
      const rootPage = this._archiveLinkRootPage || 0
      this._archiveLinkRoot = null
      this._archiveLinkRootPage = 0
      this.showInspectorEntryPage(rootPage, { inspectorLinkFolder: '', error: '' })
    },

    async readZipArchiveEntry (entry, revision, maxSize = MAX_FILE_SIZE) {
      const archivePath = this._inspectorArchivePath
      const archiveSize = this._inspectorArchiveSize
      const fixedHeader = await this.readFileRange(archivePath, entry.localHeaderOffset, 30)
      if (revision !== this._fileOpenRevision) throw new Error('文件已经切换')
      const headerLength = zipLocalHeaderLength(fixedHeader, entry)
      if (entry.localHeaderOffset + headerLength > archiveSize) throw new Error('ZIP 本地头范围超出文件长度')
      const localHeader = headerLength === 30 ? fixedHeader : await this.readFileRange(archivePath, entry.localHeaderOffset, headerLength)
      if (revision !== this._fileOpenRevision) throw new Error('文件已经切换')
      const dataOffset = zipEntryDataOffset(localHeader, entry)
      if (dataOffset + entry.compressedSize > archiveSize) throw new Error('包内文件数据超出 ZIP 文件范围')
      const packed = await this.readFileRange(archivePath, dataOffset, entry.compressedSize)
      if (revision !== this._fileOpenRevision) throw new Error('文件已经切换')
      return extractZipEntryPayload(packed, entry, { maxSize })
    },

    async openInspectorEntry (event) {
      const index = Number(event && event.detail && event.detail.index != null ? event.detail.index : event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
      const visibleEntries = this._inspectorVisibleEntries || this._inspectorEntries
      const entry = visibleEntries && visibleEntries[index]
      if (!entry || !entry.canOpen || (!this._inspectorBytes && !this._inspectorArchivePath && !this._inspectorRarBytes && !this._inspectorSevenZipBytes && !this._inspectorArchiveVolumes)) return
      const revision = this._fileOpenRevision
      this.setData({ isLoading: true, ...loadingCopy('extract', { name: entry.name }, { label: '正在解压包内文件…', detail: entry.name }), error: '' })
      let bytes
      let contentEntry = entry
      try {
        if (entry.archiveType === 'volume-engine' && this._inspectorArchiveVolumes) {
          const runtime = await loadSevenZipRuntime()
          if (revision !== this._fileOpenRevision) return
          const result = await runtime.readArchiveVolumeEntry(this._inspectorArchiveVolumes, entry, {
            mainName: this._inspectorArchiveVolumeMainName,
            format: this._inspectorArchiveVolumeFormat,
            maxSize: MAX_FILE_SIZE,
            password: this._archivePassword,
            passwordVerified: this._archivePasswordVerified
          })
          if (revision !== this._fileOpenRevision) return
          contentEntry = result.entry
          if (contentEntry.isDirectory) {
            if (!this._archiveLinkRoot) {
              this._archiveLinkRoot = this._inspectorEntries
              this._archiveLinkRootPage = this._inspectorEntryPage
            }
            this._inspectorEntries = buildArchiveTree(result.entries)
            this.finishLoading()
            this.showInspectorEntryPage(0, { inspectorLinkFolder: contentEntry.name, error: '' })
            return
          }
          bytes = result.bytes
        } else if (entry.archiveType === 'rar-engine' && this._inspectorRarBytes) {
          const result = await archiveFamily().readRarEntry(this._inspectorRarBytes, entry, {
            maxSize: MAX_FILE_SIZE,
            password: this._archivePassword,
            legacyEncoding: this._inspectorRarLegacyEncoding,
            readLinkTarget: async (input, linkedEntry) => (await loadSevenZipRuntime()).readRarLinkTarget(input, linkedEntry, { password: this._archivePassword })
          })
          if (revision !== this._fileOpenRevision) return
          contentEntry = result.entry
          if (contentEntry.isDirectory) {
            if (!this._archiveLinkRoot) {
              this._archiveLinkRoot = this._inspectorEntries
              this._archiveLinkRootPage = this._inspectorEntryPage
            }
            this._inspectorEntries = result.entries
            this.finishLoading()
            this.showInspectorEntryPage(0, { inspectorLinkFolder: contentEntry.name, error: '' })
            return
          }
          bytes = result.bytes
        } else if (entry.archiveType === 'tar-engine' && this._inspectorSevenZipBytes) {
          if (entry.isLink) {
            const result = archiveFamily().resolveTarLink(this._archiveLinkRoot || this._inspectorEntries, entry)
            contentEntry = result.entry
            if (contentEntry.isDirectory) {
              if (!this._archiveLinkRoot) {
                this._archiveLinkRoot = this._inspectorEntries
                this._archiveLinkRootPage = this._inspectorEntryPage
              }
              this._inspectorEntries = buildArchiveTree(result.entries)
              this.finishLoading()
              this.showInspectorEntryPage(0, { inspectorLinkFolder: contentEntry.name, error: '' })
              return
            }
          }
          bytes = await archiveFamily().extractTarEntry(this._inspectorSevenZipBytes, contentEntry, { maxSize: MAX_FILE_SIZE })
        } else if ((entry.archiveType === '7z-engine' || entry.archiveType === 'zip-engine') && this._inspectorSevenZipBytes) {
          const runtime = await loadSevenZipRuntime()
          if (revision !== this._fileOpenRevision) return
          const zipOptions = entry.archiveType === 'zip-engine' ? { archiveExtension: '.zip' } : {}
          if (entry.isLink) {
            const resolveLink = entry.archiveType === 'zip-engine' ? archiveFamily().resolveZipLink : runtime.resolveSevenZipLink
            const result = await resolveLink(this._inspectorZipIdentityEntries || this._inspectorEntries, entry, (linked, maxSize) => runtime.extract7zLinkTarget(this._inspectorSevenZipBytes, linked, { maxSize, password: this._archivePassword, passwordVerified: this._archivePasswordVerified, ...zipOptions }))
            if (revision !== this._fileOpenRevision) return
            contentEntry = result.entry
            if (contentEntry.isDirectory) {
              if (!this._archiveLinkRoot) {
                this._archiveLinkRoot = this._inspectorEntries
                this._archiveLinkRootPage = this._inspectorEntryPage
              }
              this._inspectorEntries = buildArchiveTree(result.entries)
              this.finishLoading()
              this.showInspectorEntryPage(0, { inspectorLinkFolder: contentEntry.name, error: '' })
              return
            }
          }
          bytes = await runtime.extract7zEntry(this._inspectorSevenZipBytes, contentEntry, { maxSize: MAX_FILE_SIZE, password: this._archivePassword, passwordVerified: this._archivePasswordVerified, ...zipOptions })
        } else if (entry.archiveType === 'zip' && this._inspectorArchivePath) {
          if (entry.isLink) {
            const result = await archiveFamily().resolveZipLink(this._inspectorZipIdentityEntries || this._inspectorEntries, entry, (linked, maxSize) => this.readZipArchiveEntry(linked, revision, maxSize))
            if (revision !== this._fileOpenRevision) return
            contentEntry = result.entry
            if (contentEntry.isDirectory) {
              if (!this._archiveLinkRoot) {
                this._archiveLinkRoot = this._inspectorEntries
                this._archiveLinkRootPage = this._inspectorEntryPage
              }
              this._inspectorEntries = buildArchiveTree(result.entries)
              this.finishLoading()
              this.showInspectorEntryPage(0, { inspectorLinkFolder: contentEntry.name, error: '' })
              return
            }
          }
          bytes = await this.readZipArchiveEntry(contentEntry, revision)
        } else bytes = extractArchiveEntry(this._inspectorBytes, entry, { maxSize: MAX_FILE_SIZE })
      } catch (error) {
        if (revision !== this._fileOpenRevision) return
        if (isArchivePasswordError(error)) {
          this._archivePassword = ''
          this._archivePasswordVerified = false
          const entries = (this._inspectorEntries || []).map(item => item.encrypted ? { ...item, canOpen: false } : item)
          this._inspectorEntries = entries
          this.finishLoading()
          this.showInspectorEntryPage(this._inspectorEntryPage, { inspectorNeedsPassword: true, inspectorPasswordStatus: skinCopy.message('reader.openInspectorEntry.password.f3e93c', {}, '密码不正确或压缩包已损坏，请重新输入。'), error: '' })
          return
        }
        this.stopLoadingWithError(skinCopy.message('reader.openInspectorEntry.error.54751a', { detail: error.message || error }, `包内文件打开失败：${error.message || error}`))
        return
      }
      if (revision !== this._fileOpenRevision) return
      const entryPath = contentEntry.pathSeparator === 'slash' ? contentEntry.name : contentEntry.name.replace(/\\/g, '/')
      const basename = entryPath.split('/').pop() || `zip-entry-${index}`
      const storageName = basename.replace(/[\\/:*?"<>|]/g, '_')
      const filePath = `${wx.env.USER_DATA_PATH}/html-reader-zip-${Date.now()}-${index}-${storageName}`
      const entryExtension = extensionOf(basename)
      const inferredType = ['xml', 'json', 'csv', 'log'].includes(entryExtension) ? 'text/plain' : ''
      wx.getFileSystemManager().writeFile({
        filePath,
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        success: () => { if (revision === this._fileOpenRevision) this.openSelectedFile({ name: basename, path: filePath, tempFilePath: filePath, size: bytes.length, type: inferredType }) },
        fail: error => { if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.openInspectorEntry.error.9a5664', { detail: error.errMsg || '未知错误' }, `包内文件保存失败：${error.errMsg || '未知错误'}`)) }
      })
    },

    readSafeFile (file, revision) {
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.readSafeFile.error.8c25f9', {}, '微信没有返回可读取的文件路径，请重新选择文件。'))
        return
      }
      documentFamily().readHtmlFileBytes(wx.getFileSystemManager(), {
        filePath,
        size: file.size,
        maxBytes: MAX_FILE_SIZE,
        isCurrent: () => revision === this._fileOpenRevision,
        success: readResult => {
          if (revision !== this._fileOpenRevision) return
          if (this._loadMetrics) this._loadMetrics.readAt = Date.now()
          this.setData({ ...loadingCopy('html-parse', {}, { label: '正在解析网页…', detail: '' }) }, () => {
            const parse = () => {
              if (revision === this._fileOpenRevision) {
                try {
                  const decoded = decodeText(readResult.data, { kind: htmlContentType(file) === 'application/xhtml+xml' ? 'xhtml' : 'html' })
                  this.parseContent(decoded.text, file.name, revision, htmlContentType(file))
                } catch (error) {
                  this.stopLoadingWithError(skinCopy.message('reader.readSafeFile.error.85e91e', { detail: error.message || error }, `网页文本解码失败：${error.message || error}`))
                }
              }
            }
            if (typeof wx.nextTick === 'function') wx.nextTick(parse)
            else parse()
          })
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readSafeFile.error.99d68f', { detail: error.errMsg || '未知错误' }, `文件读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    readSvgFile (file, revision) {
      if (Number(file.size || 0) > MAX_SVG_FILE_SIZE) {
        this.stopLoadingWithError(skinCopy.message('reader.readSvgFile.error.9483d4', {}, 'SVG 文件超过 20 MB，为避免本地解析卡顿暂时无法预览。'))
        return
      }
      const filePath = file.path || file.tempFilePath
      if (!filePath) {
        this.stopLoadingWithError(skinCopy.message('reader.readSvgFile.error.953ee6', {}, '微信没有返回可读取的 SVG 路径，请重新选择文件。'))
        return
      }
      const fileSystem = wx.getFileSystemManager()
      fileSystem.readFile({
        filePath,
        encoding: 'utf8',
        success: readResult => {
          if (revision !== this._fileOpenRevision) return
          this.prepareSvgPreview(readResult.data, revision, fileSystem)
        },
        fail: error => {
          if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readSvgFile.error.1ba6f8', { detail: error.errMsg || '未知错误' }, `SVG 读取失败：${error.errMsg || '未知错误'}`))
        }
      })
    },

    prepareSvgPreview (svgText, revision, fileSystem = wx.getFileSystemManager()) {
      if (revision !== this._fileOpenRevision) return
      try {
        const preview = documentFamily().sanitizeStandaloneSvg(svgText, { viewportWidth: this.readerViewportWidth() })
        // 动态 SVG（SMIL 或 CSS 动画）交给 image 分包的 <svg-view> 用 Canvas 播放；
        // 静态 data URI 同时准备好，组件加载或绘制失败时退回微信原生 <image>。
        const hasAnimation = ANIMATED_SVG_PATTERN.test(svgText)
        const animatedSource = hasAnimation && payloadBytes(svgText) <= MAX_ANIMATED_SVG_BYTES ? String(svgText) : ''
        this._standaloneSvgAnimatedOriginal = animatedSource
        const animationNotice = hasAnimation && !animatedSource ? '文件动画数据较大，当前显示静态预览。' : ''
        // 真机对 USER_DATA_PATH 下临时 .svg 的解码存在机型差异；常见 SVG 直接
        // 使用净化后的 data URI，可绕过文件扩展名与临时路径识别问题。较大文件
        // 才退回本地路径，避免单次 setData 超限。
        const safeSource = preview.fallbackSource || preview.source
        // 微信 image 组件会把百分号编码的 SVG data URI 报为加载成功却显示空白；
        // base64 形式在开发者工具和真机内核均走稳定的图片解码路径。
        const dataUri = `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(safeSource))}`
        if (payloadBytes(dataUri) <= MAX_SVG_DATA_URI_BYTES) {
          if (revision !== this._fileOpenRevision) return
          this._standaloneSvgFallback = { fileSystem, revision, safeSource, attempted: false }
          this.setData({
            hasContent: true,
            renderedHtml: '',
            domMode: false,
            standaloneSvgPath: '',
            standaloneSvgSource: dataUri,
            standaloneSvgAnimatedSource: animatedSource,
            standaloneSvgAnimationNotice: animationNotice,
            standaloneSvgAnimationCanRetry: false,
            error: ''
          })
          return
        }
        // 使用本次打开的修订号隔离文件，避免快速切换时较慢的旧写入覆盖新预览。
        const previewPath = `${wx.env.USER_DATA_PATH}/html-reader-svg-preview-${revision}.svg`
        fileSystem.writeFile({
          filePath: previewPath,
          data: safeSource,
          encoding: 'utf8',
          success: () => {
            if (revision !== this._fileOpenRevision) return
            this._standaloneSvgFallback = null
            this.setData({
              hasContent: true,
              renderedHtml: '',
              domMode: false,
              standaloneSvgPath: previewPath,
              standaloneSvgSource: '',
              standaloneSvgAnimatedSource: animatedSource,
              standaloneSvgAnimationNotice: animationNotice,
              standaloneSvgAnimationCanRetry: false,
              error: ''
            })
          },
          fail: error => {
            if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readSvgFile.error.351e1a', { detail: error.errMsg || '无法写入本地预览文件' }, `SVG 预览准备失败：${error.errMsg || '无法写入本地预览文件'}`))
          }
        })
      } catch (error) {
        if (revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.readSvgFile.error.0283ee', { detail: error.message || error }, `SVG 解析失败：${error.message || error}`))
      }
    },

    onStandaloneSvgError (event) {
      const fallback = this._standaloneSvgFallback
      if (fallback && !fallback.attempted && fallback.revision === this._fileOpenRevision) {
        fallback.attempted = true
        const previewPath = `${wx.env.USER_DATA_PATH}/html-reader-svg-preview-${fallback.revision}.svg`
        fallback.fileSystem.writeFile({
          filePath: previewPath,
          data: fallback.safeSource,
          encoding: 'utf8',
          success: () => {
            if (fallback.revision !== this._fileOpenRevision) return
            this._standaloneSvgFallback = null
            this.setData({ standaloneSvgSource: '', standaloneSvgPath: previewPath })
          },
          fail: error => {
            if (fallback.revision === this._fileOpenRevision) this.stopLoadingWithError(skinCopy.message('reader.onStandaloneSvgError.error.351e1a', { detail: error.errMsg || '无法写入本地预览文件' }, `SVG 预览准备失败：${error.errMsg || '无法写入本地预览文件'}`))
          }
        })
        return
      }
      const detail = event && event.detail && event.detail.errMsg
      this.stopLoadingWithError(skinCopy.message('reader.onStandaloneSvgError.error.186ad1', { detail: detail || '当前微信内核无法显示该 SVG' }, `SVG 图像解码失败：${detail || '当前微信内核无法显示该 SVG'}。文件已成功读取，但其中可能包含该设备不支持的滤镜或图形。`))
    },

    onStandaloneSvgLoad () {
      this._standaloneSvgFallback = null
      this.finishLoading()
    },

    // <svg-view>（image 分包）就绪：Canvas 已画出首帧
    onStandaloneSvgAnimatedReady (event) {
      const detail = event && event.detail
      this.setData({ standaloneSvgAnimationNotice: '', standaloneSvgAnimationCanRetry: false })
      this._standaloneSvgAnimation = detail ? { animated: Boolean(detail.animated), unsupported: detail.unsupported || [] } : null
      this.finishLoading()
    },

    // Canvas 播放失败（分包下载失败、解析或绘制异常）：退回静态 <image>，不丢内容
    onStandaloneSvgAnimatedError (event) {
      const message = event && event.detail && event.detail.message
      this._standaloneSvgAnimation = { animated: false, unsupported: [], fallbackReason: message || '' }
      if (this.data.standaloneSvgAnimatedSource) {
        this.setData({ standaloneSvgAnimatedSource: '', standaloneSvgAnimationNotice: '动画暂时无法播放，当前显示静态预览。', standaloneSvgAnimationCanRetry: true })
        this.finishLoading()
      }
    },

    retryStandaloneSvgAnimation () {
      if (!this._standaloneSvgAnimatedOriginal) return
      this.setData({ standaloneSvgAnimatedSource: this._standaloneSvgAnimatedOriginal, standaloneSvgAnimationNotice: '', standaloneSvgAnimationCanRetry: false })
    },

    readerViewportWidth () {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375 }
      return Number(info.windowWidth || 375)
    },

    // 仅开发版供 miniprogram-automator 注入用户原文件；体验版和正式版不可调用。
    readMaterial (material, htmlText) {
      if (!isDevelopmentBuild()) return false
      const revision = (this._fileOpenRevision || 0) + 1
      this._fileOpenRevision = revision
      this.resetReaderView(material && material.name || '自动化原文件')
      this.withFamilies(FAMILIES_BY_KIND.html, revision, () => this.parseContent(String(htmlText || ''), material && material.name || '自动化原文件', revision, htmlContentType(material)))
      return true
    },

    // 与 readMaterial 相同，仅供开发版对独立 SVG 的文件写入与视图链做模拟器验收。
    readSvgMaterial (material, svgText) {
      if (!isDevelopmentBuild()) return false
      const revision = (this._fileOpenRevision || 0) + 1
      this._fileOpenRevision = revision
      this.resetReaderView(material && material.name || '自动化 SVG 原文件')
      this.withFamilies(FAMILIES_BY_KIND.svg, revision, () => this.prepareSvgPreview(String(svgText || ''), revision))
      return true
    },

    // 仅供自动化验收微信 WXWebAssembly 链。探针异步运行并把结果留在页面实例，
    // 避免 miniprogram-automator 对跨上下文 Promise 返回值支持不一致。
    startRarRuntimeProbeForDevelopment (base64Archive) {
      if (!isDevelopmentBuild()) return { state: 'denied' }
      const probe = { state: 'running' }
      this._rarRuntimeProbe = probe
      Promise.resolve().then(async () => {
        if (typeof wx.base64ToArrayBuffer !== 'function') throw new Error('微信运行层缺少 base64ToArrayBuffer')
        await families.load('archive')
        const archive = wx.base64ToArrayBuffer(String(base64Archive || ''))
        const inspection = await archiveFamily().inspectRarArchive(archive, { maxEntrySize: 2 * 1024 * 1024 })
        const target = inspection.entries.find(entry => !entry.isDirectory && /\/long\.txt$/i.test(entry.name))
        if (!target) throw new Error('RAR 测试包中没有找到压缩条目 long.txt')
        const output = await archiveFamily().extractRarEntry(archive, target, { maxSize: 2 * 1024 * 1024 })
        this._rarRuntimeProbe = {
          state: 'done',
          entries: inspection.entries.length,
          method: target.method,
          length: output.length
        }
      }).catch(error => {
        this._rarRuntimeProbe = {
          state: 'error',
          message: error && (error.errMsg || error.message) || String(error),
          stack: error && error.stack || '',
          wasm: typeof WXWebAssembly === 'object' && WXWebAssembly
            ? {
                instantiate: typeof WXWebAssembly.instantiate,
                runtimeError: typeof WXWebAssembly.RuntimeError,
                module: typeof WXWebAssembly.Module,
                instance: typeof WXWebAssembly.Instance,
                memory: typeof WXWebAssembly.Memory,
                table: typeof WXWebAssembly.Table
              }
            : null
        }
      })
      return probe
    },

    startSevenZipRuntimeProbeForDevelopment (base64Archive) {
      if (!isDevelopmentBuild()) return { state: 'denied' }
      const probe = { state: 'running' }
      this._sevenZipRuntimeProbe = probe
      Promise.resolve().then(async () => {
        if (typeof wx.base64ToArrayBuffer !== 'function') throw new Error('微信运行层缺少 base64ToArrayBuffer')
        const runtime = await loadSevenZipRuntime()
        const archive = wx.base64ToArrayBuffer(String(base64Archive || ''))
        const inspection = await runtime.inspect7zArchive(archive, { maxEntrySize: 1024 * 1024 })
        const target = inspection.entries.find(entry => entry.name === '资料/说明.txt')
        if (!target) throw new Error('7z 测试包中没有找到资料/说明.txt')
        const output = await runtime.extract7zEntry(archive, target, { maxSize: 1024 * 1024 })
        this._sevenZipRuntimeProbe = {
          state: 'done',
          entries: inspection.entries.length,
          method: target.method,
          length: output.length
        }
      }).catch(error => {
        this._sevenZipRuntimeProbe = {
          state: 'error',
          message: error && (error.errMsg || error.message) || String(error),
          stack: error && error.stack || ''
        }
      })
      return probe
    },

    getReaderDiagnostics () {
      if (!isDevelopmentBuild()) return null
      const state = this._htmlRuntime && this._htmlRuntime.renderState()
      return {
        sourceName: this.data.sourceName,
        hasContent: this.data.hasContent,
        domMode: this.data.domMode,
        error: this.data.error,
        isLoading: this.data.isLoading,
        standaloneSvgSource: this.data.standaloneSvgSource ? 'data-uri' : '',
        standaloneSvgAnimated: Boolean(this.data.standaloneSvgAnimatedSource),
        standaloneSvgAnimation: this._standaloneSvgAnimation || null,
        loadMetrics: this._loadMetrics ? { ...this._loadMetrics } : null,
        runtimeErrors: (this._runtimeErrors || []).slice(),
        rootClass: state && state.rootClass || '',
        bodyAttrs: state && state.bodyAttrs || '',
        packageLoadError: this._packageLoadError || '',
        canvasRevisions: state ? state.canvases.map(item => ({ nid: item.nid, rev: item.canvas.rev })) : []
      }
    },

    parseContent (html, sourceName, revision, contentType = htmlContentType({ name: sourceName })) {
      const activeRevision = revision == null ? (this._fileOpenRevision || 0) + 1 : revision
      if (revision != null && revision !== this._fileOpenRevision) return false
      if (revision == null) this._fileOpenRevision = activeRevision
      if (!families.get('document')) {
        this.withFamilies(FAMILIES_BY_KIND.html, activeRevision, () => this.parseContent(html, sourceName, activeRevision, contentType))
        return true
      }
      this.disposeHtmlRuntime()
      const documentMeta = extractHtmlDocumentMeta(html)
      if (Object.keys(documentMeta).length) this.emit('meta', { name: sourceName || '', meta: documentMeta })
      const root = wx.env && wx.env.USER_DATA_PATH
      const fs = root && typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      if (fs && typeof fs.writeFile === 'function') this._htmlAssets = documentFamily().createInlineImageStore(fs, root)
      if (this._htmlAssets && contentType !== 'application/xhtml+xml' && documentFamily().hasLargeInlineImage(html)) {
        const store = this._htmlAssets
        this.setData({ isLoading: true, ...loadingCopy('html-images', {}, { label: '正在准备网页内嵌图片…', detail: '' }), loadingDetail: '' })
        const prepare = () => store.rewriteStaticHtml(documentFamily().transformHtml(html).html).then(fallback => {
          if (this._htmlAssets === store && activeRevision === this._fileOpenRevision) this.parsePreparedContent(html, sourceName, activeRevision, contentType, fallback)
        }).catch(error => {
          if (this._htmlAssets !== store || activeRevision !== this._fileOpenRevision) return
          this.offerHtmlPresentationRetry(error, prepare)
          this.stopLoadingWithError(error.message)
        })
        prepare()
        return true
      }
      return this.parsePreparedContent(html, sourceName, activeRevision, contentType)
    },

    parsePreparedContent (html, sourceName, activeRevision, contentType, preparedFallback) {
      if (activeRevision !== this._fileOpenRevision) return false
      try {
        // Validate XML before creating an HTML fallback; malformed XML must never
        // silently appear as a successful, truncated HTML preview.
        const xml = contentType === 'application/xhtml+xml' ? documentFamily().parseXhtmlDocument(html) : null
        const result = documentFamily().transformHtml(xml ? xml.document.body.outerHTML : html)
        if (!result.html) throw new Error('文件中没有可展示的正文内容')
        this._staticHtmlFallback = xml ? '' : preparedFallback ?? result.html
        if (!this._loadMetrics || this._loadMetrics.sourceName !== sourceName) this._loadMetrics = { startedAt: Date.now(), sourceName }
        this._loadMetrics.transformedAt = Date.now()
        const initial = {
          hasContent: false,
          renderedHtml: '',
          domMode: false,
          domTree: [],
          domStyles: [''],
          sourceName,
          report: result.analysis,
          notes: result.notes,
          error: '',
          nativeStatus: '',
          standaloneSvgPath: '',
          standaloneSvgSource: '',
          standaloneSvgAnimatedSource: '',
          isLoading: true,
          ...loadingCopy('html-run', {}, { label: '正在运行网页并准备排版…', detail: '' }),
          loadingDetail: ''
        }
        this.setData(initial, () => {
          const startRuntime = () => {
            if (activeRevision !== this._fileOpenRevision) return
            try {
              const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375, windowHeight: 667, pixelRatio: 1 }
              this._documentColorScheme = currentColorScheme()
              this._loadMetrics.runtimeStartedAt = Date.now()
              this._htmlRuntime = documentFamily().createRuntime(html, {
                contentType,
                directCanvasFrames: true,
                viewportWidth: windowInfo.windowWidth,
                viewportHeight: windowInfo.windowHeight,
                devicePixelRatio: windowInfo.pixelRatio,
                colorScheme: this._documentColorScheme,
                onRender: state => {
                  if (activeRevision === this._fileOpenRevision) this.renderDomState(state, windowInfo.windowWidth)
                },
                onCanvas: canvases => this.presentRuntimeCanvases(canvases),
                onHostAction: action => this.onDomHostAction(action),
                onError: error => { this._runtimeErrors = (this._runtimeErrors || []).concat(error) },
                resolveImageSource: source => this._htmlAssets ? this._htmlAssets.resource(source, true) : source,
                createOffscreenCanvas: typeof wx.createOffscreenCanvas !== 'function' ? undefined : config => {
                  try { return wx.createOffscreenCanvas(config) } catch (_) {
                    try {
                      const canvas = wx.createOffscreenCanvas({ type: config.type })
                      canvas.width = config.width
                      canvas.height = config.height
                      return canvas
                    } catch (_) { return null }
                  }
                }
              })
              this._htmlRuntime.run()
            } catch (runtimeError) {
              if (activeRevision !== this._fileOpenRevision) return
              if (contentType === 'application/xhtml+xml') {
                this.disposeHtmlRuntime()
                this.stopLoadingWithError(skinCopy.message('reader.parsePreparedContent.error.f5fbb2', { detail: runtimeError.message || runtimeError }, `XHTML 运行失败：${runtimeError.message || runtimeError}`))
                return
              }
              const staticFallback = this._staticHtmlFallback
              this.disposeHtmlRuntime(true)
              this.setData({
                hasContent: true,
                domMode: false,
                domTree: [],
                domStyles: [''],
                renderedHtml: staticFallback,
                error: skinCopy.message('reader.parsePreparedContent.error.b6b875', { detail: runtimeError.message || runtimeError }, `交互内容解析失败，已切换到静态阅读模式：${runtimeError.message || runtimeError}`)
              })
            }
          }
          if (typeof wx.nextTick === 'function') wx.nextTick(startRuntime)
          else startRuntime()
        })
        // 网页标题属于正文，不替换宿主小程序的导航标题；标题由宿主页面维护。
        return true
      } catch (error) {
        this.stopLoadingWithError(skinCopy.message('reader.parsePreparedContent.error.9eff68', { detail: error.message || error }, `解析失败：${error.message || error}`))
        return false
      }
    },

    renderDomState (state, viewportWidth) {
      if (this._domRenderFailed) return false
      if (this._progressiveDomRendering) {
        this._pendingDomRender = { state, viewportWidth }
        return true
      }
      try {
        return this.renderDomStateUnsafe(state, viewportWidth)
      } catch (error) {
        this._domRenderFailed = true
        if (this._htmlRuntime && this._htmlRuntime.document.contentType === 'application/xhtml+xml') {
          this.stopLoadingWithError(skinCopy.message('reader.renderDomState.error.2c9009', { detail: error.message || error }, `XHTML 排版失败：${error.message || error}`))
          return false
        }
        this.stopLoadingWithError(skinCopy.message('reader.renderDomState.error.e222ad', { detail: error.message || error }, `交互排版失败，已切换到静态阅读模式：${error.message || error}`))
        this.setData({
          hasContent: true,
          domMode: false,
          domTree: [],
          domStyles: [''],
          renderedHtml: this._staticHtmlFallback || this.data.renderedHtml
        })
        return false
      }
    },

    renderDomStateUnsafe (state, viewportWidth) {
      if (!this._htmlRuntime) return
      const rendered = documentFamily().renderHtmlDomTree(
        { document: this._htmlRuntime.document, styles: state.styles },
        { viewportWidth, colorScheme: this._documentColorScheme || 'light' }
      )
      this._svgFallbackByNid = Object.create(null)
      let smilProbeNid = null
      // Match the standalone SVG route: some WeChat image decoders report load
      // success for percent-encoded SVG URLs but show an empty rectangle. Convert
      // only the already-sanitized presentation resource, never the author's DOM.
      const nativeSvg = source => /^data:image\/svg\+xml,/i.test(source || '')
        ? `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(decodeURIComponent(source.slice(source.indexOf(',') + 1))))}` : source
      const collectSvgFallbacks = nodes => (nodes || []).forEach(node => {
        if (node.name === 'img' && node.attrs) node.attrs.src = nativeSvg(node.attrs.src)
        if (node.svgFallbackSrc) node.svgFallbackSrc = nativeSvg(node.svgFallbackSrc)
        if (node.svgHasSmil) {
          if (this._smilSupport === 'unsupported') node.attrs.src = node.svgFallbackSrc
          else if (smilProbeNid == null) smilProbeNid = node.nid
        }
        if (node.svgFallbackSrc && node.attrs.src !== node.svgFallbackSrc) this._svgFallbackByNid[node.nid] = node.svgFallbackSrc
        collectSvgFallbacks(node.children)
      })
      collectSvgFallbacks(rendered.nodes)
      rendered.smilProbeNid = smilProbeNid
      if (this._htmlAssets) {
        if (this._htmlAssets.hasViewResources(rendered)) {
          const store = this._htmlAssets
          this._progressiveDomRendering = true
          store.rewriteView(rendered).then(() => {
            if (this._htmlAssets !== store) return
            this._progressiveDomRendering = false
            this.presentRenderedDom(rendered, viewportWidth)
          }).catch(error => {
            if (this._htmlAssets !== store) return
            this._progressiveDomRendering = false
            this._pendingDomRender = null
            // The runtime already recorded this DOM key. Retry the latest DOM,
            // not the failed snapshot, only after an explicit user action.
            this.offerHtmlPresentationRetry(error, () => {
              if (this._htmlRuntime) this.renderDomState(this._htmlRuntime.renderState(), viewportWidth)
            })
            this.stopLoadingWithError(error.message)
          })
          return true
        }
      }
      return this.presentRenderedDom(rendered, viewportWidth)
    },

    presentRenderedDom (rendered, viewportWidth) {
      const runtime = this._htmlRuntime
      // Native image callbacks can arrive after a file switch or src update.
      // Carry a short view token instead of the potentially large data URI.
      const previousMedia = this._mediaStateByNid || Object.create(null)
      const currentMedia = Object.create(null)
      const tagMedia = nodes => (nodes || []).forEach(node => {
        if (node.name === 'img') {
          const nid = String(node.nid), source = node.attrs?.src || ''
          const previous = previousMedia[nid]
          const token = previous && previous.source === source
            ? previous.token : (this._mediaEventSerial = (this._mediaEventSerial || 0) + 1)
          node.mediaToken = token
          currentMedia[nid] = { source, token }
        }
        tagMedia(node.children)
      })
      tagMedia(rendered.nodes)
      this._mediaStateByNid = currentMedia
      if (!this._viewTextFragments) this._viewTextFragments = new Map()
      const compacted = documentFamily().compactDomTreeForView(rendered.nodes, this._viewTextFragments)
      const totalBytes = payloadBytes({ domTree: compacted.nodes, domStyles: compacted.styles })
      if (totalBytes > MAX_DOM_PAYLOAD_BYTES) {
        throw new Error(`网页排版数据仍有 ${Math.ceil(totalBytes / 1024)} KB，超过本机渲染安全上限`)
      }
      const contentWidth = rendered.contentWidth
      const fittedViewportWidth = Math.max(1, viewportWidth - FIXED_CANVAS_SIDE_INSET * 2)
      const scale = contentWidth > viewportWidth * 1.02 ? fittedViewportWidth / contentWidth : 1
      const frameStyle = scale < 1 ? `width:${contentWidth}px;transform:scale(${scale});transform-origin:0 0` : 'width:100%'
      const clipStyle = scale < 1 ? `width:${viewportWidth}px;overflow:hidden` : 'width:100%'
      const treePatch = domTreePatch(this.data.domTree, compacted.nodes)
      if (Object.keys(treePatch).some(path => path === 'domTree' || path.startsWith('domTree['))) {
        this.invalidateCanvasHandles()
      }
      this.emitDocumentTheme(rendered.wrapperStyle)
      const updates = {
        ...treePatch,
        domStyles: compacted.styles,
        hasContent: true,
        domMode: true,
        // DOM 链成功后不再把整份静态 HTML 留在 page.data，避免大型单文件和
        // 渲染树同时常驻并再次逼近微信的数据总量边界。
        renderedHtml: '',
        domWrapperStyle: documentFamily().compactStyle(rendered.wrapperStyle),
        domFrameStyle: frameStyle,
        // Keep the measured scaled height during an ordinary state/scroll update.
        // Clearing it until the next measurement expands the document and moves
        // the viewport, even when every child has kept the same identity.
        domClipStyle: scale < 1 && this.data.domFrameStyle === frameStyle && this.data.domClipStyle.startsWith(clipStyle) ? this.data.domClipStyle : clipStyle,
        error: '',
        htmlPresentationRetry: false
      }
      Object.keys(updates).forEach(key => {
        if (updates[key] === this.data[key] || (key === 'domStyles' && JSON.stringify(updates[key]) === JSON.stringify(this.data[key]))) delete updates[key]
      })
      const viewChanged = Object.keys(updates).length > 0
      const finishRender = () => {
        if (runtime !== this._htmlRuntime) return
        this._retryHtmlPresentation = null
        if (this._loadMetrics) this._loadMetrics.domReadyAt = Date.now()
        this.finishLoading()
        if (viewChanged) {
          this.scheduleDomMeasurement(scale, contentWidth)
          this.scheduleSmilProbe(rendered.smilProbeNid)
        }
        // canvas.ops are deliberately excluded from setData. Replay the original
        // logic-side nodes only after WXML has created their native surfaces.
        this.presentDomCanvases(rendered.nodes)
        const pending = this._pendingDomRender
        this._pendingDomRender = null
        if (pending) setTimeout(() => this.renderDomState(pending.state, pending.viewportWidth), 0)
      }
      const isInitialTree = !this.data.domMode || !Array.isArray(this.data.domTree) || !this.data.domTree.length
      const chunkLimit = documentFamily().DEFAULT_DOM_CHUNK_BYTES
      if ((isInitialTree && totalBytes > PROGRESSIVE_DOM_THRESHOLD_BYTES) || payloadBytes(updates) > chunkLimit) {
        const header = { ...updates }
        for (const key of Object.keys(treePatch)) delete header[key]
        const splitHeader = payloadBytes(header) > chunkLimit - 1024
        const headerPlan = splitHeader ? documentFamily().buildDomPatchPlan(header, chunkLimit) : null
        const plan = isInitialTree
          ? documentFamily().buildProgressiveDomPlan(compacted.nodes, chunkLimit, Math.max(0, chunkLimit - payloadBytes({ ...(splitHeader ? {} : header), domTree: [] }) - 1024))
          : documentFamily().buildDomPatchPlan(treePatch, chunkLimit)
        // Many uniquely positioned table cells also produce a large style
        // dictionary. Deliver its indices before nodes reference those styles.
        const chunks = [...(headerPlan ? headerPlan.chunks : []), ...plan.chunks]
        const renderRevision = (this._domRenderRevision || 0) + 1
        this._domRenderRevision = renderRevision
        this._progressiveDomRendering = true
        if (this._loadMetrics) {
          this._loadMetrics.domBytes = totalBytes
          this._loadMetrics.domChunks = chunks.length
          this._loadMetrics.domMaxChunkBytes = Math.max(plan.maxChunkBytes, headerPlan ? headerPlan.maxChunkBytes : 0)
        }
        this.setData({ ...(splitHeader ? {} : header), ...(isInitialTree ? { domTree: plan.initial } : {}), ...loadingCopy('html-chunks', {}, { label: '正在分段排版网页…', detail: '' }) }, () => {
          let index = 0
          const applyNext = () => {
            if (renderRevision !== this._domRenderRevision || !this._htmlRuntime) {
              return
            }
            if (index >= chunks.length) {
              this._progressiveDomRendering = false
              finishRender()
              return
            }
            const patch = chunks[index++]
            this.setData(patch, () => {
              if (typeof wx.nextTick === 'function') wx.nextTick(applyNext)
              else applyNext()
            })
          }
          applyNext()
        })
        return true
      }
      if (viewChanged) this.setData(updates, finishRender)
      else finishRender()
      return true
    },

    // 正文背景色变化时通知宿主（AGI Bar 用它同步导航栏颜色）；组件自己不改导航栏。
    emitDocumentTheme (wrapperStyle) {
      const background = documentBackgroundColor(wrapperStyle)
      if (background === this._documentBackground) return
      this._documentBackground = background
      this.emit('theme', { name: this.data.sourceName, background, colorScheme: this._documentColorScheme || 'light' })
    },

    scheduleSmilProbe (nid) {
      clearTimeout(this._smilProbeTimer)
      this._smilProbeNid = null
      if (nid == null || this._smilSupport) return
      this._smilProbeNid = String(nid)
      this._smilProbeTimer = setTimeout(() => {
        this._smilProbeTimer = null
        this.rememberSmilSupport('unsupported')
        this.downgradeSmilImages()
      }, 1200)
    },

    rememberSmilSupport (status) {
      this._smilSupport = status
      if (typeof wx.setStorageSync !== 'function') return
      try { wx.setStorageSync(SMIL_SUPPORT_STORAGE_KEY, status) } catch (_) {}
    },

    downgradeSmilImages () {
      if (!this._htmlRuntime) return
      // The unsupported state is set by the probe/error handler. Use the normal
      // render diff so replacing one SVG source cannot resend all document text.
      // It also queues behind an in-flight initial render and scopes callbacks
      // to the current runtime instead of retaining a stale view snapshot.
      this.renderDomState(this._htmlRuntime.renderState(), this.readerViewportWidth())
    },

    scheduleDomMeasurement (scale, contentWidth) {
      if (!this.hasSelectorQuery()) return
      clearTimeout(this._domMeasureShort)
      clearTimeout(this._domMeasureLong)
      const runtime = this._htmlRuntime
      const measure = () => {
        if (runtime !== this._htmlRuntime) return
        // Slider scripts need the real board origin/width, not the whole viewport.
        const geometryQuery = this.selectorQuery()
        if (geometryQuery && typeof geometryQuery.selectAll === 'function') geometryQuery.selectAll('.dom-node').boundingClientRect(rects => {
          if (runtime !== this._htmlRuntime || !runtime) return
          const nodes = new Map(runtime.document.querySelectorAll('*').map(node => [String(node._nid), node]))
          for (const rect of rects || []) {
            const match = String(rect.id || '').match(/^dom-nid-(\d+)$/)
            const node = match && nodes.get(match[1])
            if (node) {
              node._layoutRect = { x: rect.left, y: rect.top, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
              node._layoutDocumentTop = rect.top + Number(runtime.window.scrollY || 0)
              node._layoutDocumentLeft = rect.left + Number(runtime.window.scrollX || 0)
            }
          }
        }).exec()
        if (scale >= 1) return
        const frameQuery = this.selectorQuery()
        if (!frameQuery || typeof frameQuery.select !== 'function') return
        frameQuery.select('.dom-render-frame').boundingClientRect(rect => {
          if (runtime !== this._htmlRuntime || !rect || !rect.height) return
          const measuredUnscaled = rect.width > contentWidth * 0.9
          const height = measuredUnscaled ? rect.height * scale : rect.height
          const style = `width:${this.data.domClipStyle.match(/width:([^;]+)/)?.[1] || '100%'};overflow:hidden;height:${Math.ceil(height)}px`
          if (style !== this.data.domClipStyle) this.setData({ domClipStyle: style })
        }).exec()
      }
      this._domMeasureShort = setTimeout(measure, 120)
      this._domMeasureLong = setTimeout(measure, 900)
    },

    disposeHtmlRuntime (keepAssets = false) {
      if (this._viewTextFragments) this._viewTextFragments.clear()
      this._viewTextFragments = null
      this._retryFamilyLoad = null
      if (this.data.fileLoadRetry) this.setData({ fileLoadRetry: false })
      this._retryHtmlPresentation = null
      if (this.data.htmlPresentationRetry) this.setData({ htmlPresentationRetry: false })
      if (this._canvasPresenter) this._canvasPresenter.dispose()
      this._canvasPresenter = null
      this._lastCanvasPresentation = null
      if (!keepAssets) {
        if (this._htmlAssets) this._htmlAssets.dispose()
        this._htmlAssets = null
      }
      clearTimeout(this._domMeasureShort)
      clearTimeout(this._domMeasureLong)
      clearTimeout(this._domMoveTimer)
      clearTimeout(this._smilProbeTimer)
      this._domRenderRevision = (this._domRenderRevision || 0) + 1
      this._progressiveDomRendering = false
      this._pendingDomRender = null
      this._standaloneSvgFallback = null
      this._pendingDomMove = null
      this._domMoveTimer = null
      this._readerGesture = null
      this._lastDomTouchKey = ''
      this._domActiveTouches = null
      this._smilProbeTimer = null
      this._smilProbeNid = null
      this._canvasRevisions = Object.create(null)
      this._canvasNodeCache = Object.create(null)
      this._svgFallbackByNid = Object.create(null)
      this._mediaStateByNid = Object.create(null)
      if (this._htmlRuntime) this._htmlRuntime.destroy()
      this._htmlRuntime = null
      this._runtimeErrors = []
      this._domRenderFailed = false
      this._staticHtmlFallback = ''
    },

    onDomTap (event) {
      if (this._readerGesture && this._readerGesture.moved && Date.now() - this._readerGesture.endedAt < 600) return
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (this._htmlRuntime && nid != null) {
        const runtime = this._htmlRuntime
        this.withDomPoint(event, (rootNid, rect) => {
          const detail = { clientX: event.detail?.x ?? 0, clientY: event.detail?.y ?? 0 }
          runtime.dispatchTap(rect ? runtime.pointTarget(rootNid, detail, rect) : rootNid)
        })
      }
      if (nid != null) this.retryHtmlPresentation()
    },

    offerHtmlPresentationRetry (error, retry) {
      if (error.code !== 'INLINE_IMAGE_WRITE_FAILED') return
      this._retryHtmlPresentation = retry
      this.setData({ htmlPresentationRetry: true })
    },

    retryReading () {
      const retry = this._retryFamilyLoad
      if (!retry) return this.retryHtmlPresentation()
      this._retryFamilyLoad = null
      this.setData({ fileLoadRetry: false })
      return retry()
    },

    retryHtmlPresentation () {
      const retry = this._retryHtmlPresentation
      if (!retry || this._progressiveDomRendering) return
      this._retryHtmlPresentation = null
      this.setData({ htmlPresentationRetry: false })
      retry()
    },

    onDomInput (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (this._htmlRuntime && nid != null) this._htmlRuntime.syncInput(nid, { value: event.detail && event.detail.value }, 'input')
    },

    onDomChanging (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (this._htmlRuntime && nid != null) this._htmlRuntime.syncInput(nid, { value: event.detail && event.detail.value }, 'input')
    },

    onDomChange (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (!this._htmlRuntime || nid == null) return
      const detail = event.detail || {}
      const patch = { value: detail.value }
      if (detail.checked != null) patch.checked = detail.checked
      this._htmlRuntime.syncInput(nid, patch, 'change')
    },

    onDomChoiceChange (event) {
      const dataset = event.currentTarget && event.currentTarget.dataset || {}
      if (!this._htmlRuntime || dataset.nid == null) return
      const node = this._htmlRuntime.getNode(dataset.nid)
      const value = event.detail && event.detail.value
      const checked = dataset.kind === 'checkbox' ? Array.isArray(value) && value.length > 0 : String(value == null ? '' : value) === String(node && node.value || 'on')
      this._htmlRuntime.syncInput(dataset.nid, { checked }, 'change', true)
    },

    onDomPickerChange (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (this._htmlRuntime && nid != null) this._htmlRuntime.syncInput(nid, { value: event.detail && event.detail.value }, 'change')
    },

    stopDomTap () {
      // 原生控件自己通过 input/change 回灌 DOM；这里只阻止外层 view 再次触发一次 click。
    },

    onDomSelect (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      if (!this._htmlRuntime || nid == null) return
      const index = Number(event.detail && event.detail.value || 0)
      this._htmlRuntime.syncInput(nid, { selectedIndex: index }, 'change')
    },

    onDomMediaError (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      const mediaToken = event.currentTarget?.dataset?.mediaToken
      if (mediaToken != null && String(mediaToken) !== String(this._mediaStateByNid?.[nid]?.token)) return
      const runtime = this._htmlRuntime
      if (runtime && nid != null) runtime.dispatchEvent(nid, 'error', { error: event.detail })
      if (runtime !== this._htmlRuntime) return
      const fallback = this._svgFallbackByNid && this._svgFallbackByNid[nid]
      if (!fallback) return
      const failed = this.findDomTreeNode(nid)
      // A non-animated SVG already uses the same sanitized source. Replacing
      // the entire tree with identical bytes cannot recover that image.
      if (!failed || failed.attrs?.src === fallback) {
        delete this._svgFallbackByNid[nid]
        return
      }
      if (failed && failed.svgHasSmil) {
        clearTimeout(this._smilProbeTimer)
        this.rememberSmilSupport('unsupported')
        this.downgradeSmilImages()
        return
      }
      const replace = nodes => (nodes || []).map(node => {
        if (String(node.nid) === String(nid)) return { ...node, attrs: { ...node.attrs, src: fallback }, svgFallbackSrc: '' }
        return node.children ? { ...node, children: replace(node.children) } : node
      })
      this.invalidateCanvasHandles()
      this.setData({ domTree: replace(this.data.domTree) })
      delete this._svgFallbackByNid[nid]
    },

    onDomMediaLoad (event) {
      const nid = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nid
      const mediaToken = event.currentTarget?.dataset?.mediaToken
      if (mediaToken != null && String(mediaToken) !== String(this._mediaStateByNid?.[nid]?.token)) return
      const runtime = this._htmlRuntime
      if (runtime && nid != null) runtime.dispatchEvent(nid, 'load', {})
      if (runtime !== this._htmlRuntime) return
      if (this._smilProbeNid == null || String(nid) !== this._smilProbeNid) return
      clearTimeout(this._smilProbeTimer)
      this._smilProbeTimer = null
      this._smilProbeNid = null
      this.rememberSmilSupport('supported')
    },

    findDomTreeNode (nid) {
      let found = null
      const visit = nodes => (nodes || []).some(node => {
        if (String(node.nid) === String(nid)) { found = node; return true }
        return visit(node.children)
      })
      visit(this.data.domTree)
      return found
    },

    presentDomCanvases (nodes) {
      const canvases = []
      const visit = list => (list || []).forEach(node => { if (node.name === 'canvas' && node.canvas) canvases.push({ nid: node.nid, canvas: node.canvas }); visit(node.children) })
      visit(nodes)
      this.presentCanvasItems(canvases)
    },

    invalidateCanvasHandles () {
      this._canvasNodeCache = Object.create(null)
      this._canvasRevisions = Object.create(null)
      if (this._canvasPresenter) this._canvasPresenter.invalidateTargets()
    },

    presentRuntimeCanvases (canvases) {
      this.presentCanvasItems(canvases || [])
    },

    presentCanvasItems (canvases) {
      if (!this.hasSelectorQuery()) return Promise.resolve([])
      this._canvasNodeCache = this._canvasNodeCache || Object.create(null)
      if (!this._canvasPresenter) {
        this._canvasPresenter = documentFamily().createCanvasPresenter({
          resolveNativeCanvas: nid => this._htmlRuntime?.nativeCanvas(nid),
          isCanvasAlive: nid => Boolean(this._htmlRuntime?.getNode(nid)),
          resolveNativeFrame: nid => this._htmlRuntime?.nativeFrame(nid),
          resolveCanvas: nid => new Promise(resolve => {
            const cache = this._canvasNodeCache
            if (cache[nid]) return resolve(cache[nid])
            const query = this.selectorQuery()
            const selection = query && typeof query.select === 'function' && query.select(`#dom-canvas-${nid}`)
            if (!selection || typeof selection.fields !== 'function') return resolve(null)
            selection.fields({ node: true, size: true }, result => {
              const canvas = result && result.node
              if (canvas && cache === this._canvasNodeCache) cache[nid] = canvas
              resolve(canvas)
            })
            query.exec()
          }),
          resolveImageSource: source => {
            if (/^data:image\/svg\+xml[;,]/i.test(source)) {
              const comma = source.indexOf(',')
              const text = /;base64,/i.test(source.slice(0, comma + 1))
                ? utf8Decode(Uint8Array.from(atobSafe(source.slice(comma + 1)), c => c.charCodeAt(0)))
                : decodeURIComponent(source.slice(comma + 1))
              const safe = documentFamily().sanitizeStandaloneSvg(text)
              return 'data:image/svg+xml;base64,' + bytesToBase64(utf8Encode(safe.fallbackSource || safe.source))
            }
            return this._htmlAssets ? this._htmlAssets.resource(source, true) : source
          },
          onError: (error, nid) => {
            this._runtimeErrors = (this._runtimeErrors || []).concat({ phase: 'canvas:present', nid, message: error.message })
            this.setData({ error: skinCopy.message('reader.presentCanvasItems.error.5d04a1', {}, 'Canvas 画面未能完成：') + error.message })
          }
        })
      }
      this._lastCanvasPresentation = this._canvasPresenter.present(canvases || [])
      return this._lastCanvasPresentation
    },

    flushPendingDomMove () {
      if (!this._pendingDomMove) return
      const pending = this._pendingDomMove
      this._pendingDomMove = null
      clearTimeout(this._domMoveTimer)
      this._domMoveTimer = null
      this.dispatchDomTouch(pending.event, 'move')
    },

    withDomPoint (event, callback) {
      const runtime = this._htmlRuntime, nid = event.currentTarget?.dataset?.nid
      if (!runtime || nid == null) return
      if (runtime.getNode(nid)?.localName !== 'svg') return callback(nid, null)
      // Serialize asynchronous view measurements so a quick up cannot overtake down.
      this._svgInputQueue = (this._svgInputQueue || Promise.resolve()).catch(() => {}).then(() => new Promise(resolve => {
        if (this._htmlRuntime !== runtime) return resolve()
        const query = this.selectorQuery(), selected = query?.select(`#dom-nid-${nid}`)
        if (!selected?.boundingClientRect) return resolve()
        selected.boundingClientRect(rect => {
          try { if (this._htmlRuntime === runtime && rect) callback(nid, rect) } finally { resolve() }
        })
        query.exec()
      }))
    },

    dispatchDomTouch (event, phase) {
      const dataset = event.currentTarget?.dataset || {}
      if (!this._htmlRuntime || dataset.nid == null || !dataset.touch) return
      const active = this._domActiveTouches || (this._domActiveTouches = new Map())
      const touches = Array.from(event.touches || [])
      // Some native hosts omit changedTouches (or send an empty array).
      // Diff live identifiers so a second finger never re-presses the first.
      let changed = Array.from(event.changedTouches?.length ? event.changedTouches : event.changeTouches || [])
      if (!changed.length) {
        if (phase === 'start') changed = touches.filter(t => !active.has(t.identifier ?? 0))
        else if (phase === 'end' || phase === 'cancel') changed = [...active.values()].filter(t => !touches.some(next => (next.identifier ?? 0) === (t.identifier ?? 0)))
        else changed = touches
      }
      if (!changed.length) return
      const touch = changed[0] || {}
      const key = `${phase}:${event.timeStamp}:${touch.identifier}:${touch.clientX ?? touch.x}:${touch.clientY ?? touch.y}`
      if (Number.isFinite(event.timeStamp) && this._lastDomTouchKey === key) return
      this._lastDomTouchKey = key
      for (const t of changed) {
        if (phase === 'end' || phase === 'cancel') active.delete(t.identifier ?? 0)
        else active.set(t.identifier ?? 0, t)
      }
      const runtime = this._htmlRuntime
      this.withDomPoint(event, (rootNid, rect) => {
        const detail = { touches: event.touches || [], changedTouches: changed, timeStamp: event.timeStamp }
        const point = t => ({ clientX: t.clientX ?? t.x ?? t.pageX ?? 0, clientY: t.clientY ?? t.y ?? t.pageY ?? 0 })
        const firstNid = rect ? runtime.pointTarget(rootNid, point(touch), rect) : rootNid
        runtime.dispatchEvent(firstNid, `touch${phase}`, detail)
        for (const t of changed) {
          const pointer = { ...detail, ...point(t), pointerId: Number(t.identifier ?? 0) + 1, pointerType: 'touch', button: 0, buttons: /end|cancel/.test(phase) ? 0 : 1 }
          const nid = rect ? runtime.pointTarget(rootNid, pointer, rect) : rootNid
          const type = { start: 'pointerdown', move: 'pointermove', end: 'pointerup', cancel: 'pointercancel' }[phase]
          if (type) runtime.dispatchEvent(nid, type, pointer)
        }
        const mouseType = { start: 'mousedown', move: 'mousemove', end: 'mouseup' }[phase]
        if (mouseType) runtime.dispatchEvent(firstNid, mouseType, { ...detail, ...point(touch), button: 0, buttons: phase === 'end' ? 0 : 1 })
      })
    },

    onDomTouchStart (event) { this.flushPendingDomMove(); this.dispatchDomTouch(event, 'start') },
    onDomTouchMove (event) {
      this._pendingDomMove = { event }
      if (!this._domMoveTimer) this._domMoveTimer = setTimeout(() => { this._domMoveTimer = null; this.flushPendingDomMove() }, 0)
    },
    onDomTouchEnd (event) { this.flushPendingDomMove(); this.dispatchDomTouch(event, 'end') },
    onDomTouchCancel (event) { this.flushPendingDomMove(); this.dispatchDomTouch(event, 'cancel') },

    onReaderTouchStart (event) {
      const point = (event.touches || event.changedTouches || [])[0]
      this._readerGesture = point ? { x: point.clientX ?? point.pageX ?? point.x ?? 0, y: point.clientY ?? point.pageY ?? point.y ?? 0, moved: false, endedAt: 0 } : null
    },
    onReaderTouchMove (event) {
      const point = (event.touches && event.touches.length ? event.touches : event.changedTouches || [])[0], gesture = this._readerGesture
      if (point && gesture && Math.hypot((point.clientX ?? point.pageX ?? point.x ?? 0) - gesture.x, (point.clientY ?? point.pageY ?? point.y ?? 0) - gesture.y) > 10) gesture.moved = true
    },
    onReaderTouchEnd (event) { this.onReaderTouchMove(event); if (this._readerGesture) this._readerGesture.endedAt = Date.now() },
    onReaderTouchCancel () { if (this._readerGesture) { this._readerGesture.moved = true; this._readerGesture.endedAt = Date.now() } },
    // 组件收不到页面滚动事件；宿主页面在 onPageScroll 里转发 scrollTop。
    syncPageScroll (scrollTop) { if (this._htmlRuntime) this._htmlRuntime.syncViewportScroll(Number(scrollTop || 0)) },
    onPageScroll (event) { this.syncPageScroll(event && event.scrollTop) },

    onDomHostAction (action) {
      if (!action) return
      if (action.type === 'anchor' && action.value) {
        const target = this._htmlRuntime && this._htmlRuntime.document.getElementById(action.value)
        if (target) this.scrollToDomNid(target._nid, 0, 300)
        else wx.pageScrollTo({ selector: `#${action.value}`, duration: 300 })
      } else if (action.type === 'scroll' && action.nid != null) {
        this.scrollToDomNid(action.nid, Number(action.offsetTop || 0), action.behavior === 'smooth' ? 300 : 0)
      } else if (action.type === 'scroll-position') {
        wx.pageScrollTo({ scrollTop: Math.max(0, Number(action.top) || 0), duration: action.behavior === 'smooth' ? 300 : 0 })
      } else if (action.type === 'link' || action.type === 'clipboard') {
        wx.setClipboardData({ data: action.value, success: () => wx.showToast({ title: skinCopy.message('reader.onDomHostAction.title.3e1fac', {}, '链接已复制'), icon: 'success' }) })
      } else if (action.type === 'edit' && action.nid != null && this._htmlRuntime && typeof wx.showModal === 'function') {
        const runtime = this._htmlRuntime
        wx.showModal({
          title: skinCopy.message('reader.onDomHostAction.title.b527a0', {}, '编辑内容'),
          content: String(action.value == null ? '' : action.value),
          editable: true,
          placeholderText: '请输入内容',
          success: result => {
            if (result.confirm && this._htmlRuntime === runtime) runtime.applyEditableText(action.nid, result.content)
          }
        })
      }
    },

    scrollToDomNid (nid, offsetTop = 0, duration = 0) {
      // 页面级 selector 查不到组件内部节点；先在组件内量出位置，再按绝对 scrollTop 滚动。
      const query = this.selectorQuery()
      if (!query || typeof query.select !== 'function' || typeof query.selectViewport !== 'function') {
        wx.pageScrollTo({ selector: `#dom-nid-${nid}`, offsetTop: Number(offsetTop || 0), duration })
        return
      }
      query.select(`#dom-nid-${nid}`).boundingClientRect()
      query.selectViewport().scrollOffset()
      query.exec(results => {
        const rect = results && results[0]
        const viewport = results && results[1]
        if (!rect) return
        const scrollTop = Number(rect.top || 0) + Number(viewport && viewport.scrollTop || 0) + Number(offsetTop || 0)
        wx.pageScrollTo({ scrollTop: Math.max(0, scrollTop), duration })
      })
    },

    onRenderLoad () {
      wx.hideLoading()
      this.finishLoading()
    },

    onRenderError (event) {
      this.stopLoadingWithError(skinCopy.message('reader.onRenderError.error.64ca9e', { detail: event.detail && event.detail.errMsg ? event.detail.errMsg : '未知错误' }, `部分内容排版失败：${event.detail && event.detail.errMsg ? event.detail.errMsg : '未知错误'}`))
    },

    onLinkTap (event) {
      const href = event.detail && event.detail.href
      if (!href || href[0] === '#') return
      wx.setClipboardData({
        data: href,
        success: () => wx.showToast({ title: skinCopy.message('reader.onLinkTap.title.3e1fac', {}, '链接已复制'), icon: 'success' })
      })
    },
  }
})

module.exports = { _internals: { diffDomValue, documentBackgroundColor, domTreePatch, isArchivePasswordError, subpackage } }
