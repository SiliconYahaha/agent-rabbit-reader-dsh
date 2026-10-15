'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createSvgScene}=require('../miniprogram/file-reader/image')
const {cases}=require('./helpers/svg-symbols')
const {failures,interop}=require('../scripts/verify-svg-symbols')
function context(){const state={depth:0,fills:0};return new Proxy({state,save(){state.depth++},restore(){state.depth--},fill(){state.fills++},fillRect(){state.fills++}},{get:(o,k)=>k in o?o[k]:()=>{}})}
for(const kind of ['symbol','svg']) {
  test(`${kind} use dimensions, transforms and nested percentages produce instance bounds`,()=>{
    for(const [name,expected] of [
      ['percent-units',{x:32,y:16,width:64,height:32}],['nested-percent',{x:64,y:32,width:32,height:16}],
      ['auto-target-size',{x:32,y:16,width:64,height:32}],['css-size-overrides',{x:32,y:16,width:64,height:32}],
      ['source-transform',{x:40,y:20,width:64,height:32}],['source-position',{x:40,y:20,width:64,height:32}],
      ['nested-use-percent',{x:64,y:32,width:32,height:16}]
    ]) {
      const source=cases.find(c=>c.name===`${kind}-${name}`).source,scene=createSvgScene(source),before=JSON.stringify(scene.doc.byId.part.node.attrs),ctx=context()
      for(let repeat=0;repeat<3;repeat++){scene.draw(ctx,256,256);assert.deepEqual(scene.renderer.getBounds(scene.doc.byId.instance),expected,name);assert.equal(ctx.state.depth,0)}
      assert.equal(JSON.stringify(scene.doc.byId.part.node.attrs),before,'Instances must not mutate source attributes')
    }
  })
}
test('symbol viewport animation recomputes bounds when seeking backwards and reopening',()=>{
  for(const name of ['use-width-animation-0','symbol-viewbox-animation-0','use-x-animation-0']) {
    const scene=createSvgScene(cases.find(c=>c.name===name).source),ctx=context()
    for(const time of [0,1.5,.5,1,0]) {
      scene.draw(ctx,256,256,time)
      const expected=name.startsWith('use-width')?{x:32,y:16,width:64+32*time,height:64}:name.startsWith('use-x')?{x:32+32*time,y:16,width:64,height:64}:{x:32,y:16,width:4096/(64+32*time),height:32}
      const actual=scene.renderer.getBounds(scene.doc.byId.instance,scene.timeline.sample(time))
      // Analytic rational and transformed corner subtraction differ by IEEE-754
      // rounding. Bound only arithmetic error; pixel gates remain exact.
      for(const key of Object.keys(expected))assert.ok(Math.abs(actual[key]-expected[key])<=8*Number.EPSILON*Math.max(1,Math.abs(expected[key])),key)
      assert.equal(ctx.state.depth,0)
    }
  }
})
test('circular references terminate while valid siblings remain, and nesting failures restore Canvas',()=>{
  const ctx=context(),source='<svg viewBox="0 0 256 256"><defs><symbol id="a"><use href="#a"/></symbol></defs><use href="#a"/><rect width="10" height="10"/></svg>'
  createSvgScene(source).draw(ctx,256,256);assert.equal(ctx.state.fills,1);assert.equal(ctx.state.depth,0)
  const definitions=Array.from({length:34},(_,i)=>`<symbol id="p${i}">${i===33?'<rect width="8" height="8"/>':`<use href="#p${i+1}"/>`}</symbol>`).join('')
  const deep=createSvgScene(`<svg><defs>${definitions}</defs><use href="#p0"/></svg>`)
  assert.throws(()=>deep.draw(ctx,256,256),/nesting/);assert.equal(ctx.state.depth,0)
  assert.doesNotThrow(()=>createSvgScene(source).draw(ctx,256,256));assert.equal(ctx.state.depth,0)
})
test('audited browser disagreements never hide product errors or missing evidence',()=>{
  const clean={results:cases.map(c=>({name:c.name,nativeReferenceError:0,variants:['native','fallback','factory-throws'].map(mode=>({mode,error:null,rgbaError:0,svgRGBAError:0,fallbackError:0,boundsError:0}))}))}
  assert.deepEqual(failures(clean),[])
  for(const key of ['rgbaError','fallbackError','error']){const r=structuredClone(clean);r.results.find(r=>interop[r.name]).variants[0][key]=key==='error'?'failed':1;assert.ok(failures(r).length,key)}
  for(const key of ['svgRGBAError','boundsError']){const r=structuredClone(clean);r.results[0].variants[0][key]=1;assert.ok(failures(r).length,key)}
  const missing=structuredClone(clean);missing.results.pop();assert.ok(failures(missing).length)
})

test('an ancestor use cycle never paints an extra translucent layer or reports its ancestor bounds',()=>{
  const scene=createSvgScene(cases.find(c=>c.name==='ancestor-cycle-translucent').source),ctx=context()
  scene.draw(ctx,256,256);assert.equal(ctx.state.fills,1);assert.equal(ctx.state.depth,0)
  assert.equal(scene.renderer.getBounds(scene.doc.byId.instance),null)
})
