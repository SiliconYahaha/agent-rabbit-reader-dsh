'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const zlib = require('node:zlib')

const jpeg = require('jpeg-js')
const { compositeRgbaOnCheckerboard, extensionOf, extractLegacyAiPreview, extractLegacyAiRasterPreview, extractPsdComposite, extractPsdThumbnail, formatBytes, isPdfCompatibleAi, parsePsdHeader } = require('../miniprogram/file-reader/engine/core/design-file')
const { fileKind, isSupportedMaterial, SUPPORTED_EXTENSIONS } = require('../miniprogram/file-reader/shared/file-types')

test('文件名末尾空格不丢失扩展名路由，原名称和路径不被重写', () => {
  for (const extension of SUPPORTED_EXTENSIONS) {
    for (const padding of [' ', '  ', '\t']) {
      const name = ` 前缀----------文件.${extension.toUpperCase()}${padding}`
      const file = { name, path: `/local/${name}` }
      const before = { ...file }
      assert.equal(extensionOf(name), extension)
      assert.equal(fileKind(file), fileKind({ name: `example.${extension}` }))
      assert.equal(isSupportedMaterial(file), true)
      assert.deepEqual(file, before)
    }
  }
  assert.equal(extensionOf('report.txt.exe '), 'exe')
  assert.equal(fileKind({ name: 'report.txt.exe ' }), 'unsupported')
  assert.equal(extensionOf('report.txt .'), '')
})

function makePsdHeader ({ version = 1, channels = 4, height = 1080, width = 1920, depth = 8, colorMode = 3, colorDataLength = 0 } = {}) {
  const bytes = new Uint8Array(30)
  bytes.set(Buffer.from('8BPS'))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, version, false)
  view.setUint16(12, channels, false)
  view.setUint32(14, height, false)
  view.setUint32(18, width, false)
  view.setUint16(22, depth, false)
  view.setUint16(24, colorMode, false)
  view.setUint32(26, colorDataLength, false)
  return bytes
}

function makeThumbnailResource () {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])
  const dataSize = 28 + jpeg.length
  const output = new Uint8Array(4 + 2 + 2 + 4 + dataSize)
  output.set(Buffer.from('8BIM'), 0)
  const view = new DataView(output.buffer)
  view.setUint16(4, 1036, false)
  output[6] = 0
  output[7] = 0
  view.setUint32(8, dataSize, false)
  view.setUint32(12, 1, false)
  view.setUint32(16, 320, false)
  view.setUint32(20, 180, false)
  view.setUint32(32, jpeg.length, false)
  output.set(jpeg, 40)
  return output
}

function makeRawCompositePsd () {
  const header = makePsdHeader({ width: 2, height: 1, channels: 3, depth: 8, colorMode: 3 })
  const sections = new Uint8Array(4 + 4 + 2)
  const data = Uint8Array.from([255, 0, 0, 255, 0, 0])
  return Uint8Array.from([...header, ...sections, ...data])
}

function makeRleCompositePsd () {
  const header = makePsdHeader({ width: 3, height: 1, channels: 3, depth: 8, colorMode: 3 })
  const sections = new Uint8Array(4 + 4 + 2 + 6)
  const view = new DataView(sections.buffer)
  view.setUint16(8, 1, false)
  view.setUint16(10, 4, false); view.setUint16(12, 4, false); view.setUint16(14, 4, false)
  const packed = Uint8Array.from([2, 255, 0, 0, 2, 0, 255, 0, 2, 0, 0, 255])
  return Uint8Array.from([...header, ...sections, ...packed])
}

