'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {bundle}=require('./verify-inline-poster'),{chromeTestResult}=require('./chrome-test-result')
const names=['2d.drawImage.canvas.html','2d.drawImage.self.2.html','2d.drawImage.zerocanvas.html']
const fixtures=names.map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../tests/fixtures/canvas-source',name),'utf8')}))
const expectedHashes=['70df9143b8b1bc8e26ad53c131c0105d1873768b509548cfdc6411bd0fb532d4','bdd096392d264a352bc419b2eaab1bee8390f8d2561c2bfd7af1ec0417596e70','3cfc2aef5d707fc9254413f192269d60116bed7245054113ffe628c9e0ed103d']
fixtures.forEach((fixture,i)=>assert.equal(crypto.createHash('sha256').update(fixture.source).digest('hex'),expectedHashes[i],fixture.name+' original bytes changed'))
const fallback=process.argv.includes('--fallback')
const out=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||fs.mkdtempSync(path.join(os.tmpdir(),'reader-canvas-source-'))
function harness(){
  window.readTests=[];window.async_test=()=>({})
  window._assert=(ok,message)=>{if(!ok)throw Error(message||'assertion failed')}
  window._assertSame=(a,b,message)=>window._assert(a===b,message)
  window._assertPixelApprox=(c,x,y,...values)=>{const tolerance=values.pop(),actual=c.getContext('2d').getImageData(x,y,1,1).data;window._assert(values.every((v,i)=>Math.abs(v-actual[i])<=tolerance),'pixel assertion failed')}
  window.assert_throws_dom=(name,fn)=>{let error;try{fn()}catch(e){error=e}window._assert(error&&error.name===(name==='INVALID_STATE_ERR'?'InvalidStateError':name),'expected '+name+' but got '+(error?.name||'no exception'))}
  window._addTest=fn=>{try{const c=document.getElementById('c');fn(c,c.getContext('2d'));window.readTests.push({pass:true})}catch(e){window.readTests.push({pass:false,error:e.message})}}
}
async function browserRun(fixtures,harnessSource,fallback){
  const progress=stage=>{document.querySelector('output').setAttribute('data-progress',stage);return fetch('/progress?'+encodeURIComponent(stage))}
  let definition,activePage
  window.Page=p=>{definition=p};window.Component=c=>{definition=window.readerComponentDefinition(c)};window.getApp=()=>({globalData:{}})
  const factory=config=>{const c=document.createElement('canvas');c.width=config.width;c.height=config.height;c.createImage=()=>new Image();return c}
  const runtimeFactory=config=>{const c=factory(config);if(fallback)Object.defineProperty(c,'toDataURL',{value:undefined});return c}
  window.wx={setNavigationBarTitle(){},pageScrollTo(){},createOffscreenCanvas:runtimeFactory,createSelectorQuery(){let cb,selector;const q={in(p){activePage=p;return q},select(s){selector=s;return{fields(_o,fn){cb=fn},boundingClientRect(fn){cb=fn}}},exec(){cb?.({node:activePage?.canvases.get(selector)})}};return q}}
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
    const c=ctx.canvas,doc=c.ownerDocument;c.width=64;c.height=48
    const source=doc.createElement('canvas');source.width=24;source.height=20
    if(n%2){source.style.display='none';doc.body.appendChild(source)}
    const a=source.getContext('2d');a.fillStyle=n%3===0?'rgba(173,43,201,.37)':'#ba3158';a.fillRect(0,0,24,20)
    const g=a.createLinearGradient(0,0,24,20);g.addColorStop(0,'rgba(0,231,143,.65)');g.addColorStop(1,'#153dd1');a.fillStyle=g;a.fillRect(3,2,17,13)
    ctx.fillStyle='#e3d7ac';ctx.fillRect(0,0,64,48);ctx.save()
    switch(n%8){
      case 0:ctx.drawImage(source,2,3);break
      case 1:ctx.drawImage(source,2,3,45,38);break
      case 2:ctx.drawImage(source,3,2,17,14,1,5,58,38);break
      case 3:ctx.drawImage(source,-4,-3,35,27,1,1,57,44);break
      case 4:ctx.translate(55,2);ctx.rotate(Math.PI/2);ctx.drawImage(source,0,0,37,45);break
      case 5:ctx.globalAlpha=.47;ctx.globalCompositeOperation='multiply';ctx.drawImage(source,3,4,51,38);break
      case 6:ctx.beginPath();ctx.rect(8,7,36,25);ctx.clip();ctx.drawImage(source,0,0,64,48);break
      case 7:ctx.imageSmoothingEnabled=false;ctx.drawImage(source,20,18,-15,-14,50,40,-43,-30);break
    }
    ctx.restore()
    // Modifying the source before asynchronous view replay must not change the
    // earlier draw. A second draw must see the newly painted source.
    a.fillStyle='#ffa200';a.fillRect(0,0,24,20);ctx.drawImage(source,47,34,17,14)
    if(n>=8)ctx.drawImage(c,0,0,50,38,4,5,54,40)
    if(n%4===3){source.width=13;source.height=11;a.fillStyle='#19ae74';a.fillRect(0,0,13,11);ctx.drawImage(source,30,2)}
    source.remove()
    return{pixels:Array.from(ctx.getImageData(0,0,64,48).data)}
  }
  const generated=[]
  for(let n=0;n<16;n++){
    await progress('generated:'+n)
    const native=factory({width:64,height:48}),ctx=native.getContext('2d'),p=page()
    const html=`<canvas id="c" width="64" height="48"></canvas><button id="next">next</button><p id="out"></p><script>const runCase=${runCase};let n=${n};const c=document.getElementById('c'),ctx=c.getContext('2d');function run(){try{window.readResult=runCase(ctx,n);document.getElementById('out').textContent=String(window.readResult.pixels[0]);window.png=c.toDataURL()}catch(e){window.readError=e.message}window.ready=true}run();document.getElementById('next').onclick=()=>{n++;run()}</script>`
    try{
      const expected=runCase(ctx,n);await progress('page:'+n);p.openSelectedFile({name:'canvas-source.html',inlineHtml:html});await wait(()=>p._htmlRuntime?.window.ready);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const state=p._htmlRuntime.window,target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      const first={nativeReadHash:await hash(Uint8Array.from(expected.pixels)),readerReadHash:state.readResult?await hash(Uint8Array.from(state.readResult.pixels)):null,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null}
      const nextExpected=runCase(ctx,n+1);p.onDomTap({currentTarget:{dataset:{nid:p._htmlRuntime.document.getElementById('next')._nid}}});p._htmlRuntime.flush();await p._lastCanvasPresentation
      generated.push({n,first,next:{nativeReadHash:await hash(Uint8Array.from(nextExpected.pixels)),readerReadHash:state.readResult?await hash(Uint8Array.from(state.readResult.pixels)):null,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null},errors:p._runtimeErrors})
    }finally{p.onUnload()}
  }
  const publicResults=[]
  for(const fixture of fixtures){
    await progress(fixture.name)
    const iframe=document.createElement('iframe');iframe.src='/original/'+fixture.name;document.body.appendChild(iframe);await wait(()=>iframe.contentWindow.readTests?.length)
    const p=page()
    try{p.openSelectedFile({name:fixture.name,inlineHtml:'<script>('+harnessSource+')()</script>'+fixture.source});await wait(()=>p._htmlRuntime?.window.readTests?.length);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      publicResults.push({name:fixture.name,nativeTests:iframe.contentWindow.readTests,readerTests:p._htmlRuntime.window.readTests,nativePixels:await hash(pixels(iframe.contentDocument.getElementById('c'))),visiblePixels:await hash(pixels(target)),errors:p._runtimeErrors})
    }finally{p.onUnload();iframe.remove()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({hostExport:fallback?'pixel-encoder':'native-toDataURL',generated,publicResults})))
}
async function main(){
  fs.mkdirSync(out,{recursive:true});const code=bundle(['miniprogram/file-reader/engine/components/reader/reader.js'])
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/progress?')){console.log('progress',decodeURIComponent(req.url.slice(10)));res.end('ok');return}
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'")
    res.setHeader('Content-Type','text/html; charset=utf-8')
    if(req.url==='/bundle'){res.setHeader('Content-Type','text/javascript');res.end(code);return}
    if(req.url==='/resources/testharness.js'){res.setHeader('Content-Type','text/javascript');res.end('('+harness+')()');return}
    if(req.url==='/resources/testharnessreport.js'||req.url==='/html/canvas/resources/canvas-tests.js'){res.setHeader('Content-Type','text/javascript');res.end('');return}
    const fixture=fixtures.find(f=>req.url==='/original/'+f.name);if(fixture){res.end(fixture.source);return}
    if(req.url==='/'){res.end(`<!doctype html><output></output><script src="/bundle"></script><script>(${browserRun.toString().replace(/<\/script/gi,'<\\/script')})(${JSON.stringify(fixtures).replace(/</g,'\\u003c')},${JSON.stringify(harness.toString())},${fallback}).catch(e=>document.querySelector('output').setAttribute('data-error',e.stack||e.message))</script>`);return}
    res.statusCode=404;res.end()
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`);fs.writeFileSync(path.join(out,'browser-dom.html'),dom);const match=dom.match(/data-result="([^"]+)"/);assert.ok(match,(dom.match(/data-error="([^"]+)"/)||[])[1]);const result=JSON.parse(decodeURIComponent(match[1]));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2))
    const failures=[];assert.equal(result.generated.length,16);assert.equal(result.publicResults.length,3)
    for(const row of result.generated)for(const phase of ['first','next']){const r=row[phase];try{assert.equal(r.error,'');assert.equal(r.readerReadHash,r.nativeReadHash);assert.equal(r.visiblePixels,r.nativePixels);assert.equal(r.exportedPixels,r.nativePixels);assert.deepEqual(row.errors,[])}catch(e){failures.push({n:row.n,phase,message:e.message})}}
    for(const r of result.publicResults)try{assert.ok(r.nativeTests.every(t=>t.pass));assert.deepEqual(r.readerTests,r.nativeTests);assert.equal(r.visiblePixels,r.nativePixels);assert.deepEqual(r.errors,[])}catch(e){failures.push({name:r.name,message:e.message})}
    fs.writeFileSync(path.join(out,'failures.json'),JSON.stringify(failures,null,2));console.log(JSON.stringify({hostExport:result.hostExport,generatedFrames:32,publicFiles:3,failures:failures.length,out}));assert.deepEqual(failures,[])
  }finally{server.close()}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={harness}
