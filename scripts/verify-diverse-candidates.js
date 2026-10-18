'use strict'
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {bundle}=require('./verify-inline-poster'),{chromeTestResult}=require('./chrome-test-result')
const base=process.argv[2]||path.join(__dirname,'../test-materials/files/web-candidates/bubbbly-diverse'),out=path.join(__dirname,'../outputs/koi-compatibility')
const names=['retro-calculator','flower-life','gameboy'],sources=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(base,name+'.html'),'utf8').replace(/<script[^>]*src="https:\/\/www.googletagmanager.com[^>]*><\/script>/g,'').replace(/<script>\s*window.dataLayer[\s\S]*?<\/script>/g,'')]))
async function run(){
 const {createRuntime}=readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js'),rows=[],sources=await(await fetch('/sources')).json(),pause=ms=>new Promise(r=>setTimeout(r,ms))
 for(const [name,html]of Object.entries(sources)){
  if(typeof createRuntime!=='function')throw Error('runtime exports: '+JSON.stringify(window.__errors)+' '+Object.keys(readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')).join(','));
  const r=createRuntime(html,{directCanvasFrames:true,viewportWidth:390,viewportHeight:844,createAudioContext:()=>new AudioContext(),resolveImageSource:src=>src.startsWith('data:')?src:'',createOffscreenCanvas:cfg=>{const c=document.createElement('canvas');c.width=cfg.width;c.height=cfg.height;c.createImage=()=>new Image();return c}})
  const row={name,environment:'Chrome native Canvas + reader sandbox; remote assets blocked'}
  try{r.run();await pause(100);const d=r.document
   if(name==='retro-calculator'){
    for(const key of ['1','+','2','=']){const button=d.querySelectorAll('button').find(b=>b.getAttribute('onclick')===`handleClick('${key}')`);if(!button)throw Error('No calculator key '+key);r.dispatchTap(button._nid)}
    await pause(3200);row.display=d.getElementById('display-text').textContent;row.pass=row.display==='3'
   }else if(name==='flower-life'){
    r.dispatchTap(d.querySelector('[data-season="summer"]')._nid);r.dispatchTap(d.querySelector('[data-flower="magnolia"]')._nid);r.dispatchEvent(d.getElementById('scrub')._nid,'keydown',{key:'End'});r.flush(true)
    row.season=d.body.dataset.season;row.flower=d.getElementById('brandName').textContent;row.caption=d.getElementById('caption').textContent;row.progress=d.getElementById('scrub').getAttribute('aria-valuenow');row.pass=row.season==='summer'&&row.flower==='Magnolia'&&Number(row.progress)>90
   }else{
    r.dispatchEvent(d.getElementById('btnStart')._nid,'touchstart',{touches:[{identifier:1,clientX:0,clientY:0}],changedTouches:[{identifier:1,clientX:0,clientY:0}]});await pause(100);r.dispatchEvent(d.getElementById('btnStart')._nid,'touchend',{touches:[],changedTouches:[{identifier:1,clientX:0,clientY:0}]});row.pass=true
   }
   row.canvases=[]
   for(const c of d.querySelectorAll('canvas')){const n=r.nativeCanvas(c._nid);if(!n)continue;const size={width:n.width,height:n.height};if(n.width&&n.height){const data=n.getContext('2d').getImageData(0,0,n.width,n.height).data,colors=new Set();for(let i=0;i<data.length&&colors.size<1000;i+=4)colors.add(data[i]+','+data[i+1]+','+data[i+2]);size.colors=colors.size;if(colors.size<3)row.pass=false}else row.pass=false;row.canvases.push(size)}
   row.errors=r.errors.map(e=>({phase:e.phase,message:e.message}));if(row.errors.length)row.pass=false
  }catch(e){row.pass=false;row.failure=e.message;row.errors=r.errors.map(e=>({phase:e.phase,message:e.message}))}finally{r.destroy()}
  rows.push(row)
 }
 document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify(rows)))
}
const code=bundle(),server=http.createServer((q,r)=>{if(q.url==='/bundle'){r.setHeader('Content-Type','text/javascript; charset=utf-8');r.end(code)}else if(q.url==='/sources'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(sources))}else{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(`<output></output><script>window.__errors=[];window.onerror=(...args)=>__errors.push(args.slice(0,4))</script><script src="/bundle"></script><script>(${run})().catch(e=>document.querySelector('output').setAttribute('data-error',e.stack))</script>`)}})
;(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const dom=await chromeTestResult('http://127.0.0.1:'+server.address().port);const m=dom.match(/data-result="([^"]+)"/);if(!m)throw Error(dom.match(/data-error="([^"]+)"/)?.[1]||'No result');const rows=JSON.parse(decodeURIComponent(m[1]));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'diverse.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2))}finally{server.close()}})().catch(e=>{console.error(e);process.exitCode=1})
