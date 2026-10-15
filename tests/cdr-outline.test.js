'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { cdrOutlineFixture } = require('./helpers/cdr-outline')
const { cdrCompressedVectorFixture } = require('./helpers/cdr-zlib')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')

// Independent reference: libcdr CDRContentCollector::_lineProperties at
// 77f52f694362ba0f01b3fdac6ebcc91e5debe400: absent style or bit 0 => no outline.
test('CDR 明确无轮廓时不添加伪造边线（含与其他位组合）', () => {
  for (const type of [1, 3, 5, 7, 33, 35]) {
    const svg = inspectFileBytes(cdrOutlineFixture({ type }), { name: 'no-outline.cdr' }).previewSvg
    assert.ok(svg.includes('M2 -3L3 -3L2 -4Z'))
    assert.match(svg, /<path[^>]*stroke="none"/)
  }
})

test('CDR 未指定线条样式时不擅自给填色路径增加黑边', () => {
  const svg = inspectFileBytes(cdrCompressedVectorFixture(), { name: 'no-style.cdr' }).previewSvg
  assert.match(svg, /<path[^>]*stroke="none"/)
})

test('CDR 有效细线按原宽度显示，不被最小视觉宽度放大', () => {
  const svg = inspectFileBytes(cdrOutlineFixture({ type: 2, width: 1 }), { name: 'fine-line.cdr' }).previewSvg
  const match = svg.match(/<path[^>]*stroke-width="([^"]+)"/)
  assert.ok(match)
  assert.ok(Math.abs(Number(match[1]) - 1 / 254000) < 1e-8, `fine outline inflated or rounded away: ${match[1]}`)
})

function firstPath (options) {
  const result = inspectFileBytes(cdrOutlineFixture(options), { name: 'outline.cdr' })
  const path = result.previewSvg.match(/<path\b[^>]+>/)?.[0]
  assert.ok(path, result.summary)
  return path
}

test('端点、转角和伸展比例取自文件，不统一改成圆角', () => {
  for (const caps of [0, 1, 2, 9]) for (const join of [0, 1, 2, 9]) {
    const path = firstPath({ type: 2, caps, join, stretch: 125 })
    assert.ok(path.includes(`stroke-linecap="${['butt', 'round', 'square'][caps] || 'butt'}"`))
    assert.ok(path.includes(`stroke-linejoin="${['miter', 'round', 'bevel'][join] || 'miter'}"`))
    assert.ok(path.includes('stroke-width="0.125"'))
  }
})

test('基本虚线按真实分段与线宽输出，无轮廓标志优先于虚线', () => {
  assert.ok(firstPath({ type: 4, dashes: [4, 2, 1, 2] }).includes('stroke-dasharray="0.4 0.2 0.1 0.2"'))
  assert.ok(firstPath({ type: 4, dashes: [0, 2], caps: 1 }).includes('stroke-dasharray="0 0.2"'))
  for (const type of [1, 2, 5]) assert.doesNotMatch(firstPath({ type, dashes: [4, 2] }), /stroke-dasharray/)
})

test('100种线宽、颜色、伸展和无轮廓变体不伪造边线', () => {
  for (let i = 0; i < 100; i++) {
    const hidden = i % 3 === 0, width = i + 1, color = i * 15937, stretch = i * 3
    const path = firstPath({ type: hidden ? 1 : 2, width, color, stretch })
    const actualWidth = Number(path.match(/stroke-width="([^"]+)"/)[1])
    const expectedWidth = hidden ? 0 : width / 254000 * stretch / 100
    assert.ok(Math.abs(actualWidth - expectedWidth) <= Math.max(1e-15, expectedWidth * 1e-10))
    assert.ok(path.includes(`stroke="${hidden ? 'none' : '#' + color.toString(16).padStart(6, '0')}"`))
  }
  assert.ok(firstPath({ type: 0 }).includes('stroke-width="0"'))
  assert.ok(firstPath({ type: 2, stretch: 0 }).includes('stroke-width="0"'))
})

test('宽轮廓完整落入预览边界，不能按路径中心线裁掉边缘', () => {
  const result = inspectFileBytes(cdrOutlineFixture({ type: 2, width: 254000 }), { name: 'wide.cdr' })
  const box = result.previewSvg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
  assert.ok(box[0] <= 1 && box[0] + box[2] >= 4)
  assert.ok(box[1] <= -5 && box[1] + box[3] >= -2)
})

test('虚线分段声明超量或截断必须明确失败，之后正常文件仍可打开', () => {
  const zlib = require('node:zlib')
  const { repackCdrStreams } = require('./helpers/cdr-zlib')
  const base = cdrOutlineFixture({ type: 4 })
  const firstEnd = 48 + base.readUInt32LE(24) - 8
  const stream = zlib.inflateSync(base.subarray(48, firstEnd))
  stream.writeUInt16LE(1, 12 + 8 + 104)
  const truncated = repackCdrStreams(base, zlib.deflateSync(stream), base.subarray(firstEnd + 8), stream.length, base.readUInt32LE(36))
  for (const [bytes, reason] of [[truncated, /不完整/], [cdrOutlineFixture({ type: 4, dashes: Array(129).fill(1) }), /上限/]]) {
    const result = inspectFileBytes(bytes, { name: 'invalid.cdr' })
    assert.equal(result.previewSvg, '')
    assert.match(result.summary, reason)
  }
  assert.ok(firstPath({ type: 2 }).includes('stroke="#112233"'))
})
