'use strict'
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {readerPage}=require('../tests/helpers/reader-host')
const {chromeTestResult}=require('./chrome-test-result')
const {referenceSvg,browserRun}=require('./verify-dxf-insert-grid')
const {compare,svgLines}=require('./probe-dxf-insert-grid')
const {drawing}=require('./probe-dxf-traversal-adversarial')
const originals=require('../tests/fixtures/dxf-grid-traversal/before.json').rows
const out=path.resolve(process.argv[2]||'outputs/dxf-grid-traversal/content')
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const reads=[],host=readerPage({getFileSystemManager:()=>({readFile:o=>reads.push(o)})}),sources=[],report={host:[],lifecycle:{},limits:['Node host definitions and mocked wx file API; actual host-returned SVG in Chrome. No WeChat/device verification.','1200 preview primitives and 24000 record/cell work budget produce visible truncation metadata. Cycles and depth above64 clearly fail. OCS remains separate.']}
 const open=async(name,bytes)=>{host.openSelectedFile({name:name+'.dxf',path:'/fixture/'+name+'.dxf',size:bytes.length});await reads.shift().success({data:bytes});await new Promise(setImmediate);return host.data.inspectorPreviewSource?Buffer.from(host.data.inspectorPreviewSource.split(',')[1],'base64').toString():''}
 try{
  for(const row of originals){
   const bytes=Buffer.from(row.base64,'base64');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256)
   if(row.name==='depth65'){await open(row.name,bytes);assert.match(host.data.error,/64 层/);assert.equal(host.data.inspectorPreviewSource,'');continue}
   const svg=await open(row.name,bytes);assert.equal(host.data.error,'');assert.equal(host.data.hasContent,true);assert.equal(compare(svgLines(svg),row.nativeLines.slice(0,1200)).allExact,true,row.name);assert.equal(await open(row.name,bytes),svg)
   const ref=referenceSvg(row.nativeLines.slice(0,1200));fs.writeFileSync(path.join(out,row.name+'.svg'),svg);fs.writeFileSync(path.join(out,row.name+'-native.svg'),ref)
   const before=path.resolve('outputs/dxf-grid-traversal/before',row.name+'.svg')
   sources.push({name:row.name,svg,reference:ref,before:fs.existsSync(before)?fs.readFileSync(before,'utf8'):'',compareBefore:['grid21x21','zero-both'].includes(row.name)})
   report.host.push({name:row.name,opens:2,lines:row.nativeLines.slice(0,1200).length,sha256:row.sha256})
  }
  for(const name of ['cycle','empty-tree','unsupported-tree','huge','empty-huge']){
   await open(name,drawing(name))
   if(name==='cycle'){assert.match(host.data.error,/循环/);assert.equal(host.data.hasContent,false);assert.equal(host.data.inspectorPreviewSource,'')}
   else assert.equal(host.data.error,'')
   const recovered=await open(originals[0].name,Buffer.from(originals[0].base64,'base64'));assert.equal(host.data.error,'');assert.equal(compare(svgLines(recovered),originals[0].nativeLines).allExact,true)
  }
  report.lifecycle.errorAndBudgetRecovery=true
  host.openSelectedFile({name:'stale.dxf',path:'/stale.dxf'});const stale=reads.shift();const latest=await open(originals[0].name,Buffer.from(originals[0].base64,'base64'));await stale.success({data:drawing('cycle')});assert.equal(host.data.error,'');assert.equal(Buffer.from(host.data.inspectorPreviewSource.split(',')[1],'base64').toString(),latest);report.lifecycle.staleErrorIgnored=true
  host.openSelectedFile({name:'detached.dxf',path:'/detached.dxf'});const detached=reads.shift();host.detached();const count=host.patches.length;await detached.success({data:drawing('huge')});assert.equal(host.patches.length,count);report.lifecycle.detachedIgnored=true
 }finally{host.detached()}
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<output></output><script>('+browserRun.toString()+')('+JSON.stringify(sources).replace(/</g,'\\u003c')+').catch(e=>document.querySelector("output").setAttribute("data-error",e.message))</script>')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const html=await chromeTestResult('http://127.0.0.1:'+server.address().port);fs.writeFileSync(path.join(out,'chrome.html'),html);const match=html.match(/data-result="([^"]+)"/);assert.ok(match,html.slice(-1500));const rendered=JSON.parse(decodeURIComponent(match[1]));report.chrome=rendered.rows
  for(const sheet of rendered.sheets)fs.writeFileSync(path.join(out,sheet.name+'-comparison.png'),Buffer.from(sheet.png,'base64'))
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
  for(const row of rendered.rows)for(const view of row.views){assert.equal(view.exact,true,row.name+':'+view.width);assert.ok(view.actualInkPixels>0,row.name)}
  console.log(JSON.stringify({actualHostOriginals:report.host.length,hostOriginalOpens:report.host.length*2,nativePixelViews:rendered.rows.length*2,lifecycle:report.lifecycle}))
 }finally{server.close()}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
