'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { cases } = require('./helpers/rtf-special-characters')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { readerPage, flush } = require('./helpers/reader-host')
test('RTF spaces, joiners, direction marks and required breaks survive scoped controls', () => {
  assert.equal(cases.length,138)
  for (const c of cases) {
    assert.equal(rtfToText(c.source),c.expected,c.id)
    assert.equal(rtfToText(Buffer.from(c.source)),c.expected,c.id+' bytes')
  }
})
test('special character controls keep legacy byte runs separate without changing their codepage', () => {
  const source=Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg936 '),Buffer.from([0xd6,0xd0]),Buffer.from('\\emspace '),Buffer.from([0xce,0xc4]),Buffer.from('}')])
  assert.equal(rtfToText(source),'中\u2003文')
  assert.throws(()=>rtfToText(Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg936 '),Buffer.from([0x81]),Buffer.from('\\zwj X}') ])),/字节与代码页/)
})
test('special characters flow through actual file entry and malformed reads cannot contaminate recovery', async () => {
  const reads=[],page=readerPage({getFileSystemManager:()=>({readFile:options=>reads.push(options)})})
  try {
    for(const c of cases){const bytes=Buffer.from(c.source);page.openSelectedFile({name:c.id+'.rtf',path:'/fixture/special.rtf',size:bytes.length});reads.shift().success({data:bytes});await flush();assert.equal(page.data.error,'',c.id);assert.equal(page._htmlRuntime.document.querySelector('pre').textContent,c.expected,c.id)}
    for(const source of ['{\\rtf1 A\\emspace B','{\\rtf1 \\u999999?\\zwj X}']){
      const bytes=Buffer.from(source);page.openSelectedFile({name:'bad.rtf',path:'/fixture/bad.rtf',size:bytes.length});reads.shift().success({data:bytes});await flush();assert.ok(page.data.error)
      const good=cases.find(c=>c.id==='emoji-joiner'),body=Buffer.from(good.source);page.openSelectedFile({name:'good.rtf',path:'/fixture/good.rtf',size:body.length});reads.shift().success({data:body});await flush();assert.equal(page.data.error,'');assert.equal(page._htmlRuntime.document.querySelector('pre').textContent,good.expected)
    }
  } finally {page.detached()}
})
test('new control characters remain local to their footnote stream', () => {
  const text=rtfToText('{\\rtf1 BODY\\chftn{\\footnote \\chftn NOTE\\emspace TEXT\\page NEXT} END}')
  assert.match(text,/BODY.*END/)
  assert.match(text,/NOTE\u2003TEXT\nNEXT/)
})
