'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { psdAlphaFixture, taggedBlock } = require('./helpers/psd-alpha')
const alphaOf = result => Array.from(result.rgba.filter((_, i) => i % 4 === 3))

test('PSD/PSB 8/16/32 bit 四种压缩读取真正的合成透明度，不对 alpha 做 sRGB 伽马', () => {
  for (const version of [1, 2]) for (const depth of [8, 16, 32]) for (const compression of [0, 1, 2, 3]) {
    const result = extractPsdComposite(psdAlphaFixture({ version, depth, compression }))
    assert.deepEqual(alphaOf(result), [0, 64, 128, 191, 255], `${version}/${depth}/${compression}`)
    assert.equal(result.transparentPixels, 4)
    assert.equal(result.transparencySource, 'layer-count')
  }
})

test('Mtrn/Mt16/Mt32 以及 Layr/Lr16/Lr32 的合成透明标志按位深读取', () => {
  for (const version of [1, 2]) for (const [depth, keys] of [[8, ['Mtrn', 'Layr']], [16, ['Mt16', 'Lr16']], [32, ['Mt32', 'Lr32']]]) for (const flag of keys) {
    assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ version, depth, flag }))), [0, 64, 128, 191, 255], `${version}/${flag}`)
  }
})

test('正图层计数的额外蒙版/专色通道不是透明度；真正透明度不是最后一个通道', () => {
  assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ flag: 'none' }))), [255, 255, 255, 255, 255])
  assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ trailingSpot: true }))), [0, 64, 128, 191, 255])
  assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ depth: 8, flag: 'Mt32' }))), [255, 255, 255, 255, 255])
})

test('灰度/CMYK/Lab 的透明通道在颜色通道后，不覆盖颜色或误作专色', () => {
  for (const mode of [1, 4, 9]) for (const depth of [8, 16]) {
    const result = extractPsdComposite(psdAlphaFixture({ mode, depth }))
    assert.deepEqual(alphaOf(result), [0, 64, 128, 191, 255])
    assert.equal(result.transparentPixels, 4)
  }
})

test('合成透明度转换为真实棋盘格，保留半透明颜色而非黑底', () => {
  const result = extractPsdComposite(psdAlphaFixture())
  const flattened = compositeRgbaOnCheckerboard(result.rgba, result.width, 1)
  assert.deepEqual(Array.from(flattened.slice(0, 4)), [248, 248, 248, 255])
  assert.equal(flattened[2 * 4 + 3], 255)
  assert.ok(flattened[2 * 4 + 1] >= 110 && flattened[2 * 4 + 1] <= 125)
})

test('只读结构化标签，不从未知块内部搜索透明标记', () => {
  const hidden = taggedBlock('fake', Buffer.from('8BIMMtrn\0\0\0\0'))
  assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ flag: 'none', extraBlocks: [hidden] }))), [255, 255, 255, 255, 255])
})

test('GIMP 风格图层区可在图层信息结尾结束，无需不存在的全局蒙版', () => {
  assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ omitGlobalMask: true }))), [0, 64, 128, 191, 255])
})

test('声明透明度却缺通道，或图层/标签长度损坏，不能悄悄退成不透明', () => {
  assert.throws(() => extractPsdComposite(psdAlphaFixture({ extraChannel: false })), /透明.*通道/)
  const truncated = psdAlphaFixture({ flag: 'Mt32', depth: 32 })
  truncated.writeUInt32BE(0x7fffffff, 34)
  assert.throws(() => extractPsdComposite(truncated), /图层.*长度|图层.*完整/)
  const bad = psdAlphaFixture({ flag: 'Mtrn' })
  const tag = bad.indexOf(Buffer.from('Mtrn'))
  bad.writeUInt32BE(100000, tag + 4)
  assert.throws(() => extractPsdComposite(bad), /标签.*长度|标签.*完整/)
})

