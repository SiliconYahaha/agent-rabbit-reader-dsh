'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.join(__dirname, '../fixtures/css-variables')
const source = fs.readFileSync(path.join(root, 'variable-cycles.html'), 'utf8')
// Extract only literal arrays from the fixed original. Do not execute fetched
// scripts in Node or substitute reader-generated expected values.
const pattern = /\n  test_cycles\(\s*(\[[\s\S]*?\]),\s*(\[[\s\S]*?\]),\s*(?:\/\/[^\n]*\n\s*)?(\[[\s\S]*?\]),\s*'([^']*)'\);/g
const array = s => JSON.parse(s.replace(/'/g, '"').replace(/,\s*\]/g, ']'))
const cycles = Array.from(source.matchAll(pattern), m => ({ declarations: array(m[1]), invalid: array(m[2]), valid: array(m[3]), name: m[4] }))
assert.equal(cycles.length, 11, 'fixed upstream test extraction must remain complete')
module.exports = { root, cycles }
