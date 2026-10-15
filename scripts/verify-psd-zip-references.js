'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')

const [destination, ...inputs] = process.argv.slice(2).map(file => path.resolve(file))
assert.ok(destination && inputs.length >= 2, '需要输出目录及至少两个真实样本')
const python = process.env.PSD_ORACLE_PYTHON || 'python3'
const options = { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }
const run = (script, args) => JSON.parse(execFileSync(python, [path.join(__dirname, script), ...args], options))
const derived = run('psd-zip-variants.py', [destination, ...inputs])
const originals = run('psd-reference-oracle.py', inputs)
const references = run('psd-reference-oracle.py', derived.map(item => item.path))
const results = derived.map((item, i) => {
  const original = originals.find(original => original.name === item.original)
  const expected = Buffer.from(original.rgbaBase64, 'base64')
  assert.deepEqual(Buffer.from(references[i].rgbaBase64, 'base64'), expected)
  const started = performance.now()
  const actual = extractPsdComposite(fs.readFileSync(item.path))
  assert.equal(actual.width, item.width); assert.equal(actual.height, item.height)
  assert.deepEqual(Buffer.from(actual.rgba), expected, item.name)
  return { ...item, byteDifference: 0, actualCompression: actual.compression,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100 }
})
console.log(JSON.stringify({ oracle: 'psd-tools 1.18.0; original and recompressed merged pixels', results }, null, 2))
