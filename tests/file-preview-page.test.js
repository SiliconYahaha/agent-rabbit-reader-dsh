'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { psdZlibFailureFixtures } = require('./helpers/psd-zlib')
const jpegCodec = require('jpeg-js')
const { designPreview, loadDesignPreviewHost } = require('./helpers/reader-host')

// 真实的 file-reader/engine/components/design-preview 组件实例；open() 等价于宿主传入 file 属性。
function loadPreviewPage (material, wxOverrides) {
  const page = designPreview(wxOverrides)
  const open = page.open
  page.open = (next = material) => open(next)
  return page
}

function tick () {
  return new Promise(resolve => setImmediate(resolve))
}

function makePsdPreviewParts () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const headerView = new DataView(header.buffer)
  headerView.setUint16(4, 1, false)
  headerView.setUint16(12, 4, false)
  headerView.setUint32(14, 1440, false)
  headerView.setUint32(18, 1080, false)
  headerView.setUint16(22, 8, false)
  headerView.setUint16(24, 3, false)

  const jpeg = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])
  const resource = new Uint8Array(40 + jpeg.length)
  resource.set(Buffer.from('8BIM'), 0)
  const resourceView = new DataView(resource.buffer)
  resourceView.setUint16(4, 1036, false)
  resource[6] = 0
  resource[7] = 0
  resourceView.setUint32(8, 28 + jpeg.length, false)
  resourceView.setUint32(12, 1, false)
  resourceView.setUint32(16, 320, false)
  resourceView.setUint32(20, 180, false)
  resourceView.setUint32(32, jpeg.length, false)
  resource.set(jpeg, 40)

  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, resource.length, false)
  return { header, length, resource, jpeg }
}

function makeRawCompositePsd () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 3, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, 2, false)
  view.setUint16(22, 8, false)
  view.setUint16(24, 3, false)
  const emptySectionsAndCompression = new Uint8Array(10)
  const planes = Uint8Array.from([255, 0, 0, 255, 0, 0])
  return Uint8Array.from([...header, ...emptySectionsAndCompression, ...planes])
}

function makeZipPredictionCompositePsd () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 3, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, 3, false)
  view.setUint16(22, 8, false)
  view.setUint16(24, 3, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const predicted = Uint8Array.from([255, 1, 1, 0, 255, 1, 0, 0, 255])
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(predicted)])
}

function make16BitZipPredictionCompositePsd () {
  const width = 3
  const height = 1
  const channels = 3
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, channels, false)
  view.setUint32(14, height, false)
  view.setUint32(18, width, false)
  view.setUint16(22, 16, false)
  view.setUint16(24, 3, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const rows = [[255, 0, 128], [0, 255, 64], [0, 0, 255]].map(samples => {
    const predicted = new Uint8Array(samples.length * 2)
    let previous = 0
    samples.forEach((sample8, index) => {
      const sample = sample8 * 257
      const delta = index ? (sample - previous + 0x10000) & 0xffff : sample
      predicted[index * 2] = delta >>> 8
      predicted[index * 2 + 1] = delta & 0xff
      previous = sample
    })
    return predicted
  })
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(Uint8Array.from(rows.flatMap(row => Array.from(row))))])
}

function make32BitZipPredictionCompositePsd () {
  const width = 3
  const height = 1
  const channels = 3
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, channels, false)
  view.setUint32(14, height, false)
  view.setUint32(18, width, false)
  view.setUint16(22, 32, false)
  view.setUint16(24, 3, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const rows = [[0, 0.21404114, 1], [1, 0.21404114, 0], [0, 0, 1]].map(samples => {
    const raw = new Uint8Array(width * 4)
    const rawView = new DataView(raw.buffer)
    samples.forEach((sample, index) => rawView.setFloat32(index * 4, sample, false))
    const shuffled = new Uint8Array(raw.length)
    for (let byte = 0; byte < 4; byte++) for (let column = 0; column < width; column++) shuffled[byte * width + column] = raw[column * 4 + byte]
    for (let index = shuffled.length - 1; index > 0; index--) shuffled[index] = (shuffled[index] - shuffled[index - 1] + 256) & 0xff
    return shuffled
  })
  return Uint8Array.from([...header, ...sections, ...zlib.deflateSync(Uint8Array.from(rows.flatMap(row => Array.from(row))))])
}

