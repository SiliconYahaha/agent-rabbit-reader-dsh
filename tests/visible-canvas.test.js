'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { readerPage, flush } = require('./helpers/reader-page')
const { createCanvasPresenter } = require('../miniprogram/file-reader/document/canvas-presenter')
const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyAQMAAACQ++z9AAAAA1BMVEX/AAAZ4gk3AAAAD0lEQVQoFWNgGAWjYGgCAAK8AAEb3eOQAAAAAElFTkSuQmCC'
const op = (name, ...args) => ({ name, args })
const frame = (rev, ops, nid = 1) => ({ nid, canvas: { width: 100, height: 50, rev, ops } })
function host () {
  const calls = [], images = [], resets = []
  const context = { transformX: 0, fillStyle: '#000', globalAlpha: 1,
    setTransform (a,b,c,d,x) { this.transformX = x }, translate (x) { this.transformX += x },
    clearRect () {}, fillRect () { calls.push(['fill', this.fillStyle, this.transformX, this.globalAlpha]) },
    drawImage (image) { calls.push(['image', image.src, this.transformX, this.globalAlpha]) }
  }
  const canvas = { _width: 100, _height: 50, getContext: () => context,
    get width () { return this._width }, set width (n) { this._width = n; resets.push(n); context.fillStyle='#000';context.globalAlpha=1;context.transformX=0 },
    get height () { return this._height }, set height (n) { this._height=n;resets.push(n);context.fillStyle='#000';context.globalAlpha=1;context.transformX=0 },
    createImage () { const image = { width: 100, height: 50 }; images.push(image); return image }
  }
  return { calls, images, canvas, resets, context }
}
function pageHost (h) {
  const pending=[]
  const p=readerPage({createSelectorQuery:()=>{
    const q={in(){return q},select(){return{fields(_o,cb){pending.push(cb)}}},exec(){pending.splice(0).forEach(cb=>cb({node:h.canvas}))}}
    return q
  }})
  return p
}
test('first Page render paints Canvas without sending its command stream in setData',async()=>{
  const h=host(),p=pageHost(h)
  try{p.openSelectedFile({name:'canvas.html',inlineHtml:'<canvas id="c" width="100" height="50"></canvas><script>const ctx=document.getElementById("c").getContext("2d");ctx.fillStyle="red";ctx.fillRect(0,0,100,50)</script>'});await flush();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],['fill','red',0,1]);assert.ok(p.patches.every(x=>!JSON.stringify(x).includes('"ops"')))}finally{p.host.onUnload()}
})
test('slow image cannot overtake later paint or lose its transform',async()=>{
  const h=host(),p=pageHost(h)
  try{p.presentCanvasItems([frame(1,[op('translate',25,0),op('drawImage',{__canvasImage:source},0,0),op('setTransform',1,0,0,1,0,0),op('set:fillStyle','green'),op('fillRect',0,0,20,20)])]);await flush();assert.equal(h.images.length,1);h.images[0].onload();await flush();assert.deepEqual(h.calls.map(c=>c[0]),['image','fill']);assert.equal(h.calls[0][2],25)}finally{p.host.onUnload()}
})
test('late image from replaced revision cannot overwrite the newer picture',async()=>{
  const h=host(),p=pageHost(h)
  try{p.presentCanvasItems([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();const late=h.images[0].onload;p.presentCanvasItems([frame(2,[op('set:fillStyle','green'),op('fillRect',0,0,100,50)])]);await flush();late();await flush();assert.deepEqual(h.calls.map(c=>c[0]),['fill'])}finally{p.host.onUnload()}
})
test('full replay resets previous alpha and paint state even when dimensions match',async()=>{
  const h=host(),p=pageHost(h)
  try{p.presentCanvasItems([frame(1,[op('set:globalAlpha',0),op('set:fillStyle','red')])]);await flush();p.presentCanvasItems([frame(2,[op('fillRect',0,0,100,50)])]);await flush();assert.deepEqual(h.calls.at(-1),['fill','#000',0,1])}finally{p.host.onUnload()}
})
test('closing a document prevents an already queued image callback from painting',async()=>{
  const h=host(),p=pageHost(h);p.presentCanvasItems([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();const late=h.images[0].onload;p.host.onUnload();late();await flush();assert.deepEqual(h.calls,[])
})
test('query response from an older revision cannot paint after a newer query completed',async()=>{
  const h=host(),queries=[];const p=createCanvasPresenter({resolveCanvas:()=>new Promise(r=>queries.push(r))})
  try{const old=p.present([frame(1,[op('set:fillStyle','red'),op('fillRect',0,0,100,50)])]),next=p.present([frame(2,[op('set:fillStyle','green'),op('fillRect',0,0,100,50)])]);queries[1](h.canvas);await next;queries[0](h.canvas);assert.equal((await old)[0].status,'cancelled');assert.deepEqual(h.calls,[['fill','green',0,1]])}finally{p.dispose()}
})
test('image dependencies are deduplicated across repeated commands and newer pending frames',async()=>{
  const h=host(),p=createCanvasPresenter({resolveCanvas:()=>h.canvas})
  try{const old=p.present([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();const next=p.present([frame(2,[op('drawImage',{__canvasImage:source},0,0),op('drawImage',{__canvasImage:source},10,0)])]);await flush();assert.equal(h.images.length,1);h.images[0].onload();assert.equal((await old)[0].status,'cancelled');assert.equal((await next)[0].status,'painted');assert.equal(h.calls.length,2);assert.equal((await p.present([frame(2,[])]))[0].status,'unchanged');assert.equal(h.calls.length,2)}finally{p.dispose()}
})
test('bad image is an explicit failed frame, and a subsequent image-free frame can render',async()=>{
  const h=host(),errors=[],p=createCanvasPresenter({resolveCanvas:()=>h.canvas,onError:e=>errors.push(e.message)})
  try{const pending=p.present([frame(1,[op('drawImage',{__canvasImage:source},0,0),op('fillRect',0,0,100,50)])]);await flush();h.images[0].onerror();assert.equal((await pending)[0].status,'error');assert.match(errors[0],/解码/);assert.deepEqual(h.calls,[]);assert.equal((await p.present([frame(2,[op('fillRect',0,0,100,50)])]))[0].status,'painted')}finally{p.dispose()}
})
test('native query, local resource and image decode hangs end within a bounded timeout',async()=>{
  for(const mode of ['query','resource','decode']){const h=host(),errors=[],p=createCanvasPresenter({limits:{timeoutMs:20},resolveCanvas:()=>mode==='query'?new Promise(()=>{}):h.canvas,resolveImageSource:()=>mode==='resource'?new Promise(()=>{}):source,onError:e=>errors.push(e.message)})
    try{const result=await p.present([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);assert.equal(result[0].status,'error');assert.equal(errors.length,1);assert.match(errors[0],/超时/)}finally{p.dispose()}}
})
test('dimension, operation and total surface limits reject before native canvas allocation',async()=>{
  let requests=0;const p=createCanvasPresenter({resolveCanvas:()=>{requests++;return host().canvas},limits:{pixels:5000,totalPixels:5000,operations:2,canvases:2}})
  try{for(const items of [[frame(1,[],1),frame(1,[],2)], [frame(1,[op('save'),op('save'),op('save')])], [{nid:1,canvas:{width:-1,height:1,rev:1,ops:[]}}], [{nid:1,canvas:{width:1e9,height:0,rev:1,ops:[]}}]])assert.equal((await p.present(items))[0].status,'error');assert.equal(requests,0)}finally{p.dispose()}
})
test('decoded image pixel limit and image-count limit reject without drawing fake content',async()=>{
  const h=host(),p=createCanvasPresenter({resolveCanvas:()=>h.canvas,limits:{pixels:5000,images:1}})
  try{const result=p.present([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();h.images[0].width=5001;h.images[0].onload();assert.equal((await result)[0].status,'error');assert.deepEqual(h.calls,[]);assert.equal((await p.present([frame(2,[op('drawImage',{__canvasImage:source+'AAAA'},0,0)])]))[0].status,'error');assert.equal(h.images.length,1)}finally{p.dispose()}
})
test('native surface missing during creation can be resolved after WXML completion',async()=>{
  const h=host();let ready=false;const p=createCanvasPresenter({resolveCanvas:()=>ready?h.canvas:null})
  try{const item=frame(1,[op('fillRect',0,0,100,50)]);assert.equal((await p.present([item]))[0].status,'missing');ready=true;assert.equal((await p.present([item]))[0].status,'painted');assert.equal(h.calls.length,1)}finally{p.dispose()}
})
test('raw network, system-file and unsanitized SVG sources never reach the decoder',async()=>{
  for(const value of ['https://example.invalid/a.png','/private/file.png','wxfile://unowned/a.png','data:image/svg+xml,<svg/>']){const h=host(),p=createCanvasPresenter({resolveCanvas:()=>h.canvas});try{assert.equal((await p.present([frame(1,[op('drawImage',{__canvasImage:value},0,0)])]))[0].status,'error');assert.equal(h.images.length,0)}finally{p.dispose()}}
})
test('invalid replacement frame and removed canvas cancel outstanding work',async()=>{
  for(const replacement of [[],[{nid:1,canvas:{width:-1,height:1,rev:2,ops:[]}}]]){const h=host(),p=createCanvasPresenter({resolveCanvas:()=>h.canvas});try{const pending=p.present([frame(1,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();const late=h.images[0].onload;await p.present(replacement);late();assert.equal((await pending)[0].status,'cancelled');assert.deepEqual(h.calls,[])}finally{p.dispose()}}
})
test('unsupported operation or malformed pixel payload is reported, not marked painted',async()=>{
  for(const operation of [op('unsupportedDrawingMethod'),op('putImageData',{width:2,height:2,data:{data:[1]}},0,0)]){const h=host(),p=createCanvasPresenter({resolveCanvas:()=>h.canvas});try{assert.equal((await p.present([frame(1,[operation])]))[0].status,'error')}finally{p.dispose()}}
})
test('WXML target invalidation cancels old work and forces same-revision repaint',async()=>{
  const h=host(),p=pageHost(h)
  try{const item=frame(1,[op('fillRect',0,0,100,50)]);await p.presentCanvasItems([item]);p.invalidateCanvasHandles();await p.presentCanvasItems([item]);assert.equal(h.calls.length,2)
    h.calls.length=0;const pending=p.presentCanvasItems([frame(2,[op('drawImage',{__canvasImage:source},0,0)])]);await flush();const late=h.images[0].onload;p.invalidateCanvasHandles();late();assert.equal((await pending)[0].status,'cancelled');assert.deepEqual(h.calls,[])
  }finally{p.host.onUnload()}
})
test('author same-value dimension assignment and removal reset context state and saved stack',()=>{
  const {parseHtmlDocument,canvasStateForElement}=require('../miniprogram/file-reader/document/html-runtime/html-dom-shim'),c=parseHtmlDocument('<canvas width="100" height="50"></canvas>').document.querySelector('canvas'),ctx=c.getContext('2d')
  ctx.fillStyle='red';ctx.globalAlpha=.2;ctx.save();ctx.fillRect(0,0,20,20);const before=canvasStateForElement(c).rev;c.width=c.width;ctx.restore()
  assert.equal(ctx.fillStyle,'#000000');assert.equal(ctx.globalAlpha,1);assert.ok(canvasStateForElement(c).rev>before);assert.deepEqual(canvasStateForElement(c).ops.slice(-2).map(o=>o.name),['resetCanvas','restore'])
  ctx.fillStyle='blue';c.removeAttribute('width');assert.equal(c.width,300);assert.equal(ctx.fillStyle,'#000000');assert.equal(c.hasAttribute('width'),false)
})
test('native frames copy the current backing without replay and cancel after disposal',async()=>{
 const h=host(),native={width:100,height:50,src:'native-backing'};h.context.save=()=>{};h.context.restore=()=>{}
 const p=createCanvasPresenter({resolveCanvas:()=>h.canvas,resolveNativeCanvas:()=>native})
 const item={nid:1,canvas:{width:100,height:50,rev:1,ops:[],native:true}}
 assert.equal((await p.present([item]))[0].status,'painted');assert.equal(h.calls[0][1],'native-backing');assert.equal((await p.present([item]))[0].status,'unchanged');p.dispose();assert.deepEqual(await p.present([item]),[])
})
test('native WebGL pixels stay off setData and are flipped into the visible 2D surface',async()=>{
 let drawn,allocated=0
 const canvas={width:1,height:2,getContext:()=>({createImageData:(w,h)=>{allocated++;return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}},putImageData:image=>{drawn=Array.from(image.data)}})}
 const source={width:1,height:2},p=createCanvasPresenter({resolveCanvas:()=>canvas,resolveNativeFrame:()=>({canvas:source,readPixels:data=>data.set([255,0,0,255,0,255,0,255])})})
 for(const rev of [1,2])assert.equal((await p.present([{nid:1,canvas:{width:1,height:2,rev,native:true,ops:[]}}]))[0].status,'painted')
 assert.deepEqual(drawn,[0,255,0,255,255,0,0,255]);assert.equal(allocated,1);p.dispose()
})


test('canvas replaced during native target lookup cancels only the detached frame',async()=>{
 for(const alive of [false,true]){
  const h=host(),errors=[];let resolve
  const p=createCanvasPresenter({resolveCanvas:()=>new Promise(r=>{resolve=r}),resolveNativeFrame:()=>null,isCanvasAlive:()=>alive,onError:e=>errors.push(e.message)})
  const pending=p.present([{nid:1,canvas:{width:100,height:50,rev:1,native:true,ops:[]}}]);resolve(h.canvas)
  assert.equal((await pending)[0].status,alive?'error':'cancelled');assert.equal(errors.length,alive?1:0);assert.deepEqual(h.calls,[]);p.dispose()
 }
})
