'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const test = require('node:test')
const componentPath = path.resolve(__dirname, '../miniprogram/file-reader/image/components/svg-view/svg-view.js')
const sample = '<svg viewBox="0 0 20 20"><rect width="5" height="5"><animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite"/></rect></svg>'
function player (loadClipUnion) {
  let definition
  const ticks = [], timers = new Map(), frames = new Map(), queries = [], calls = []
  let serial = 0
  const context = new Proxy({}, { get: (o, key) => o[key] || ((...args) => { calls.push([key, ...args]) }), set: (o, key, value) => { o[key] = value; return true } })
  const canvas = { getContext: () => context, requestAnimationFrame: callback => { frames.set(++serial, callback); return serial }, cancelAnimationFrame: id => frames.delete(id) }
  vm.runInNewContext(fs.readFileSync(componentPath, 'utf8'), {
    require: id => id.endsWith('svg-clip-runtime') && loadClipUnion ? { loadClipUnion } : createRequire(componentPath)(id), Component: value => { definition = value },
    setTimeout: callback => { timers.set(++serial, callback); return serial }, clearTimeout: id => timers.delete(id),
    wx: { nextTick: callback => ticks.push(callback), getWindowInfo: () => ({ pixelRatio: 1 }) }, Map, Date, Array
  })
  const instance = { ...definition.methods, data: { source: sample, playing: true, ...definition.data }, events: [],
    setData (patch) { Object.assign(this.data, patch) }, triggerEvent (name, detail) { this.events.push({ name, detail }) },
    createSelectorQuery () { const q = { select: () => q, boundingClientRect: () => q, fields: () => q, exec: callback => queries.push(callback) }; return q }
  }
  const mount = (width = 100) => queries.shift()([{ width }, { node: canvas, width }])
  const frame = timestamp => { const [id, callback] = [...frames][0]; frames.delete(id); callback(timestamp) }
  return { definition, instance, ticks, timers, frames, queries, calls, canvas, context, mount, frame }
}

test('initial property observer waits for a ready Canvas instead of triggering static fallback', () => {
  const p = player(), v = p.instance
  p.definition.observers.source.call(v, sample)
  p.definition.lifetimes.attached.call(v)
  assert.equal(p.queries.length, 0)
  assert.equal(v.events.length, 0)
  p.definition.lifetimes.ready.call(v); p.mount()
  assert.equal(v.data.ready, true); assert.equal(v._playing, true); assert.equal(p.frames.size, 1)
  p.frame(100); const first = p.calls.length; p.frame(400)
  assert.ok(p.calls.length > first); assert.equal(v._pausedAt, 300)
})

test('new source restarts after user pause; explicit playing=false remains paused', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v); p.mount()
  v.onTap(); assert.equal(p.frames.size, 0); assert.equal(v.data.paused, true)
  v.data.source = sample.replace('to="10"', 'to="15"'); p.definition.observers.source.call(v, v.data.source); p.mount()
  assert.equal(v.data.paused, false); assert.equal(v._playing, true); assert.equal(p.frames.size, 1)
  v.data.playing = false; v.load(sample); p.mount()
  assert.equal(v.data.paused, true); assert.equal(p.frames.size, 0)
})

test('old query and frame callbacks cannot mount or restart a replaced/detached SVG', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v)
  const oldQuery = p.queries.shift(); v.load(sample.replace('to="10"', 'to="8"'))
  oldQuery([{ width: 999 }, { node: p.canvas }]); assert.equal(v.data.ready, false)
  p.mount(); const oldFrame = [...p.frames.values()][0]
  p.definition.pageLifetimes.hide.call(v); p.definition.pageLifetimes.show.call(v)
  oldFrame(200); assert.equal(p.frames.size, 1)
  p.definition.lifetimes.detached.call(v); oldFrame(400)
  assert.equal(p.frames.size, 0); assert.equal(v._canvas, null)
})

test('missing Canvas retries are bounded and detach cancels pending retries', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v)
  for (let i = 0; i < 3; i++) {
    p.queries.shift()([])
    if (i < 2) { const [id, callback] = [...p.timers][0]; p.timers.delete(id); callback() }
  }
  assert.equal(v.events.filter(e => e.name === 'error').length, 1); assert.equal(p.timers.size, 0)
  v.load(sample); p.queries.shift()([]); assert.equal(p.timers.size, 1)
  p.definition.lifetimes.detached.call(v); assert.equal(p.timers.size, 0)
})

test('draw failures never emit ready or keep scheduling invisible animation frames', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v)
  v._scene.draw = () => { throw Error('lost Canvas') }; p.mount()
  assert.equal(v.events.some(e => e.name === 'ready'), false); assert.equal(p.frames.size, 0)
  assert.equal(v.events.filter(e => e.name === 'error').length, 1)
})


test('async subpackage attach starts via nextTick when ready is not delivered, and never after detach', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v)
  assert.equal(p.queries.length, 0)
  p.ticks.shift()(); p.mount()
  assert.equal(v.data.ready, true); assert.equal(p.frames.size, 1)
  p.definition.lifetimes.ready.call(v)
  assert.equal(p.queries.length, 0, 'ready must not start another mount')
  const q = player()
  q.definition.lifetimes.attached.call(q.instance)
  q.definition.lifetimes.detached.call(q.instance)
  q.ticks.shift()()
  assert.equal(q.queries.length, 0)
})

