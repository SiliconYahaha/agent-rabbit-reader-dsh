'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
function setup(options={}){
  const calls=[],surfaces=[]
  const factory=config=>{
    calls.push(['allocate',config.width,config.height])
    const context={fillRect(){calls.push(['fill'])},getImageData(x,y,w,h){calls.push(['read',x,y,w,h]);return{width:Math.abs(w),height:Math.abs(h),data:new Uint8ClampedArray([255,0,0,255])}}}
    const canvas={...config,getContext:()=>context};surfaces.push(canvas);return canvas
  }
  const runtime=createRuntime('<canvas id="c" width="2" height="2"></canvas>',{createOffscreenCanvas:factory,...options})
  runtime.run();const canvas=runtime.document.getElementById('c'),ctx=canvas.getContext('2d')
  return{runtime,canvas,ctx,calls,surfaces}
}
test('attached Canvas readback uses the actual backing pixels, not an invented zero buffer',()=>{
  const s=setup();try{s.ctx.fillStyle='red';s.ctx.fillRect(0,0,2,2);assert.deepEqual(Array.from(s.ctx.getImageData(0,0,1,1).data),[255,0,0,255]);assert.deepEqual(s.calls.map(c=>c[0]),['allocate','fill','read'])}finally{s.runtime.destroy()}
})
test('negative readback extents preserve native coordinates and return positive dimensions',()=>{
  const s=setup();try{const result=s.ctx.getImageData(1,1,-1,-1);assert.equal(result.width,1);assert.equal(result.height,1);assert.deepEqual(s.calls.at(-1),['read',1,1,-1,-1])}finally{s.runtime.destroy()}
})
test('zero pixel extent reports IndexSizeError before native readback',()=>{
  const s=setup();try{assert.throws(()=>s.ctx.getImageData(0,0,0,1),{name:'IndexSizeError'});assert.ok(!s.calls.some(c=>c[0]==='read'))}finally{s.runtime.destroy()}
})
test('missing native readback fails explicitly instead of reporting empty pixels as success',()=>{
  const s=setup({createOffscreenCanvas:undefined});try{assert.throws(()=>s.ctx.getImageData(0,0,1,1),/像素|Canvas/)}finally{s.runtime.destroy()}
})
test('createImageData handles negative extents and the size-copy overload without copying pixels',()=>{
  const s=setup();try{const a=s.ctx.createImageData(-2,3);assert.equal(a.width,2);assert.equal(a.height,3);assert.equal(a.data.length,24);a.data[0]=255;const b=s.ctx.createImageData(a);assert.equal(b.data.length,24);assert.equal(b.data[0],0);assert.throws(()=>s.ctx.createImageData(0,1),{name:'IndexSizeError'})}finally{s.runtime.destroy()}
})
test('oversized or non-finite readback/create requests reject before allocating buffers',()=>{
  const s=setup();try{for(const size of [[16385,1],[4097,4096],[Infinity,1],[NaN,1]]){assert.throws(()=>s.ctx.getImageData(0,0,...size));assert.throws(()=>s.ctx.createImageData(...size))}assert.ok(!s.calls.some(c=>c[0]==='read'));assert.throws(()=>s.ctx.getImageData(Infinity,0,1,1),TypeError)}finally{s.runtime.destroy()}
})
test('oversized native surfaces fail before the host allocation and never return fake readback',()=>{
  let calls=0;const r=createRuntime('<canvas id="c" width="16385" height="0"></canvas>',{createOffscreenCanvas:()=>{calls++;throw Error('must not allocate')}})
  try{r.run();const ctx=r.document.getElementById('c').getContext('2d');assert.equal(calls,0);assert.throws(()=>ctx.getImageData(0,0,1,1),/安全上限/)}finally{r.destroy()}
})
test('document total native surface budget rejects a third large surface without allocating it',()=>{
  const s=setup();try{s.canvas.width=8192;s.canvas.height=2048;for(let n=1;n<3;n++){const c=s.runtime.document.createElement('canvas');c.width=8192;c.height=2048;const ctx=c.getContext('2d');if(n===2)assert.throws(()=>ctx.getImageData(0,0,1,1),/累计像素/);else assert.deepEqual(Array.from(ctx.getImageData(0,0,1,1).data),[255,0,0,255])}assert.equal(s.surfaces.length,2)}finally{s.runtime.destroy()}
})
test('closing the runtime clears native storage and blocks subsequent pixel access or resize',()=>{
  const s=setup();s.ctx.fillRect(0,0,2,2);s.runtime.destroy();assert.equal(s.surfaces[0].width,0);assert.equal(s.surfaces[0].height,0)
  assert.throws(()=>s.ctx.getImageData(0,0,1,1),/已关闭/);assert.throws(()=>s.canvas.toDataURL(),/已关闭/);assert.throws(()=>s.canvas.getContext('2d'),/已关闭/);assert.throws(()=>{s.canvas.width=20},/已关闭/);assert.throws(()=>s.ctx.fillRect(0,0,1,1),/已关闭/)
})
test('native failures or malformed pixel data are propagated instead of repaired into blank pixels',()=>{
  for(const result of [null,{width:1,height:1,data:{length:4}},{width:1,height:1,data:new Uint8Array(3)}]){const s=setup({createOffscreenCanvas:()=>({getContext:()=>({getImageData:()=>result})})});try{assert.throws(()=>s.ctx.getImageData(0,0,1,1),/不完整/)}finally{s.runtime.destroy()}}
  const s=setup({createOffscreenCanvas:()=>{throw Error('native allocation refused')}});try{assert.throws(()=>s.ctx.getImageData(0,0,1,1),/native allocation refused/)}finally{s.runtime.destroy()}
})
test('same-size clear and removal reach the native backing before the next readback',()=>{
  const s=setup();try{s.canvas.width=s.canvas.width;assert.equal(s.surfaces[0].width,2);s.canvas.removeAttribute('width');assert.equal(s.surfaces[0].width,300);assert.equal(s.canvas.width,300)}finally{s.runtime.destroy()}
})