test('PDF 兼容 AI 会自动复制为 PDF 并直接打开', async () => {
  let copied
  let opened
  const page = loadPreviewPage({ name: '画板.ai', path: '/tmp/art.ai', size: 1024, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: Buffer.from('%PDF-1.7\nAI') }),
      copyFile: options => { copied = options; options.success() }
    }),
    openDocument: options => { opened = options }
  })

  page.open()
  await tick()
  await tick()

  assert.equal(page.data.canOpenPdf, true)
  assert.equal(copied.srcPath, '/tmp/art.ai')
  assert.match(copied.destPath, /^\/user-data\/illustrator-preview-\d+-\d+\.pdf$/)
  assert.equal(opened.fileType, 'pdf')
  assert.equal(opened.showMenu, true)
})

test('自带 Ai 示例先显示原画板预览，用户再主动打开内嵌 PDF', async () => {
  let copied = false
  const page = loadPreviewPage({ name: '标志的四种形态.ai', path: '/user-data/rabbit-example-v1-final.ai', size: 220794,
    type: 'application/pdf', samplePreview: '/assets/logo-variants-preview.jpg' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: Buffer.from('%PDF-1.6\n') }),
      copyFile: options => { copied = true; options.success() }
    }),
    openDocument: () => {}
  })
  page.open()
  await tick()
  assert.equal(page.data.previewPath, '/assets/logo-variants-preview.jpg')
  assert.equal(page.data.canOpenPdf, true)
  assert.equal(copied, false)
  page.openAiPdf()
  assert.equal(copied, true)
})

test('短 Ai 文件按真实字节数读取，不会在真机触发 length out of range', async () => {
  const reads = []
  const page = loadPreviewPage({ name: 'ai-test-vector-basic-01.ai', path: '/tmp/short.ai', size: 3482, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => { reads.push(options); options.success({ data: Buffer.from('%PDF-1.4\nAi') }) },
      copyFile: options => options.success()
    }),
    openDocument: () => {}
  })

  page.open()
  await tick()

  assert.equal(reads[0].position, 0)
  assert.equal(reads[0].length, 3482)
  assert.equal(page.data.error, '')
  assert.equal(page.data.canOpenPdf, true)
  assert.equal(page.data.extensionLabel, 'Ai')
})

test('文件元数据不准时，Ai 头部长度越界会安全重试短文件整读', async () => {
  const reads = []
  const fileSystem = {
    readFile: options => {
      reads.push(options)
      if (reads.length === 1) options.fail({ errMsg: 'readFile:fail the value of length is out of range' })
      else options.success({ data: Buffer.from('%PDF-1.4\nAi') })
    },
    copyFile: options => options.success()
  }
  const page = loadPreviewPage({ name: 'metadata-missing.ai', path: '/tmp/short.ai', size: 0, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => fileSystem,
    openDocument: () => {}
  })

  page.open()
  await tick()

  assert.equal(reads.length, 2)
  assert.equal(reads[0].length, 4096)
  assert.equal(Object.prototype.hasOwnProperty.call(reads[1], 'length'), false)
  assert.equal(page.data.error, '')
  assert.equal(page.data.canOpenPdf, true)
})

test('非 PDF 兼容 AI 会解释限制而不是显示空白', async () => {
  let opened = false
  const page = loadPreviewPage({ name: '旧版.ai', path: '/tmp/legacy.ai', size: 1024, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: Buffer.from('%!PS-Adobe-3.0') })
    }),
    openDocument: () => { opened = true }
  })

  page.open()
  await tick()
  await tick()

  assert.equal(opened, false)
  assert.equal(page.data.canOpenPdf, false)
  assert.match(page.data.message, /无内嵌 PDF 或可用预览/)
})

