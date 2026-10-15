'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const zlib = require('node:zlib')
const { cdrCompressedVectorFixture, repackCdrStreams, cdrZlibFailureFixtures } = require('./helpers/cdr-zlib')
const bounded = require('../miniprogram/file-reader/engine/core/bounded-zlib')
let decodeCalls = 0
let declaredBudget = null
const originalBounded = bounded.inflateZlibBounded
bounded.inflateZlibBounded = (...args) => { decodeCalls++; declaredBudget = args.slice(1); return originalBounded(...args) }
const fflate = require('../miniprogram/file-reader/document/vendor/fflate')
let maxAllocation = 0
const originalInflate = fflate.unzlibSync
fflate.unzlibSync = (...args) => {
  const value = originalInflate(...args)
  maxAllocation = Math.max(maxAllocation, value.length)
  return value
}
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')

test('CDR 两段 cmpr 的 Adler 损坏不能仍返回成功矢量', () => {
  const fixture = cdrCompressedVectorFixture()
  assert.ok(inspectFileBytes(fixture, { name: 'valid.cdr' }).previewSvg)
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  for (const [start, end] of [[48, firstEnd], [firstEnd + 8, fixture.length]]) {
    const bad = Buffer.from(fixture); bad[end - 1] ^= 1
    assert.throws(() => zlib.inflateSync(bad.subarray(start, end)), /data check/)
    const result = inspectFileBytes(bad, { name: 'corrupt.cdr' })
    assert.equal(result.previewSvg, '', '校验失败的 cmpr 仍被显示为正常矢量画面')
  }
})

test('CDR 实际解压越界应在分配大结果之前拒绝', () => {
  const fixture = cdrCompressedVectorFixture()
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  const expanded = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024))
  const bad = Buffer.concat([fixture.subarray(0, 48), expanded, fixture.subarray(firstEnd)])
  bad.writeUInt32LE(expanded.length + 8, 24)
  bad.writeUInt32LE(bad.length - 20, 16)
  bad.writeUInt32LE(bad.length - 8, 4)
  maxAllocation = 0
  declaredBudget = null
  assert.equal(inspectFileBytes(bad, { name: 'expanded.cdr' }).previewSvg, '')
  assert.ok(maxAllocation <= fixture.readUInt32LE(28), `声明260 B却先分配${maxAllocation} B`)
  assert.deepEqual(declaredBudget, [260, 32 * 1024 * 1024], 'CDR must actually call the allocation-tested bounded decoder with the declared size')
})

test('100个颜色/平移/压缩变体仍显示精确三角路径，而不是只识别文件头', () => {
  for (let i = 0; i < 100; i++) {
    const x = i - 50, y = 2 + i % 13, color = (i * 7919) & 0xffffff
    const bytes = cdrCompressedVectorFixture({ translation: [x, y], color,
      zlibOptions: { level: i % 4 === 0 ? 0 : 9, strategy: [0, 2, 3, 4][i % 4] } })
    const result = inspectFileBytes(bytes, { name: 'generated.cdr' })
    assert.ok(result.previewSvg.includes(`M${x} ${-y}L${x + 1} ${-y}L${x} ${-(y + 1)}Z`))
    assert.ok(result.previewSvg.includes(`fill="#${color.toString(16).padStart(6, '0')}"`))
  }
})

test('两段流的校验、截断、实际输出超量都明确失败，后续正常文件可恢复', () => {
  for (const sample of cdrZlibFailureFixtures()) {
    const result = inspectFileBytes(sample.bytes, { name: sample.name })
    assert.equal(result.previewSvg, '')
    assert.equal(result.preview, null)
    assert.ok(result.summary.includes(sample.message), result.summary)
  }
  assert.ok(inspectFileBytes(cdrCompressedVectorFixture(), { name: 'recovery.cdr' }).previewSvg)
})

test('多个 cmpr 合计超限在任何解压之前拒绝，而不是每段单独放行', () => {
  for (const offset of [28, 36]) {
    const fixture = cdrCompressedVectorFixture()
    fixture.writeUInt32LE(offset === 28 ? 17 * 1024 * 1024 : 3 * 1024 * 1024, offset)
    const chunk = fixture.subarray(12)
    const padded = Buffer.concat([chunk, chunk.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
    const file = Buffer.concat([fixture.subarray(0, 12), padded, padded])
    file.writeUInt32LE(file.length - 8, 4)
    decodeCalls = 0
    const result = inspectFileBytes(file, { name: 'many.cdr' })
    assert.equal(result.previewSvg, '')
    assert.match(result.summary, /多压缩列表合计超过本机解压上限/)
    assert.equal(decodeCalls, 0)
  }
})

test('非四字节长度表、流尾多余数据、空流和声明不符均不生成矢量', () => {
  const fixture = cdrCompressedVectorFixture()
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  const first = fixture.subarray(48, firstEnd), second = fixture.subarray(firstEnd + 8)
  const expected = [fixture.readUInt32LE(28), fixture.readUInt32LE(36)]
  const invalid = [
    repackCdrStreams(fixture, first, zlib.deflateSync(Buffer.alloc(3)), expected[0], 3),
    repackCdrStreams(fixture, first, second, expected[0] + 1, expected[1]),
    repackCdrStreams(fixture, zlib.deflateSync(Buffer.alloc(0)), second, expected[0], expected[1])
  ]
  const extra = Buffer.concat([fixture, Buffer.from([1, 2])]); extra.writeUInt32LE(extra.length - 8, 4); extra.writeUInt32LE(extra.length - 20, 16); invalid.push(extra)
  for (const sample of invalid) assert.equal(inspectFileBytes(sample, { name: 'invalid.cdr' }).previewSvg, '')
})

test('有独立缩略图时允许回退，但必须说明矢量校验失败与非完整正文', () => {
  const bad = cdrZlibFailureFixtures()[0].bytes
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const header = Buffer.alloc(8); header.write('prev'); header.writeUInt32LE(png.length, 4)
  const file = Buffer.concat([bad, bad.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0), header, png, png.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
  file.writeUInt32LE(file.length - 8, 4)
  const result = inspectFileBytes(file, { name: 'fallback.cdr' })
  assert.ok(result.preview)
  assert.equal(result.previewSvg, '')
  assert.match(result.summary, /校验失败.*仅显示独立内嵌缩略图.*不代表完整正文/)
})
