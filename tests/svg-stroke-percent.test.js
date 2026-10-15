'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { cases } = require('./helpers/svg-stroke-percent')

function strokes (scene, time = 0) {
  const result = [], stack = []
  let state = { lineWidth: 1, lineDashOffset: 0, dash: [], globalAlpha: 1 }
  const ctx = new Proxy({}, {
    get (_, key) {
      if (key in state) return state[key]
      if (key === 'getTransform') return undefined
      if (key === 'save') return () => stack.push({ ...state })
      if (key === 'restore') return () => { state = stack.pop() }
      if (key === 'setLineDash') return value => { state.dash = value }
      if (key === 'stroke' || key === 'strokeRect') return () => result.push([state.lineWidth, state.lineDashOffset, ...state.dash])
      return () => {}
    },
    set (_, key, value) { state[key] = value; return true }
  })
  scene.draw(ctx, 256, 256, time)
  return result
}

test('SVG percentage strokes match numeric lengths across viewports, style sources and animation frames', () => {
  for (const fixture of cases) {
    const actual = strokes(createSvgScene(fixture.source, { nativePaths: false }), fixture.time || 0)
    const expected = strokes(createSvgScene(fixture.referenceSource, { nativePaths: false }))
    assert.ok(expected.length > 0, fixture.name)
    assert.equal(actual.length, expected.length, fixture.name)
    for (const [i, row] of actual.entries()) {
      assert.equal(row.length, expected[i].length)
      row.forEach((value, c) => assert.ok(Math.abs(value - expected[i][c]) < 1e-10, `${fixture.name}: ${value} != ${expected[i][c]}`))
    }
  }
})

test('leaving a nested viewport restores the outer stroke reference', () => {
  const line = '<path d="M10 20H70"/>'
  const source = '<svg viewBox="0 0 320 160"><g fill="none" stroke="black" stroke-width="10%" stroke-dasharray="2% 3%" stroke-dashoffset="-4%">' + line + '<svg width="100" height="100" viewBox="0 0 100 100">' + line + '</svg>' + line + '</g></svg>'
  const values = strokes(createSvgScene(source))
  assert.equal(values.length, 3)
  assert.deepEqual(values[0], values[2])
  assert.deepEqual(values[1], [10, -4, 2, 3])
  assert.ok(Math.abs(values[0][0] - Math.sqrt(64000) / 10) < 1e-10)
})

test('animated percentage width rewinds on the same scene without stale stroke state', () => {
  const fixture = cases.find(c => c.name === 'animated-stroke-width-0')
  const scene = createSvgScene(fixture.source)
  for (const time of [0, 1.5, .5, 0]) {
    const expected = (.02 + .02 * time) * Math.sqrt(64000)
    for (const row of strokes(scene, time)) assert.ok(Math.abs(row[0] - expected) < 1e-10)
  }
})
