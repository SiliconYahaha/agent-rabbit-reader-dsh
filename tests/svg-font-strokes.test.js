'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { parseSvgDocument } = require('../miniprogram/file-reader/image/svg/svg-document')
const { cases } = require('./helpers/svg-font-strokes')
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
      if (key === 'measureText') return text => ({ width: text.length * 20 })
      if (key === 'stroke' || key === 'strokeText') return (...args) => result.push([state.lineWidth, state.lineDashOffset, state.dash, ...(key === 'strokeText' ? [state.font, ...args] : [])])
      return () => {}
    },
    set (_, key, value) { state[key] = value; return true }
  })
  scene.draw(ctx, 256, 256, time)
  return result
}

test('font-relative stroke parameters equal numeric references through inheritance, use instances and animation', () => {
  for (const fixture of cases) {
    const expected = strokes(createSvgScene(fixture.referenceSource))
    assert.ok(expected.length, fixture.name)
    assert.deepEqual(strokes(createSvgScene(fixture.source), fixture.time || 0), expected, fixture.name)
  }
})

test('font inheritance resolves at the declaring element and keeps percentage strokes unresolved', () => {
  const doc = parseSvgDocument('<svg font-size="32"><g stroke-width=".25em" stroke-dasharray="1em 10%"><path id="p" font-size="50%"/></g></svg>')
  assert.equal(doc.byId.p.style['font-size'], '16')
  assert.equal(doc.byId.p.style['stroke-width'], '8')
  assert.equal(doc.byId.p.style['stroke-dasharray'], '32 10%')
})

test('animated font and root rem lengths recompute when seeking backward on one scene', () => {
  for (const name of ['animated-font-', 'animated-root-rem-', 'animated-percent-font-']) {
    const scene = createSvgScene(cases.find(c => c.name === name + '0').source)
    for (const time of [0, 1.5, .5, 0]) {
      const reference = cases.find(c => c.name === name + time).referenceSource
      assert.deepEqual(strokes(scene, time), strokes(createSvgScene(reference)), name + time)
    }
  }
})
