'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const { cases, dataCases } = require('./helpers/ai-dsc')
const { extractLegacyAiPreview, extractLegacyAiRasterPreview, isPdfCompatibleAi } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview } = require('./helpers/reader-host')
const jpeg = require('jpeg-js')

test('DSC parent previews, trailer bounds and PDF identity ignore embedded markers', () => {
  for (const sample of cases()) {
    assert.equal(isPdfCompatibleAi(sample.bytes), false, sample.name)
    if (sample.box) {
      const preview = extractLegacyAiPreview(sample.bytes)
      assert.deepEqual([preview.width, preview.height], sample.box, sample.name)
      assert.equal(preview.paths, sample.paths || 1)
    } else if (sample.preview) {
      const preview = extractLegacyAiRasterPreview(sample.bytes), image = jpeg.decode(preview.jpeg)
      assert.deepEqual([image.width, image.height], [1, 1])
      assert.deepEqual([...image.data], [0, 0, 0, 255], sample.name)
    } else assert.throws(() => extractLegacyAiRasterPreview(sample.bytes), /没有 DSC\/EPSI/, sample.name)
  }
})

test('PDF detection retains native-tolerated prefixes while PostScript owns embedded markers', () => {
  for (const prefix of ['', '\ufeff', '   ', '\n', '% note\n', '\0']) {
    assert.equal(isPdfCompatibleAi(Buffer.from(prefix + '%PDF-1.4\n')), true)
  }
  for (const ending of ['\n', '\r', '\r\n', '\n\r']) {
    assert.equal(isPdfCompatibleAi(Buffer.from('%!PS-Adobe-3.0' + ending + '%%Title: %PDF-1.7' + ending)), false)
  }
  assert.equal(isPdfCompatibleAi(Buffer.from('%PDF-1.7\n%!PS-Adobe-3.0\n')), true)
})

test('DSC metadata isolation retains imported vector artwork and ignores late PDF prose', () => {
  const source = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n' +
    '% Ordinary PostScript comment without executable content.\n'.repeat(100) + '% A guide to %PDF-1.7\n' +
    '%%BeginDocument: child.eps\n%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 1 1\n%%EndComments\n' +
    '1 0 0 setrgbcolor\n0 0 moveto\n20 0 lineto\n20 20 lineto\n0 20 lineto\nclosepath fill\n%%EOF\n%%EndDocument\n' +
    '0 0 1 setrgbcolor\n20 0 moveto\n40 0 lineto\n40 20 lineto\n20 20 lineto\nclosepath fill\n%%EOF\n'
  const preview = extractLegacyAiPreview(Buffer.from(source))
  assert.deepEqual([preview.width, preview.height, preview.paths], [40, 20, 2])
  assert.match(preview.svg, /fill="rgb\(255,0,0\)"/)
  assert.match(preview.svg, /fill="rgb\(0,0,255\)"/)
})

test('actual design component writes only parent previews and does not open an EPS title as PDF', async () => {
  let input, writes = [], pdfOpens = 0
  const page = designPreview({ env: { USER_DATA_PATH: '/fixture' }, openDocument: () => pdfOpens++, getFileSystemManager: () => ({
    readFile: o => { const b = input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile: o => { writes.push(o); o.success() }, copyFile: o => o.success()
  }) })
  try {
    for (const sample of cases()) {
      input = sample.bytes; writes = []
      page.open({ name: sample.name + '.ai', path: '/fixture/input.ai', size: input.length })
      for (let i = 0; i < 8; i++) await new Promise(setImmediate)
      assert.equal(page.data.loading, false, sample.name)
      assert.equal(page.data.canOpenPdf, false)
      assert.equal(pdfOpens, 0)
      if (sample.box) {
        assert.equal(writes.length, 1)
        assert.match(writes[0].data, /viewBox="0 -20 40 20"/)
      } else if (sample.preview) {
        assert.equal(writes.length, 1)
        assert.deepEqual([...jpeg.decode(Buffer.from(writes[0].data)).data], [0, 0, 0, 255])
      } else {
        assert.equal(writes.length, 0)
        assert.equal(page.data.previewPath, '')
        assert.match(page.data.message, /没有 DSC\/EPSI/)
      }
    }
  } finally { page.detached() }
})

test('DSC data lengths and nesting stop explicitly, then valid parent artwork still opens', () => {
  const head = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1 1\n%%EndComments\n'
  for (const body of ['%%BeginData: 9007199254740992 ASCII Bytes\n', '%%BeginData: 99 ASCII Lines\nx\n%%EndData\n', '%%BeginBinary: 1\nx%%WrongEnd\n', '%%EndDocument\n', '%%BeginDocument: child\n', '%%BeginDocument: child\n'.repeat(65)]) {
    assert.throws(() => extractLegacyAiRasterPreview(Buffer.from(head + body)), /DSC|嵌套文档/)
  }
  const good = cases().find(c => c.preview)
  assert.equal(extractLegacyAiRasterPreview(good.bytes).width, 1)
})

test('opaque DSC marker bytes cannot close a parent scope or become vector commands', () => {
  const payload = '%%EndDocument\n%%BeginPreview: broken\n1 0 0 setrgbcolor\n0 0 99 99 re f\n'
  const data = 'discard\n' + payload
  const source = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 1\n%%EndComments\n' +
    '/discard { currentfile ' + Buffer.byteLength(payload) + ' string readstring pop pop } bind def\n' +
    '%%BeginDocument: child\n%%BeginData: ' + Buffer.byteLength(data) + ' ASCII Bytes\n' + data + '%%EndData\n%%EndDocument\n' +
    '0 0 1 setrgbcolor\n0 0 moveto\n2 0 lineto\n2 1 lineto\n0 1 lineto\nclosepath fill\n%%EOF\n1 0 0 setrgbcolor\n0 0 9 9 re f\n'
  const preview = extractLegacyAiPreview(Buffer.from(source))
  assert.deepEqual([preview.width, preview.height, preview.paths], [2, 1, 1])
  assert.match(preview.svg, /fill="rgb\(0,0,255\)"/)
  assert.doesNotMatch(preview.svg, /rgb\(255,0,0\)/)
})

test('DSC physical byte and line counts retain following artwork across defaults, Unicode and nesting limits', () => {
  const head = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 1\n%%EndComments\n'
  const body = '0 0 1 setrgbcolor\n0 0 moveto\n2 0 lineto\n2 1 lineto\n0 1 lineto\nclosepath fill\n%%EOF\n'
  for (const sample of dataCases()) {
    const preview = extractLegacyAiPreview(sample.bytes)
    assert.deepEqual([preview.width, preview.height, preview.paths], [2, 1, 1], sample.name)
    assert.match(preview.svg, /fill="rgb\(0,0,255\)"/)
  }
  const emptyBlock = '%%BeginData: 0\n%%EndData\n'
  const atLimit = extractLegacyAiPreview(Buffer.from(head + emptyBlock.repeat(10000) + body))
  assert.equal(atLimit.paths, 1)
  assert.throws(() => extractLegacyAiPreview(Buffer.from(head + emptyBlock.repeat(10001) + body)), /数量超过/)
  const nested = n => '%%BeginDocument: child\n'.repeat(n) + '%%EndDocument\n'.repeat(n)
  assert.equal(extractLegacyAiPreview(Buffer.from(head + nested(64) + body)).paths, 1)
  assert.throws(() => extractLegacyAiPreview(Buffer.from(head + nested(65) + body)), /层数超过/)
})
