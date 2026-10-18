'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {readerPage}=require('./helpers/reader-host')
require('../miniprogram/file-reader/engine/core/families').warmSync(['office'])
const office=require('../miniprogram/file-reader/office').attach(require('../miniprogram/file-reader/engine/core/kernel-exports'))
const XLSX=require('../miniprogram/file-reader/office/vendor/xlsx')
const {resolveLocalSvgReferences}=require('../miniprogram/file-reader/document/local-svg-references')
const {PDFPath,context}=require('../miniprogram/file-reader/shared/pdf-runtime/canvas')
const Matrix=require('../miniprogram/file-reader/shared/pdf-runtime/matrix')
const svg='<svg width="200" height="100" viewBox="0 0 200 100"><style>@keyframes ride{to{transform:translateX(80px)}}.bike{animation:ride 1s infinite}g > rect{stroke:red}</style><rect class="bike" width="40" height="30" fill="red"/></svg>'
const flatten=a=>a.flatMap(n=>[n,...flatten(n.children||[])])
test('963-row workbook stays bounded and every row is reachable, with wide columns and cross-page merges',()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(Array.from({length:963},(_,r)=>Array.from({length:12},(_,c)=>`R${r+1}C${c+1}`)))
 sheet['!merges']=[{s:{r:24,c:0},e:{r:26,c:1}}];XLSX.utils.book_append_sheet(book,sheet,'全部汇总');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['另一张表']]),'第二表')
 const reopened=office.openSpreadsheet(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));let count=0
 for(let i=0;i<39;i++){const page=office.spreadsheetPage(reopened,0,i);assert.equal(page.pageCount,39);assert.ok(Buffer.byteLength(page.html)<80000);assert.match(page.html,/width:1920px/);count+=(page.html.match(/<tr>/g)||[]).length;assert.match(page.html,new RegExp(`R${i*25+1}C12`))}
 assert.equal(count,963);assert.match(office.spreadsheetPage(reopened,0,1).html,/rowspan="2" colspan="2"/);assert.match(office.spreadsheetPage(reopened,0,1).html,/R25C1/);assert.match(office.spreadsheetPage(reopened,1,0).html,/另一张表/)
 const reader=readerPage();try{reader._spreadsheetBook=reopened;reader.showSpreadsheetPage(0,0);reader.nextSpreadsheetPage();assert.equal(reader.data.spreadsheet.pageIndex,1);reader.openSelectedFile({name:'next.html',inlineHtml:'<p>下一份正常</p>'});assert.equal(reader.data.spreadsheet,null);assert.equal(reader._spreadsheetBook,null);assert.equal(reader.data.error,'')}finally{reader.detached()}
})
test('HTML SVG animation reaches Canvas with keyframes; Canvas failure falls back without affecting the next file',()=>{
 const r=readerPage();try{r.openSelectedFile({name:'bike.html',inlineHtml:svg});const n=flatten(r.data.domTree).find(n=>n.svgCanvasSource);assert.ok(n);assert.match(n.svgCanvasSource,/@keyframes ride/);assert.match(n.svgCanvasSource,/g > rect/);const old={currentTarget:{dataset:{nid:n.nid,mediaToken:n.mediaToken}}};r.onDomSvgError(old);assert.ok(!flatten(r.data.domTree).find(x=>x.nid===n.nid).svgCanvasSource);r.openSelectedFile({name:'next.html',inlineHtml:'<h1>OK</h1>'});r.onDomSvgError(old);assert.equal(r.data.error,'');assert.match(r._htmlRuntime.document.body.textContent,/OK/)}finally{r.detached()}
})
test('local SVG references use selected sibling bytes and remove active SVG script',async()=>{
 const reads=[],fs={stat:o=>o.success({stats:{size:svg.length}}),readFile:o=>{reads.push(o.filePath);o.success({data:svg.replace('</svg>','<script>evil()</script></svg>')})}}
 for(const tag of ['<object data="bike.svg"></object>','<img src="./bike.svg">','<embed src="bike.svg">']){const html=await resolveLocalSvgReferences(tag+'<p>caption</p>',[{name:'bike.svg',path:'/selected.svg'}],fs);assert.match(html,/<img[^>]*src="data:image\/svg\+xml;base64,/);assert.match(html,/caption/);assert.doesNotMatch(html,/evil/)}
 assert.deepEqual(reads,['/selected.svg','/selected.svg','/selected.svg'])
 const missing=await resolveLocalSvgReferences('<img src="bike.svg">',[],fs);assert.match(missing,/一起选择/)
 for(const ref of ['../bike.svg','https://host/bike.svg','/bike.svg'])assert.equal(resolveLocalSvgReferences('<img src="'+ref+'">',[],fs),null)
 assert.equal(resolveLocalSvgReferences('<script>const x=\'<img src="bike.svg">\'</script>',[],fs),null)
})
test('local SVG completion is discarded after file switch',async()=>{
 let stat,current=true;const pending=resolveLocalSvgReferences('<object data="bike.svg"></object>',[{name:'bike.svg',path:'/selected.svg'}],{stat:o=>{stat=o},readFile(){throw Error('must not read stale resource')}},()=>current);current=false;stat.success({stats:{size:100}});assert.equal(await pending,null)
})
test('PDF paths replay transformed curves and clip rules without native Path2D or getTransform',()=>{
 const calls=[],ctx={};for(const name of ['save','restore','transform','translate','scale','rotate','setTransform','beginPath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','closePath','fill','stroke','clip'])ctx[name]=(...args)=>calls.push([name,...args])
 context({getContext:()=>ctx});ctx.translate(10,20);ctx.save();ctx.scale(2,3);assert.deepEqual(ctx.getTransform().transformPoint({x:1,y:1}),{x:12,y:23});ctx.restore();assert.deepEqual(ctx.getTransform().transformPoint({x:1,y:1}),{x:11,y:21})
 const p=new PDFPath();p.rect(0,0,10,10);const q=new PDFPath();q.addPath(p,new Matrix().translate(3,4));ctx.clip(q,'evenodd');assert.ok(calls.some(c=>c[0]==='moveTo'&&c[1]===3&&c[2]===4));assert.deepEqual(calls.at(-1),['clip','evenodd']);ctx._pdfResetTransform();assert.deepEqual(ctx.getTransform(),new Matrix())
})

test('selected SVG keeps its CSS and duplicate IDs isolated from the HTML page',async()=>{
 const raw=svg.replace('<style>','<style>body,p{display:none}#shared{fill:red}').replace('class="bike"','id="shared" class="bike"')
 const fs={stat:o=>o.success({stats:{size:raw.length}}),readFile:o=>o.success({data:raw})}
 const html=await resolveLocalSvgReferences('<p id="shared">保留正文</p><object data="bike.svg" width="200"></object><img src="bike.svg">',[{name:'bike.svg',path:'/selected.svg'}],fs)
 assert.doesNotMatch(html,/<style|body,p/);assert.match(html,/width="200"/)
 const r=readerPage();try{r.openSelectedFile({name:'isolated.html',inlineHtml:html});const nodes=flatten(r.data.domTree);assert.ok(nodes.some(n=>n.text==='保留正文'));const images=nodes.filter(n=>n.svgCanvasSource);assert.equal(images.length,2);assert.match(images[0].svgCanvasSource,/@keyframes/);assert.doesNotMatch(images[0].svgCanvasSource,/<script/)}finally{r.detached()}
})