test('20 dimension and timing variants survive repeated pause/source replacement with one active frame', () => {
  const p = player(), v = p.instance
  p.definition.lifetimes.attached.call(v); p.ticks.shift()(); p.mount()
  for (let i = 1; i <= 20; i++) {
    p.frame(100); p.frame(350)
    v.onTap()
    v.load(sample.replace('0 0 20 20', `0 0 ${20 + i} ${21 + i}`).replace('dur="1s"', `dur="${i / 10}s"`))
    p.mount()
    assert.equal(v._pausedAt, 0)
    assert.equal(v._playing, true)
    assert.equal(p.frames.size, 1)
  }
  p.definition.lifetimes.detached.call(v)
  assert.equal(p.frames.size, 0)
})


test('union kernel preparation cannot mount stale files or report stale errors after detach', async () => {
  let resolve
  const pending = new Promise(yes => { resolve = yes })
  const p = player(() => pending), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v); p.mount()
  const union = '<svg><clipPath id="c"><rect width="5" height="5"/><rect width="10" height="10"/></clipPath><rect width="20" height="20" clip-path="url(#c)"/></svg>'
  v.load(union); assert.equal(p.queries.length, 0); assert.equal(v.data.ready, false)
  v.load(sample); p.mount(); resolve(() => ({ d: '', segments: [], rule: 'nonzero' })); await pending; await Promise.resolve()
  assert.equal(p.queries.length, 0); assert.equal(v.data.ready, true)
  let rejectSecond
  const q = player(() => new Promise((_, no) => { rejectSecond = no }))
  q.definition.lifetimes.attached.call(q.instance); q.definition.lifetimes.ready.call(q.instance); q.mount(); q.instance.load(union)
  q.definition.lifetimes.detached.call(q.instance); rejectSecond(Error('late kernel failure')); await Promise.resolve(); await Promise.resolve()
  assert.equal(q.instance.events.filter(e => e.name === 'error').length, 0)
})


test('kernel completion while a page is hidden waits until show before scheduling animation', async () => {
  let complete
  const pending = new Promise(resolve => { complete = resolve })
  const p = player(() => pending), v = p.instance
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v); p.mount()
  v.load('<svg><clipPath id="c"><rect width="2" height="2"/><rect width="4" height="4"/></clipPath><rect width="10" height="10" clip-path="url(#c)"/><animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>')
  p.definition.pageLifetimes.hide.call(v)
  complete(() => ({ d: '', segments: [], rule: 'nonzero' })); await pending; await Promise.resolve(); p.mount()
  assert.equal(p.frames.size, 0); assert.equal(v.data.ready, true)
  p.definition.pageLifetimes.show.call(v); assert.equal(p.frames.size, 1)
  p.definition.pageLifetimes.show.call(v); assert.equal(p.frames.size, 1)
})

test('player fits the source intrinsic viewport rather than forcing its viewBox aspect ratio', () => {
  const p=player(),v=p.instance
  p.definition.lifetimes.attached.call(v);p.definition.lifetimes.ready.call(v);p.mount()
  v.load('<svg width="400" height="100" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>');p.mount()
  assert.equal(v._width,100);assert.equal(v._height,25);assert.equal(p.canvas.height,25)
})

test('canvas allocations reject extreme intrinsic dimensions and nonfinite DPR before assignment, then recover', () => {
  for(const source of ['<svg width="1" height="1e308"/>','<svg width="1" height="100000"/>']){
    const p=player(),v=p.instance;v.data.source=source;p.definition.lifetimes.attached.call(v);p.definition.lifetimes.ready.call(v);p.mount()
    assert.equal(p.canvas.width,undefined);assert.equal(p.canvas.height,undefined);assert.match(v.events.at(-1).detail.message,/画布尺寸/);assert.equal(p.frames.size,0)
    v.load(sample);p.mount();assert.equal(v.data.ready,true);assert.equal(p.canvas.width,100)
  }
  const p=player(),v=p.instance;v.devicePixelRatio=()=>Infinity;p.definition.lifetimes.attached.call(v);p.definition.lifetimes.ready.call(v);p.mount();assert.equal(p.canvas.width,undefined);assert.match(v.events.at(-1).detail.message,/画布尺寸/)
})


test('canvas pixel and dimension ceilings accept their boundary and reject the next allocation', () => {
  for (const [width,height,accepted] of [[4096,4096,true],[4096,4097,false],[16384,1,true],[16385,1,false]]) {
    const p=player(),v=p.instance;v.data.source=`<svg width="${width}" height="${height}"/>`;p.definition.lifetimes.attached.call(v);p.definition.lifetimes.ready.call(v);p.mount(width)
    assert.equal(v.data.ready,accepted)
    if(accepted)assert.equal(p.canvas.width,width);else assert.equal(p.canvas.width,undefined)
  }
})

test('rounded SVG host failure falls back across animation frames and later file loads', () => {
  const p = player(), v = p.instance
  let roundCalls = 0
  p.context.isPointInPath = (x, y) => x === 4 && y === 3
  p.context.roundRect = () => { roundCalls++; if (roundCalls > 1) { p.calls.push(['partial-path']); throw Error('roundRect unavailable') } }
  v.data.source = '<svg viewBox="0 0 20 20"><rect width="15" height="10" rx="3"><animate attributeName="rx" values="3;5;3" dur="1s" repeatCount="indefinite"/></rect></svg>'
  p.definition.lifetimes.attached.call(v); p.definition.lifetimes.ready.call(v); p.mount()
  p.frame(100); p.frame(400)
  assert.equal(roundCalls, 2); assert.equal(v.data.ready, true)
  assert.equal(v.events.filter(e => e.name === 'error').length, 0)
  assert.ok(p.calls.some(c => c[0] === 'bezierCurveTo'))
  v.load(sample); p.mount(); p.frame(100); p.frame(400)
  assert.equal(v.events.filter(e => e.name === 'error').length, 0)
  p.definition.lifetimes.detached.call(v); assert.equal(p.frames.size, 0)
})
