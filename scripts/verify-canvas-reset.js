'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {bundle}=require('./verify-inline-poster'),{chromeTestResult}=require('./chrome-test-result')
const names=['2d.reset.basic.html','2d.reset.state.global_alpha.html','2d.reset.state.clip.html']
const fixtures=names.map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../tests/fixtures/canvas-reset',name),'utf8')}))
const expectedHashes=["5303f2308f75d33138a40453ee3fb7b73058257f51d95d60d3010d88dc696aaf","4b08eab9339389557c66af19e2bb839b96f30258fac6a6d4a68713012425c140","8bf77b9269e2ed727f5cedeef30e8a0a076d192dfb37694a0c7319fdc52e64e1"]
fixtures.forEach((fixture,i)=>assert.equal(crypto.createHash('sha256').update(fixture.source).digest('hex'),expectedHashes[i],fixture.name+' original bytes changed'))
const expectedSource=fs.readFileSync(path.join(__dirname,'../tests/fixtures/canvas-reset/2d.reset.state.clip-expected.html'),'utf8')
assert.equal(crypto.createHash('sha256').update(expectedSource).digest('hex'),"6721713a26c5802c94a67b1c0fee41d6ef3b2fb5dca660936d03ea2d82a08f5c",'clip reference bytes changed')
const fallback=process.argv.includes('--fallback')
const out=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||fs.mkdtempSync(path.join(os.tmpdir(),'reader-canvas-reset-'))
function harness(){
  window.readTests=[];window.async_test=()=>({done(){}})
  window._assert=(ok,message)=>{if(!ok)throw Error(message||'assertion failed')}
  window._assertSame=(a,b,message)=>window._assert(a===b,message)
  window._assertPixel=(c,x,y,...values)=>{const actual=c.getContext('2d').getImageData(x,y,1,1).data;window._assert(values.every((v,i)=>v===actual[i]),'exact pixel assertion failed')}
  window._assertPixelApprox=(c,x,y,...values)=>{const tolerance=values.pop(),actual=c.getContext('2d').getImageData(x,y,1,1).data;window._assert(values.every((v,i)=>Math.abs(v-actual[i])<=tolerance),'pixel assertion failed')}
  window.assert_throws_dom=(name,fn)=>{let error;try{fn()}catch(e){error=e}window._assert(error&&error.name===(name==='INVALID_STATE_ERR'?'InvalidStateError':name),'expected '+name+' but got '+(error?.name||'no exception'))}
  window._addTest=fn=>{try{const c=document.getElementById('c');fn(c,c.getContext('2d'));window.readTests.push({pass:true})}catch(e){window.readTests.push({pass:false,error:e.message})}}
}
async function browserRun(fixtures,harnessSource,fallback){
  const progress=stage=>{document.querySelector('output').setAttribute('data-progress',stage);return fetch('/progress?'+encodeURIComponent(stage))}
  let definition,activePage
  window.Page=p=>{definition=p};window.Component=c=>{definition=window.readerComponentDefinition(c)};window.getApp=()=>({globalData:{}})
  const factory=config=>{const c=document.createElement('canvas');c.width=config.width;c.height=config.height;c.createImage=()=>new Image();return c}
  const runtimeFactory=config=>{const c=factory(config);if(fallback)Object.defineProperty(c.getContext('2d'),'reset',{value:undefined});return c}
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
    const c=ctx.canvas;c.width=64;c.height=48
    const keys=['fillStyle','strokeStyle','globalAlpha','globalCompositeOperation','lineWidth','lineCap','lineJoin','miterLimit','lineDashOffset','font','textAlign','textBaseline','direction','shadowBlur','shadowColor','shadowOffsetX','shadowOffsetY','imageSmoothingEnabled','imageSmoothingQuality','filter','fontKerning','fontStretch','fontVariantCaps','letterSpacing','wordSpacing','textRendering']
    const initial=Object.fromEntries(keys.map(k=>[k,ctx[k]]))
    const gradient=ctx.createLinearGradient(0,0,64,48);gradient.addColorStop(0,'#ec5b19');gradient.addColorStop(1,'#1872b4')
    ctx.fillStyle='red';ctx.fillRect(0,0,64,48)
    ctx.fillStyle=gradient;ctx.strokeStyle='#d838af';ctx.globalAlpha=.37;ctx.globalCompositeOperation='multiply';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='bevel';ctx.miterLimit=5;ctx.lineDashOffset=3;ctx.setLineDash([3,5]);ctx.shadowBlur=2;ctx.shadowColor='red';ctx.shadowOffsetX=4;ctx.shadowOffsetY=3;ctx.imageSmoothingEnabled=false;ctx.imageSmoothingQuality='high';ctx.filter='blur(2px)';ctx.font='italic 18px serif';ctx.fontKerning='none';ctx.fontStretch='expanded';ctx.fontVariantCaps='small-caps';ctx.letterSpacing='3px';ctx.wordSpacing='7px';ctx.textRendering='optimizeSpeed';ctx.textAlign='right';ctx.textBaseline='top';ctx.direction='rtl'
    ctx.translate(19,13);ctx.rotate(.23);ctx.beginPath();ctx.rect(1,1,14,12);ctx.clip();ctx.save();ctx.scale(2,3);ctx.save()
    ctx.reset()
    const after=Object.fromEntries(keys.map(k=>[k,ctx[k]]))
    ctx.restore();ctx.restore()
    const restored=Object.fromEntries(keys.map(k=>[k,ctx[k]]))
    switch(n%8){
      case 0:break
      case 1:ctx.fillRect(0,0,64,48);break
      case 2:ctx.fillStyle='#198b32';ctx.fill();break // no old current path
      case 3:ctx.strokeStyle='#21ab9b';ctx.beginPath();ctx.moveTo(1,1);ctx.lineTo(61,42);ctx.stroke();break
      case 4:ctx.fillStyle=gradient;ctx.fillRect(0,0,64,48);break // gradient object survives
      case 5:ctx.fillStyle='#21ab9b';ctx.fillText('Reset',2,22);break
      case 6:for(let i=0;i<5;i++){ctx.fillStyle='red';ctx.fillRect(0,0,64,48);ctx.reset()}ctx.fillRect(1,1,40,30);break
      case 7:ctx.fillStyle='#208fca';ctx.fillRect(3,5,40,30);ctx.save();ctx.translate(10,2);ctx.fillStyle='#a13872';ctx.fillRect(0,0,20,20);ctx.restore();break
    }
    if(n>=8){const copy=c.ownerDocument.createElement('canvas');copy.width=64;copy.height=48;const d=copy.getContext('2d');d.drawImage(c,0,0);ctx.reset();ctx.fillStyle='rgba(26,157,211,.43)';ctx.fillRect(4,4,25,20);d.drawImage(c,0,0);ctx.reset();ctx.drawImage(copy,3,4,48,36)}
    return{pixels:Array.from(ctx.getImageData(0,0,64,48).data),initial,after,restored}
  }
  const generated=[]
  for(let n=0;n<16;n++){
    await progress('generated:'+n)
    const native=factory({width:64,height:48}),ctx=native.getContext('2d'),p=page()
    const html=`<canvas id="c" width="64" height="48"></canvas><button id="next">next</button><p id="out"></p><script>const runCase=${runCase};let n=${n};const c=document.getElementById('c'),ctx=c.getContext('2d');function run(){try{window.readResult=runCase(ctx,n);document.getElementById('out').textContent=String(window.readResult.pixels[0]);window.png=c.toDataURL()}catch(e){window.readError=e.message}window.ready=true}run();document.getElementById('next').onclick=()=>{n++;run()}</script>`
    try{
      const expected=runCase(ctx,n);await progress('page:'+n);p.openSelectedFile({name:'canvas-reset.html',inlineHtml:html});await wait(()=>p._htmlRuntime?.window.ready);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const state=p._htmlRuntime.window,target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      const first={nativeInitial:expected.initial,readerInitial:state.readResult?.initial,nativeStyles:expected.after,readerStyles:state.readResult?.after,restoredStyles:state.readResult?.restored,nativeReadHash:await hash(Uint8Array.from(expected.pixels)),readerReadHash:state.readResult?await hash(Uint8Array.from(state.readResult.pixels)):null,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null}
      const nextExpected=runCase(ctx,n+1);p.onDomTap({currentTarget:{dataset:{nid:p._htmlRuntime.document.getElementById('next')._nid}}});p._htmlRuntime.flush();await p._lastCanvasPresentation
      generated.push({n,first,next:{nativeInitial:nextExpected.initial,readerInitial:state.readResult?.initial,nativeStyles:nextExpected.after,readerStyles:state.readResult?.after,restoredStyles:state.readResult?.restored,nativeReadHash:await hash(Uint8Array.from(nextExpected.pixels)),readerReadHash:state.readResult?await hash(Uint8Array.from(state.readResult.pixels)):null,error:state.readError||'',nativePixels:await hash(pixels(native)),visiblePixels:await hash(pixels(target)),exportedPixels:state.png?await exportedPixels(state.png):null},errors:p._runtimeErrors})
    }finally{p.onUnload()}
  }
  const publicResults=[]
  async function reference(url){const frame=document.createElement('iframe');frame.src=url;await new Promise(r=>{frame.onload=r;document.body.appendChild(frame)});return frame}
  for(const fixture of fixtures){
    await progress(fixture.name)
    const iframe=await reference('/original/'+fixture.name),p=page()
    try{p.openSelectedFile({name:fixture.name,inlineHtml:'<script>('+harnessSource+')()</script>'+fixture.source+'<script>window.fixtureReady=true</script>'});await wait(()=>p._htmlRuntime?.window.fixtureReady);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const c=p._htmlRuntime.document.querySelector('canvas'),target=p.canvases.get('#dom-canvas-'+c._nid)
      let expectedPixels=null
      if(fixture.name.includes('.clip.')){const expected=await reference('/expected');expectedPixels=await hash(pixels(expected.contentDocument.querySelector('canvas')));expected.remove()}
      publicResults.push({name:fixture.name,nativeTests:iframe.contentWindow.readTests||[],readerTests:p._htmlRuntime.window.readTests||[],nativePixels:await hash(pixels(iframe.contentDocument.querySelector('canvas'))),visiblePixels:await hash(pixels(target)),expectedPixels,errors:p._runtimeErrors})
    }finally{p.onUnload();iframe.remove()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({hostReset:fallback?'same-width':'native-reset',generated,publicResults})))
}
async function main(){
  fs.mkdirSync(out,{recursive:true});const code=bundle(['miniprogram/file-reader/engine/components/reader/reader.js'])
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/progress?')){console.log('progress',decodeURIComponent(req.url.slice(10)));res.end('ok');return}
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'")
    res.setHeader('Content-Type','text/html; charset=utf-8')
    if(req.url==='/expected'){res.end(expectedSource);return}
    if(req.url==='/bundle'){res.setHeader('Content-Type','text/javascript');res.end(code);return}
    if(req.url==='/resources/testharness.js'){res.setHeader('Content-Type','text/javascript');res.end('('+harness+')()');return}
    if(req.url==='/resources/testharnessreport.js'||req.url==='/html/canvas/resources/canvas-tests.js'){res.setHeader('Content-Type','text/javascript');res.end('');return}
    const fixture=fixtures.find(f=>req.url==='/original/'+f.name);if(fixture){res.end(fixture.source);return}
    if(req.url==='/'){res.end(`<!doctype html><output></output><script src="/bundle"></script><script>(${browserRun.toString().replace(/<\/script/gi,'<\\/script')})(${JSON.stringify(fixtures).replace(/</g,'\\u003c')},${JSON.stringify(harness.toString())},${fallback}).catch(e=>document.querySelector('output').setAttribute('data-error',e.stack||e.message))</script>`);return}
    res.statusCode=404;res.end()
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`);fs.writeFileSync(path.join(out,'browser-dom.html'),dom);const match=dom.match(/data-result="([^"]+)"/);assert.ok(match,(dom.match(/data-error="([^"]+)"/)||[])[1]);const result=JSON.parse(decodeURIComponent(match[1]));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2))
    const failures=[],styleDifferences=[];assert.equal(result.generated.length,16);assert.equal(result.publicResults.length,3)
    for(const row of result.generated)for(const phase of ['first','next']){const r=row[phase];try{assert.equal(r.error,'');assert.deepEqual(r.nativeStyles,r.nativeInitial);assert.deepEqual(r.readerStyles,r.readerInitial);assert.deepEqual(r.restoredStyles,r.readerInitial);const {direction:nativeDirection,...nativeStyles}=r.nativeStyles,{direction:readerDirection,...readerStyles}=r.readerStyles;assert.deepEqual(readerStyles,nativeStyles);assert.equal(readerDirection,'inherit');assert.ok(['inherit','ltr'].includes(nativeDirection));if(readerDirection!==nativeDirection)styleDifferences.push({n:row.n,phase,property:'direction',native:nativeDirection,reader:readerDirection,specification:'initial value inherit; Chromium getter resolves ltr on this host'});assert.equal(r.readerReadHash,r.nativeReadHash);assert.equal(r.visiblePixels,r.nativePixels);assert.equal(r.exportedPixels,r.nativePixels);assert.deepEqual(row.errors,[])}catch(e){failures.push({n:row.n,phase,message:e.message})}}
    for(const r of result.publicResults)try{assert.ok(r.nativeTests.every(t=>t.pass));assert.equal(r.nativeTests.length,r.name.includes('.clip.')?0:1);assert.deepEqual(r.readerTests,r.nativeTests);if(r.expectedPixels)assert.equal(r.visiblePixels,r.expectedPixels);assert.equal(r.visiblePixels,r.nativePixels);assert.deepEqual(r.errors,[])}catch(e){failures.push({name:r.name,message:e.message})}
    fs.writeFileSync(path.join(out,'style-differences.json'),JSON.stringify(styleDifferences,null,2));fs.writeFileSync(path.join(out,'failures.json'),JSON.stringify(failures,null,2));console.log(JSON.stringify({hostReset:result.hostReset,generatedFrames:32,publicFiles:3,knownDirectionGetterDifferences:styleDifferences.length,failures:failures.length,out}));assert.deepEqual(failures,[])
  }finally{server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
