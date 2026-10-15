'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const zlib = require('node:zlib')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const vendor = require('../miniprogram/file-reader/document/vendor/fflate')
let allocatedOutput = 0
const original = vendor.unzlibSync
vendor.unzlibSync = (...args) => {
  const output = original(...args)
  allocatedOutput = Math.max(allocatedOutput, output.length)
  return output
}
const { extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const { MAX_BLOCKS } = require('../miniprogram/file-reader/engine/core/bounded-zlib')

test('PSD 合法但区块过多是本机限制，不错误声称文件已经损坏', () => {
  const valid = psdAlphaFixture({ compression: 2 })
  const start = 38 + valid.readUInt32BE(34) + 2
  const blocks = Buffer.alloc(MAX_BLOCKS * 5)
  for (let at = 0; at < blocks.length; at += 5) { blocks[at + 3] = 255; blocks[at + 4] = 255 }
  const excessive = Buffer.concat([valid.subarray(0, start + 2), blocks, valid.subarray(start + 2)])
  assert.equal(zlib.inflateSync(excessive.subarray(start)).length, 20)
  assert.throws(() => extractPsdComposite(excessive), error => /暂不能还原.*区块数量.*本机处理上限/.test(error.message) && !/损坏/.test(error.message))
})

test('PSD ZIP 不能先分配超过声明/上限的解压结果，再以长度错误结束', () => {
  for (const compression of [2, 3]) {
    const valid = psdAlphaFixture({ compression })
    const start = 38 + valid.readUInt32BE(34) + 2
    // Bounded benign stress input: only two MiB of zero bytes, not an unbounded bomb.
    const invalid = Buffer.concat([valid.subarray(0, start), zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024))])
    allocatedOutput = 0
    assert.throws(() => extractPsdComposite(invalid, { maxInflatedBytes: 80 }), /长度|上限/)
    assert.ok(allocatedOutput <= 80, `在拒绝之前已分配 ${allocatedOutput} B，输出预算只有 80 B`)
  }
})

test('PSD ZIP/Prediction 的 Adler 校验错误不能返回看似成功的像素', () => {
  for (const compression of [2, 3]) {
    const invalid = psdAlphaFixture({ compression })
    const start = 38 + invalid.readUInt32BE(34) + 2
    invalid[invalid.length - 1] ^= 1
    assert.throws(() => zlib.inflateSync(invalid.subarray(start)), /data check/)
    assert.throws(() => extractPsdComposite(invalid), /校验|损坏/)
  }
})
