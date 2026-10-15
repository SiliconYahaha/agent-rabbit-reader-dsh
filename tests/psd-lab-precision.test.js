'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { designPreview } = require('./helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const fixture = require('./fixtures/psd-lab-precision.json')

function checkColors (rgba, rgb, label) {
  assert.equal(rgba.length / 4, rgb.length / 3, label)
  for (let i = 0; i < rgb.length / 3; i++) {
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(rgba[i * 4 + c] - rgb[i * 3 + c]) <= 1, `${label}: pixel ${i} channel ${c}: ${rgba[i * 4 + c]} vs ${rgb[i * 3 + c]}`)
  }
}
for (const pattern of ['seeded-gamut', 'dark-ramp', 'chroma-ramp']) test(`Lab source precision: ${pattern} native PSD/PSB in Raw/RLE/ZIP/prediction`, () => {
  for (const sample of fixture.samples.filter(s => s.pattern === pattern)) {
    const bytes = Buffer.from(sample.sourceBase64, 'base64')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sourceSha256)
    const result = extractPsdComposite(bytes)
    assert.equal(result.width, sample.width); assert.equal(result.height, sample.height)
    checkColors(result.rgba, Buffer.from(fixture.references[sample.reference].rgbBase64, 'base64'), sample.name)
    for (let i = 3; i < result.rgba.length; i += 4) assert.equal(result.rgba[i], 255)
  }
})

// A low-bit source difference that disappears when all three Lab channels are
// rounded to eight bits first. This also guards against increasing tolerance.
test('16-bit Lab retains a sub-byte chroma change that changes the visible red channel', () => {
  const sample = fixture.samples.find(s => s.name === 'seeded-gamut-d16-v1-c0.psd')
  const result = extractPsdComposite(Buffer.from(sample.sourceBase64, 'base64'))
  assert.deepEqual(Array.from(result.rgba.slice(114 * 4, 114 * 4 + 4)), [67, 143, 255, 255])
})

function alphaSamples () {
  const values = [29118, 32253, 56211] // fractional encoded Lab coordinates
  return [1, 2].flatMap(version => [0, 1, 2, 3].map(compression => ({
    name: `alpha-v${version}-c${compression}.psd`,
    bytes: psdAlphaFixture({ version, depth: 16, mode: 9, compression, width: 7, height: 2, colors: values.map(v => v / 65535), alpha: [0, .02, .25, .5, .75, .98, 1], trailingSpot: true })
  })))
}
test('Lab precision does not reinterpret merged alpha or a trailing saved selection', () => {
  for (const sample of alphaSamples()) {
    const result = extractPsdComposite(sample.bytes)
    for (let i = 0; i < 14; i++) assert.equal(result.rgba[i * 4 + 3], [0, 5, 64, 128, 191, 250, 255][i % 7])
    // Opaque color channels must be the same at every alpha level.
    for (let i = 1; i < 14; i++) assert.deepEqual(result.rgba.slice(i * 4, i * 4 + 3), result.rgba.slice(0, 3))
  }
})
test('actual preview preserves verified Lab pixels through JPEG and clears a failed image before recovery', async () => {
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) { const start = o.position || 0, b = input.bytes.subarray(start, start + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const good = fixture.samples.filter(s => s.depth === 16 && s.compression === 3).map(s => ({ name: s.name, bytes: Buffer.from(s.sourceBase64, 'base64') }))
  const bad = { name: 'unsupported-lab32.psd', bytes: psdAlphaFixture({ mode: 9, depth: 32 }) }
  const sequence = [...good.slice(0, 2), ...alphaSamples(), bad, ...good.slice(2)]
  for (input of sequence) {
    written = null; host.loadMaterial({ name: input.name, path: '/tmp/lab.psd', size: input.bytes.length })
    for (let i = 0; i < 6; i++) await new Promise(setImmediate)
    assert.equal(host.data.loading, false); assert.equal(host.data.error, '')
    if (input === bad) { assert.equal(written, null); assert.equal(host.data.previewPath, ''); assert.match(host.data.message, /32 bit.*Lab/); continue }
    const decoded = extractPsdComposite(input.bytes)
    const pixels = decoded.transparentPixels ? compositeRgbaOnCheckerboard(decoded.rgba, decoded.width) : decoded.rgba
    assert.deepEqual(written, Buffer.from(encode({ data: pixels, width: decoded.width, height: decoded.height }, 82).data), input.name)
    assert.match(host.data.previewPath, /psd-composite-/)
  }
})
