'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {encodeCanvasPng}=require('../miniprogram/file-reader/document/canvas-png')
function setup(options={}){
  const surfaces=[],calls=[]
  const factory=config=>{
    const ctx={fillStyle:'',fillRect(){canvas.color=this.fillStyle;calls.push(['fill',canvas.color])},drawImage(source){calls.push(['draw',source.color]);canvas.color=source.color}}
    const canvas={...config,color:'',getContext:()=>ctx,toDataURL(){calls.push(['snapshot',canvas.color]);return 'data:image/png;base64,'+Buffer.from(encodeCanvasPng({width:2,height:2,getContext:()=>({getImageData:()=>({data:Uint8ClampedArray.from(Array(4).fill(canvas.color==='red'?[255,0,0,255]:[0,0,255,255]).flat())})})})).toString('base64')}}
    surfaces.push(canvas);return canvas
  }
  const r=createRuntime('<canvas id="src" width="2" height="2"></canvas><canvas id="dst" width="2" height="2"></canvas>',{createOffscreenCanvas:factory,...options});r.run()
  const src=r.document.getElementById('src'),dst=r.document.getElementById('dst'),s=src.getContext('2d'),d=dst.getContext('2d')
  const ops=()=>dst._canvasState?.ops.filter(o=>o.name==='drawImage')||[]
  return{r,src,dst,s,d,ops,calls,surfaces}
}
test('Canvas image source records real immutable image data instead of an empty src',()=>{
  const x=setup();try{x.s.fillStyle='red';x.s.fillRect(0,0,2,2);x.d.drawImage(x.src,0,0);assert.match(x.ops()[0].args[0].__canvasImage,/^data:image\/png;base64,/);assert.equal(x.calls.filter(c=>c[0]==='snapshot').length,1)}finally{x.r.destroy()}
})
test('source modification creates a new snapshot without changing the previous command',()=>{
  const x=setup();try{x.s.fillStyle='red';x.s.fillRect(0,0,2,2);x.d.drawImage(x.src,0,0);const first=x.ops()[0].args[0].__canvasImage;x.s.fillStyle='blue';x.s.fillRect(0,0,2,2);x.d.drawImage(x.src,1,1);assert.notEqual(x.ops()[1].args[0].__canvasImage,first);assert.equal(x.ops()[0].args[0].__canvasImage,first)}finally{x.r.destroy()}
})
test('unchanged source reuses one snapshot across destinations and crop arguments',()=>{
  const x=setup();try{x.d.drawImage(x.src,0,0);x.d.drawImage(x.src,0,0,2,2,1,1,1,1);assert.equal(x.calls.filter(c=>c[0]==='snapshot').length,1);assert.deepEqual(x.ops()[1].args.slice(1),[0,0,2,2,1,1,1,1])}finally{x.r.destroy()}
})
test('self-copy captures source before the native overlapping draw',()=>{
  const x=setup();try{x.s.fillStyle='red';x.s.fillRect(0,0,2,2);x.calls.length=0;x.s.drawImage(x.src,1,0);assert.deepEqual(x.calls.map(c=>c[0]),['snapshot','draw'])}finally{x.r.destroy()}
})
test('zero-area Canvas source throws InvalidStateError without a poisoned draw command',()=>{
  const x=setup();try{x.src.width=0;const before=x.ops().length;assert.throws(()=>x.d.drawImage(x.src,0,0),{name:'InvalidStateError'});assert.equal(x.ops().length,before)}finally{x.r.destroy()}
})
test('a blank or detached Canvas source initializes its real backing and remains usable',()=>{
  const x=setup();try{const blank=x.r.document.createElement('canvas');blank.width=2;blank.height=2;x.d.drawImage(blank,0,0);assert.match(x.ops()[0].args[0].__canvasImage,/^data:image\/png;base64,/);x.src.remove();x.d.drawImage(x.src,0,0);assert.equal(x.ops().length,2)}finally{x.r.destroy()}
})
test('native snapshot or drawing failures do not append an invalid replay command',()=>{
  const x=setup();try{x.surfaces[0].toDataURL=()=>{throw Error('snapshot sentinel')};assert.throws(()=>x.d.drawImage(x.src,0,0),/snapshot sentinel/);assert.equal(x.ops().length,0);assert.ok(!x.calls.some(c=>c[0]==='draw'))}finally{x.r.destroy()}
  const y=setup();try{y.surfaces[1].getContext('2d').drawImage=()=>{throw Error('draw sentinel')};assert.throws(()=>y.d.drawImage(y.src,0,0),/draw sentinel/);assert.equal(y.ops().length,0)}finally{y.r.destroy()}
})
test('malformed PNG, raw local paths and oversized encoded snapshots are rejected',()=>{
  for(const value of ['data:,','file:///private/a.png','data:image/png;base64,!?','data:image/png;base64,'+'A'.repeat(16*1024*1024)]){const x=setup();try{x.surfaces[0].toDataURL=()=>value;assert.throws(()=>x.d.drawImage(x.src,0,0),/PNG|安全上限/);assert.equal(x.ops().length,0)}finally{x.r.destroy()}}
})
test('snapshot count is bounded before encoding again, even for changing same-size sources',()=>{
  const x=setup();try{for(let i=0;i<128;i++){x.s.fillRect(0,0,2,2);x.d.drawImage(x.src,0,0)}x.s.fillRect(0,0,2,2);assert.throws(()=>x.d.drawImage(x.src,0,0),/数量|累计像素/);assert.equal(x.calls.filter(c=>c[0]==='snapshot').length,128);assert.equal(x.ops().length,128)}finally{x.r.destroy()}
})
test('cumulative snapshot pixels reject before a third capture without allocating huge images',()=>{
  const x=setup();try{x.src.width=8192;x.src.height=2048;for(let i=0;i<2;i++){x.s.fillRect(0,0,1,1);x.d.drawImage(x.src,0,0)}x.s.fillRect(0,0,1,1);assert.throws(()=>x.d.drawImage(x.src,0,0),/累计像素/);assert.equal(x.calls.filter(c=>c[0]==='snapshot').length,2)}finally{x.r.destroy()}
})
test('zero, unavailable, closed or cross-document sources never enter replay',()=>{
  const x=setup(),other=setup();try{assert.throws(()=>x.d.drawImage(other.src,0,0),/跨文件/);other.r.destroy();assert.throws(()=>x.d.drawImage(other.src,0,0),/已关闭/);assert.equal(x.ops().length,0)}finally{x.r.destroy();other.r.destroy()}
  const missing=setup({createOffscreenCanvas:undefined});try{assert.throws(()=>missing.d.drawImage(missing.src,0,0),/真实像素/);assert.equal(missing.ops().length,0)}finally{missing.r.destroy()}
})
test('same-size source reset invalidates the snapshot and invalid arity does not allocate',()=>{
  const x=setup();try{assert.throws(()=>x.d.drawImage(x.src,0),TypeError);assert.ok(!x.calls.some(c=>c[0]==='snapshot'));x.d.drawImage(x.src,0,0);x.src.width=x.src.width;x.d.drawImage(x.src,0,0);assert.equal(x.calls.filter(c=>c[0]==='snapshot').length,2)}finally{x.r.destroy()}
})

