'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {createCanvasPresenter}=require('../miniprogram/file-reader/document/canvas-presenter')
function setup(fallback=false){
  const calls=[],context={fillRect(){},save(){},restore(){},setLineDash(){},reset(){calls.push('reset')}}
  let width=16,height=12
  const canvas={get width(){return width},set width(v){calls.push(['width',v]);width=v},get height(){return height},set height(v){calls.push(['height',v]);height=v},getContext:()=>context}
  if(fallback)delete context.reset
  const r=createRuntime('<canvas id="c" width="16" height="12"></canvas>',{createOffscreenCanvas:()=>canvas});r.run()
  const c=r.document.getElementById('c'),ctx=c.getContext('2d')
  return{r,c,ctx,canvas,context,calls}
}
test('context reset calls native reset and appends a visible reset without changing dimensions',()=>{
  const x=setup();try{x.ctx.fillStyle='red';x.ctx.fillRect(0,0,16,12);const rev=x.c._canvasState.rev;assert.equal(x.ctx.reset(),undefined);assert.deepEqual(x.calls,['reset']);assert.equal(x.ctx.canvas,x.c);assert.equal(x.c.width,16);assert.equal(x.c.height,12);assert.equal(x.ctx.fillStyle,'#000000');assert.ok(x.c._canvasState.rev>rev);assert.deepEqual(x.c._canvasState.ops.at(-1),{name:'resetCanvas',args:[16,12]})}finally{x.r.destroy()}
})
test('context reset clears all mirrored styles and saved state rather than allowing restore to resurrect them',()=>{
  const x=setup();try{const defaults={filter:'none',fontKerning:'auto',fontStretch:'normal',fontVariantCaps:'normal',imageSmoothingQuality:'low',letterSpacing:'0px',wordSpacing:'0px',textRendering:'auto',globalAlpha:1,fillStyle:'#000000'};for(const key of Object.keys(defaults))x.ctx[key]=key==='globalAlpha'?.4:'changed';x.ctx.save();x.ctx.reset();x.ctx.restore();for(const [k,v]of Object.entries(defaults))assert.equal(x.ctx[k],v,k)}finally{x.r.destroy()}
})
test('missing native reset uses the real backing width assignment and invalidates state',()=>{
  const x=setup(true);try{x.ctx.globalAlpha=.2;x.ctx.reset();assert.deepEqual(x.calls,[['width',16]]);assert.equal(x.ctx.globalAlpha,1);assert.equal(x.canvas.height,12)}finally{x.r.destroy()}
})
test('a rejected native reset leaves logical state and replay history unchanged',()=>{
  const x=setup();try{x.ctx.fillStyle='red';const before=x.c._canvasState.rev;x.context.reset=()=>{throw Error('reset refused')};assert.throws(()=>x.ctx.reset(),/reset refused/);assert.equal(x.ctx.fillStyle,'red');assert.equal(x.c._canvasState.rev,before)}finally{x.r.destroy()}
})
test('full replay resize never creates a transient surface exceeding the final pixel budget',async()=>{
  let width=1,height=16384;const attempted=[]
  const canvas={get width(){return width},set width(v){attempted.push(v*height);assert.ok(v*height<=16384,'unsafe transient width allocation');width=v},get height(){return height},set height(v){attempted.push(width*v);assert.ok(width*v<=16384,'unsafe transient height allocation');height=v},getContext:()=>({})}
  const p=createCanvasPresenter({resolveCanvas:async()=>canvas});try{const result=await p.present([{nid:1,canvas:{width:16384,height:1,rev:1,ops:[]}}]);assert.equal(result[0].status,'painted',result[0].message);assert.ok(attempted.length>0);assert.equal(width,16384);assert.equal(height,1)}finally{p.dispose()}
})
test('closed documents cannot reset or revive their real backing',()=>{
  const x=setup();x.r.destroy();const before=x.calls.length;assert.throws(()=>x.ctx.reset(),/已关闭/);assert.equal(x.calls.length,before)
})
test('zero-sized backing can reset without changing its dimensions',()=>{
  const x=setup();try{x.c.width=0;x.c.height=0;x.calls.length=0;assert.equal(x.ctx.reset(),undefined);assert.deepEqual(x.calls,['reset']);assert.equal(x.c.width,0);assert.equal(x.c.height,0)}finally{x.r.destroy()}
})
test('repeated context reset does not reserve additional backing allocations',()=>{
  let allocations=0;const r=createRuntime('<canvas id="c" width="4096" height="4096"></canvas>',{createOffscreenCanvas:()=>{allocations++;return{width:4096,height:4096,getContext:()=>({reset(){}})}}});
  try{r.run();const c=r.document.getElementById('c'),ctx=c.getContext('2d');for(let i=0;i<200;i++)ctx.reset();assert.equal(allocations,1);assert.equal(c._canvasState.ops.length,200)}finally{r.destroy()}
})
test('failed width fallback does not append reset or clear mirrored style; retry can recover',()=>{
  const x=setup(true);try{x.ctx.fillStyle='red';const before=x.c._canvasState.rev,descriptor=Object.getOwnPropertyDescriptor(x.canvas,'width');Object.defineProperty(x.canvas,'width',{configurable:true,get:()=>16,set(){throw Error('width refused')}});assert.throws(()=>x.ctx.reset(),/width refused/);assert.equal(x.c._canvasState.rev,before);assert.equal(x.ctx.fillStyle,'red');Object.defineProperty(x.canvas,'width',descriptor);x.ctx.reset();assert.equal(x.ctx.fillStyle,'#000000')}finally{x.r.destroy()}
})
test('reset also clears mirrored state on view-only hosts without falsely promising readback',()=>{
  const r=createRuntime('<canvas id="c"></canvas>');try{r.run();const c=r.document.getElementById('c'),ctx=c.getContext('2d');ctx.fillStyle='red';ctx.save();ctx.reset();ctx.restore();assert.equal(ctx.fillStyle,'#000000');assert.equal(ctx.direction,'inherit');assert.ok(c._canvasState.ops.some(op=>op.name==='resetCanvas'));assert.throws(()=>ctx.getImageData(0,0,1,1),/真实 Canvas 像素/)}finally{r.destroy()}
})
test('reset commands inside one replay are also safe when aspect ratio crosses',async()=>{
  let width=1,height=1,peak=0
  const canvas={get width(){return width},set width(v){peak=Math.max(peak,v*height);assert.ok(v*height<=16384);width=v},get height(){return height},set height(v){peak=Math.max(peak,width*v);assert.ok(width*v<=16384);height=v},getContext:()=>({})}
  const p=createCanvasPresenter({resolveCanvas:async()=>canvas});try{const result=await p.present([{nid:1,canvas:{width:16384,height:1,rev:1,ops:[{name:'resetCanvas',args:[1,16384]},{name:'resetCanvas',args:[16384,1]}]}}]);assert.equal(result[0].status,'painted');assert.equal(peak,16384)}finally{p.dispose()}
})
test('oversized reset commands remain explicit errors without allocating their unsafe size',async()=>{
  let width=1,height=1,peak=0
  const canvas={get width(){return width},set width(v){width=v;peak=Math.max(peak,width*height)},get height(){return height},set height(v){height=v;peak=Math.max(peak,width*height)},getContext:()=>({})}
  const p=createCanvasPresenter({resolveCanvas:async()=>canvas});try{const result=await p.present([{nid:1,canvas:{width:1,height:1,rev:1,ops:[{name:'resetCanvas',args:[16384,16384]}]}}]);assert.equal(result[0].status,'error');assert.match(result[0].message,/安全上限/);assert.equal(peak,1)}finally{p.dispose()}
})
