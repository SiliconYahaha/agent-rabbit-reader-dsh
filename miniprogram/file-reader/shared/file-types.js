'use strict'

const { extensionOf } = require('./file-names')
const { isArchiveVolumeName } = require('./archive-volumes')

const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'xht'])
const DESIGN_EXTENSIONS = new Set(['ai', 'ait', 'eps', 'psd', 'psb', 'psdt', 'fig', 'sketch'])
const NATIVE_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const SVG_EXTENSIONS = new Set(['svg'])
const SOURCE_TEXT_EXTENSIONS = new Set(['base', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'log', 'js', 'mjs', 'cjs', 'ts', 'css', 'py', 'sh', 'sql', 'ini', 'toml', 'conf'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', ...SOURCE_TEXT_EXTENSIONS])
const SOURCE_TEXT_MIME_TYPES = new Set(['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'text/xml', 'text/csv', 'text/tab-separated-values', 'text/yaml', 'text/x-yaml', 'text/javascript', 'text/css', 'application/javascript', 'application/x-javascript', 'text/x-python', 'application/sql'])
const AUDIO_EXTENSIONS = new Set(['flac', 'm4a', 'ogg', 'ape', 'amr', 'wma', 'wav', 'mp3', 'aac', 'aiff', 'aif', 'caf'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', '3gp', 'avi', 'm3u8', 'webm'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar'])
const CAD_EXTENSIONS = new Set(['dwg', 'cdr', 'dxf', 'stp', 'step'])
const RTF_EXTENSIONS = new Set(['rtf'])
const SUPPORTED_EXTENSIONS = [
  ...HTML_EXTENSIONS,
  ...DESIGN_EXTENSIONS,
  ...NATIVE_DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...SVG_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
  ...CAD_EXTENSIONS,
  ...RTF_EXTENSIONS
]

const SUPPORTED_MIME_TYPES = new Set([
  'text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'image/svg+xml',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-photoshop', 'application/postscript',
  'application/zip', 'application/vnd.rar', 'application/x-7z-compressed', 'application/x-tar', 'application/tar', 'application/x-gtar',
  'application/acad', 'application/x-cdr', 'application/dxf', 'application/step',
  'application/rtf'
])

const NATIVE_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])

// Compare only the media type. Preserve the original header on the material:
// text decoding still needs charset parameters and metadata needs the raw value.
function mimeTypeOf (file) {
  return String(file && file.type || '').split(';')[0].trim().toLowerCase()
}

function mimeParametersOf (file) {
  const header = String(file && file.type || '')
  const parameters = []
  let offset = header.indexOf(';')
  if (offset < 0) return parameters
  offset++
  while (offset < header.length) {
    while (offset < header.length && /[\s;]/.test(header[offset])) offset++
    const start = offset
    while (offset < header.length && header[offset] !== '=' && header[offset] !== ';') offset++
    const name = header.slice(start, offset).trim().toLowerCase()
    if (header[offset] !== '=') { if (name) parameters.push({ name, value: '', valid: false }); offset++; continue }
    offset++
    while (/\s/.test(header[offset] || '\0')) offset++
    let value = '', valid = true
    const quote = header[offset]
    // Single quotes retain the older host-header compatibility; standard
    // double-quoted values honor quoted-pair escapes and embedded semicolons.
    if (quote === '"' || quote === "'") {
      offset++; let closed = false
      while (offset < header.length) {
        const char = header[offset++]
        if (char === '\\' && offset < header.length) { const escaped = header[offset++]; if (/[\r\n\0]/.test(escaped)) valid = false; value += escaped }
        else if (char === quote) { closed = true; break }
        else { if (/[\r\n\0]/.test(char)) valid = false; value += char }
      }
      valid = valid && closed
      while (/\s/.test(header[offset] || '\0')) offset++
      if (offset < header.length && header[offset] !== ';') valid = false
      while (offset < header.length && header[offset] !== ';') offset++
    } else {
      const begin = offset
      while (offset < header.length && header[offset] !== ';') offset++
      value = header.slice(begin, offset).trim()
      valid = /^[!#$%&'*+.^_`|~a-z0-9-]+$/i.test(value)
    }
    parameters.push({ name, value, valid })
    if (header[offset] === ';') offset++
  }
  return parameters
}

function isMarkdownFile (file) {
  const extension = extensionOf(file && file.name)
  const type = mimeTypeOf(file)
  if (extension === 'txt' || SOURCE_TEXT_EXTENSIONS.has(extension)) return false
  return extension === 'md' || extension === 'markdown' || type === 'text/markdown' || type === 'text/x-markdown'
}

function textDataFormat (file) {
  const extension = extensionOf(file && file.name)
  const type = mimeTypeOf(file)
  if (extension === 'base') return 'base'
  if (extension === 'json') return 'json'
  if (extension === 'csv') return 'csv'
  if (extension === 'txt') return 'text'
  if (TEXT_EXTENSIONS.has(extension)) return 'source'
  if (type === 'application/json' || /^application\/[\w.-]+\+json$/.test(type)) return 'json'
  if (type === 'text/csv') return 'csv'
  return SOURCE_TEXT_MIME_TYPES.has(type) ? 'source' : 'text'
}

function fileKind (file) {
  const extension = extensionOf(file && file.name)
  const type = mimeTypeOf(file)
  // Known source/data files stay read-only even if a provider labels embedded
  // markup as HTML, Markdown, media or application/octet-stream.
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (HTML_EXTENSIONS.has(extension) || type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (DESIGN_EXTENSIONS.has(extension) || type === 'application/x-photoshop' || type === 'application/postscript') return 'design'
  if (NATIVE_DOCUMENT_EXTENSIONS.has(extension) || NATIVE_DOCUMENT_MIME_TYPES.has(type)) return 'document'
  if (SVG_EXTENSIONS.has(extension) || type === 'image/svg+xml') return 'svg'
  if (IMAGE_EXTENSIONS.has(extension) || type.startsWith('image/')) return 'image'
  if (TEXT_EXTENSIONS.has(extension) || type === 'text/plain' || SOURCE_TEXT_MIME_TYPES.has(type) || /^application\/[\w.-]+\+json$/.test(type) || isMarkdownFile(file)) return 'text'
  if (RTF_EXTENSIONS.has(extension) || type === 'application/rtf') return 'rtf'
  if (ARCHIVE_EXTENSIONS.has(extension) || isArchiveVolumeName(file && file.name) || type === 'application/zip' || type === 'application/vnd.rar' || type === 'application/x-7z-compressed' || ['application/x-tar', 'application/tar', 'application/x-gtar'].includes(type)) return 'archive'
  if (CAD_EXTENSIONS.has(extension) || type === 'application/acad' || type === 'application/x-cdr' || type === 'application/dxf' || type === 'application/step') return 'cad'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  // 微信官方聊天素材清单包含 application/*。未知二进制不能静默丢弃，
  // 交给本机检查器显示类型、大小、文件头和校验值，至少给用户可判断的信息。
  if (type.startsWith('application/')) return 'binary'
  return 'unsupported'
}

function isSupportedMaterial (material) {
  if (!material || !material.path) return false
  const type = mimeTypeOf(material)
  return fileKind(material) !== 'unsupported' || SUPPORTED_MIME_TYPES.has(type) || /^(image|audio|video)\//.test(type) || type.startsWith('application/')
}

function htmlContentType (file) {
  const type = mimeTypeOf(file)
  if (type === 'text/html' || type === 'application/xhtml+xml') return type
  return /^(?:xhtml|xht)$/.test(extensionOf(file && file.name)) ? 'application/xhtml+xml' : 'text/html'
}

module.exports = {
  ARCHIVE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  CAD_EXTENSIONS,
  DESIGN_EXTENSIONS,
  HTML_EXTENSIONS,
  IMAGE_EXTENSIONS,
  NATIVE_DOCUMENT_EXTENSIONS,
  RTF_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
  SOURCE_TEXT_EXTENSIONS,
  SVG_EXTENSIONS,
  TEXT_EXTENSIONS,
  VIDEO_EXTENSIONS,
  fileKind,
  htmlContentType,
  mimeTypeOf,
  mimeParametersOf,
  isSupportedMaterial,
  isMarkdownFile,
  textDataFormat
}