test('非 PDF 的旧式 Ai 会写出 SVG 并在页面显示真实矢量画面', async () => {
  const legacyAi = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator(R) 8.0
%%BoundingBox: 0 0 160 90
0.1 0.8 0.3 r
5 5 m 155 5 l 155 85 l 5 85 l h f
0 0 0 R 2 w 10 10 m 150 80 l S
showpage`)
  let written
  const page = loadPreviewPage({ name: 'legacy-vector.ai', path: '/tmp/legacy-vector.ai', size: legacyAi.length, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: legacyAi.buffer.slice(legacyAi.byteOffset, legacyAi.byteOffset + legacyAi.byteLength) }),
      writeFile: options => { written = options; options.success() }
    }),
    openDocument: () => { throw new Error('旧式 Ai 不应调用 PDF 查看器') }
  })

  page.open()
  await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.equal(page.data.canOpenPdf, false)
  assert.match(page.data.previewPath, /^\/user-data\/illustrator-legacy-preview-\d+-\d+\.svg$/)
  assert.equal(written.encoding, 'utf8')
  assert.match(written.data, /<svg/)
  assert.match(written.data, /fill="rgb\(26,204,77\)"/)
  assert.equal(page.data.metadata.find(item => item.label === '画布').value, '160 × 90 pt')
  assert.equal(page.data.metadata.find(item => item.label === '基础路径').value, '2 条 · 6 个控制点')
  assert.match(page.data.message, /已显示基础矢量/)
})

test('旧式 Ai 路径无法还原时会把内嵌 EPSI 预览写成 JPEG 上屏', async () => {
  const legacyAi = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 4 2
%%BeginPreview: 4 2 1 2
% 90
% 60
%%EndPreview
showpage
%%EOF`)
  let written
  const page = loadPreviewPage({ name: 'legacy-raster-preview.ai', path: '/tmp/legacy-raster-preview.ai', size: legacyAi.length, type: 'application/postscript' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: legacyAi.buffer.slice(legacyAi.byteOffset, legacyAi.byteOffset + legacyAi.byteLength) }),
      writeFile: options => { written = options; options.success() }
    }),
    openDocument: () => { throw new Error('EPSI 回退不应调用 PDF 查看器') }
  })

  page.open()
  await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/illustrator-epsi-preview-\d+-\d+\.jpg$/)
  assert.ok(written.data instanceof ArrayBuffer)
  assert.equal(page.data.metadata.find(item => item.label === '屏幕预览').value, '4 × 2 px · 1 bit')
  assert.equal(page.data.metadata.find(item => item.label === '预览来源').value, 'DSC/EPSI %%BeginPreview')
  assert.match(page.data.message, /当前显示内嵌位图/)
})

test('PSD 页面会读取画布信息并写出内嵌 JPEG 缩略图', async () => {
  const parts = makePsdPreviewParts()
  let written
  const page = loadPreviewPage({ name: '活动视觉.psd', path: '/tmp/poster.psd', size: 4096, type: 'application/x-photoshop' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        if (options.position === 0) options.success({ data: parts.header.buffer })
        else if (options.position === 30) options.success({ data: parts.length.buffer })
        else options.success({ data: parts.resource.buffer })
      },
      writeFile: options => { written = options; options.success() }
    })
  })

  page.open()
  await tick()
  await tick()
  await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/psd-preview-\d+-\d+\.jpg$/)
  assert.equal(page.data.metadata.find(item => item.label === '画布').value, '1080 × 1440 px')
  assert.deepEqual(Array.from(new Uint8Array(written.data)), Array.from(parts.jpeg))
})

