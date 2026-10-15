'use strict'

// Compare explicit fixed-hash public samples; never downloads or redistributes
// them. PSD_ORACLE_PYTHON should point at an isolated psd-tools==1.18.0 runtime.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tombstone } = require('./tombstone')

// verdicts.md T1：只有 docs/release-v1.4.45-dev.md 引用，需要外部 psd-tools/Swift oracle；观察两个发布周期。
tombstone('verify-psd-references', '2026-09-02', '只有 docs/release-v1.4.45-dev.md 引用；依赖隔离 Python psd-tools 与 Swift ImageIO oracle')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')

const inputs = process.argv.slice(2).map(file => path.resolve(file))
assert.ok(inputs.length >= 2, '需要至少两个真实 PSD 输入')
const profile = require('../compatibility/profiles/psd.json')
for (const file of inputs) {
  const sample = profile.publicSamples.find(sample => sample.name === path.basename(file))
  assert.ok(sample, `未登记样本 ${path.basename(file)}`)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sample.sha256)
}
const options = { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }
const reference = JSON.parse(execFileSync(process.env.PSD_ORACLE_PYTHON || 'python3', [path.join(__dirname, 'psd-reference-oracle.py'), ...inputs], options))
const native = process.platform === 'darwin'
  ? JSON.parse(execFileSync('swift', [path.join(__dirname, 'psd-imageio-oracle.swift'), ...inputs], options)) : []
const results = inputs.map((file, i) => {
  const actual = extractPsdComposite(fs.readFileSync(file))
  const expected = Buffer.from(reference[i].rgbaBase64, 'base64')
  assert.equal(actual.width, reference[i].width); assert.equal(actual.height, reference[i].height)
  assert.equal(actual.transparentPixels, reference[i].nonOpaquePixels)
  let maxAlphaDifference = 0; let maxPremultipliedRgbDifference = 0; let nativeRgbMaxDifference = 0
  const imageio = native[i] && Buffer.from(native[i].rgbaBase64, 'base64')
  for (let p = 0; p < expected.length; p += 4) {
    maxAlphaDifference = Math.max(maxAlphaDifference, Math.abs(actual.rgba[p + 3] - expected[p + 3]))
    if (imageio) assert.equal(actual.rgba[p + 3], imageio[p + 3], `ImageIO alpha ${path.basename(file)} pixel ${p / 4}`)
    for (let c = 0; c < 3; c++) {
      const value = Math.round(actual.rgba[p + c] * actual.rgba[p + 3] / 255)
      const oracle = Math.round(expected[p + c] * expected[p + 3] / 255)
      maxPremultipliedRgbDifference = Math.max(maxPremultipliedRgbDifference, Math.abs(value - oracle))
      if (imageio) nativeRgbMaxDifference = Math.max(nativeRgbMaxDifference, Math.abs(value - imageio[p + c]))
    }
  }
  assert.equal(maxAlphaDifference, 0)
  assert.ok(maxPremultipliedRgbDifference <= 1, `PSD reference color mismatch ${path.basename(file)}: ${maxPremultipliedRgbDifference}`)
  return { name: path.basename(file), width: actual.width, height: actual.height, depth: actual.depth,
    transparencySource: actual.transparencySource, nonOpaquePixels: actual.transparentPixels,
    maxAlphaDifference, maxPremultipliedRgbDifference, imageioAlphaCompared: !!imageio, nativeRgbMaxDifference,
    note: 'ImageIO RGB differences are recorded, not counted as agreement; psd-tools removes the RGB merged white matte.' }
})
console.log(JSON.stringify({ oracle: 'psd-tools 1.18.0 + ImageIO alpha', results }, null, 2))
