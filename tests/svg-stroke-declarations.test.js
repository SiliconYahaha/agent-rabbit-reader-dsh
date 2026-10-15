'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { parseStyleSheet, splitDeclarations, parseLength } = require('../miniprogram/file-reader/image/svg/svg-style')
const { cases } = require('./helpers/svg-stroke-declarations')

function paintedDashes (source) {
  const result = [], stack = []
  let dash = []
  const ctx = new Proxy({}, { get (_, key) {
    if (key === 'getTransform') return undefined
    if (key === 'save') return () => stack.push(dash)
    if (key === 'restore') return () => { dash = stack.pop() }
    if (key === 'setLineDash') return values => { dash = values.map(n => n === 0 ? 0 : n) }
    if (key === 'stroke') return () => result.push(dash)
    return () => {}
  } })
  createSvgScene(source, { nativePaths: false }).draw(ctx, 256, 256, 0)
  return result
}

test('literal dash declarations preserve native-reference paint across invalid overrides and valid CSS tokens', () => {
  for (const fixture of cases) {
    const expected = paintedDashes(fixture.referenceSource)
    assert.ok(expected.length > 0, fixture.name)
    assert.deepEqual(paintedDashes(fixture.source), expected, fixture.name)
  }
})

test('invalid repeated keyframe declarations retain the earlier valid value; unrelated declarations survive', () => {
  const sheet = parseStyleSheet('@keyframes dash { from { stroke-dasharray: 18 9; stroke-dasharray: 4 -2; opacity: .5 } to { stroke-dasharray: +12+6 } }')
  assert.deepEqual(sheet.keyframes.dash.map(frame => frame.declarations), [
    { 'stroke-dasharray': '18 9', opacity: '.5' }, { 'stroke-dasharray': '+12+6' }
  ])
  // Function evaluation is a separate existing gap, not an invalid literal.
  assert.equal(splitDeclarations('stroke-dasharray:18 9;stroke-dasharray:calc(12px + 6px)')['stroke-dasharray'], 'calc(12px + 6px)')
})

test('positive length signs work for shared length parsing without changing negative and percentage values', () => {
  assert.equal(parseLength('+12'), 12)
  assert.equal(parseLength('+1.2e1px'), 12)
  assert.equal(parseLength('+25%', 200), 50)
  assert.equal(parseLength('-.5em', 0, 32), -16)
  assert.ok(Number.isNaN(parseLength('++12')))
})