function makeZipCompositePsd ({ prediction = false } = {}) {
  const width = 3
  const height = 2
  const channels = 3
  const header = makePsdHeader({ width, height, channels, depth: 8, colorMode: 3 })
  const planar = Uint8Array.from([
    10, 20, 40, 100, 110, 120,
    5, 15, 25, 200, 180, 160,
    1, 2, 4, 50, 60, 70
  ])
  const encoded = new Uint8Array(planar)
  if (prediction) {
    const planeBytes = width * height
    for (let channel = 0; channel < channels; channel++) {
      for (let row = 0; row < height; row++) {
        const start = channel * planeBytes + row * width
        for (let column = width - 1; column > 0; column--) {
          const index = start + column
          encoded[index] = (encoded[index] - encoded[index - 1] + 256) & 0xff
        }
      }
    }
  }
  const sections = new Uint8Array(4 + 4 + 2)
  new DataView(sections.buffer).setUint16(8, prediction ? 3 : 2, false)
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(encoded)])
}

function make16BitCompositePsd ({ compression = 0 } = {}) {
  const width = 3
  const height = 2
  const channels = 3
  const header = makePsdHeader({ width, height, channels, depth: 16, colorMode: 3 })
  const planes8 = [
    [10, 20, 40, 100, 110, 120],
    [5, 15, 25, 200, 180, 160],
    [1, 2, 4, 50, 60, 70]
  ]
  const planes16 = planes8.map(samples => Uint8Array.from(samples.flatMap(sample => [sample, sample])))
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, compression, false)
  if (compression === 0) return Uint8Array.from([...header, ...sections, ...planes16.flatMap(plane => Array.from(plane))])

  if (compression === 1) {
    const rows = []
    const lengths = []
    for (const plane of planes16) {
      for (let row = 0; row < height; row++) {
        const bytes = plane.slice(row * width * 2, (row + 1) * width * 2)
        const packed = Uint8Array.from([bytes.length - 1, ...bytes])
        rows.push(packed)
        lengths.push(packed.length)
      }
    }
    const table = new Uint8Array(lengths.length * 2)
    const tableView = new DataView(table.buffer)
    lengths.forEach((length, index) => tableView.setUint16(index * 2, length, false))
    return Uint8Array.from([...header, ...sections, ...table, ...rows.flatMap(row => Array.from(row))])
  }

  let planar = Uint8Array.from(planes16.flatMap(plane => Array.from(plane)))
  if (compression === 3) {
    const predicted = new Uint8Array(planar.length)
    const rowBytes = width * 2
    const planeBytes = rowBytes * height
    for (let channel = 0; channel < channels; channel++) {
      for (let row = 0; row < height; row++) {
        const offset = channel * planeBytes + row * rowBytes
        let previous = 0
        for (let column = 0; column < width; column++) {
          const index = offset + column * 2
          const sample = (planar[index] << 8) | planar[index + 1]
          const delta = column ? (sample - previous + 0x10000) & 0xffff : sample
          predicted[index] = delta >>> 8
          predicted[index + 1] = delta & 0xff
          previous = sample
        }
      }
    }
    planar = predicted
  }
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(planar)])
}

function make32BitCompositePsd ({ compression = 0 } = {}) {
  const width = 3
  const height = 2
  const channels = 3
  const header = makePsdHeader({ width, height, channels, depth: 32, colorMode: 3 })
  const planes = [
    [0, 0.21404114, 1, 1, 0, 0.21404114],
    [1, 0.21404114, 0, 0, 1, 0.21404114],
    [0, 0, 1, 0.21404114, 0.21404114, 1]
  ].map(samples => {
    const plane = new Uint8Array(samples.length * 4)
    const view = new DataView(plane.buffer)
    samples.forEach((sample, index) => view.setFloat32(index * 4, sample, false))
    return plane
  })
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, compression, false)
  if (compression === 0) return Uint8Array.from([...header, ...sections, ...planes.flatMap(plane => Array.from(plane))])

  if (compression === 1) {
    const rows = []
    const lengths = []
    for (const plane of planes) {
      for (let row = 0; row < height; row++) {
        const bytes = plane.slice(row * width * 4, (row + 1) * width * 4)
        const packed = Uint8Array.from([bytes.length - 1, ...bytes])
        rows.push(packed)
        lengths.push(packed.length)
      }
    }
    const table = new Uint8Array(lengths.length * 2)
    const tableView = new DataView(table.buffer)
    lengths.forEach((length, index) => tableView.setUint16(index * 2, length, false))
    return Uint8Array.from([...header, ...sections, ...table, ...rows.flatMap(row => Array.from(row))])
  }

  let planar = Uint8Array.from(planes.flatMap(plane => Array.from(plane)))
  if (compression === 3) {
    const predicted = new Uint8Array(planar.length)
    const rowBytes = width * 4
    const planeBytes = rowBytes * height
    for (let channel = 0; channel < channels; channel++) {
      for (let row = 0; row < height; row++) {
        const offset = channel * planeBytes + row * rowBytes
        const shuffled = new Uint8Array(rowBytes)
        for (let byte = 0; byte < 4; byte++) for (let column = 0; column < width; column++) shuffled[byte * width + column] = planar[offset + column * 4 + byte]
        predicted.set(shuffled, offset)
        for (let index = rowBytes - 1; index > 0; index--) predicted[offset + index] = (predicted[offset + index] - predicted[offset + index - 1] + 256) & 0xff
      }
    }
    planar = predicted
  }
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(planar)])
}

