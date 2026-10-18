'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const Matrix=require('../miniprogram/file-reader/shared/pdf-runtime/matrix')
const {readerPage}=require('./helpers/reader-host')
test('PDF route stays inline; stale ready cannot act on the next file',()=>{
 let opens=0;const reader=readerPage({openDocument(){opens++}})
 try{reader.openSelectedFile({name:'a.pdf',path:'/a.pdf'});const old=reader._fileOpenRevision;assert.equal(opens,0);assert.equal(reader.data.pdfSessions.length,1)
 reader.openSelectedFile({name:'b.gif',path:'/b.gif'});reader.onPdfReady({currentTarget:{dataset:{revision:old}}});assert.equal(opens,0);assert.equal(reader.data.pdfSessions.length,0);assert.equal(reader.data.isLoading,true)
 }finally{reader.detached()}
})
test('PDF affine transform and inverse preserve known points without browser DOMMatrix',()=>{
 const m=new Matrix().translate(10,20).scale(2,3),p=m.transformPoint({x:4,y:5});assert.deepEqual(p,{x:18,y:35});const back=m.inverse().transformPoint(p);assert.ok(Math.abs(back.x-4)<1e-10&&Math.abs(back.y-5)<1e-10);assert.deepEqual(new Matrix([2,0,0,3,10,20]),m)
 assert.deepEqual(new Matrix().scale(2).preMultiplySelf(new Matrix().translate(3,4)).transformPoint({x:1,y:1}),{x:5,y:6})
})
function host(){
 let definition;global.Component=x=>{definition=x};const module='../miniprogram/file-reader/pdf/components/pdf-view/pdf-view';delete require.cache[require.resolve(module)];require(module)
 const stats=[],reads=[],events=[]
 global.wx={getFileSystemManager:()=>({stat:o=>stats.push(o),readFile:o=>reads.push(o),unlink(){}})}
 const page={...definition.methods,_attached:true,data:{...definition.data},setData(x){Object.assign(this.data,x)},triggerEvent(name,data){events.push({name,data})}}
 return {page,stats,reads,events}
}
const flush=()=>new Promise(r=>setImmediate(r))
test('oversized or incomplete PDF fails visibly without automatic native popup',async()=>{
 const {page,stats,reads,events}=host();const p=page.open({path:'/big.pdf'});stats[0].success({stats:{size:26*1024*1024}});await p;assert.equal(reads.length,0);assert.equal(page.data.busy,false);assert.match(page.data.error,/25 MB/);assert.deepEqual(events.map(x=>x.name),['error'])
 const p2=page.open({path:'/short.pdf'});stats[1].success({stats:{size:10}});await flush();reads[0].success({data:new ArrayBuffer(4)});await p2;assert.equal(page.data.busy,false);assert.match(page._pdfDiagnostic,/读取不完整/);assert.equal(events.some(x=>x.name==='fallback'),false);page.dispose()
})
test('changing files or closing before stat completion prevents stale reads and UI updates',async()=>{
 const {page,stats,reads}=host();const first=page.open({path:'/old.pdf'}),second=page.open({path:'/new.pdf'});stats[0].success({stats:{size:100}});await first;assert.equal(reads.length,0);page.dispose();stats[1].fail({errMsg:'late'});await second;assert.equal(page.data.error,'')
})


test('PDF packages retain source-size headroom for WeChat compilation', () => {
 const fs=require('node:fs'),path=require('node:path')
 const size=dir=>fs.readdirSync(dir,{withFileTypes:true}).reduce((total,entry)=>total+(entry.isDirectory()?size(path.join(dir,entry.name)):fs.statSync(path.join(dir,entry.name)).size),0)
 assert.ok(size(path.join(__dirname,'../miniprogram/file-reader/pdf'))<1.5*1024*1024,'PDF subpackage must leave at least 0.5 MiB for compilation')
 assert.ok(size(path.join(__dirname,'../miniprogram/file-reader/shared/pdf-runtime'))<0.75*1024*1024,'main-package PDF dependencies must remain bounded')
})