test('PSD 没有缩略图时会读取 Raw 合成通道并生成真实 JPEG 预览', async () => {
  const psd = makeRawCompositePsd()
  let written
  const page = loadPreviewPage({ name: '无缩略图.psd', path: '/tmp/raw.psd', size: psd.length, type: 'application/x-photoshop' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        const start = Number(options.position || 0)
        const end = Object.prototype.hasOwnProperty.call(options, 'length') ? start + options.length : psd.length
        const data = psd.slice(start, end)
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { written = new Uint8Array(options.data); options.success() }
    })
  })

  page.open()
  await tick(); await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/psd-composite-\d+-\d+\.jpg$/)
  assert.match(page.data.message, /合成通道在本机还原/)
  assert.equal(page.data.metadata.find(item => item.label === '合成预览').value, '2 × 1 px · 8 bit · Raw')
  assert.deepEqual(Array.from(written.slice(0, 2)), [0xff, 0xd8])
})

test('PSD ZIP Prediction 合成通道会在设计页生成真实 JPEG 预览', async () => {
  const psd = makeZipPredictionCompositePsd()
  let written
  const page = loadPreviewPage({ name: 'ZIP预测.psd', path: '/tmp/zip-prediction.psd', size: psd.length, type: 'application/x-photoshop' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        const start = Number(options.position || 0)
        const end = Object.prototype.hasOwnProperty.call(options, 'length') ? start + options.length : psd.length
        const data = psd.slice(start, end)
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { written = new Uint8Array(options.data); options.success() }
    })
  })

  page.open()
  await tick(); await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/psd-composite-\d+-\d+\.jpg$/)
  assert.equal(page.data.metadata.find(item => item.label === '合成预览').value, '3 × 1 px · 8 bit · ZIP Prediction')
  assert.deepEqual(Array.from(written.slice(0, 2)), [0xff, 0xd8])
})

test('16-bit PSD ZIP Prediction 合成通道会生成真实 JPEG 预览', async () => {
  const psd = make16BitZipPredictionCompositePsd()
  let written
  const page = loadPreviewPage({ name: '16位-ZIP预测.psd', path: '/tmp/16bit-zip-prediction.psd', size: psd.length, type: 'application/x-photoshop' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        const start = Number(options.position || 0)
        const end = Object.prototype.hasOwnProperty.call(options, 'length') ? start + options.length : psd.length
        const data = psd.slice(start, end)
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { written = new Uint8Array(options.data); options.success() }
    })
  })

  page.open()
  await tick(); await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/psd-composite-\d+-\d+\.jpg$/)
  assert.equal(page.data.metadata.find(item => item.label === '合成预览').value, '3 × 1 px · 16 bit · ZIP Prediction')
  assert.match(page.data.message, /合成通道在本机还原/)
  assert.deepEqual(Array.from(written.slice(0, 2)), [0xff, 0xd8])
})

test('32-bit 浮点 PSD ZIP Prediction 会在设计页生成真实 JPEG 预览', async () => {
  const psd = make32BitZipPredictionCompositePsd()
  let written
  const page = loadPreviewPage({ name: '32位浮点-ZIP预测.psd', path: '/tmp/32bit-zip-prediction.psd', size: psd.length, type: 'application/x-photoshop' }, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        const start = Number(options.position || 0)
        const end = Object.prototype.hasOwnProperty.call(options, 'length') ? start + options.length : psd.length
        const data = psd.slice(start, end)
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { written = new Uint8Array(options.data); options.success() }
    })
  })

  page.open()
  await tick(); await tick(); await tick(); await tick()

  assert.equal(page.data.error, '')
  assert.match(page.data.previewPath, /^\/user-data\/psd-composite-\d+-\d+\.jpg$/)
  assert.equal(page.data.metadata.find(item => item.label === '合成预览').value, '3 × 1 px · 32 bit · ZIP Prediction')
  assert.match(page.data.message, /合成通道在本机还原/)
  assert.deepEqual(Array.from(written.slice(0, 2)), [0xff, 0xd8])
})