function makeLabCompositePsd ({ depth = 8, compression = 0 } = {}) {
  const width = 3
  const height = 1
  const channels = 3
  const header = makePsdHeader({ width, height, channels, depth, colorMode: 9 })
  const planes8 = [
    [255, 0, 138],
    [128, 128, 209],
    [128, 128, 198]
  ]
  const planes = depth === 8
    ? planes8.map(samples => Uint8Array.from(samples))
    : planes8.map(samples => Uint8Array.from(samples.flatMap(sample => [sample, sample])))
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, compression, false)
  if (compression === 0) return Uint8Array.from([...header, ...sections, ...planes.flatMap(plane => Array.from(plane))])
  if (compression === 1) {
    const rows = planes.map(plane => Uint8Array.from([plane.length - 1, ...plane]))
    const table = new Uint8Array(rows.length * 2)
    const view = new DataView(table.buffer)
    rows.forEach((row, index) => view.setUint16(index * 2, row.length, false))
    return Uint8Array.from([...header, ...sections, ...table, ...rows.flatMap(row => Array.from(row))])
  }
  let planar = Uint8Array.from(planes.flatMap(plane => Array.from(plane)))
  if (compression === 3) {
    const predicted = new Uint8Array(planar.length)
    const bytesPerSample = depth / 8
    const rowBytes = width * bytesPerSample
    for (let channel = 0; channel < channels; channel++) {
      const offset = channel * rowBytes
      if (depth === 8) {
        predicted[offset] = planar[offset]
        for (let column = 1; column < width; column++) predicted[offset + column] = (planar[offset + column] - planar[offset + column - 1] + 256) & 0xff
      } else {
        let previous = 0
        for (let column = 0; column < width; column++) {
          const index = offset + column * 2
          const sample = (planar[index] << 8) | planar[index + 1]
          const delta = column ? (sample - previous + 0x10000) & 0xffff : sample
          predicted[index] = delta >>> 8
          predicted[index + 1] = delta & 0xff
          previous = sample
        }
      }
    }
    planar = predicted
  }
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(planar)])
}

function makeRawCmykCompositePsd (depth = 8) {
  const header = makePsdHeader({ width: 3, height: 1, channels: 4, depth, colorMode: 4 })
  const planes8 = [[255, 255, 0], [255, 255, 255], [255, 255, 255], [255, 0, 255]]
  const planes = depth === 8 ? planes8 : planes8.map(samples => samples.flatMap(sample => [sample, sample]))
  return Uint8Array.from([...header, ...new Uint8Array(10), ...planes.flat()])
}

