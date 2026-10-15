'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const source = '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="40" rx="30" ry="12" fill="red" stroke="blue"/></svg>'
function context (mode) {
  const ctx = { depth: 0, calls: [], path: [], painted: [], dashes: [],
    setLineDash (values) { this.dashes.push(values) },
    save () { this.depth++ }, restore () { this.depth-- }, beginPath () { this.path=[] },
    moveTo (...a) { this.path.push(['M',...a]) }, lineTo (...a) { this.path.push(['L',...a]) },
    bezierCurveTo (...a) { this.path.push(['C',...a]) }, closePath () { this.path.push(['Z']) },
    getTransform () { return mode === 'invalid-transform' ? null : {a:1,b:0,c:0,d:1,e:0,f:0} },
    setTransform () {}, isPointInPath (x,y) { return mode !== 'noop' && x===0 && y===0 },
    fill () { this.painted.push(this.path.slice()) }, stroke () { this.painted.push(this.path.slice()) },
    ellipse (...a) {
      this.calls.push(a)
      if (mode === 'noop') return
      if (mode === 'throws' && this.calls.length>1) { this.path.push(['leaked']); throw Error('Unsupported ellipse') }
      this.path.push(['ellipse',...a])
    }
  }
  if (mode === 'missing') ctx.ellipse=undefined
  return new Proxy(ctx,{get:(o,key)=>key in o?o[key]:()=>{}})
}
test('fill and stroke share verified native ellipse geometry without changing its radii',()=>{
  const scene=createSvgScene(source),ctx=context('native')
  for(let i=0;i<3;i++)scene.draw(ctx,100,100,i)
  assert.equal(ctx.calls.length,7)
  for(const call of ctx.calls.slice(1)) assert.deepEqual(call,[50,40,30,12,0,0,Math.PI*2])
  assert.ok(ctx.painted.every(p=>p.length===2&&p[0][0]==='ellipse'&&p[1][0]==='Z'))
  assert.equal(ctx.depth,0)
})
test('missing/no-op/invalid-transform hosts keep the complete cubic fallback and bounded probes',()=>{
  for(const mode of ['missing','noop','invalid-transform']) {
    const scene=createSvgScene(source),ctx=context(mode)
    for(let i=0;i<3;i++)scene.draw(ctx,100,100,i)
    assert.equal(ctx.calls.length,mode==='noop'?1:0)
    assert.ok(ctx.painted.every(p=>p.length===6&&p.filter(s=>s[0]==='C').length===4))
    assert.equal(ctx.depth,0)
  }
})
test('partially written native paths are discarded, and failure stays local to the context',()=>{
  const scene=createSvgScene(source),bad=context('throws'),good=context('native')
  for(let i=0;i<3;i++)scene.draw(bad,100,100,i)
  assert.equal(bad.calls.length,2)
  assert.ok(bad.painted.every(p=>p.length===6&&!p.some(s=>s[0]==='leaked')))
  scene.draw(good,100,100,0)
  assert.equal(good.calls.length,3);assert.equal(good.painted[0][0][0],'ellipse')
  assert.equal(bad.depth,0);assert.equal(good.depth,0)
})
test('animated radii rewind without stale geometry; zero radii remain unpainted',()=>{
  const scene=createSvgScene('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10"><animate attributeName="r" from="10" to="30" dur="2s" repeatCount="indefinite"/></circle></svg>'),ctx=context('native')
  for(const t of [0,1.5,.5,0])scene.draw(ctx,100,100,t)
  assert.deepEqual(ctx.calls.slice(1).map(c=>c[2]),[10,25,15,10])
  const empty=context('native');createSvgScene('<svg><ellipse rx="0" ry="10"/></svg>').draw(empty,100,100,0)
  assert.equal(empty.painted.length,0)
})

test('calibrated strokes follow the path that actually painted, including partial native failure',()=>{
  const scene=createSvgScene('<svg><circle cx="128" cy="128" r="80" pathLength="100" fill="none" stroke="black" stroke-dasharray="10 5"/></svg>')
  for(const mode of ['native','missing','noop','throws']) {
    const ctx=context(mode);scene.draw(ctx,256,256,0)
    // Browser native getTotalLength is501.8427734375; analytical fallback is160*pi.
    // The1e-4 bound here is float32 measurement precision, never a pixel pass tolerance.
    const expected=mode==='native'?501.8427734375:160*Math.PI
    assert.ok(Math.abs(ctx.dashes[0][0]*10-expected)<1e-4,mode)
    assert.equal(ctx.depth,0)
  }
})
