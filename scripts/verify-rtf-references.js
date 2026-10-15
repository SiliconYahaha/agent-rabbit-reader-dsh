'use strict'

// Local, read-only oracle. Public files are supplied explicitly, never fetched or
// redistributed by this script. macOS Cocoa/textutil is independent of our parser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { encodedRtf } = require('../tests/helpers/rtf-samples')

const hashes = {
  'accent.rtf': 'af34e9fd55222e25f022c1c6029ec4a4e0dee3424e3ebeb5d52379ce461b9bac',
  'unicode.rtf': '0724e00559b01ff7639eca25ecd6a7c0a24a253d06ba65ef0ee1dec4260639e8',
  'formatting.rtf': 'abca13508e29e97fc13609e1143b2a705e3fc8b0a35ef0cf6196588339d6f14c'
}
function oracle (bytes) {
  const result = spawnSync('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], { input: bytes, timeout: 10000, maxBuffer: 10 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr.toString())
  return result.stdout.toString('utf8').trim()
}
const files = process.argv.slice(2)
assert.equal(files.length, 3, '需传入 accent.rtf unicode.rtf formatting.rtf 的本地路径')
assert.deepEqual(files.map(file => path.basename(file)).sort(), Object.keys(hashes).sort())
const samples = []
for (const file of files) {
  const bytes = fs.readFileSync(file)
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hashes[path.basename(file)])
  const actual = rtfToText(bytes)
  assert.equal(actual, oracle(bytes), path.basename(file))
  samples.push({ name: path.basename(file), size: bytes.length, characters: actual.length, equalToCocoa: true })
}
let generated = 0
for (const [encoding, cp, text] of [['gbk', 936, '中文正文'], ['big5', 950, '繁體中文'], ['shift_jis', 932, '日本語の本文']]) {
  for (let variant = 0; variant < 20; variant++) {
    const expected = `${text} ${variant}`
    const bytes = encodedRtf(expected, encoding, cp, variant)
    assert.equal(oracle(bytes), expected, `Cocoa ${encoding}/${variant}`)
    assert.equal(rtfToText(bytes), expected, `reader ${encoding}/${variant}`)
    generated++
  }
}
const ambiguous = Buffer.from('{\\rtf1\\ansi\\uc1\\u20320\\par X}')
assert.equal(rtfToText(ambiguous), '你X')
const differences = [{ case: 'control-word-as-unicode-fallback', reader: rtfToText(ambiguous), cocoa: oracle(ambiguous), decision: 'Follow MSFT-RTF 1.9.1 pp.14-15: a complete control word counts as one fallback character; do not leak par into body.' }]
console.log(JSON.stringify({ publicSamples: samples, generatedMatches: generated, documentedOracleDifferences: differences }, null, 2))