function makeIndexedCompositePsd (compression = 0, transparentIndex = null) {
  const width = 4
  const indices = Uint8Array.from([1, 2, 3, 0])
  const header = makePsdHeader({ width, height: 1, channels: 1, depth: 8, colorMode: 2, colorDataLength: 768 })
  const palette = new Uint8Array(768)
  palette[0] = palette[256] = palette[512] = 255
  palette[1] = 255
  palette[256 + 2] = 255
  palette[512 + 3] = 255
  const resource = transparentIndex == null ? new Uint8Array(0) : Uint8Array.from([
    ...Buffer.from('8BIM'), 0x04, 0x17, 0, 0, 0, 0, 0, 2, 0, transparentIndex
  ])
  const sections = new Uint8Array(10 + resource.length)
  const sectionView = new DataView(sections.buffer)
  sectionView.setUint32(0, resource.length, false)
  sections.set(resource, 4)
  sectionView.setUint16(8 + resource.length, compression, false)
  if (compression === 0) return Uint8Array.from([...header, ...palette, ...sections, ...indices])
  if (compression === 1) {
    const table = Uint8Array.from([0, 5])
    const row = Uint8Array.from([3, ...indices])
    return Uint8Array.from([...header, ...palette, ...sections, ...table, ...row])
  }
  const encoded = new Uint8Array(indices)
  if (compression === 3) for (let index = encoded.length - 1; index > 0; index--) encoded[index] = (encoded[index] - encoded[index - 1] + 256) & 0xff
  return Uint8Array.from([...header, ...palette, ...sections, ...zlib.deflateSync(encoded)])
}

test('识别常用扩展名和文件路由', () => {
  assert.equal(extensionOf('海报.PSD'), 'psd')
  assert.equal(fileKind({ name: '网页.html' }), 'html')
  assert.equal(fileKind({ name: '画板.ai' }), 'design')
  assert.equal(fileKind({ name: '设计.psd' }), 'design')
  assert.equal(fileKind({ name: '大画布.psb' }), 'design')
  assert.equal(fileKind({ name: '方案.pptx' }), 'document')
  assert.equal(fileKind({ type: 'application/pdf', name: '没有扩展名' }), 'document')
  assert.equal(fileKind({ name: '截图.png' }), 'image')
  assert.equal(fileKind({ name: '图标.svg' }), 'svg')
  assert.equal(fileKind({ type: 'image/svg+xml', name: '没有扩展名' }), 'svg')
  assert.equal(fileKind({ name: '说明.md' }), 'text')
  assert.equal(fileKind({ name: '采访.mp3' }), 'audio')
  assert.equal(fileKind({ type: 'video/mp4', name: '没有扩展名' }), 'video')
  assert.equal(fileKind({ name: '资料.zip' }), 'archive')
  assert.equal(fileKind({ name: '图纸.dxf' }), 'cad')
  assert.equal(fileKind({ name: '排版.rtf' }), 'rtf')
  assert.equal(fileKind({ type: 'application/octet-stream', name: '未知文件' }), 'binary')
  assert.equal(isSupportedMaterial({ type: 'application/x-photoshop', path: '/tmp/a', name: 'a.psd' }), true)
})

