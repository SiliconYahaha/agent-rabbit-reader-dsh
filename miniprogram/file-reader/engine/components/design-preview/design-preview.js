'use strict'

const { compositeRgbaOnCheckerboard, extensionOf, extractLegacyAiPreview, extractLegacyAiRasterPreview, extractPsdComposite, extractPsdThumbnail, formatBytes, isPdfCompatibleAi, parsePsdHeader } = require('../../core/design-file')
const skinCopy = require('../../../skin/copy')
const { mimeTypeOf } = require('../../../shared/file-types')
const encodeJpeg = require('../../core/vendor/jpeg-encoder')

const MAX_RESOURCE_BYTES = 16 * 1024 * 1024
const MAX_COMPOSITE_FILE_BYTES = 40 * 1024 * 1024
const MAX_COMPOSITE_PIXELS = 2_000_000
const MAX_LEGACY_AI_BYTES = 20 * 1024 * 1024

let previewSequence = 0
function previewFile (prefix, extension) {
  // Clock milliseconds are not unique. A late write must never target the
  // file currently displayed by another load, even before revision guards run.
  return `${wx.env.USER_DATA_PATH}/${prefix}-${Date.now()}-${++previewSequence}.${extension}`
}

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    // 要预览的设计文件：{ name, path, size, type }。每次设置都会重新读取。
    file: { type: Object, value: null }
  },

  observers: {
    file (file) {
      if (file && file.path) this.loadMaterial(file)
    }
  },

  lifetimes: {
    detached () { this._materialRevision = (this._materialRevision || 0) + 1 }
  },

  data: {
    name: '设计文件',
    sizeLabel: '',
    extensionLabel: 'FILE',
    skinMark: 'FILE',
    skinLoadingText: '',
    skinMetadataTitle: '',
    skinOpenPdfText: '',
    loading: true,
    previewPath: '',
    metadata: [],
    message: '',
    error: '',
    canOpenPdf: false
  },

  methods: {
    loadMaterial (material) {
      const revision = (this._materialRevision || 0) + 1
      this._materialRevision = revision
      this.material = material
      const extension = extensionOf(material.name)
      const copy = skinCopy.design({ extension, name: material.name || '设计文件' }, { size: formatBytes(material.size) }) || {}
      this.setData({
        name: copy.name || material.name || '设计文件',
        sizeLabel: copy.size || formatBytes(material.size),
        extensionLabel: copy.mark || (extension === 'ai' ? 'Ai' : extension ? extension.toUpperCase() : 'FILE'),
        skinMark: copy.mark || (extension === 'ai' ? 'Ai' : extension ? extension.toUpperCase() : 'FILE'),
        skinLoadingText: copy.loading || '正在读取文件预览……',
        skinMetadataTitle: copy.metadataTitle || '文件信息',
        skinOpenPdfText: copy.openPdf || '打开 Ai 内嵌 PDF',
        loading: true,
        previewPath: '',
        metadata: [],
        message: '',
        error: '',
        canOpenPdf: false
      })
      if (extension === 'psd' || extension === 'psb' || mimeTypeOf(material) === 'application/x-photoshop') this.loadPsd(material, revision)
      else this.loadAi(material, revision)
    },

    readBinary (filePath, position, length, fileSize = 0) {
      return new Promise((resolve, reject) => {
        const fileSystem = wx.getFileSystemManager()
        const safePosition = Math.max(0, Number(position) || 0)
        const requestedLength = Math.max(0, Number(length) || 0)
        const knownSize = Math.max(0, Number(fileSize) || 0)
        const safeLength = knownSize > 0 ? Math.min(requestedLength, Math.max(0, knownSize - safePosition)) : requestedLength
        if (!safeLength) {
          resolve(new ArrayBuffer(0))
          return
        }
        const readOptions = {
          filePath,
          success: result => resolve(result.data),
          fail: error => {
            // 某些微信真机文件系统会在请求长度恰好越过短文件末尾时直接失败。
            // 只有从文件头读取且确认是长度越界时才退回整文件读取；此时实际文件
            // 小于请求的头部长度，不会意外把大型设计文件整体载入内存。
            if (safePosition === 0 && /length is out of range/i.test(String(error && (error.errMsg || error.message || error)))) {
              fileSystem.readFile({ filePath, success: result => resolve(result.data), fail: reject })
            } else reject(error)
          }
        }
        readOptions.position = safePosition
        readOptions.length = safeLength
        fileSystem.readFile(readOptions)
      })
    },

    readWholeBinary (filePath) {
      return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
        filePath,
        success: result => resolve(result.data),
        fail: reject
      }))
    },

    async loadPsd (material, revision) {
      try {
        const headerBuffer = await this.readBinary(material.path, 0, 30, material.size)
        const header = parsePsdHeader(headerBuffer)
        const lengthBuffer = await this.readBinary(material.path, header.resourceLengthOffset, 4, material.size)
        const lengthBytes = new Uint8Array(lengthBuffer)
        const resourceLength = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, lengthBytes.byteLength).getUint32(0, false)
        if (revision !== this._materialRevision) return
        const metadata = [
          { label: skinCopy.message('design.loadPsd.label.9d2601', {}, '格式'), value: header.kind },
          { label: skinCopy.message('design.loadPsd.label.95b210', {}, '画布'), value: `${header.width} × ${header.height} px` },
          { label: skinCopy.message('design.loadPsd.label.8ef488', {}, '颜色'), value: `${header.colorModeName} · ${header.depth} bit` },
          { label: skinCopy.message('design.loadPsd.label.f3c5b9', {}, '通道'), value: String(header.channels) }
        ]
        // A JPEG thumbnail cannot preserve the document's transparency and may
        // be much smaller than its canvas. Prefer bounded full composite data.
        const fallback = await this.loadPsdComposite(material, header, metadata, revision)
        if (fallback.opened || revision !== this._materialRevision) return
        // Read/decode the thumbnail only when the saved full composite cannot
        // be shown. Raw thumbnails should not add work to ordinary PSD opens.
        const readableLength = Math.min(resourceLength, MAX_RESOURCE_BYTES)
        const resourceBuffer = readableLength ? await this.readBinary(material.path, header.resourceLengthOffset + 4, readableLength, material.size) : new ArrayBuffer(0)
        if (revision !== this._materialRevision) return
        const thumbnail = extractPsdThumbnail(resourceBuffer)
        if (thumbnail) {
          const jpeg = thumbnail.jpeg || encodeJpeg({ data: thumbnail.rgba, width: thumbnail.width, height: thumbnail.height }, 82).data
          const previewPath = previewFile('psd-preview', 'jpg')
          await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
            filePath: previewPath,
            data: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
            success: resolve,
            fail: reject
          }))
          if (revision !== this._materialRevision) return
          metadata.push({ label: skinCopy.message('design.loadPsd.label.de61aa', {}, '预览'), value: `${thumbnail.width} × ${thumbnail.height} px` })
          this.setData({ loading: false, previewPath, metadata, message: skinCopy.message('design.loadPsd.message.af05ff', { detail: fallback.reason }, `合成画面暂未能还原：${fallback.reason}。当前显示文件内嵌缩略图，不代表完整分辨率或透明度；图层、蒙版和文字仍保留在原文件中。`) })
        } else {
          this.setData({
            loading: false,
            metadata,
            message: resourceLength > MAX_RESOURCE_BYTES
              ? '已读出 PSD 画布信息，但预览资源过大，暂时没有找到可直接显示的内嵌缩略图。'
              : `这个 PSD 未找到可用缩略图，合成图也未能还原：${fallback.reason || '文件没有可支持的 1/8/16/32-bit Raw/RLE/ZIP 合成数据'}。图层信息仍保留在原文件中。`
          })
        }
      } catch (error) {
        if (revision === this._materialRevision) this.setData({ loading: false, error: skinCopy.message('design.loadPsd.error.1cb58c', { detail: error.errMsg || error.message || error }, `PSD 解析失败：${error.errMsg || error.message || error}`) })
      }
    },

    async loadPsdComposite (material, header, metadata, revision) {
      const size = Number(material.size || 0)
      if (!size) return { opened: false, reason: '微信没有提供文件大小' }
      if (size > MAX_COMPOSITE_FILE_BYTES) return { opened: false, reason: `文件超过 ${formatBytes(MAX_COMPOSITE_FILE_BYTES)} 本机合成上限` }
      if (header.width * header.height > MAX_COMPOSITE_PIXELS) return { opened: false, reason: `画布超过 ${MAX_COMPOSITE_PIXELS.toLocaleString()} 像素本机合成上限` }
      try {
        const fileBuffer = await this.readBinary(material.path, 0, size, size)
        const composite = extractPsdComposite(fileBuffer, { maxPixels: MAX_COMPOSITE_PIXELS })
        const jpegPixels = composite.transparentPixels
          ? compositeRgbaOnCheckerboard(composite.rgba, composite.width)
          : composite.rgba
        const jpeg = encodeJpeg({ data: jpegPixels, width: composite.width, height: composite.height }, 82)
        const previewPath = previewFile('psd-composite', 'jpg')
        await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
          filePath: previewPath,
          data: jpeg.data.buffer.slice(jpeg.data.byteOffset, jpeg.data.byteOffset + jpeg.data.byteLength),
          success: resolve,
          fail: reject
        }))
        if (revision !== this._materialRevision) return { opened: false, reason: '文件已切换' }
        metadata.push({ label: skinCopy.message('design.loadPsdComposite.label.0aada1', {}, '合成预览'), value: `${composite.width} × ${composite.height} px · ${composite.depth} bit · ${composite.compression}` })
        if (composite.colorProfile) metadata.push({
          label: skinCopy.message('design.loadPsdComposite.label.1d59d4', {}, '色彩预览'),
          value: composite.colorProfile === 'applied'
            ? skinCopy.message('design.loadPsdComposite.value.5383bf', {}, '已按文件色彩配置还原')
            : composite.colorProfile === 'invalid'
              ? skinCopy.message('design.loadPsdComposite.value.e22f6f', {}, '色彩配置损坏，当前颜色可能有偏差')
              : skinCopy.message('design.loadPsdComposite.value.cfff0c', {}, '暂不支持此色彩配置，当前颜色可能有偏差')
        })
        if (header.colorMode === 4 && !composite.colorProfile) metadata.push({ label: skinCopy.message('design.loadPsdComposite.label.1d59d4', {}, '色彩预览'), value: skinCopy.message('design.loadPsdComposite.value.0fb8c8', {}, 'CMYK 近似颜色（未应用 ICC 配置）') })
        if (composite.transparentPixels) metadata.push(composite.transparentIndex != null
          ? { label: skinCopy.message('design.loadPsdComposite.label.844bb0', {}, '透明索引'), value: `${composite.transparentIndex} · ${composite.transparentPixels} 像素` }
          : { label: skinCopy.message('design.loadPsdComposite.label.3fdf0c', {}, '合成透明度'), value: `${composite.transparentPixels} 个透明或半透明像素 · 棋盘格` })
        this.setData({ loading: false, previewPath, metadata, message: composite.transparentPixels
          ? '当前画面由 PSD 保存的合成通道在本机还原；透明及半透明区域以棋盘格显示。独立图层、蒙版和文字仍保留在原文件中。'
          : '当前画面由 PSD 保存的合成通道在本机还原；独立图层、蒙版和文字仍保留在原文件中。' })
        return { opened: true }
      } catch (error) {
        return { opened: false, reason: error.errMsg || error.message || String(error) }
      }
    },

    async loadAi (material, revision) {
      try {
        const header = await this.readBinary(material.path, 0, 4096, material.size)
        if (revision !== this._materialRevision) return
        const compatible = isPdfCompatibleAi(header)
        if (compatible) {
          this.setData({
            loading: false,
            canOpenPdf: true,
            previewPath: material.samplePreview || '',
            metadata: [
              { label: skinCopy.message('design.loadAi.label.9d2601', {}, '格式'), value: 'Adobe Illustrator' },
              { label: skinCopy.message('design.loadAi.label.08be1e', {}, 'PDF 预览'), value: '已内嵌' }
            ],
            message: material.samplePreview
              ? '已显示画板预览，也可打开内嵌 PDF 放大查看。'
              : skinCopy.message('design.loadAi.message.f16e51', {}, '检测到 Illustrator 内嵌 PDF，可以使用微信文档查看器显示画板。正在直接打开……')
          })
          if (!material.samplePreview) this.openAiPdf()
          return
        }

        const size = Math.max(0, Number(material.size) || 0)
        if (size > MAX_LEGACY_AI_BYTES) {
          this.setData({
            loading: false,
            metadata: [
              { label: skinCopy.message('design.loadAi.label.9d2601', {}, '格式'), value: 'Adobe Illustrator' },
              { label: skinCopy.message('design.loadAi.label.08be1e', {}, 'PDF 预览'), value: '未内嵌' }
            ],
            message: skinCopy.message('design.loadAi.message.4cb97a', { size: formatBytes(MAX_LEGACY_AI_BYTES) }, `这个旧式 Ai 没有内嵌 PDF，且文件超过 ${formatBytes(MAX_LEGACY_AI_BYTES)} 本机矢量解析上限。请在 Illustrator 中重新保存并开启 PDF 兼容。`)
          })
          return
        }

        const fileBuffer = size ? await this.readBinary(material.path, 0, size, size) : await this.readWholeBinary(material.path)
        try {
          const preview = extractLegacyAiPreview(fileBuffer, { maxBytes: MAX_LEGACY_AI_BYTES })
          const previewPath = previewFile('illustrator-legacy-preview', 'svg')
          await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
            filePath: previewPath,
            data: preview.svg,
            encoding: 'utf8',
            success: resolve,
            fail: reject
          }))
          if (revision !== this._materialRevision) return
          this.setData({
            loading: false,
            previewPath,
            metadata: [
              { label: skinCopy.message('design.loadAi.label.9d2601', {}, '格式'), value: '旧式 Adobe Illustrator / EPS' },
              { label: skinCopy.message('design.loadAi.label.08be1e', {}, 'PDF 预览'), value: '未内嵌' },
              { label: skinCopy.message('design.loadAi.label.95b210', {}, '画布'), value: `${Math.round(preview.width * 10) / 10} × ${Math.round(preview.height * 10) / 10} pt` },
              { label: skinCopy.message('design.loadAi.label.c9530c', {}, '基础路径'), value: `${preview.paths} 条 · ${preview.points} 个控制点` },
              { label: skinCopy.message('design.loadAi.label.175f8a', {}, '画布范围'), value: preview.boundingBoxSource }
            ],
            message: skinCopy.message('design.loadAi.message.26eb63', { value: preview.truncated ? '；文件内容较复杂，当前画面已达到安全解析上限' : '' }, `已在本机安全还原旧式 Ai 的基础矢量路径、颜色、描边和常见变换${preview.truncated ? '；文件内容较复杂，当前画面已达到安全解析上限' : ''}。渐变、剪切蒙版、文字字体、链接图片和 Illustrator 专有效果仍可能缺失。`)
          })
        } catch (legacyError) {
          if (revision !== this._materialRevision) return
          try {
            const raster = extractLegacyAiRasterPreview(fileBuffer, { maxBytes: MAX_LEGACY_AI_BYTES })
            const previewPath = previewFile('illustrator-epsi-preview', 'jpg')
            await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
              filePath: previewPath,
              data: raster.jpeg.buffer.slice(raster.jpeg.byteOffset, raster.jpeg.byteOffset + raster.jpeg.byteLength),
              success: resolve,
              fail: reject
            }))
            if (revision !== this._materialRevision) return
            this.setData({
              loading: false,
              previewPath,
              metadata: [
                { label: skinCopy.message('design.loadAi.label.9d2601', {}, '格式'), value: '旧式 Adobe Illustrator / EPS' },
                { label: skinCopy.message('design.loadAi.label.08be1e', {}, 'PDF 预览'), value: '未内嵌' },
                { label: skinCopy.message('design.loadAi.label.3ac624', {}, '屏幕预览'), value: `${raster.width} × ${raster.height} px · ${raster.depth} bit` },
                { label: skinCopy.message('design.loadAi.label.6edd72', {}, '预览来源'), value: raster.source }
              ],
              message: skinCopy.message('design.loadAi.message.f0f1e9', {}, '基础矢量解释器没有找到可安全还原的路径，但文件内含用于屏幕显示的 EPSI 位图预览，已原样解码为可见画面。它可能是低分辨率预览，不代表完整可编辑内容。')
            })
          } catch (rasterError) {
            if (revision !== this._materialRevision) return
            this.setData({
              loading: false,
              metadata: [
                { label: skinCopy.message('design.loadAi.label.9d2601', {}, '格式'), value: 'Adobe Illustrator' },
                { label: skinCopy.message('design.loadAi.label.08be1e', {}, 'PDF 预览'), value: '未内嵌' },
                { label: skinCopy.message('design.loadAi.label.23a052', {}, 'EPSI 位图'), value: '未找到' }
              ],
              message: skinCopy.message('design.loadAi.message.8825e5', { detail: legacyError.errMsg || legacyError.message || legacyError, detail2: rasterError.errMsg || rasterError.message || rasterError }, `这个 Ai 没有内嵌 PDF，也没有找到可安全还原的旧式基础矢量画面或文件内屏幕预览。矢量检查：${legacyError.errMsg || legacyError.message || legacyError}；位图检查：${rasterError.errMsg || rasterError.message || rasterError}。请在 Illustrator 中重新保存并开启 PDF 兼容。`)
            })
          }
        }
      } catch (error) {
        if (revision === this._materialRevision) this.setData({ loading: false, error: skinCopy.message('design.loadAi.error.c3cc62', { detail: error.errMsg || error.message || error }, `Ai 文件检测失败：${error.errMsg || error.message || error}`) })
      }
    },

    openAiPdf () {
      if (!this.material || !this.data.canOpenPdf) return
      const revision = this._materialRevision
      const destination = previewFile('illustrator-preview', 'pdf')
      wx.getFileSystemManager().copyFile({
        srcPath: this.material.path,
        destPath: destination,
        success: () => {
          if (revision !== this._materialRevision) return
          wx.openDocument({
            filePath: destination,
            fileType: 'pdf',
            showMenu: true,
            fail: error => { if (revision === this._materialRevision) this.setData({ error: skinCopy.message('design.openAiPdf.error.7267f9', { detail: error.errMsg || '未知错误' }, `Ai 内嵌 PDF 打开失败：${error.errMsg || '未知错误'}`) }) }
          })
        },
        fail: error => { if (revision === this._materialRevision) this.setData({ error: skinCopy.message('design.openAiPdf.error.4b747c', { detail: error.errMsg || '未知错误' }, `Ai 预览准备失败：${error.errMsg || '未知错误'}`) }) }
      })
    },

    onImageError (event) {
      this.setData({ error: skinCopy.message('design.onImageError.error.0bb046', { detail: event.detail && event.detail.errMsg ? event.detail.errMsg : '未知错误' }, `设计文件预览显示失败：${event.detail && event.detail.errMsg ? event.detail.errMsg : '未知错误'}`) })
    },
  }
})
