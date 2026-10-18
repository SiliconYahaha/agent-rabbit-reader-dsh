'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {readerPage,flush}=require('./helpers/reader-host')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const {sniffMaterial}=require('../miniprogram/file-reader/engine/core/sniff-material')
const flat=nodes=>nodes.flatMap(n=>[n,...flat(n.children||[])])
test('浅色引用块中的近白字恢复可读，正常品牌色保持',()=>{
 const r=renderHtmlDomTree('<body style="color:#e5e7eb;background:#111827"><blockquote id="q" style="background:#f5f3ff">文字<span>子文字</span></blockquote><p id="brand" style="background:white;color:#f66">品牌</p></body>')
 const n=flat(r.nodes),quote=n.find(n=>n.attrs?.id==='q'),brand=n.find(n=>n.attrs?.id==='brand')
 assert.match(quote.attrs.style,/color:#6f7072/);assert.match(brand.attrs.style,/color:#f66/)
})
test('SVG 小图标保留显式尺寸和父级 currentColor，不能撑满屏',()=>{
 const r=renderHtmlDomTree('<body style="color:#eee;background:#111"><button style="color:#0ff"><svg id="icon" width="24" height="24" viewBox="0 0 24 24"><path stroke="currentColor" d="M2 2 L20 20"/></svg></button></body>')
 const icon=flat(r.nodes).find(n=>n.attrs?.id==='icon');assert.match(icon.attrs.style,/width:24px/);assert.match(icon.attrs.style,/height:24px/);assert.equal(icon.imageMode,'aspectFit');assert.match(decodeURIComponent(icon.attrs.src),/color:#0ff/)
})
for(const [label,source,expected] of [
 ['HTML','<!doctype html><p>Hello</p>','text/html'],['SVG','<svg viewBox="0 0 20 20"></svg>','image/svg+xml'],['MD','# 标题\n\n- [x] 任务','text/markdown'],['TXT','普通文本','text/plain'],['JSON','{"a":1}','application/json'],['PDF','%PDF-1.7','application/pdf'],['binary',Buffer.from([0,1,2,3]),''],['UTF16',Buffer.concat([Buffer.from([255,254]),Buffer.from('# 标题','utf16le')]),'text/markdown']]){
 test('无后缀自动识别 '+label,()=>assert.equal(sniffMaterial(Buffer.isBuffer(source)?source:Buffer.from(source)),expected))
}
test('未知文件读取迟到不能覆盖新文件；混合队列图片不弹出',async()=>{
 let pending,popups=0;const p=readerPage({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:5}}),readFile:o=>{pending=o}}),previewImage:()=>popups++})
 try{p.openSelectedFile({name:'opaque',path:'/tmp/a'});p.openSelectedFile({name:'photo.png',path:'/tmp/b'});pending.success({data:Buffer.from('# old')});await flush();assert.equal(p.data.imagePath,'/tmp/b');assert.equal(p.data.sourceName,'photo.png');assert.equal(popups,0)}finally{p.host.onUnload();p.detached()}
})

test('font 简写的前导小数不会放大十倍，字体和行高按原值继承',async()=>{
 const p=readerPage()
 try{
  p.openSelectedFile({name:'font.html',inlineHtml:'<body style="font-size:20px"><p id="a" style="font:italic bold .8em/1.5 sans-serif">正文</p><p id="b" style="font:.6em serif">注释</p><script>window.fontReady=true</script></body>'});await flush()
  const r=p._htmlRuntime,style=id=>r.window.getComputedStyle(r.document.getElementById(id))
  assert.equal(style('a').fontSize,'16px');assert.equal(style('a').lineHeight,'24px');assert.equal(style('a').fontWeight,'700');assert.equal(style('b').fontSize,'12px')
 }finally{p.host.onUnload();p.detached()}
})
test('无正确后缀的 PDF 按识别后的 MIME 打开而不是传 bin',async()=>{
 let options;const p=readerPage({openDocument:o=>{options=o}})
 try{p.openSelectedFile({name:'document.bin',path:'/tmp/file',type:'application/pdf'});await flush();assert.equal(options,undefined);assert.equal(p.data.pdfSessions[0].file.path,'/tmp/file');assert.equal(p.openDocumentOnRequest,undefined)}finally{p.host.onUnload();p.detached()}
})

test('微信按 length 补零时，无后缀短文件只读取真实字节数',async()=>{
 const bytes=Buffer.from('# 笔记\n\n正文');let observedLength
 const p=readerPage({getFileSystemManager:()=>({
  stat:o=>o.success({stats:{size:bytes.length}}),
  readFile:o=>{if(observedLength===undefined)observedLength=o.length;const out=Buffer.alloc(o.length||bytes.length);bytes.copy(out);o.success({data:out})}
 })})
 try{p.openSelectedFile({name:'无后缀',path:'/tmp/note'});await flush();assert.equal(observedLength,bytes.length);assert.equal(p.data.error,'');assert.match(JSON.stringify(p.data.domTree),/正文/)}finally{p.host.onUnload();p.detached()}
})

test('上一张图片的迟到错误不会盖住当前 Markdown',async()=>{
 const p=readerPage()
 try{p.setData({imagePath:'/new.png',error:''});p.onImagePreviewError({currentTarget:{dataset:{path:'/old.png'}}});assert.equal(p.data.error,'');p.onImagePreviewError({currentTarget:{dataset:{path:'/new.png'}}});assert.match(p.data.error,/图片未能显示/)}finally{p.host.onUnload();p.detached()}
})
