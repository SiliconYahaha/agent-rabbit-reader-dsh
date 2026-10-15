'use strict'
// Generate originals independently first with probe-psd-lab-precision.py.
// This checks source identity, native color values and actual host JPEG bytes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { designPreview } = require('../tests/helpers/reader-host')
const { extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const fixture = require('../tests/fixtures/psd-lab-precision.json')
const originals = path.resolve(process.argv[2] || 'outputs/psd-lab-precision/originals')
const output = path.resolve(process.argv[3] || 'outputs/psd-lab-precision/verified')
const native = JSON.parse(fs.readFileSync(path.join(originals, 'native.json')))
fs.mkdirSync(output, { recursive: true })
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
async function main () {
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: output }, getFileSystemManager: () => ({
    readFile (o) { const start = o.position || 0, b = input.subarray(start, start + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); fs.writeFileSync(o.filePath, written); o.success() }
  }) })
  const results = []
  assert.equal(native.results.length, fixture.samples.length)
  for (const sample of fixture.samples) {
    input = fs.readFileSync(path.join(originals, sample.name))
    assert.equal(hash(input), sample.sourceSha256, sample.name)
    const reference = native.results.find(r => r.name === sample.name)
    assert.equal(reference.rgbBase64, fixture.references[sample.reference].rgbBase64, sample.name)
    const decoded = extractPsdComposite(input), expected = Buffer.from(reference.rgbBase64, 'base64')
    let maxDelta = 0, differentPixels = 0
    for (let i = 0; i < expected.length / 3; i++) {
      let difference = 0
      for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs(decoded.rgba[i * 4 + c] - expected[i * 3 + c]))
      maxDelta = Math.max(maxDelta, difference); differentPixels += Number(difference !== 0)
      assert.equal(decoded.rgba[i * 4 + 3], 255)
    }
    assert.ok(maxDelta <= 1, `${sample.name}: ${maxDelta}`)
    written = null
    host.loadMaterial({ name: sample.name, path: path.join(originals, sample.name), size: input.length })
    for (let i = 0; i < 8; i++) await new Promise(setImmediate)
    assert.equal(host.data.loading, false); assert.equal(host.data.error, '')
    assert.match(host.data.previewPath, /psd-composite-/)
    const jpg = Buffer.from(encode({ data: decoded.rgba, width: decoded.width, height: decoded.height }, 82).data)
    assert.deepEqual(written, jpg, sample.name)
    fs.writeFileSync(path.join(output, sample.name + '.jpg'), jpg)
    results.push({ name: sample.name, sourceSha256: hash(input), nativeMaxChannelDelta: maxDelta, differentPixels, actualHostJPEGExact: true, previewSha256: hash(jpg) })
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ producer: native.producer, oracle: native.oracle, results, limits: ['Unprofiled merged Lab composites only; no ICC or layer recomposition.', 'Host file API is mocked. Browser decoding, WeChat WXML and physical devices are separate verification.'] }, null, 2) + '\n')
  console.log(JSON.stringify({ nativeOriginals: results.length, actualHostPreviews: results.length, maximumChannelDelta: Math.max(...results.map(r => r.nativeMaxChannelDelta)) }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
