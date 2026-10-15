'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict')
const {bundle}=require('./verify-inline-poster'),{chromeTestResult}=require('./chrome-test-result')
const names=['2d.imageData.get.source.outside.html','2d.imageData.get.unaffected.html','2d.imageData.get.nonpremul.html']
const fixtures=names.map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../tests/fixtures/canvas-readback',name),'utf8')}))
const hashes=['f2d15f49a6c6ce3d965478fe93a4dbfa2367d96f4d210fba9cb44893a94062eb','838226d2b9f2129f5429d91c27321726f2dc0e187d93cb88109def563cfb4274','817d4452c512d75ee03afe159c3e86dd59f4bdc6882041db2fc26b8d908b1140']
const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-canvas-readback-'))
function harness(){
  window.readTests=[];window.async_test=()=>({})
  window._assert=(ok,message)=>{if(!ok)throw Error(message||'assertion failed')}
  window._assertSame=(a,b,message)=>window._assert(a===b,message)
  window._assertPixelApprox=(c,x,y,...values)=>{const tolerance=values.pop(),actual=c.getContext('2d').getImageData(x,y,1,1).data;window._assert(values.every((v,i)=>Math.abs(v-actual[i])<=tolerance),'pixel assertion failed')}
  window._addTest=fn=>{try{const c=document.getElementById('c');fn(c,c.getContext('2d'));window.readTests.push({pass:true})}catch(e){window.readTests.push({pass:false,error:e.message})}}
}
async function browserRun(fixtures,harnessSource){
  let definition,activePage
  window.Page=p=>{definition=p};window.Component=c=>{definition=window.readerComponentDefinition(c)};window.getApp=()=>({globalData:{}})
  const factory=config=>{const c=document.createElement('canvas');c.width=config.width;c.height=config.height;c.createImage=()=>new Image();return c}
  window.wx={setNavigationBarTitle(){},pageScrollTo(){},createOffscreenCanvas:factory,createSelectorQuery(){let cb,selector;const q={in(p){activePage=p;return q},select(s){selector=s;return{fields(_o,fn){cb=fn},boundingClientRect(fn){cb=fn}}},exec(){cb?.({node:activePage?.canvases.get(selector)})}};return q}}
  readerRequire('miniprogram/file-reader/engine/components/reader/reader.js')
  function page(){const p={...definition,data:structuredClone(definition.data),canvases:new Map(),setData(updates,callback){
    for(const [key,value]of Object.entries(updates)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let d=this.data;for(const part of parts.slice(0,-1))d=d[part];d[parts.at(-1)]=value}
    const visit=nodes=>(nodes||[]).forEach(n=>{if(n.name==='canvas'&&!this.canvases.has('#dom-canvas-'+n.nid))this.canvases.set('#dom-canvas-'+n.nid,factory({width:1,height:1}));visit(n.children)});visit(this.data.domTree);callback?.()
  }};activePage=p;return p}
  const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('readback fixture timeout')}
  const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('')
  const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data
  const exportedPixels=async src=>{const i=new Image();i.src=src;await i.decode();const c=factory({width:i.width,height:i.height});c.getContext('2d').drawImage(i,0,0);return hash(pixels(c))}
  const runCase=(ctx,n)=>{
    const c=ctx.canvas;c.width=32;c.height=24
    ctx.fillStyle=n%2?'#1273a8':'#dc3155';ctx.fillRect(0,0,32,24)
    ctx.save();ctx.translate(n%7,n%5);ctx.globalAlpha=.5;ctx.fillStyle='#0cf';ctx.fillRect(2,1,13,10);ctx.restore()
    if(n%3===0){const g=ctx.createLinearGradient(0,0,32,0);g.addColorStop(0,'#fff');g.addColorStop(1,'#000');ctx.fillStyle=g;ctx.fillRect(0,18,32,6)}
    ctx.save();ctx.translate(100,100);ctx.globalAlpha=.1;ctx.beginPath();ctx.rect(0,0,1,1);ctx.clip()
    const args=n%4===0?[-2,-3,12,10]:n%4===1?[20,15,-11,-9]:n%4===2?[29,20,7,7]:[0,0,32,24]
    const read=ctx.getImageData(...args);ctx.restore()
    const before=Array.from(read.data);read.data[0]=17;read.data[1]=99;read.data[3]=255;ctx.putImageData(read,2,3)
    const blank=ctx.createImageData(n%2?-3:3,2);blank.data[0]=250;blank.data[3]=255;const copy=ctx.createImageData(blank);ctx.putImageData(blank,28,0)
    return{before,width:read.width,height:read.height,blankSize:[blank.width,blank.height],copyZero:Array.from(copy.data).every(v=>v===0),pixels:Array.from(ctx.getImageData(0,0,32,24).data)}
  }
  const generated=[]
  for(let n=0;n<16;n++){
    document.querySelector('output').setAttribute('data-progress','generated:'+n)
    const native=factory({width:32,height:24}),ctx=native.getContext('2d'),p=page()
    const html=`<canvas id="c" width="32" height="24"></canvas><button id="next">next</button><p id="out"></p><script>const runCase=${runCase};let n=${n};const c=document.getElementById('c'),ctx=c.getContext('2d');function run(){try{window.readResult=runCase(ctx,n);document.getElementById('out').textContent=String(window.readResult.pixels[0]);window.png=c.toDataURL()}catch(e){window.readError=e.message}window.ready=true}run();document.getElementById('next').onclick=()=>{n++;run()}</script>`
    try{
      const expected=runCase(ctx,n);p.openSelectedFile({name:'readback.html',inlineHtml:html});await wait(()=>p._htmlRuntime?.window.ready);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const state=p._htmlRuntime.window,target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      const first={native:expected,reader:state.readResult,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null}
      const nextExpected=runCase(ctx,n+1);p.onDomTap({currentTarget:{dataset:{nid:p._htmlRuntime.document.getElementById('next')._nid}}});p._htmlRuntime.flush();await p._lastCanvasPresentation
      generated.push({n,first,next:{native:nextExpected,reader:state.readResult,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null},errors:p._runtimeErrors})
    }finally{p.onUnload()}
  }
  const publicResults=[]
  for(const fixture of fixtures){
    document.querySelector('output').setAttribute('data-progress',fixture.name)
    const iframe=document.createElement('iframe');iframe.src='/original/'+fixture.name;document.body.appendChild(iframe);await wait(()=>iframe.contentWindow.readTests?.length)
    const p=page()
    try{p.openSelectedFile({name:fixture.name,inlineHtml:'<script>('+harnessSource+')()</script>'+fixture.source});await wait(()=>p._htmlRuntime?.window.readTests?.length);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      publicResults.push({name:fixture.name,nativeTests:iframe.contentWindow.readTests,readerTests:p._htmlRuntime.window.readTests,nativePixels:await hash(pixels(iframe.contentDocument.getElementById('c'))),visiblePixels:await hash(pixels(target)),errors:p._runtimeErrors})
    }finally{p.onUnload();iframe.remove()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({generated,publicResults})))
}
async function main(){
  fixtures.forEach((f,i)=>assert.equal(require('node:crypto').createHash('sha256').update(f.source).digest('hex'),hashes[i],'Public fixture changed: '+f.name))
  fs.mkdirSync(out,{recursive:true});const code=bundle(['miniprogram/file-reader/engine/components/reader/reader.js'])
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'")
    res.setHeader('Content-Type','text/html; charset=utf-8')
    if(req.url==='/bundle'){res.setHeader('Content-Type','text/javascript');res.end(code);return}
    if(req.url==='/resources/testharness.js'){res.setHeader('Content-Type','text/javascript');res.end('('+harness+')()');return}
    if(req.url==='/resources/testharnessreport.js'||req.url==='/html/canvas/resources/canvas-tests.js'){res.setHeader('Content-Type','text/javascript');res.end('');return}
    const fixture=fixtures.find(f=>req.url==='/original/'+f.name);if(fixture){res.end(fixture.source);return}
    if(req.url==='/'){res.end(`<!doctype html><output></output><script src="/bundle"></script><script>(${browserRun.toString().replace(/<\/script/gi,'<\\/script')})(${JSON.stringify(fixtures).replace(/</g,'\\u003c')},${JSON.stringify(harness.toString())}).catch(e=>document.querySelector('output').setAttribute('data-error',e.stack||e.message))</script>`);return}
    res.statusCode=404;res.end()
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`);fs.writeFileSync(path.join(out,'browser-dom.html'),dom);const match=dom.match(/data-result="([^"]+)"/);assert.ok(match,(dom.match(/data-error="([^"]+)"/)||[])[1]);const result=JSON.parse(decodeURIComponent(match[1]));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2))
    const failures=[];assert.equal(result.generated.length,16);assert.equal(result.publicResults.length,3)
    for(const row of result.generated)for(const phase of ['first','next']){const r=row[phase];try{assert.equal(r.error,'');assert.deepEqual(r.reader,r.native);assert.equal(r.visiblePixels,r.nativePixels);assert.equal(r.exportedPixels,r.nativePixels);assert.deepEqual(row.errors,[])}catch(e){failures.push({n:row.n,phase,message:e.message})}}
    for(const r of result.publicResults)try{assert.ok(r.nativeTests.every(t=>t.pass));assert.deepEqual(r.readerTests,r.nativeTests);assert.equal(r.visiblePixels,r.nativePixels);assert.deepEqual(r.errors,[])}catch(e){failures.push({name:r.name,message:e.message})}
    fs.writeFileSync(path.join(out,'failures.json'),JSON.stringify(failures,null,2));console.log(JSON.stringify({generatedFrames:32,publicFiles:3,failures:failures.length,out}));assert.deepEqual(failures,[])
  }finally{server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