test('AI 文件会识别内嵌 PDF 兼容预览', () => {
  assert.equal(isPdfCompatibleAi(Buffer.from('%PDF-1.7\nIllustrator')), true)
  assert.equal(isPdfCompatibleAi(Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator')), false)
})

test('旧式非 PDF Ai 会把基础路径、颜色、描边和变换还原为安全 SVG', () => {
  const legacyAi = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator(R) 8.0
%%HiResBoundingBox: 0 0 200 120
/m {moveto} bind def
/l {lineto} bind def
/c {curveto} bind def
1 0.2 0.1 r
10 10 m 190 10 l 190 110 l 10 110 l h f
0 0 0 R 3 w
20 20 m 60 100 140 100 180 20 c S
q 10 5 translate 0 1 1 0 k
0 0 m 20 0 l 20 20 l b
Q
[1 0 0 1 30 40] concat
0 0 m 10 10 l S
showpage
%%EOF`)
  const preview = extractLegacyAiPreview(legacyAi)

  assert.equal(preview.width, 200)
  assert.equal(preview.height, 120)
  assert.equal(preview.paths, 4)
  assert.equal(preview.boundingBoxSource, '文件声明')
  assert.match(preview.svg, /viewBox="0 -120 200 120"/)
  assert.match(preview.svg, /fill="rgb\(255,51,26\)"/)
  assert.match(preview.svg, /stroke-width="3"/)
  assert.match(preview.svg, /C60 100 140 100 180 20/)
  assert.match(preview.svg, /M10 5 L30 5 L30 25 Z/)
  assert.match(preview.svg, /M30 40 L40 50/)
  assert.doesNotMatch(preview.svg, /Creator|bind|showpage/)
})

test('旧式 Ai 不执行 PostScript 过程、字符串或任意操作符', () => {
  const legacyAi = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 20 20
/dangerous { (wx should never run) run 0 0 m 20 20 l S } def
(0 0 m 20 20 l S) pop
0 0 m 20 0 l 20 20 l 0 20 l h S
showpage`)
  const preview = extractLegacyAiPreview(legacyAi)

  assert.equal(preview.paths, 1)
  assert.doesNotMatch(preview.svg, /wx should never run|M0 0 L20 20/)
  assert.match(preview.svg, /M0 0 L20 0 L20 20 L0 20 Z/)
})

test('旧式 Ai 没有实际可绘制路径时明确拒绝，不生成空白 SVG', () => {
  assert.throws(() => extractLegacyAiPreview(Buffer.from('%!PS-Adobe-3.0\n%%BoundingBox: 0 0 100 100\nshowpage')), /没有找到可安全还原/)
})

test('旧式 Ai 没有可解释路径时仍提取文件内 DSC/EPSI 位图预览', () => {
  const source = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 4 2
%%BeginPreview: 4 2 1 2
% 90
% 60
%%EndPreview
showpage
%%EOF`)
  const preview = extractLegacyAiRasterPreview(source)
  const decoded = jpeg.decode(Buffer.from(preview.jpeg), { useTArray: true })
  assert.equal(preview.width, 4)
  assert.equal(preview.height, 2)
  assert.equal(preview.depth, 1)
  assert.equal(preview.source, 'DSC/EPSI %%BeginPreview')
  assert.equal(decoded.width, 4)
  assert.equal(decoded.height, 2)
  assert.ok(decoded.data[0] < 40, '首像素应为黑色')
  assert.ok(decoded.data[4] > 215, '第二像素应为白色')
})

test('Ai 位图预览缺行和异常位深会明确拒绝', () => {
  assert.throws(() => extractLegacyAiRasterPreview(Buffer.from('%!PS-Adobe-3.0\n%%BeginPreview: 8 2 1 2\n% ff\n%%EndPreview')), /行数不完整/)
  assert.throws(() => extractLegacyAiRasterPreview(Buffer.from('%!PS-Adobe-3.0\n%%BeginPreview: 1 1 16 1\n% ffff\n%%EndPreview')), /位深 16/)
})

test('Ai EPSI 的 2/4/8 bit 灰度预览都会生成同尺寸 JPEG', () => {
  for (const { depth, data } of [{ depth: 2, data: '1b' }, { depth: 4, data: '05af' }, { depth: 8, data: '0055aaff' }]) {
    const source = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0\n%%BeginPreview: 4 1 ${depth} 1\n% ${data}\n%%EndPreview\n%%EOF`)
    const preview = extractLegacyAiRasterPreview(source)
    const decoded = jpeg.decode(Buffer.from(preview.jpeg), { useTArray: true })
    assert.equal(preview.depth, depth)
    assert.equal(decoded.width, 4)
    assert.equal(decoded.height, 1)
  }
})

test('微信运行层返回的跨上下文 ArrayBuffer 也能识别 AI PDF', () => {
  const foreignBuffer = vm.runInNewContext(`
    (() => {
      const bytes = new Uint8Array(32)
      bytes.set([37, 80, 68, 70, 45, 49, 46, 55])
      return bytes.buffer
    })()
  `)

  assert.equal(foreignBuffer instanceof ArrayBuffer, false)
  assert.equal(isPdfCompatibleAi(foreignBuffer), true)
})

