'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { parsePath } = require('../miniprogram/file-reader/image/svg/svg-path')
const { pathLength } = require('../miniprogram/file-reader/image/svg/svg-path-length')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { cases } = require('./helpers/svg-path-length')
function strokes (source, times = [0]) {
  const scene = createSvgScene(source, { nativePaths: false }), rows = [], stack = []
  let state = { lineWidth: 1, lineDashOffset: 0, dash: [] }
  const ctx = new Proxy({}, {
    get (_, key) {
      if (key in state) return state[key]
      if (key === 'getTransform') return undefined
      if (key === 'save') return () => stack.push({ ...state })
      if (key === 'restore') return () => { state = stack.pop() }
      if (key === 'setLineDash') return dash => { assert.ok(dash.every(Number.isFinite)); state.dash = dash }
      if (key === 'stroke' || key === 'strokeRect') return () => rows.push([state.lineWidth, state.lineDashOffset, ...state.dash])
      return () => {}
    }, set (_, key, value) { state[key] = value; return true }
  })
  for (const time of times) scene.draw(ctx, 256, 256, time)
  return rows
}
const svg = body => '<svg width="256" height="256"><g fill="none" stroke="black" stroke-width="4">'+body+'</g></svg>'
test('curve lengths match independent quadrature and analytic cusp/arc/close controls', () => {
  for (const fixture of require('./fixtures/svg-path-length.json').cases) {
    const actual = pathLength(parsePath(fixture.path, true))
    assert.ok(Math.abs(actual-fixture.length) <= 1e-7*Math.max(1,fixture.length), `${fixture.name}: ${actual} != ${fixture.length}`)
    const row = strokes(svg(`<path d="${fixture.path}" pathLength="100" stroke-dasharray="10 5" stroke-dashoffset="3"/>`))[0]
    assert.ok(Math.abs(row[2]-fixture.length/10) <= 1e-8*Math.max(1,fixture.length), fixture.name+' actual stroke')
  }
})
test('pathLength calibrates dash and offset but never stroke width or parent/use inheritance', () => {
  for (const name of ['line-100','path-100','use-instance','inherited-paint','transform','nested']) assert.deepEqual(strokes(cases.find(c=>c.name===name).source),[[4,6,20,10]],name)
  assert.deepEqual(strokes(svg('<g pathLength="100"><path d="M20 128H220" stroke-dasharray="10 5" stroke-dashoffset="3"/></g>')),[[4,3,10,5]])
  assert.deepEqual(strokes(cases.find(c=>c.name==='units-percent').source),[[4,5.12,25.6,10.24]])
  assert.deepEqual(strokes(cases.find(c=>c.name==='closed-100').source),[[4,19.200000000000003,64,32]])
  assert.deepEqual(strokes(cases.find(c=>c.name==='subpaths-100').source),[[4,12,40,20]])
})
test('same-scene seeks recompute animated author lengths and geometry, then rewind cleanly', () => {
  const times=[0,1.5,.5,0]
  for (const [prefix,scale] of [['animated-length-',t=>200/(100+100*t)],['animated-geometry-',t=>(100+50*t)/100]]) {
    const rows=strokes(cases.find(c=>c.name===prefix+'0').source,times)
    rows.forEach((row,i)=>assert.deepEqual(row,[4,3*scale(times[i]),10*scale(times[i]),5*scale(times[i])]))
  }
})
test('zero lengths reset prior dashes; malformed and unsupported numeric inputs remain bounded', () => {
  for(const length of ['0','1e-999','1e-320']) assert.deepEqual(strokes(svg(`<path d="M20 128H220" pathLength="${length}" stroke-dasharray="10 5"/>`)),[[4,0]])
  for(const length of ['-1','bad','100px','1e999']) assert.deepEqual(strokes(svg(`<path d="M20 128H220" pathLength="${length}" stroke-dasharray="10 5"/>`)),[[4,0,10,5]])
  assert.deepEqual(strokes(svg('<path d="M20 64H220" pathLength="100" stroke-dasharray="10 5"/><path d="M20 128H220" pathLength="0" stroke-dasharray="10 5"/><path d="M20 192H220" stroke-dasharray="10 5"/>')),[[4,0,20,10],[4,0],[4,0,10,5]])
})

test('pathLength measurement work is bounded and a later valid scene remains drawable', () => {
  const source = svg('<path pathLength="100" stroke-dasharray="10 5" d="'+('M30 128C230 128 -30 128 210 128 '.repeat(6000))+'"/>')
  assert.throws(()=>strokes(source), /pathLength measurement exceeds work limit/)
  assert.deepEqual(strokes(cases.find(c=>c.name==='path-100').source),[[4,6,20,10]])
})
