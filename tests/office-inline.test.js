'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {zipSync,strToU8}=require('fflate')
const office=require('../miniprogram/file-reader/office').attach(require('../miniprogram/file-reader/engine/core/kernel-exports'))
const XLSX=require('../miniprogram/file-reader/office/vendor/xlsx')
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/office',name))
for(const [name,expected] of [['word-table.docx',/<table>/],['word-picture.docx',/data:image\/png;base64/],['word-legacy.doc',/formula H/],['slides.ppt',/This is the title on page 2/],['slides.pptx',/Arial Black/]])test('public real file has visible inline content: '+name,async()=>{const html=await office.render(fixture(name),name.split('.').pop());assert.match(html,expected);assert.doesNotMatch(html,/<script|javascript:|onerror=/i)})
for(const ext of ['xls','xlsx','xlsm'])test('actual '+ext+' workbook: Chinese, merged cells, multiple sheets, cached formula result',async()=>{
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([['工作报告',''],['收入',125.5],['公式',250]]);ws.B3.f='B2*2';ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:1}}];XLSX.utils.book_append_sheet(wb,ws,'统计');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['另一张表','<script>danger</script>']]),'清单')
 const bytes=XLSX.write(wb,{type:'buffer',bookType:ext}),html=await office.render(bytes,ext);assert.match(html,/工作报告/);assert.match(html,/colspan="2"/);assert.match(html,/125.5/);assert.match(html,/250/);assert.match(html,/清单/);assert.doesNotMatch(html,/<script/);assert.match(html,/&lt;script&gt;/)
})
test('ZIP expansion, entity declarations and duplicate members are rejected before Office decoder',async()=>{
 const zip=zipSync({'word/document.xml':strToU8('<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>')});await assert.rejects(office.render(zip,'docx'),/实体/)
 const bad=Buffer.from(fixture('word-table.docx'));for(let p=0;p<bad.length-24;p++)if(bad.readUInt32LE(p)===0x02014b50){bad.writeUInt32LE(100*1024*1024,p+24);break}await assert.rejects(office.render(bad,'docx'))
})
test('Office HTML cannot activate links, scripts, external images or hidden runs',()=>{const html=office.safeHtml('<p>Hello<span style="display:none">SECRET</span><a href="javascript:alert(1)">Link</a><img src="https://host/private" onerror="x"/><script>evil()</script></p>');assert.match(html,/Hello/);assert.match(html,/Link/);assert.doesNotMatch(html,/SECRET|javascript|https:|evil|onerror/)})
test('invalid files fail in place, rather than returning type information as content',async()=>{for(const ext of ['doc','docx','docm','ppt','pptx','xls','xlsx','xlsm']){await assert.rejects(office.render(Buffer.from([0,1,2,3,4]),ext),undefined,ext)}})
test('reader has no external document or image viewer escape routes',()=>{
 const root=path.join(__dirname,'../miniprogram/file-reader/engine/components')
 for(const f of ['reader/reader.js','design-preview/design-preview.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,f),'utf8'),/wx\.(openDocument|previewImage|previewMedia)\s*\(/)
 const wxml=fs.readFileSync(path.join(root,'reader/reader.wxml'),'utf8');assert.match(wxml,/preview-img="\{\{false\}\}"/);assert.doesNotMatch(wxml,/使用微信查看文档/)
})
test('PPTX displays embedded picture but ignores external picture targets',async()=>{
 const {unzipSync,strFromU8}=require('fflate'),parts=unzipSync(fixture('slides.pptx'))
 const slide='ppt/slides/slide1.xml',rels='ppt/slides/_rels/slide1.xml.rels'
 const picture=id=>'<p:pic><p:nvPicPr><p:cNvPr id="99" name="picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="'+id+'"/></p:blipFill></p:pic>'
 parts[slide]=strToU8(strFromU8(parts[slide]).replace('</p:spTree>',picture('rabbitPic')+picture('remotePic')+'</p:spTree>'))
 const relations=parts[rels]?strFromU8(parts[rels]):'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
 parts[rels]=strToU8(relations.replace('</Relationships>','<Relationship Id="rabbitPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/test.png"/><Relationship Id="remotePic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/private.png" TargetMode="External"/></Relationships>'))
 parts['ppt/media/test.png']=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')
 const html=await office.render(zipSync(parts),'pptx');assert.match(html,/data:image\/png;base64/);assert.doesNotMatch(html,/example.invalid/)
})
test('legacy DOC preserves paragraph/list/table structure and hides hidden runs',async()=>{const html=await office.render(fixture('word-legacy.doc'),'doc');assert.match(html,/<table>/);assert.match(html,/1\. /);assert.match(html,/<sup>/);assert.doesNotMatch(html,/>hidden<\/span>/)})