test('Mt 标签多个额外通道必须用资源 1053 的透明标识定位，不猜最后一个', () => {
  const resource = Buffer.alloc(20)
  resource.write('8BIM'); resource.writeUInt16BE(1053, 4); resource.writeUInt32BE(8, 8)
  resource.writeUInt32BE(0, 12); resource.writeUInt32BE(17, 16)
  for (const compression of [0, 1, 2, 3]) {
    const opts = { flag: 'Mt32', depth: 32, trailingSpot: true, compression, resources: resource }
    assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture(opts))), [0, 64, 128, 191, 255])
    const last = Buffer.from(resource); last.writeUInt32BE(17, 12); last.writeUInt32BE(0, 16)
    assert.deepEqual(alphaOf(extractPsdComposite(psdAlphaFixture({ ...opts, resources: last }))), [0, 0, 0, 0, 0])
  }
  assert.throws(() => extractPsdComposite(psdAlphaFixture({ flag: 'Mt32', depth: 32, trailingSpot: true })), /透明通道位置/)
})

test('64 个确定性尺寸/行边界/压缩变体保留每个像素透明度', () => {
  const alphas = [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1]
  for (let i = 0; i < 64; i++) {
    const width = 1 + (i * 37 % 71), height = 1 + i % 5, depth = [8, 16, 32][i % 3]
    const result = extractPsdComposite(psdAlphaFixture({ width, height, depth, compression: i % 4, version: 1 + i % 2, alpha: alphas }))
    const expected = Array.from({ length: width * height }, (_, p) => Math.round(alphas[p % alphas.length] * 255))
    assert.deepEqual(alphaOf(result), expected, `${width}x${height}/${depth}/${i % 4}`)
  }
})

test('长标签及两字节/四字节填充按结构跳过；不越过实际区段', () => {
  for (const version of [1, 2]) for (const wide of [false, true]) {
    const block = taggedBlock('test', Buffer.from([1, 2]), version, wide)
    for (const padding of [0, 2]) {
      const fixture = psdAlphaFixture({ version, flag: 'Mtrn', extraBlocks: [block.subarray(0, block.length - padding)] })
      assert.deepEqual(alphaOf(extractPsdComposite(fixture)), [0, 64, 128, 191, 255])
    }
  }
})

test('透明通道截断、实际解压长度、画布及解压资源上限仍受保护', () => {
  for (const compression of [0, 1]) {
    const fixture = psdAlphaFixture({ compression })
    assert.throws(() => extractPsdComposite(fixture.subarray(0, -1)), /不完整/)
  }
  assert.throws(() => extractPsdComposite(psdAlphaFixture(), { maxPixels: 4 }), /画布.*上限/)
  assert.throws(() => extractPsdComposite(psdAlphaFixture({ compression: 2, depth: 32 }), { maxInflatedBytes: 79 }), /解压上限/)
  const bad = psdAlphaFixture({ compression: 2 }); bad.writeUInt16BE(5, 12)
  assert.throws(() => extractPsdComposite(bad), /长度不符/)
  const unsafe = psdAlphaFixture({ version: 2 }); unsafe.writeBigUInt64BE(9007199254740992n, 34)
  assert.throws(() => extractPsdComposite(unsafe), /可安全处理/)
})

test('RGB 合成图去白色底衬后再转 sRGB，32-bit 半透明黑边不能变灰', () => {
  for (const depth of [8, 16, 32]) for (const compression of [0, 1, 2, 3]) {
    const result = extractPsdComposite(psdAlphaFixture({ depth, compression, colors: [0, 0, 0] }))
    for (let p = 0; p < 5; p++) assert.ok(result.rgba[p * 4] <= 4, `black ${depth}/${compression}/${p}`)
    const colored = extractPsdComposite(psdAlphaFixture({ depth, compression, colors: [0.2, 0.4, 0.8] }))
    const expected = depth === 32 ? [124, 170, 231] : [51, 102, 204]
    for (let p = 1; p < 5; p++) for (let c = 0; c < 3; c++) assert.ok(Math.abs(colored.rgba[p * 4 + c] - expected[c]) <= 4, `${depth}/${compression}/${p}/${c}`)
  }
})
