'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { resolveViewport, viewportTransform } = require('../miniprogram/file-reader/image/svg/svg-viewport')
const { createSvgScene } = require('../miniprogram/file-reader/image')
function context () { const calls = [], ctx = { calls, depth: 0, save () { this.depth++ }, restore () { this.depth-- } }; return new Proxy(ctx, { get: (o, k) => k in o ? o[k] : (...args) => calls.push([k, ...args]) }) }
test('all nine alignments use independent axes for none and the correct meet/slice offset', () => {
  const box = { x: 32, y: 16, width: 128, height: 64 }, vb = { x: 0, y: 0, width: 64, height: 64 }
  for (const [x, xf] of [['Min', 0], ['Mid', .5], ['Max', 1]]) for (const [y, yf] of [['Min', 0], ['Mid', .5], ['Max', 1]]) {
    assert.deepEqual(viewportTransform(box, vb, `x${x}Y${y} meet`).matrix, [1, 0, 0, 1, 32 + 64 * xf, 16])
    assert.deepEqual(viewportTransform(box, vb, `x${x}Y${y} slice`).matrix, [2, 0, 0, 2, 32, 16 - 64 * yf])
  }
  assert.deepEqual(viewportTransform(box, vb, 'none').matrix, [2, 0, 0, 1, 32, 16])
  assert.deepEqual(viewportTransform(box, vb, 'invalid').matrix, [1, 0, 0, 1, 64, 16])
})
test('zero viewBox disables painting; negative or malformed viewBox falls back to local units', () => {
  for (const viewBox of ['0 0 0 64', '0 0 64 0', '0 0 0 0']) assert.equal(resolveViewport({ width: 64, height: 64, viewBox }, { width: 100, height: 100 }).disabled, true)
  for (const viewBox of ['0 0 -1 64', 'garbage', '0 0 64']) assert.deepEqual(resolveViewport({ x: 4, y: 8, width: 64, height: 32, viewBox }, { width: 100, height: 100 }).matrix, [1, 0, 0, 1, 4, 8])
  const ctx = context(); createSvgScene('<svg width="200" height="200" viewBox="0 0 0 100"><rect width="100" height="100"/></svg>').draw(ctx, 200, 200)
  assert.equal(ctx.calls.filter(c => c[0] === 'fill' || c[0] === 'fillRect').length, 0); assert.equal(ctx.depth, 0)
})
test('nearest viewport percentages and viewport-dependent geometry caches preserve different use instances', () => {
  const scene = createSvgScene('<svg viewBox="0 0 256 256"><defs><g id="part"><rect width="50%" height="50%"/></g></defs><g id="all"><svg width="64" height="64" viewBox="0 0 64 64"><use href="#part"/></svg><svg x="128" width="128" height="128" viewBox="0 0 128 128"><use href="#part"/></svg></g><svg x="16" y="16" width="128" height="64" viewBox="0 0 64 32"><rect id="inside" width="50%" height="50%"/></svg></svg>')
  assert.deepEqual(scene.renderer.getBounds(scene.doc.byId.inside), { x: 0, y: 0, width: 32, height: 16 })
  for (let i = 0; i < 3; i++) assert.deepEqual(scene.renderer.getBounds(scene.doc.byId.all), { x: 0, y: 0, width: 192, height: 64 })
})
test('default nested dimensions fill the parent viewport and animations change both bounds and drawing', () => {
  assert.deepEqual(resolveViewport({ x: '25%', width: '50%', height: '25%' }, { width: 128, height: 64 }).box, { x: 32, y: 0, width: 64, height: 16 })
  const scene = createSvgScene('<svg viewBox="0 0 256 256"><g id="g"><svg x="32" y="32" width="64" height="64" viewBox="0 0 64 64" preserveAspectRatio="none"><rect width="64" height="64"/><animate attributeName="width" from="64" to="128" dur="2s" repeatCount="indefinite"/></svg></g></svg>')
  for (const [time, width] of [[0,64],[.5,80],[1,96],[0,64]]) {
    assert.equal(scene.renderer.getBounds(scene.doc.byId.g, scene.timeline.sample(time)).width, width)
    const ctx = context(); scene.draw(ctx,256,256,time); assert.ok(ctx.calls.some(c => c[0] === 'transform' && c[1] === width/64 && c[5] === 32)); assert.equal(ctx.depth,0)
  }
})
test('overflow clipping uses viewport coordinates and visible overflow remains visible', () => {
  for (const [overflow, clips] of [['hidden',1],['visible',0],['scroll',1],['auto',0]]) {
    const ctx = context(); createSvgScene(`<svg viewBox="0 0 256 256"><svg x="32" y="16" width="128" height="64" viewBox="0 0 64 64" overflow="${overflow}"><rect width="100" height="100"/></svg></svg>`).draw(ctx,256,256)
    assert.equal(ctx.calls.filter(c=>c[0]==='clip').length, clips)
    if (clips) assert.ok(ctx.calls.some(c=>JSON.stringify(c)===JSON.stringify(['rect',32,16,128,64])))
    assert.equal(ctx.depth,0)
  }
})
test('nonfinite viewport transforms reject before painting and preserve the next frame state', () => {
  assert.throws(()=>viewportTransform({x:0,y:0,width:1e308,height:1e308},{x:0,y:0,width:1e-308,height:1e-308},'none'),/finite coordinates/)
  const ctx=context(),scene=createSvgScene('<svg viewBox="0 0 256 256"><svg width="1e308" height="1e308" viewBox="0 0 1e-308 1e-308"><rect width="1" height="1"/></svg></svg>')
  assert.throws(()=>scene.draw(ctx,256,256),/finite coordinates/); assert.equal(ctx.depth,0)
  assert.doesNotThrow(()=>createSvgScene('<svg><rect width="10" height="10"/></svg>').draw(ctx,256,256));assert.equal(ctx.depth,0)
})
test('three published zero-viewBox originals and blank reference retain pinned source hashes',()=>{
  const root=path.join(__dirname,'fixtures/svg-viewports')
  for(const r of require('./fixtures/svg-viewports/sources.json'))for(const [name,hash] of [[r.name,r.sha256],[r.reference,r.referenceSha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash)
  assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/3-Clause BSD/)
})
test('public overflow HTML originals and disputed official references retain their pinned bytes', () => {
  const root = path.join(__dirname, 'fixtures/svg-overflow')
  for (const row of require('./fixtures/svg-overflow/sources.json')) {
    for (const [name, hash] of [[row.name, row.sha256], [row.reference, row.referenceSha256]]) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), hash)
    assert.ok(row.expectedVisibleResult)
  }
  assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /3-Clause BSD/)
})
