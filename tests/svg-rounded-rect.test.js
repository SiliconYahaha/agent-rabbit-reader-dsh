'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const source = '<svg viewBox="0 0 100 100"><rect x="10" y="20" width="40" height="10" rx="200" ry="3"/></svg>'
function context (mode) {
  const ctx = { depth: 0, calls: [], path: [], painted: [],
    save () { this.depth++ }, restore () { this.depth-- }, beginPath () { this.path = [] },
    moveTo (...a) { this.path.push(['M', ...a]) }, lineTo (...a) { this.path.push(['L', ...a]) },
    bezierCurveTo (...a) { this.path.push(['C', ...a]) }, closePath () { this.path.push(['Z']) },
    isPointInPath (x, y) { return mode !== 'noop' && x === 4 && y === 3 },
    fill () { this.painted.push(this.path.slice()) },
    roundRect (...args) {
      this.calls.push(args)
      if (mode === 'noop') return
      if (mode === 'throws' && this.calls.length > 1) { this.path.push(['leaked']); throw Error('Unsupported host arguments') }
      this.path.push(['rounded', ...args])
    }
  }
  if (mode === 'missing') ctx.roundRect = undefined
  return new Proxy(ctx, { get: (o, key) => key in o ? o[key] : () => {} })
}
test('rounded paint uses independently clamped SVG radii and caches verified host support', () => {
  const scene = createSvgScene(source), ctx = context('native')
  for (let frame = 0; frame < 3; frame++) scene.draw(ctx, 100, 100, frame)
  assert.equal(ctx.calls.length, 4)
  for (const call of ctx.calls.slice(1)) assert.deepEqual(call, [10, 20, 40, 10, [{ x: 20, y: 3 }]])
  assert.equal(ctx.depth, 0)
  assert.ok(ctx.painted.every(p => p.length === 1 && p[0][0] === 'rounded'))
})
test('missing and no-op host primitives retain complete fallback paths without repeated probes', () => {
  for (const mode of ['missing', 'noop']) {
    const scene = createSvgScene(source), ctx = context(mode)
    for (let frame = 0; frame < 3; frame++) scene.draw(ctx, 100, 100, frame)
    assert.equal(ctx.calls.length, mode === 'missing' ? 0 : 1)
    assert.ok(ctx.painted.every(p => p.length === 10 && p.filter(s => s[0] === 'C').length === 4))
    assert.equal(ctx.depth, 0)
  }
})
test('partial primitive failure resets its path and disables only that context', () => {
  const scene = createSvgScene(source), failing = context('throws'), healthy = context('native')
  for (let frame = 0; frame < 3; frame++) scene.draw(failing, 100, 100, frame)
  assert.equal(failing.calls.length, 2)
  assert.ok(failing.painted.every(p => p.length === 10 && !p.some(s => s[0] === 'leaked')))
  scene.draw(healthy, 100, 100, 0)
  assert.equal(healthy.calls.length, 2); assert.equal(healthy.painted[0][0][0], 'rounded')
  assert.equal(failing.depth, 0); assert.equal(healthy.depth, 0)
})

test('rounded clip keeps clipping after restoring its matrix and recovers a partial primitive', () => {
  const svg = '<svg viewBox="0 0 100 100"><defs><clipPath id="c"><rect x="10" y="20" width="40" height="10" rx="8" ry="3"/></clipPath></defs><rect width="100" height="100" clip-path="url(#c)"/></svg>'
  for (const mode of ['native', 'throws', 'transform-throws', 'invalid-transform']) {
    const ctx = context(mode), clips = [], matrices = []
    ctx.getTransform = () => { if (mode === 'transform-throws') throw Error('Unavailable transform'); if (mode === 'invalid-transform') return null; return { a: 1, b: 0, c: 0, d: 1, e: 12, f: 34 } }
    ctx.setTransform = (...values) => matrices.push(values)
    ctx.clip = () => clips.push(ctx.path.slice())
    const scene = createSvgScene(svg); scene.draw(ctx, 100, 100, 0)
    assert.ok(clips.some(p => p.some(s => s[0] === (mode === 'native' ? 'rounded' : 'C'))))
    assert.ok(clips.every(p => !p.some(s => s[0] === 'leaked')))
    if (mode === 'native' || mode === 'throws') assert.ok(matrices.some(m => m.join(',') === '1,0,0,1,12,34'))
    assert.equal(ctx.depth, 0)
  }
})