test('PSD 文件头会读取画布、通道、位深和资源偏移', () => {
  const header = parsePsdHeader(makePsdHeader({ width: 840, height: 180, channels: 3, depth: 16, colorDataLength: 12 }))

  assert.equal(header.kind, 'PSD')
  assert.equal(header.width, 840)
  assert.equal(header.height, 180)
  assert.equal(header.channels, 3)
  assert.equal(header.depth, 16)
  assert.equal(header.colorModeName, 'RGB')
  assert.equal(header.colorDataLength, 12)
  assert.equal(header.resourceLengthOffset, 42)
})

test('PSD 图像资源会提取 JPEG 合成缩略图', () => {
  const thumbnail = extractPsdThumbnail(makeThumbnailResource())

  assert.equal(thumbnail.resourceId, 1036)
  assert.equal(thumbnail.width, 320)
  assert.equal(thumbnail.height, 180)
  assert.deepEqual(Array.from(thumbnail.jpeg), [0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])
})

test('没有缩略图的 PSD 会从 Raw 合成通道还原可见像素', () => {
  const composite = extractPsdComposite(makeRawCompositePsd())
  assert.equal(composite.width, 2)
  assert.equal(composite.height, 1)
  assert.equal(composite.compression, 'Raw')
  assert.deepEqual(Array.from(composite.rgba), [255, 0, 0, 255, 0, 255, 0, 255])
})

