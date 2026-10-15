'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { svgLines, compare } = require('../scripts/probe-dxf-insert-grid')
const originals = require('./fixtures/dxf-insert-grid/before.json').rows
const references = require('./fixtures/dxf-insert-grid/reference-review.json').rows

test('MINSERT spacing remains independent of block scale through mirrored, rotated and nested original drawings', () => {
  for (const row of originals) {
    const reference = references.find(r => r.name === row.name)
    assert.equal(row.auditErrors, 0); assert.equal(reference.sha256, row.sha256)
    const bytes = Buffer.from(row.base64, 'base64')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256)
    const info = inspectFileBytes(bytes, { name: row.name + '.dxf' })
    const comparison = compare(svgLines(info.previewSvg), reference.expandedBeforeParentLines)
    assert.equal(comparison.allExact, true, row.name + ': ' + JSON.stringify(comparison))
  }
})

test('nested independent reference scales child grid spacing by its enclosing block transform', () => {
  for (const row of references) {
    if (!row.name.endsWith('-nested')) { assert.equal(row.convenienceAgrees, true); continue }
    const step = lines => Math.hypot(lines[3][0][0] - lines[0][0][0], lines[3][0][1] - lines[0][0][1])
    // Authored child column spacing12 is in the outer block's coordinates;
    // the outer uniform1.25 transform makes that distance15 in world units.
    assert.ok(Math.abs(step(row.expandedBeforeParentLines) - 15) < 1e-9)
    assert.ok(Math.abs(step(row.originalConvenienceLines) - 12) < 1e-9)
    assert.equal(row.convenienceAgrees, false)
  }
})