test('设计文件预览页不再显示换文件按钮，多文件时使用底部连续切换', () => {
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/file-preview/file-preview.wxml'), 'utf8')
  const styles = require('./helpers/read-wxss')(path.join(__dirname, '../miniprogram/pages/file-preview/file-preview.wxss'))
  const component = fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/engine/components/design-preview/design-preview.wxml'), 'utf8')

  assert.equal(template.includes('换文件'), false)
  assert.match(template, /<design-preview\b[^>]*file="\{\{file\}\}"/)
  assert.match(template, /queueCount > 1/)
  assert.match(template, /openPreviousFile/)
  assert.match(template, /openNextFile/)
  assert.match(styles, /\.file-queue\s*\{[^}]*position:\s*fixed/s)
  assert.equal(component.includes('queueCount'), false, '队列栏属于宿主页面，不进入可复用组件')
  assert.match(component, /previewPath/)
})

test('PSD 真合成优先于内嵌 JPEG，透明与半透明像素实际进入棋盘格预览', async () => {
  const parts = makePsdPreviewParts()
  const alpha = Array(16).fill(0).concat(Array(16).fill(0.5), Array(32).fill(1))
  for (const depth of [8, 16, 32]) {
    const psd = psdAlphaFixture({ depth, width: 64, height: 32, compression: 3, flag: { 8: 'count', 16: 'Mt16', 32: 'Mt32' }[depth], alpha, resources: Buffer.from(parts.resource) })
    let written
    const page = loadPreviewPage({ name: `透明-${depth}.psd`, path: '/tmp/alpha.psd', size: psd.length, type: 'application/x-photoshop' }, {
      env: { USER_DATA_PATH: '/user-data' },
      getFileSystemManager: () => ({
        readFile: options => {
          const start = Number(options.position || 0), data = psd.subarray(start, start + options.length)
          options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
        },
        writeFile: options => { written = Buffer.from(options.data); options.success() }
      })
    })
    page.open()
    for (let i = 0; i < 6; i++) await tick()
    assert.equal(page.data.error, '')
    assert.match(page.data.previewPath, /psd-composite-/)
    assert.ok(page.data.metadata.some(item => item.label === '合成透明度' && /1024/.test(item.value)))
    assert.equal(page.data.metadata.some(item => item.label === '透明索引'), false)
    assert.doesNotMatch(page.data.message, /没有内嵌缩略图/)
    const decoded = jpegCodec.decode(written)
    assert.equal(decoded.width, 64); assert.equal(decoded.height, 32)
    const pixel = x => Array.from(decoded.data.subarray((3 * 64 + x) * 4, (3 * 64 + x) * 4 + 3))
    for (const [x, expected] of [[3, [248, 248, 248]], [11, [224, 224, 224]], [19, [252, 124, 124]], [40, [255, 0, 0]]]) {
      assert.ok(pixel(x).every((v, i) => Math.abs(v - expected[i]) <= 5), `${depth}/${x}/${pixel(x)}`)
    }
  }
})

test('损坏/越界 PSD ZIP 不生成假画面，并能继续打开正常文件', async () => {
  const cases = psdZlibFailureFixtures()
  cases.push({ name: 'valid-after-errors.psd', bytes: psdAlphaFixture({ compression: 3 }) })
  let current; const writes = []
  const page = loadPreviewPage(null, {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      readFile: options => {
        const start = options.position || 0
        const data = current.bytes.subarray(start, start + options.length)
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { writes.push(options.filePath); options.success() }
    })
  })
  for (const fixture of cases) {
    current = fixture
    page.loadMaterial({ name: fixture.name, path: '/tmp/input.psd', size: fixture.bytes.length })
    for (let i = 0; i < 6; i++) await tick()
    assert.equal(page.data.loading, false)
    assert.equal(page.data.error, '')
    if (fixture.message) {
      assert.equal(page.data.previewPath, '')
      assert.ok(page.data.message.includes(fixture.message), page.data.message)
      assert.equal(writes.length, 0)
    } else {
      assert.match(page.data.previewPath, /psd-composite-/)
      assert.equal(writes.length, 1)
    }
  }
})