test('direct frames initialize blank detached sources without allocating PNG snapshots',()=>{
  const x=setup({directCanvasFrames:true})
  try{
    const blank=x.r.document.createElement('canvas')
    x.d.drawImage(blank,0,0)
    assert.equal(x.surfaces.length,3)
    assert.deepEqual(x.calls.filter(c=>c[0]==='draw'),[['draw','']])
    assert.ok(!x.calls.some(c=>c[0]==='snapshot'))
    x.src.remove();x.s.fillStyle='red';x.s.fillRect(0,0,2,2);x.d.drawImage(x.src,0,0)
    assert.deepEqual(x.calls.filter(c=>c[0]==='draw').at(-1),['draw','red'])
  }finally{x.r.destroy()}
})

test('direct frames reject every zero-area source before drawing and recover after resize',()=>{
  const x=setup({directCanvasFrames:true})
  try{
    const blank=x.r.document.createElement('canvas')
    const revision=x.dst._canvasState?.rev||0
    for(const [width,height]of [[0,50],[50,0],[0,0]]){
      blank.width=width;blank.height=height
      assert.throws(()=>x.d.drawImage(blank,0,0),{name:'InvalidStateError'})
      assert.equal(x.dst._canvasState?.rev||0,revision)
    }
    assert.equal(x.surfaces.length,2)
    assert.ok(!x.calls.some(c=>c[0]==='draw'))
    blank.width=2;blank.height=2;x.d.drawImage(blank,0,0)
    assert.equal(x.calls.filter(c=>c[0]==='draw').length,1)
  }finally{x.r.destroy()}
})

test('direct frames reject foreign and closed sources without poisoning the current frame',()=>{
  const x=setup({directCanvasFrames:true}),other=setup({directCanvasFrames:true})
  try{
    const revision=x.dst._canvasState?.rev||0
    assert.throws(()=>x.d.drawImage(other.src,0,0),/跨文件/)
    other.r.destroy()
    assert.throws(()=>x.d.drawImage(other.src,0,0),/已关闭/)
    assert.equal(x.dst._canvasState?.rev||0,revision)
    assert.ok(!x.calls.some(c=>c[0]==='draw'))
    x.d.drawImage(x.src,0,0)
    assert.equal(x.calls.filter(c=>c[0]==='draw').length,1)
  }finally{x.r.destroy();other.r.destroy()}
})
