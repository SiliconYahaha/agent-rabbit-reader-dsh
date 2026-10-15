'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview, flush } = require('./helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
// Exact rational references. At 16 bits alpha=65280, matte offset=255;
// stored color 383 yields (383+65280-65535)*255/65280 = 1/2 -> byte 1.
// At 8 bits alpha=8, color=251 gives (251+8-255)*255/8 = 127.5 -> 128.
function fixture (depth, options = {}) {
  return psdAlphaFixture({ depth, width: 5, height: 1,
    colors: depth === 8 ? [.5, .5, .5] : [1 / 510, 3 / 510, 5 / 510],
    alpha: [depth === 8 ? 8 / 255 : 65280 / 65535], ...options })
}
function expected (depth) { return Uint8Array.from(Array(5).fill(depth === 8 ? [128, 128, 128, 8] : [1, 2, 3, 254]).flat()) }

test('RGB integer matte removal rounds exact half-byte ties without normalization cancellation', () => {
  for (const depth of [8, 16]) for (const version of [1, 2]) for (const compression of [0, 1, 2, 3]) {
    assert.deepEqual(extractPsdComposite(fixture(depth, { version, compression })).rgba, expected(depth), `${depth}/${version}/${compression}`)
  }
})

test('integer matte endpoints stay bounded and alpha remains independent of RGB quantization', () => {
  for (const depth of [8, 16]) {
    const result = extractPsdComposite(psdAlphaFixture({ depth, colors: [0, 1, .5], alpha: [0, 1] }))
    assert.deepEqual(Array.from(result.rgba.slice(0, 8)), [0, 0, 0, 0, 0, 255, 128, 255])
  }
})

test('actual preview uses corrected RGB bytes and recovers after a truncated composite', async () => {
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) { const b = input.subarray(o.position || 0, (o.position || 0) + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const good = fixture(16, { version: 2, compression: 3 }), bad = fixture(16).subarray(0, -1)
  const pixels = compositeRgbaOnCheckerboard(expected(16), 5)
  const reference = Buffer.from(encode({ data: pixels, width: 5, height: 1 }, 82).data)
  for (input of [good, bad, good]) {
    written = null; host.loadMaterial({ name: 'preview.psd', path: '/local/preview.psd', size: input.length }); await flush()
    assert.equal(host.data.loading, false)
    if (input === bad) { assert.equal(written, null); assert.equal(host.data.previewPath, ''); assert.match(host.data.message, /不完整/); continue }
    assert.equal(host.data.error, ''); assert.match(host.data.previewPath, /psd-composite-/); assert.deepEqual(written, reference)
  }
})
