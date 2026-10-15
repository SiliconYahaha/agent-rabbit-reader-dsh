'use strict'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const {testMaterialRoot}=require('./local-test-materials')
const dir=path.resolve(process.argv[2] === '--one' ? testMaterialRoot() : (process.argv[2] || testMaterialRoot())),out=path.resolve('outputs/hard-html')
fs.mkdirSync(out,{recursive:true})
if(process.argv[2]==='--one'){
 const file=process.argv[3],html=fs.readFileSync(file,'utf8'),{createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
 const start=Date.now(),r=createRuntime(html,{viewportWidth:390,viewportHeight:844});r.run()
 const targets=()=>r.document.querySelectorAll('button,[data-action]').slice(0,16).map(n=>({id:n.id,action:n.getAttribute('data-action'),text:n.textContent.slice(0,70),nid:n._nid,disabled:n.disabled}))
 function snapshot(){return {elapsedMs:Date.now()-start,errors:r.errors.map(e=>({phase:e.phase,message:e.message,stack:e.stack.slice(0,1500)})),nodes:r.document.querySelectorAll('*').length,svg:r.document.querySelectorAll('svg').length,canvas:r.document.querySelectorAll('canvas').length,loadText:r.document.getElementById('loadText')?.textContent,targets:targets()}}
 console.log(JSON.stringify({stage:'initial',...snapshot()}))
 setTimeout(()=>{console.log(JSON.stringify({stage:'settled',...snapshot()}));r.destroy()},600)
}else{
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.html'))){
  const r=spawnSync(process.execPath,[__filename,'--one',path.join(dir,name)],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024})
  fs.writeFileSync(path.join(out,name+'.probe.jsonl'),r.stdout||'');console.log(JSON.stringify({name,status:r.status,signal:r.signal,error:r.error&&r.error.message,stderr:(r.stderr||'').slice(-1000),stdout:(r.stdout||'').slice(0,11000)}))
 }
}