test('PDF parses and builds a page on phone-like runtimes without modern built-ins or browser globals', () => {
 const {spawnSync}=require('node:child_process')
 const program = `
  const assert=require('node:assert/strict');
  Promise.withResolvers=undefined;Promise.try=undefined;Math.sumPrecise=undefined;Object.hasOwn=undefined;
  Array.prototype.at=undefined;Uint8Array.prototype.toHex=undefined;Uint8Array.prototype.toBase64=undefined;Uint8Array.fromBase64=undefined;
  global.TextDecoder=undefined;global.TextEncoder=undefined;global.Blob=undefined;global.DOMMatrix=undefined;global.Path2D=undefined;global.ImageData=undefined;
  global.wx={createOffscreenCanvas(){return {}}};
  const engine=require('./miniprogram/file-reader/pdf/index');
  const stream='0.2 0.6 0.1 rg 10 10 100 80 re f';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>','<< /Length '+stream.length+' >>\\nstream\\n'+stream+'\\nendstream'];
  let source='%PDF-1.4\\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(source.length);source+=(i+1)+' 0 obj\\n'+obj+'\\nendobj\\n'});
  const xref=source.length;source+='xref\\n0 5\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('')+'trailer\\n<< /Size 5 /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';
  (async()=>{const task=engine.open(new Uint8Array(Buffer.from(source)));const pdf=await task.promise;assert.equal(pdf.numPages,1);const page=await pdf.getPage(1);assert.equal(page.getViewport({scale:1}).width,200);const ops=await page.getOperatorList();assert.ok(ops.fnArray.length>=2);await task.destroy();console.log('phone-compat-ok')})().catch(e=>{console.error(e.message);process.exitCode=1});
 `
 const result=spawnSync(process.execPath,['-e',program],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8',timeout:20000})
 assert.equal(result.status,0,result.stderr.slice(-1500));assert.match(result.stdout,/phone-compat-ok/)
})

test('PDF waits for a late Canvas, stops after bounded retries and drops stale results',async()=>{
 const {page}=host();page._generation=1;let calls=0;const canvas={}
 page.createSelectorQuery=()=>{const q={select:()=>q,fields:()=>q,exec:cb=>{calls++;cb(calls<3?[]:[{node:canvas}])}};return q}
 assert.equal(await page.waitForCanvas(1),canvas);assert.equal(calls,3)
 calls=0;page.createSelectorQuery=()=>{const q={select:()=>q,fields:()=>q,exec:cb=>{calls++;cb([])}};return q}
 assert.equal(await page.waitForCanvas(1),null);assert.equal(calls,16)
 let complete;page.createSelectorQuery=()=>{const q={select:()=>q,fields:()=>q,exec:cb=>{complete=cb}};return q}
 const pending=page.waitForCanvas(1);page.dispose();complete([{node:canvas}]);assert.equal(await pending,null)
})

test('PDF export recovers with real PNG data when the host rejects hidden Canvas export',async()=>{
 const {page}=host();let saved
 global.wx.canvasToTempFilePath=options=>options.fail({errMsg:'hidden canvas export failed'})
 global.wx.env={USER_DATA_PATH:'/local'}
 global.wx.getFileSystemManager=()=>({writeFile(options){saved=options;options.success()}})
 const result=await page.exportPage({toDataURL:()=> 'data:image/png;base64,aW1hZ2U='})
 assert.equal(saved.encoding,'base64');assert.equal(saved.data,'aW1hZ2U=');assert.equal(result.tempFilePath,saved.filePath)
 await assert.rejects(page.exportPage({toDataURL:()=> 'data:,'}))
})

test('a rendered PDF remains visible in its Canvas if both image export paths are unavailable',async()=>{
 const {page,events}=host();page._generation=1;page._pageImages=new Set();let cleaned=false
 const canvas={width:0,height:0};page.waitForCanvas=async()=>canvas
 page.setData=function(data,done){Object.assign(this.data,data);if(done)done()}
 page.createSelectorQuery=()=>{const q={select:()=>q,boundingClientRect:()=>q,exec:cb=>cb([{width:320}])};return q}
 global.wx.getWindowInfo=()=>({windowWidth:320,pixelRatio:1})
 global.wx.canvasToTempFilePath=o=>o.fail({errMsg:'not supported'})
 page._engine={context:()=>({_pdfResetTransform(){}}),annotationMode:0}
 page._pdf={numPages:1,getPage:async()=>({getViewport:({scale})=>({width:200*scale,height:300*scale}),render:()=>({promise:Promise.resolve()}),cleanup(){cleaned=true}})}
 await page.render(1)
 assert.equal(page.data.error,'');assert.equal(page.data.busy,false);assert.equal(page.data.canvasFallback,true)
 assert.equal(canvas.width,320);assert.equal(canvas.height,480);assert.equal(cleaned,true)
 assert.equal(events.at(-1).name,'ready');assert.equal(page.data.imagePath,'')
})

test('empty compatibility page in a single-page Ai reports failure for saved-preview fallback before Canvas', async () => {
 const {page,events}=host();page._generation=1;page.properties={file:{name:'logos.ai'}}
 page._engine={hasPaint:()=>false}
 page._pdf={numPages:1,getPage:async()=>({getOperatorList:async()=>({fnArray:[12,9]})})}
 await page.render(1)
 assert.match(page.data.error,/文件没有可显示/);assert.equal(events.at(-1).name,'error');assert.equal(page.data.busy,false)
 assert.equal(page._canvas,undefined)
})
test('generic document errors never relabel an Ai file as PDF', () => {
 const {page}=host();page._generation=1;page.fail(new Error('internal PDF failure'),1)
 assert.doesNotMatch(page.data.error,/PDF/);assert.match(page.data.error,/提交反馈/)
 assert.match(page._pdfDiagnostic,/internal PDF failure/)
})

test('native Canvas contexts without a browser canvas backlink expose the actual resized owner',()=>{
 const {context}=require('../miniprogram/file-reader/shared/pdf-runtime/canvas')
 const ctx={setTransform(){},save(){},restore(){},transform(){},translate(){},scale(){},rotate(){},fill(){},stroke(){},clip(){}}
 const canvas={width:320,height:480,getContext:()=>ctx}
 assert.equal(ctx.canvas,undefined)
 const wrapped=context(canvas);assert.equal(wrapped.canvas,canvas);canvas.width=640;assert.equal(wrapped.canvas.width,640)
 wrapped.translate(10,20);wrapped.save();wrapped.scale(2,3);wrapped.restore();assert.deepEqual(wrapped.getTransform().transformPoint({x:1,y:2}),{x:11,y:22})
 assert.equal(context(canvas),wrapped)
})
