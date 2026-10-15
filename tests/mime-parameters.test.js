'use strict'
const assert=require('node:assert/strict'),test=require('node:test')
const {mimeTypeOf,mimeParametersOf,fileKind}=require('../miniprogram/file-reader/shared/file-types')
const {decodeTextData}=require('../miniprogram/file-reader/document/text-data')
const {readerPage,designPreview,flush}=require('./helpers/reader-host')
const {inspectFileBytes}=require('../miniprogram/file-reader/engine/core/file-inspector')
const refs=require('./fixtures/mime-parameters/headers.json')
for(const sample of refs.rows)test('quoted MIME charset/independent decoded body '+sample.id,async()=>{
 const file=Object.freeze({name:'聊天附件',type:sample.type,path:'/fixture/input'}),bytes=Buffer.from(sample.base64,'base64')
 assert.equal(mimeTypeOf(file),sample.mediaType)
 assert.equal(mimeParametersOf(file).find(p=>p.name==='charset')?.value,sample.charset||undefined)
 assert.equal(decodeTextData(bytes,file).text,sample.source)
 const page=readerPage({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:bytes.length}}),readFile:o=>o.success({data:bytes})})})
 page.openSelectedFile(file);await flush();assert.equal(page.data.error,'')
 assert.deepEqual(page._htmlRuntime.document.querySelectorAll('td').map(c=>c.textContent),sample.rows.flat())
 assert.equal(file.type,sample.type);page.detached()
})
test('malformed and conflicting real charset parameters reject; consistent aliases and BOM remain valid',()=>{
 for(const type of ['text/plain; charset="utf-8','text/plain; charset="utf-8"junk','text/plain; charset=gbk; charset=utf-8'])assert.throws(()=>decodeTextData(Buffer.from('汉字'),{type}),/参数不完整|相互冲突/)
 assert.equal(decodeTextData(Buffer.from('汉字'),{type:'text/plain; charset=UTF8; charset="utf-8"'}).text,'汉字')
 assert.equal(decodeTextData(Buffer.from('\ufeff汉字'),{type:'text/plain; charset=gbk; charset=utf-8'}).text,'汉字')
})
const variants=type=>[type,type.toUpperCase(),' '+type+' ; name="ignored.other; x=y"',type+'; NAME="quoted\\\";charset=gbk"']
const dxf=Buffer.from('0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n100\n21\n100\n0\nENDSEC\n0\nEOF\n')
const zip=Buffer.from(require('./fixtures/text-data/references.json').archive.base64,'base64')
test('MIME spelling/parameters select actual ZIP contents and DXF geometry without mutating the header',async()=>{
 for(const [mime,bytes]of [['application/dxf',dxf],['application/zip',zip]]){
 const control=inspectFileBytes(bytes,{name:'control',type:mime})
 for(const type of variants(mime)){
 const file=Object.freeze({name:'聊天附件',type,path:'/fixture/input',size:bytes.length})
 const actual=inspectFileBytes(bytes,file)
 assert.equal(actual.title,control.title);assert.deepEqual(actual.previewSvg,control.previewSvg);assert.deepEqual(actual.stepModel,control.stepModel)
 assert.deepEqual(actual.entries,control.entries)
 let extracted=Buffer.alloc(0)
 const manager={stat:o=>o.success({stats:{size:o.path==='/fixture/input'?bytes.length:extracted.length}}),readFile:o=>{const b=o.filePath==='/fixture/input'?bytes:extracted;const data=b.subarray(o.position||0,o.length==null?b.length:(o.position||0)+o.length);o.success({data})},writeFile:o=>{extracted=Buffer.from(o.data);o.success()}}
 const page=readerPage({env:{USER_DATA_PATH:'/fixture'},getFileSystemManager:()=>manager});page.openSelectedFile(file);await flush();assert.equal(page.data.error,'')
 if(mime.endsWith('zip')){const idx=page.data.inspectorEntries.findIndex(e=>e.name==='literal.xml');assert.ok(idx>=0);await page.openInspectorEntry({currentTarget:{dataset:{index:idx}}});await flush();assert.equal(page._htmlRuntime.document.querySelector('pre').textContent,require('./fixtures/text-data/references.json').archive.members[2].source)}
 else assert.equal(Buffer.from(page.data.inspectorPreviewSource.split(',')[1],'base64').toString(),control.previewSvg)
 assert.equal(file.type,type);page.detached()
 }
 }
})
test('native Office handoff normalizes media type while retaining original headers',()=>{
 const types={'application/pdf':'pdf','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.ms-word.document.macroenabled.12':'docx','application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.ms-excel.sheet.macroenabled.12':'xlsx','application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'}
 for(const[mime,expected]of Object.entries(types))for(const type of variants(mime)){let args;const page=readerPage({openDocument:o=>{args=o}});const file=Object.freeze({name:'聊天附件',type,path:'/fixture/input'});assert.equal(fileKind(file),'document');page.openSelectedFile(file);assert.equal(args.fileType,expected);assert.equal(file.type,type);page.detached()}
})
test('unknown MIME remains metadata with the exact original header',()=>{const type=' Application/Unknown ; name="x;charset=gbk"';const result=inspectFileBytes(Buffer.from('owned bytes'),{name:'attachment',type});assert.equal(result.title,'二进制文件信息');assert.equal(result.metadata.find(m=>m.label==='MIME 类型').value,type)})
const familyRefs=require('./fixtures/mime-parameters/families.json')
for(const sample of familyRefs.rows)test('full family entry and actual contents with normalized MIME: '+sample.name,async()=>{
 const bytes=Buffer.from(sample.base64,'base64'),wait=async p=>{for(let i=0;i<100&&p.data.isLoading;i++)await flush();assert.equal(p.data.error,'');assert.equal(p.data.isLoading,false)}
 if(sample.name==='7z'){
 const wasm=require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(require('node:path').join(__dirname,'../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
 await require('../miniprogram/file-reader/archive/sevenzip-runtime').inspect7zArchive(bytes,{wasmBinary:wasm})
 }
 let firstPreview
 for(const type of variants(sample.mime)){
 let extracted=Buffer.alloc(0),preview
 const manager={stat:o=>o.success({stats:{size:o.path==='/fixture/input'?bytes.length:extracted.length}}),readFile:o=>{const b=o.filePath==='/fixture/input'?bytes:extracted;const data=b.subarray(o.position||0,o.length==null?b.length:(o.position||0)+o.length);o.success({data})},writeFile:o=>{if(o.encoding==='base64'){preview=Buffer.from(o.data,'base64')}else if(sample.name==='psd'){preview=Buffer.from(o.data)}else extracted=Buffer.from(o.data);o.success()}}
 const file=Object.freeze({name:'聊天附件',path:'/fixture/input',size:bytes.length,type})
 if(sample.name==='psd'){
 const component=designPreview({env:{USER_DATA_PATH:'/fixture'},getFileSystemManager:()=>manager});component.open(file);for(let i=0;i<100&&component.data.loading;i++)await flush();assert.equal(component.data.error,'');assert.ok(component.data.previewPath);assert.ok(preview?.length);if(firstPreview)assert.deepEqual(preview,firstPreview);else firstPreview=Buffer.from(preview)
 const composite=require('../miniprogram/file-reader/engine/core/design-file').extractPsdComposite(bytes);assert.deepEqual(Array.from(composite.rgba),sample.rgba);component.detached()
 }else{
 const p=readerPage({env:{USER_DATA_PATH:'/fixture'},getFileSystemManager:()=>manager,request:()=>assert.fail('must stay local')});p.openSelectedFile(file);await wait(p)
 if(sample.body){const i=p.data.inspectorEntries.findIndex(e=>e.name==='inside.txt');assert.ok(i>=0);await p.openInspectorEntry({currentTarget:{dataset:{index:i}}});await wait(p);assert.equal(p._htmlRuntime.document.querySelector('pre').textContent,sample.body);assert.equal(extracted.toString(),sample.body)}
 else if(sample.model)assert.deepEqual(p._inspectorModel,sample.model)
 else{const control=inspectFileBytes(bytes,{name:'control.cdr'});assert.ok(control.previewSvg);assert.equal(Buffer.from(p.data.inspectorPreviewSource.split(',')[1],'base64').toString(),control.previewSvg)}
 p.detached()
 }
 assert.equal(file.type,type)
 }
})
