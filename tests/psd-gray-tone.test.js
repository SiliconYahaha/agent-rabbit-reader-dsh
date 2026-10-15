'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { designPreview, flush } = require('./helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')

// Encoded Y-prime ramps, independently checked with psd-tools and ImageIO Raw
// composites; see scripts/probe-psd-gray-tone.py and the compatibility run.
const tones = [0, .015625, .0625, .25, .5, .75, 1]
const bytes8 = [0, 4, 16, 64, 128, 191, 255]
const alphas = [1, .75, .5, .25, .0625, 0, 1]
const alpha8 = [255, 191, 128, 64, 16, 0, 255]
const expected = (transparent, count = 14) => Uint8Array.from(Array.from({ length: count }, (_, i) => [bytes8[i % 7], bytes8[i % 7], bytes8[i % 7], transparent ? alpha8[i % 7] : 255]).flat())
const gray = options => psdAlphaFixture({ mode: 1, depth: 32, width: 7, height: 2, colors: [tones], alpha: alphas, ...options })

test('grayscale tone stays encoded across depths, PSD/PSB, compression and merged transparency', () => {
  for (const depth of [8, 16, 32]) for (const version of [1, 2]) for (const compression of [0, 1, 2, 3]) for (const transparent of [false, true]) {
    const result = extractPsdComposite(gray({ depth, version, compression, extraChannel: transparent, flag: transparent ? 'count' : 'none' }))
    assert.deepEqual(result.rgba, expected(transparent), `${depth}/${version}/${compression}/${transparent}`)
  }
})

test('gray32 alpha markers and trailing saved selections do not change gray tone', () => {
  for (const version of [1, 2]) for (const flag of ['count', 'Mt32', 'Lr32']) {
    const result = extractPsdComposite(gray({ version, flag, compression: 3, trailingSpot: flag !== 'Mt32' }))
    assert.deepEqual(result.rgba, expected(true), `${version}/${flag}`)
  }
})

test('actual preview writes correct gray JPEGs, retains RGB conversion and recovers after a bad file', async () => {
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) { const start = o.position || 0, b = input.subarray(start, start + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const good = gray({ version: 2, compression: 3 })
  const rgb = psdAlphaFixture({ depth: 32, colors: [.25, .5, .75], extraChannel: false, flag: 'none' })
  const malformed = gray({ compression: 0 }).subarray(0, -1)
  for (input of [good, rgb, malformed, good]) {
    written = null
    host.loadMaterial({ name: 'preview.psd', path: '/local/preview.psd', size: input.length })
    await flush()
    assert.equal(host.data.loading, false)
    if (input === malformed) {
      assert.equal(written, null); assert.equal(host.data.previewPath, '')
      assert.match(host.data.message, /不完整/)
      continue
    }
    const isGray = input === good
    const rgba = isGray ? expected(true) : Uint8Array.from(Array(5).fill([137, 188, 225, 255]).flat())
    const pixels = isGray ? compositeRgbaOnCheckerboard(rgba, 7) : rgba
    const jpeg = encode({ data: pixels, width: isGray ? 7 : 5, height: isGray ? 2 : 1 }, 82).data
    assert.deepEqual(written, Buffer.from(jpeg))
    assert.match(host.data.previewPath, /psd-composite-/)
    assert.equal(host.data.error, '')
  }
})