test('没有缩略图的 PSD 会从 PackBits RLE 通道还原可见像素', () => {
  const composite = extractPsdComposite(makeRleCompositePsd())
  assert.equal(composite.compression, 'RLE')
  assert.deepEqual(Array.from(composite.rgba), [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
})

test('没有缩略图的 PSD 会从 ZIP 合成通道还原可见像素', () => {
  const composite = extractPsdComposite(makeZipCompositePsd())
  assert.equal(composite.compression, 'ZIP')
  assert.deepEqual(Array.from(composite.rgba), [
    10, 5, 1, 255, 20, 15, 2, 255, 40, 25, 4, 255,
    100, 200, 50, 255, 110, 180, 60, 255, 120, 160, 70, 255
  ])
})

test('没有缩略图的 PSD 会逆向预测并还原 ZIP Prediction 合成画面', () => {
  const composite = extractPsdComposite(makeZipCompositePsd({ prediction: true }))
  assert.equal(composite.compression, 'ZIP Prediction')
  assert.deepEqual(Array.from(composite.rgba), [
    10, 5, 1, 255, 20, 15, 2, 255, 40, 25, 4, 255,
    100, 200, 50, 255, 110, 180, 60, 255, 120, 160, 70, 255
  ])
})

test('16-bit PSD 的 Raw、RLE、ZIP 和 ZIP Prediction 都会降采样为可见合成画面', () => {
  const expected = [
    10, 5, 1, 255, 20, 15, 2, 255, 40, 25, 4, 255,
    100, 200, 50, 255, 110, 180, 60, 255, 120, 160, 70, 255
  ]
  for (const compression of [0, 1, 2, 3]) {
    const composite = extractPsdComposite(make16BitCompositePsd({ compression }))
    assert.equal(composite.depth, 16)
    assert.deepEqual(Array.from(composite.rgba), expected, `16-bit 压缩方式 ${compression} 像素不正确`)
  }
})

test('32-bit 浮点 PSD 的 Raw、RLE、ZIP 和 ZIP Prediction 都会转成可见 sRGB 合成画面', () => {
  const expected = [
    0, 255, 0, 255, 128, 128, 0, 255, 255, 0, 255, 255,
    255, 0, 128, 255, 0, 255, 128, 255, 128, 128, 255, 255
  ]
  for (const compression of [0, 1, 2, 3]) {
    const composite = extractPsdComposite(make32BitCompositePsd({ compression }))
    assert.equal(composite.depth, 32)
    assert.deepEqual(Array.from(composite.rgba), expected, `32-bit 压缩方式 ${compression} 像素不正确`)
  }
})

test('8/16-bit Lab PSD 的 Raw、RLE、ZIP 和 ZIP Prediction 都会转换为可见 sRGB', () => {
  for (const depth of [8, 16]) {
    for (const compression of [0, 1, 2, 3]) {
      const composite = extractPsdComposite(makeLabCompositePsd({ depth, compression }))
      assert.equal(composite.depth, depth)
      const rgba = Array.from(composite.rgba)
      assert.ok(rgba[0] >= 254 && rgba[1] >= 254 && rgba[2] >= 254, `${depth} bit/${compression} 白点不正确：${rgba.slice(0, 3)}`)
      assert.ok(rgba[4] <= 1 && rgba[5] <= 1 && rgba[6] <= 1, `${depth} bit/${compression} 黑点不正确：${rgba.slice(4, 7)}`)
      assert.ok(rgba[8] >= 245 && rgba[9] <= 20 && rgba[10] <= 20, `${depth} bit/${compression} 红色不正确：${rgba.slice(8, 11)}`)
      assert.deepEqual([rgba[3], rgba[7], rgba[11]], [255, 255, 255])
    }
  }
})

test('8/16-bit CMYK PSD 会从反色印版通道生成可见 RGB', () => {
  for (const depth of [8, 16]) {
    const rgba = Array.from(extractPsdComposite(makeRawCmykCompositePsd(depth)).rgba)
    assert.deepEqual(rgba, [255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 255, 255])
  }
})

test('索引色 PSD 的 Raw、RLE、ZIP 和 ZIP Prediction 都会按真实调色板生成画面', () => {
  const expected = [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255
  ]
  for (const compression of [0, 1, 2, 3]) {
    const composite = extractPsdComposite(makeIndexedCompositePsd(compression))
    assert.equal(composite.compression, ['Raw', 'RLE', 'ZIP', 'ZIP Prediction'][compression])
    assert.deepEqual(Array.from(composite.rgba), expected)
  }
})

test('索引色 PSD 缺少完整调色板时明确拒绝', () => {
  const header = makePsdHeader({ width: 1, height: 1, channels: 1, depth: 8, colorMode: 2, colorDataLength: 100 })
  assert.throws(() => extractPsdComposite(Uint8Array.from([...header, ...new Uint8Array(110)])), /768 字节 RGB 调色板/)
})

test('索引色 PSD 应用图像资源 1047 的透明索引，并为 JPEG 生成可见棋盘格', () => {
  const composite = extractPsdComposite(makeIndexedCompositePsd(3, 2))
  assert.equal(composite.transparentIndex, 2)
  assert.equal(composite.transparentPixels, 1)
  assert.deepEqual(Array.from(composite.rgba.slice(4, 8)), [0, 255, 0, 0])
  const flattened = compositeRgbaOnCheckerboard(composite.rgba, composite.width, 1)
  assert.deepEqual(Array.from(flattened.slice(4, 8)), [224, 224, 224, 255])
  assert.deepEqual(Array.from(flattened.slice(0, 4)), [255, 0, 0, 255])
})

test('32-bit Lab/CMYK 组合会明确拒绝，不伪造颜色', () => {
  for (const colorMode of [4, 9]) {
    const header = makePsdHeader({ width: 1, height: 1, channels: colorMode === 4 ? 4 : 3, depth: 32, colorMode })
    assert.throws(() => extractPsdComposite(Uint8Array.from([...header, ...new Uint8Array(10)])), /32 bit .*合成图暂不支持可靠颜色转换/)
  }
})

test('PSD ZIP 数据长度不符时明确拒绝，不返回空白画面', () => {
  const psd = makeZipCompositePsd()
  const truncated = psd.slice(0, psd.length - 2)
  assert.throws(() => extractPsdComposite(truncated), /ZIP 合成数据损坏|长度不符/)
})

test('文件大小显示适合预览页', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB')
})
