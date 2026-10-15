'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { cases } = require('./helpers/markdown-frontmatter')
const reference = require('./fixtures/markdown-frontmatter-reference.json')
const { parseFrontMatter } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { readerPage } = require('./helpers/reader-host')
const tick = () => new Promise(setImmediate)
test('front matter preserves body for all pinned independent delimiter contracts', () => {
  assert.equal(cases.length, reference.length)
  for (let i=0;i<cases.length;i++) {
    assert.equal(cases[i].source, reference[i].source, cases[i].name)
    assert.equal(parseFrontMatter(cases[i].source).body, reference[i].expectedBody, cases[i].name)
  }
})
test('whole delimiters and empty blocks keep subsequent metadata-looking body and rules', () => {
  for (const end of ['---','...']) {
    assert.deepEqual(parseFrontMatter(`--- \t\r\ntitle: "Title"\r\n${end}\t\r\nkey: BODY\r\n---\r\nTAIL`), {meta:{title:'Title'},body:'key: BODY\n---\nTAIL'})
    assert.deepEqual(parseFrontMatter(`---\n${end}\nHEADER\n---\nTAIL`), {meta:{},body:'HEADER\n---\nTAIL'})
  }
})
test('unclosed front matter remains complete even after many near-markers', () => {
  const source = '---\n' + '---suffix\n...suffix\n'.repeat(50000) + 'KEEP END'
  const result = parseFrontMatter(source)
  assert.equal(result.body,source); assert.deepEqual(result.meta,{})
  assert.equal(parseFrontMatter('---\n---\nNEXT').body,'NEXT')
})
test('asynchronous Markdown open cannot send stale content or metadata to the next file', async () => {
  const reads=[]
  const page=readerPage({getFileSystemManager:()=>({readFile:o=>reads.push(o)})})
  const send=(request,source)=>{const b=Buffer.from(source);request.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})}
  page.openSelectedFile({name:'old.md',path:'/local/old.md'})
  send(reads.shift(),'---\ntitle: OLD\n---\nOLD BODY')
  page.openSelectedFile({name:'new.md',path:'/local/new.md'})
  send(reads.shift(),'---\n---\nNEW BODY\n---\nEND')
  await tick()
  assert.equal(page.data.error,'');assert.equal(page.data.hasContent,true)
  assert.match(page._htmlRuntime.document.body.textContent,/NEW BODY/)
  assert.doesNotMatch(page._htmlRuntime.document.body.textContent,/OLD BODY/)
  assert.ok(!page.events.some(e=>e.name==='meta'))
  page.openSelectedFile({name:'failed.md',path:'/local/failed.md'})
  reads.shift().fail({errMsg:'read denied'})
  assert.match(page.data.error,/read denied/)
  page.openSelectedFile({name:'recovered.md',path:'/local/recovered.md'})
  send(reads.shift(),'---\ntitle: CURRENT\n...\nRECOVERED')
  await tick()
  assert.equal(page.data.error,'');assert.match(page._htmlRuntime.document.body.textContent,/RECOVERED/)
  assert.deepEqual(page.events.filter(e=>e.name==='meta').map(e=>e.detail.meta),[{title:'CURRENT'}])
  page.disposeHtmlRuntime()
})
