'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { svgPixelFailures } = require('../scripts/svg-pixel-verdict')
const recorded = require('../compatibility/runs/2026-09-05-svg-viewports.json').chrome.results

test('the recorded v1.4.106 false green result fails when native SVG disagrees with its matching reference', () => {
  const missed = recorded.find(row => row.name === 'overflow-auto')
  assert.equal(missed.variants[0].rgbaError, 0)
  assert.ok(missed.variants[0].svgRGBAError > 0)
  assert.deepEqual(svgPixelFailures([missed]), [missed])
})
test('a recorded exact result passes only while both pixel references and host recovery agree', () => {
  const exact = recorded.find(row => row.name === 'nested-viewport-0')
  assert.deepEqual(svgPixelFailures([exact]), [])
  for (const [index, field, value] of [[0, 'rgbaError', 1], [0, 'svgRGBAError', 1], [0, 'boundsError', .01], [2, 'fallbackError', 1], [1, 'error', 'draw failed']]) {
    const damaged = structuredClone(exact); damaged.variants[index][field] = value
    assert.deepEqual(svgPixelFailures([damaged]), [damaged], field)
  }
})
