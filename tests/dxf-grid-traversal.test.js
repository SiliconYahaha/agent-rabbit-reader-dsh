'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { compare, svgLines } = require('../scripts/probe-dxf-insert-grid')
const { drawing } = require('../scripts/probe-dxf-traversal-adversarial')
const originals = require('./fixtures/dxf-grid-traversal/before.json').rows
const inspect = bytes => inspectFileBytes(bytes, { name: 'drawing.dxf' })
const previewCount = info => info.metadata.find(m => m.label === '预览图元').value

test('retained native originals expand full legal grids, coincident cells and 64 nested blocks', () => {
  for (const row of originals) {
    const bytes = Buffer.from(row.base64, 'base64')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256); assert.equal(row.auditErrors, 0)
    if (row.name === 'depth65') { assert.throws(() => inspect(bytes), /64 层/); continue }
    const info = inspect(bytes), actual = svgLines(info.previewSvg), expected = row.nativeLines.slice(0, 1200)
    assert.equal(compare(actual, expected).allExact, true, row.name)
    assert.equal(previewCount(info), `${expected.length}${row.name === 'over1201' ? '（已截断）' : ''}`, row.name)
  }
})

test('cycles fail clearly, shared blocks remain reusable and huge empty arrays preserve following content', () => {
  assert.throws(() => inspect(drawing('cycle')), /循环/)
  assert.equal(previewCount(inspect(drawing('reuse'))), '2')
  const info = inspect(drawing('empty-huge'))
  assert.equal(previewCount(info), '1'); assert.match(info.previewSvg, /M 0 0 L 4 -2/)
  assert.equal(previewCount(inspect(drawing('huge'))), '1200（已截断）')
})

test('empty and unsupported nested arrays terminate under work budget with explicit incomplete notice', () => {
  for (const kind of ['empty-tree', 'unsupported-tree']) {
    const info = inspect(drawing(kind))
    assert.equal(previewCount(info), '0（已截断）')
  }
})
