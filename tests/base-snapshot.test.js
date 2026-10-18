'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib')
const {renderSnapshot,unpack}=require('../miniprogram/file-reader/document/base-snapshot')
const {renderTextData}=require('../miniprogram/file-reader/document/text-data')
const {fileKind,textDataFormat}=require('../miniprogram/file-reader/shared/file-types')
const pack = data => JSON.stringify({gzipSnapshot:zlib.gzipSync(JSON.stringify(data)).toString('base64')})
const fixture = [{schema:{base:{name:'午餐清单'},data:{table:{fieldMap:{name:{name:'店名',type:1},kind:{name:'菜系',type:3,property:{options:[{id:'opt1',name:'川菜'}]}}},views:['v'],viewMap:{v:{property:{fields:['name','kind'],records:['b','a']}}}},recordMap:{a:{name:{value:[{text:'<script>恶意</script>',type:'text'}]},kind:{value:'opt1'}},b:{name:{value:[{text:'测试餐厅',type:'text'}]}}}}}}]
test('BASE envelope becomes readable table and options, keeps declared ordering and escapes authored markup',()=>{
 const source=pack(fixture),r=renderSnapshot(source);assert.equal(r.rows,2);assert.match(r.html,/菜系/);assert.match(r.html,/川菜/);assert.match(r.html,/&lt;script&gt;/);assert.ok(r.html.indexOf('测试餐厅')<r.html.indexOf('恶意'));assert.doesNotMatch(r.html,/<script>/)
 assert.equal(fileKind({name:'example.base'}),'text');assert.equal(textDataFormat({name:'example.base'}),'base');assert.equal(renderTextData(source,{format:'base'}).mode,'base');assert.equal(renderTextData(source,{format:'json'}).mode,'base')
})
test('ordinary JSON stays lossless, malformed compressed snapshots show explanation and preserve original',()=>{
 assert.equal(renderSnapshot('{"x":9007199254740993}'),null);assert.match(renderTextData('{"x":9007199254740993}',{format:'json'}).html,/9007199254740993/)
 const r=renderTextData('{"gzipSnapshot":"not gzip"}',{format:'json'});assert.match(r.html,/无法展开/);assert.match(r.html,/not gzip/)
 assert.throws(()=>unpack(zlib.gzipSync(Buffer.alloc(5*1024*1024)).toString('base64')),/4 MB/)
 assert.throws(()=>renderSnapshot(pack([{schema:{data:{}}}])) ,/缺少/)
})
