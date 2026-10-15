'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto')
const {cases,document}=require('./helpers/epsi-lines'),{rasterCapture}=require('./helpers/capture-design-raster'),{designPreview}=require('./helpers/reader-host')
const encode=require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const refs=require('./fixtures/epsi-lines-reference.json').results,samples=cases(),capture=rasterCapture()
const pixels=name=>zlib.inflateSync(Buffer.from(refs.find(r=>r.name===name).rgbaZlibBase64,'base64'))
for(const depth of [1,2,4,8])test(`EPSI ${depth}-bit: physical lines, marker boundaries and case-sensitive declarations preserve independent pixels`,()=>{
 for(const c of samples.filter(c=>c.depth===depth)){
  assert.equal(crypto.createHash('sha256').update(c.bytes).digest('hex'),refs.find(r=>r.name===c.name).sourceSha256,c.name)
  const r=capture(c.bytes);assert.deepEqual(r.rgba,pixels(c.name),c.name);assert.equal(r.quality,88)
  assert.deepEqual(Buffer.from(r.preview.jpeg),Buffer.from(encode({width:c.width,height:c.height,data:pixels(c.name)},88).data))
 }
})
function invalidCases(){return[
 {name:'short-lines',bytes:document(1,1,8,['% ff'],'\n',{header:'%%BeginPreview: 1 1 8 2'}),error:/行数不完整/},
 {name:'extra-lines',bytes:document(1,1,8,['% ff','% xyz'],'\n',{header:'%%BeginPreview: 1 1 8 1'}),error:/行数不符/},
 {name:'zero-lines',bytes:document(1,1,8,['% ff'],'\n',{header:'%%BeginPreview: 1 1 8 0'}),error:/行数无效/},
 {name:'huge-lines',bytes:document(1,1,8,['% ff'],'\n',{header:'%%BeginPreview: 1 1 8 999999999999999999999'}),error:/行数无效/},
 {name:'split-header',bytes:document(1,1,8,['% ff'],'\n',{header:'%%BeginPreview: 1\n1 8 1'}),error:/预览头无效/},
 {name:'vertical-header',bytes:document(1,1,8,['% ff'],'\n',{header:'%%BeginPreview: 1\v1 8 1'}),error:/预览头无效/},
 {name:'end-suffix',bytes:document(1,1,8,['% ff'],'\n',{end:'%%EndPreviewSuffix'}),error:/缺少结束/},
 {name:'end-lowercase',bytes:document(1,1,8,['% ff'],'\n',{end:'%%endpreview'}),error:/缺少结束/},
 {name:'end-indented',bytes:document(1,1,8,['% ff'],'\n',{end:' %%EndPreview'}),error:/缺少结束/},
 {name:'missing-byte',bytes:document(2,1,8,['% ff']),error:/数据不完整/},
 {name:'odd-nibble',bytes:document(2,1,8,['% ff0']),error:/数据不完整/},
 {name:'extra-hex',bytes:document(1,1,8,['% ff00']),error:/超过声明尺寸/},
 {name:'invalid-depth',bytes:document(1,1,16,['% ffff']),error:/位深 16/},
 {name:'oversize',bytes:document(4000001,1,8,['% 00']),error:/尺寸超出/}
]}
test('EPSI malformed declarations, incomplete data and non-DSC terminators fail explicitly',()=>{
 for(const c of invalidCases())assert.throws(()=>capture(c.bytes),c.error,c.name)
 assert.throws(()=>capture(samples[0].bytes,{maxPixels:38}),/尺寸超出/)
 assert.throws(()=>capture(samples[0].bytes,{maxBytes:10}),/超过/)
})
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))}
test('actual EPSI preview component preserves every valid image and recovers after malformed files and write failures',async()=>{
 let input,written,writeFailure=false
 const page=designPreview({env:{USER_DATA_PATH:'/user-data'},getFileSystemManager:()=>({readFile(o){const b=input.bytes.subarray(o.position||0,(o.position||0)+o.length);o.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})},writeFile(o){if(writeFailure)o.fail({errMsg:'intentional EPSI write failure'});else{written=Buffer.from(o.data);o.success()}}})})
 const sequence=[...samples];for(const [i,c]of invalidCases().entries())sequence.splice(i*3+1,0,c)
 sequence.push({...samples[0],writeFailure:true},samples[1],samples[0])
 for(input of sequence){written=null;writeFailure=!!input.writeFailure;page.open({name:input.name+'.ai',path:'/input.ai',size:input.bytes.length});await flush()
  assert.equal(page.data.loading,false);assert.equal(page.data.error,'')
  if(input.error||writeFailure){assert.equal(written,null);assert.equal(page.data.previewPath,'');assert.match(page.data.message,input.error||/intentional EPSI write failure/);continue}
  assert.match(page.data.previewPath,/illustrator-epsi-preview-/)
  assert.deepEqual(written,Buffer.from(encode({width:input.width,height:input.height,data:pixels(input.name)},88).data),input.name)
 }
})