test('设计文件预览页从原生查看器返回后会重新开启分享菜单，并把文件交给预览组件', () => {
  let shareOptions
  const reads = []
  const material = { name: '旧版.ai', path: '/tmp/legacy.ai', size: 1024, type: 'application/postscript' }
  const { host, preview } = loadDesignPreviewHost({
    env: { USER_DATA_PATH: '/user-data' },
    showShareMenu: options => { shareOptions = options },
    getFileSystemManager: () => ({ readFile: options => reads.push(options.filePath) })
  }, { globalData: { pendingFilePreview: material } })

  host.onLoad()
  host.onShow()

  assert.deepEqual(shareOptions.menus, ['shareAppMessage', 'shareTimeline'])
  assert.equal(host.data.error, '')
  assert.deepEqual(host.data.file, material)
  assert.deepEqual(preview.data.name, '旧版.ai')
  assert.deepEqual(reads, ['/tmp/legacy.ai'])
})

for (const kind of ['epsi', 'composite', 'vector', 'thumbnail', 'pdf']) test(`same-millisecond ${kind} loads: late old writes cannot replace the new file bytes`, async () => {
  const { document } = require('./helpers/epsi-lines')
  const { bitmapFixture } = require('./helpers/psd-bitmap')
  let pair
  if (kind === 'epsi') pair = [0, 255].map(n => document(1, 1, 8, ['% ' + n.toString(16).padStart(2, '0')]))
  else if (kind === 'composite') pair = [0, 255].map(n => bitmapFixture({ width: 1, height: 1, packed: Buffer.from([n]) }))
  else if (kind === 'vector') pair = [1, 0].map(n => Buffer.from(`%!PS-Adobe-3.0\n%%BoundingBox: 0 0 8 8\n${n} g 0 0 m 8 0 l 8 8 l 0 8 l h f\n`))
  else if (kind === 'thumbnail') pair = [1, 2].map(n => {
    const parts = makePsdPreviewParts()
    parts.resource[42] = n // distinguish the stored thumbnail byte streams
    return Buffer.concat([parts.header, parts.length, parts.resource])
  })
  else pair = [Buffer.from('%PDF-1.7\nfirst'), Buffer.from('%PDF-1.7\nsecond')]
  let current = 0, held, opened
  const files = new Map()
  const finish = (destination, data, callback) => { files.set(destination, Buffer.from(data)); callback() }
  const page = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) { const b = pair[current].subarray(o.position || 0, (o.position || 0) + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) {
      if (current === 0) held = { path: o.filePath, finish: () => finish(o.filePath, o.data, o.success) }
      else finish(o.filePath, o.data, o.success)
    },
    copyFile (o) {
      const data = pair[current]
      if (current === 0) held = { path: o.destPath, finish: () => finish(o.destPath, data, o.success) }
      else finish(o.destPath, data, o.success)
    }
  }), openDocument (o) { opened = o.filePath; o.success?.() } })
  const originalNow = Date.now
  Date.now = () => 123456
  try {
    const extension = ['thumbnail', 'composite'].includes(kind) ? 'psd' : 'ai'
    page.open({ name: 'first.' + extension, path: '/first', size: pair[0].length })
    for (let i = 0; i < 8; i++) await tick()
    assert.ok(held, kind + ' first write reached')
    current = 1
    page.open({ name: 'second.' + extension, path: '/second', size: pair[1].length })
    for (let i = 0; i < 8; i++) await tick()
    const visible = kind === 'pdf' ? opened : page.data.previewPath
    const expected = files.get(visible)
    assert.ok(expected)
    assert.notEqual(held.path, visible, 'distinct output identities despite identical clock time')
    held.finish()
    for (let i = 0; i < 8; i++) await tick()
    assert.equal(kind === 'pdf' ? opened : page.data.previewPath, visible)
    assert.deepEqual(files.get(visible), expected, 'late write left the active file unchanged')
    assert.notDeepEqual(files.get(held.path), expected, 'control images/files really differ')
  } finally { Date.now = originalNow }
})
