'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict')
const {bundle}=require('./verify-inline-poster'),{chromeTestResult}=require('./chrome-test-result')
const {harness}=require('../tests/helpers/image-public-harness'),{png}=require('../tests/helpers/inline-poster')
const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-image-decode-'))
const fixtures=['data-url.html','image-constructor.html','image-decode.html'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../tests/fixtures/image-data',name),'utf8')}))
async function browserRun(fixtures,image,harnessSource,modes){
  const {createRuntime}=readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
  const wait=async fn=>{for(let n=0;n<160;n++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('image test timed out')}
  const factory=config=>{const c=document.createElement('canvas');c.width=config.width;c.height=config.height;c.createImage=()=>new Image();Object.defineProperty(c,'toDataURL',{value:undefined});return c}
  let frame=document.querySelector('iframe')
  const publicResults=[],generated=[]
  for(const fixture of fixtures){
    document.querySelector('output').setAttribute('data-progress','public:'+fixture.name)
    await new Promise(resolve=>{frame.onload=resolve;frame.src='/original/'+fixture.name})
    const native=frame.contentWindow
    await wait(()=>native.imagePending===0&&native.imageTests?.length>0)
    const runtime=createRuntime('<script>('+harnessSource+')()</script>'+fixture.source,{createOffscreenCanvas:factory})
    try{
      runtime.run();await wait(()=>runtime.window.imagePending===0&&runtime.window.imageTests?.length>0)
      publicResults.push({name:fixture.name,native:JSON.parse(JSON.stringify(native.imageTests)),reader:JSON.parse(JSON.stringify(runtime.window.imageTests)),errors:runtime.errors})
    }finally{runtime.destroy()}
  }
  for(const mode of modes){
    frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin allow-scripts')
    document.querySelector('output').setAttribute('data-progress','generated:'+mode+':load')
    const make=`${mode==='markup'?`<img id="asset" src="${image}">`:'<div id="holder"></div>'}<script>window.ready=false;window.output='';async function run(){let i;${mode==='new'?'i=new Image(40,50)':mode==='create'?'i=document.createElement("img")':mode==='markup'?'i=document.getElementById("asset")':mode==='innerHTML'?`document.getElementById('holder').innerHTML='<img id="asset">';i=document.getElementById('asset')`:'const other=document.createElement("img");i=other.cloneNode()'};i.src=${JSON.stringify(image)};await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);window.output=c.toDataURL('image/png');window.info={width:i.naturalWidth,height:i.naturalHeight,complete:i.complete,src:i.src===${JSON.stringify(image)}};window.ready=true}run().catch(e=>window.output=e.message)</script>`
    frame.srcdoc=make;document.body.appendChild(frame)
    document.querySelector('output').setAttribute('data-progress','generated:'+mode+':native');await wait(()=>frame.contentWindow.ready)
    const runtime=createRuntime(make,{createOffscreenCanvas:factory})
    try{
      runtime.run();document.querySelector('output').setAttribute('data-progress','generated:'+mode+':reader');await wait(()=>runtime.window.ready)
      const hash=async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data)),b=>b.toString(16).padStart(2,'0')).join('')}
      document.querySelector('output').setAttribute('data-progress','generated:'+mode+':pixels')
      generated.push({mode,native:frame.contentWindow.info,reader:runtime.window.info,nativePixels:await hash(frame.contentWindow.output),readerPixels:await hash(runtime.window.output),errors:runtime.errors})
    }finally{runtime.destroy();frame.remove()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({publicResults,generated})))
}
async function main(){
  fs.mkdirSync(out,{recursive:true});const script=bundle()
  const runs=['public','new','create','markup','innerHTML','clone']
  const runner=mode=>`<!doctype html><output></output><iframe sandbox="allow-same-origin allow-scripts"></iframe><script src="/bundle"></script><script>(${browserRun.toString().replace(/<\/script/gi,'<\\/script')})(${JSON.stringify(mode==='public'?fixtures:[]).replace(/</g,'\\u003c')},${JSON.stringify(png())},${JSON.stringify(harness.toString())},${JSON.stringify(mode==='public'?[]:[mode])}).catch(e=>document.querySelector('output').setAttribute('data-error',e.message))</script>`
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src 'self'; connect-src 'self'")
    res.setHeader('Content-Type',req.url==='/bundle'?'text/javascript':'text/html; charset=utf-8')
    if(req.url==='/runner-error'){res.end('<output data-error="expected fixture failure"></output>');return}
    if(req.url==='/runner-hang'){res.end('<output data-progress="expected never-ready fixture"></output>');return}
    if(runs.includes(req.url.slice(1))){res.end(runner(req.url.slice(1)));return}if(req.url==='/bundle'){res.end(script);return}
    const fixture=fixtures.find(f=>req.url==='/original/'+f.name)
    if(fixture){res.end('<script>('+harness.toString()+')()</script>'+fixture.source);return}
    res.statusCode=404;res.end()
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{
    const root=`http://127.0.0.1:${server.address().port}`
    await assert.rejects(chromeTestResult('https://example.invalid'),/Only isolated loopback/)
    const failed=await chromeTestResult(root+'/runner-error')
    assert.ok(failed.includes('data-error="expected fixture failure"'));assert.ok(!failed.includes('data-result='))
    await assert.rejects(chromeTestResult(root+'/runner-hang',{timeoutMs:10000}),error=>/result timed out/.test(error.message)&&error.dom.includes('expected never-ready fixture'))
    const result={publicResults:[],generated:[]}
    for(const mode of runs){
      let stdout
      try{stdout=await chromeTestResult(`http://127.0.0.1:${server.address().port}/${mode}`)}catch(error){if(error.dom)fs.writeFileSync(path.join(out,mode+'-dom.html'),error.dom);throw error}
      fs.writeFileSync(path.join(out,mode+'-dom.html'),stdout)
      const encoded=stdout.match(/data-result="([^"]+)"/);assert.ok(encoded,'Chrome missing '+mode+': '+(stdout.match(/data-error="([^"]+)"/)||[])[1]+' / '+(stdout.match(/data-progress="([^"]+)"/)||[])[1])
      const current=JSON.parse(decodeURIComponent(encoded[1]));result.publicResults.push(...current.publicResults);result.generated.push(...current.generated)
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
    assert.equal(result.generated.length,5)
    for(const g of result.generated){assert.deepEqual(g.reader,g.native,g.mode);assert.equal(g.readerPixels,g.nativePixels,g.mode);assert.deepEqual(g.errors,[])}
    const byName=rows=>rows.slice().sort((a,b)=>a.name.localeCompare(b.name))
    for(const p of result.publicResults){assert.ok(p.native.every(t=>t.pass));assert.deepEqual(p.errors,[]);if(p.name!=='image-constructor.html')assert.deepEqual(byName(p.reader),byName(p.native),p.name)}
    // Preserve constructor's complete results including any sandbox realm gap;
    // require the four actual construction/prototype/tag/namespace cases.
    const constructors=result.publicResults.find(p=>p.name==='image-constructor.html')
    assert.equal(constructors.reader.length,5);assert.ok(constructors.reader.slice(0,4).every(t=>t.pass))
    if(!constructors.reader[4].pass)assert.equal(constructors.reader[4].error,"Image's prototype is Function.prototype",'unknown failure must not hide behind the known realm gap')
  }finally{server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
