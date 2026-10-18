'use strict'

// Read only the preview saved by the author. Never execute design plugins or
// approximate a full editable canvas with unrelated images from the archive.
const { inspectZip, readZipDirectoryDescriptor, extractZipEntry, decodeUtf8 } = require('./file-inspector')
const MAX_PACKAGE_BYTES = 40 * 1024 * 1024
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
// Sketch stores shared styles and symbols in document.json, independently of
// its small saved PNG. Keep a separate bounded budget from package metadata.
const MAX_SKETCH_DOCUMENT_BYTES = 16 * 1024 * 1024

function pngSize (data) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (data.length < 33 || !signature.every((v, i) => data[i] === v) || String.fromCharCode(...data.slice(12, 16)) !== 'IHDR') throw new Error('文件内的预览不是有效 PNG')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16_000_000) throw new Error('预览画面过大，未加载')
  return { width, height }
}

function extractDesignPackage (input, extension) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!['fig', 'sketch'].includes(extension)) throw new Error('暂不支持这种设计源文件')
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('设计文件超过 40 MB，暂不加载')
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error(extension === 'fig' ? '这份 FIG 不是带预览的 Figma 本地副本，请导出 SVG、PNG 或 PDF 后查看' : '这份 Sketch 不是现代文档包，请导出 SVG、PNG 或 PDF 后查看')
  const descriptor = readZipDirectoryDescriptor(bytes)
  if (descriptor.zip64 || descriptor.count > 4096) throw new Error('设计文件目录过大或为 ZIP64，暂不加载')
  const entries = inspectZip(bytes).zipIdentityEntries
  function member (name) {
    const matches = entries.filter(e => e.name === name)
    if (matches.length > 1) throw new Error('设计包包含重名条目，无法确定预览来源')
    const entry = matches[0]
    if (entry && (entry.isDirectory || entry.isLink || !entry.canOpen)) throw new Error('设计包预览条目已加密、为链接或压缩方式不受支持')
    return entry
  }
  function json (name, maxSize = 2 * 1024 * 1024) {
    const entry = member(name)
    if (!entry) throw new Error('设计包缺少 ' + name)
    try { return JSON.parse(decodeUtf8(extractZipEntry(bytes, entry, { maxSize }))) } catch (error) { throw new Error(name + ' 读取失败：' + error.message) }
  }
  const meta = json('meta.json')
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('设计包元数据无效')
  let title, message, previewName, pageCount = null
  if (extension === 'sketch') {
    const document = json('document.json', MAX_SKETCH_DOCUMENT_BYTES)
    if (!document || document._class !== 'document' || !Array.isArray(document.pages)) throw new Error('这不是有效的 Sketch 文档结构')
    title = 'Sketch'; pageCount = document.pages.length; previewName = 'previews/preview.png'
    message = '显示文件保存的最后编辑页预览，不包含全部画板；不播放原型或编辑图层。'
  } else {
    const canvasEntry = member('canvas.fig')
    if (!canvasEntry) throw new Error('设计包缺少 Figma 画布数据')
    const canvas = extractZipEntry(bytes, canvasEntry, { maxSize: 24 * 1024 * 1024 })
    if (String.fromCharCode(...canvas.slice(0, 8)) !== 'fig-kiwi') throw new Error('这不是可识别的 Figma 画布数据')
    title = 'Figma'; previewName = 'thumbnail.png'
    message = '显示文件保存的缩略预览，不是完整 Figma 画布；不播放原型或编辑图层。'
  }
  const entry = member(previewName)
  if (!entry) return { title, pageCount, message: '文件没有保存可用预览。请在原软件中导出 SVG、PNG 或 PDF 后查看。', preview: null }
  const preview = extractZipEntry(bytes, entry, { maxSize: MAX_PREVIEW_BYTES })
  return { title, pageCount, message, preview, ...pngSize(preview) }
}

module.exports = { extractDesignPackage, MAX_PACKAGE_BYTES }
