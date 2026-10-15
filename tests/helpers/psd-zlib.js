'use strict'

const zlib = require('node:zlib')
const { psdAlphaFixture } = require('./psd-alpha')

function psdZlibFailureFixtures () {
  const cases = []
  for (const compression of [2, 3]) {
    const valid = psdAlphaFixture({ compression })
    const start = 38 + valid.readUInt32BE(34) + 2
    const corrupt = Buffer.from(valid); corrupt[corrupt.length - 1] ^= 1
    cases.push({ name: `adler-invalid-${compression}.psd`, bytes: corrupt, message: '校验失败' })
    cases.push({ name: `oversized-stream-${compression}.psd`, bytes: Buffer.concat([valid.subarray(0, start), zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024))]), message: '实际解压长度超过声明上限' })
    cases.push({ name: `truncated-stream-${compression}.psd`, bytes: valid.subarray(0, valid.length - 5), message: '损坏' })
  }
  return cases
}

module.exports = { psdZlibFailureFixtures }
