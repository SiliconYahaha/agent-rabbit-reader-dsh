'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {cases,malformed}=require('./helpers/rtf-control-case')
const {rtfToText}=require('../miniprogram/file-reader/engine/core/rtf-reader')
const {readerPage}=require('./helpers/reader-host')
test('case-sensitive RTF controls preserve independently specified content and destinations',()=>{
  assert.equal(new Set(cases.map(c=>c.name.toLowerCase())).size,cases.length)
  const reference=require('./fixtures/rtf-control-case-reference.json')
  assert.deepEqual(cases.map(c=>[c.name,c.source,c.expected]),reference.map(c=>[c.name,c.source,c.expected]))
  for(const c of cases.filter(c=>!c.knownGap)){
    assert.equal(rtfToText(c.source),c.expected,c.name+' string')
    assert.equal(rtfToText(Buffer.from(c.source)),c.expected,c.name+' file bytes')
  }
})
test('known binary/Unicode controls remain strict while uppercase unknown controls remain text',()=>{
  for(const c of [...malformed,{source:'{\\rtf1 A{\\*\\ud1 B}Z}'},{source:'{\\rtf1 A{\\*\\ud-1 B}Z}'}]){
    assert.throws(()=>rtfToText(c.source),/RTF/)
    assert.equal(rtfToText('{\\rtf1 NEXT}'),'NEXT')
  }
  assert.equal(rtfToText('{\\rtf1 A\\BIN999999 B}'),'AB')
  assert.equal(rtfToText('{\\rtf1 A{\\*\\UD HIDDEN}Z}'),'AZ')
  assert.equal(rtfToText('{\\rtf1 A{\\*\\unknown{\\*\\ud1 HIDDEN}}Z}'),'AZ')
})
test('real RTF file opens retain all certified text and recover on one reader host',()=>{
  let bytes
  const page=readerPage({getFileSystemManager:()=>({readFile:o=>o.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})})})
  for(const c of cases.filter(c=>!c.knownGap)){
    bytes=Buffer.from(c.source);page.openSelectedFile({name:c.name+'.rtf',path:'/local/fixture.rtf',size:bytes.length})
    assert.equal(page.data.error,'',c.name);assert.equal(page.data.hasContent,true,c.name)
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent,c.expected,c.name)
  }
  bytes=Buffer.from(malformed[0].source);page.openSelectedFile({name:'broken.rtf',path:'/local/broken.rtf',size:bytes.length})
  assert.match(page.data.error,/RTF/);assert.equal(page.data.hasContent,false)
  bytes=Buffer.from('{\\rtf1 A{\\*\\ud RECOVERED}Z}');page.openSelectedFile({name:'recovered.rtf',path:'/local/ok.rtf',size:bytes.length})
  assert.equal(page.data.error,'');assert.equal(page._htmlRuntime.document.querySelector('pre').textContent,'ARECOVEREDZ')
  page.disposeHtmlRuntime()
})
