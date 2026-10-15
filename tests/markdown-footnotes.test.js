'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { readerPage } = require('./helpers/reader-host')
const { cases } = require('./helpers/markdown-footnotes')
const doc = source => parseHtmlDocument(renderMarkdownDocument(source).html).document
test('footnotes retain separate paragraphs, nested lists, quotations and exact code whitespace', () => {
  for (const name of ['paragraphs','nestedList','blockquote','noteCode-twoBlank','noteCode-spaces','noteCode-tabs','closing-tab-before-body']) {
    const sample = cases.find(c=>c.name===name), d = doc(sample.source), ref = parseHtmlDocument(sample.referenceHtml).document
    assert.deepEqual(d.querySelectorAll('pre').map(n=>n.textContent),ref.querySelectorAll('pre').map(n=>n.textContent),name)
    assert.equal(d.querySelectorAll('blockquote').length,ref.querySelectorAll('blockquote').length,name)
    assert.equal(d.querySelectorAll('ul li').length,ref.querySelectorAll('ul li').length,name)
    if (name === 'paragraphs') assert.deepEqual(d.querySelectorAll('.md-footnote p').map(n=>n.textContent),['[1] FIRST','SECOND'])
    if (name === 'nestedList') assert.equal(d.querySelector('.md-footnote ul ul').parentNode.localName,'li')
  }
})
test('all source contracts keep code exactly and every reachable note has a unique return target', () => {
  for (const sample of cases) {
    const d=doc(sample.source), ref=parseHtmlDocument(sample.referenceHtml).document
    assert.deepEqual(d.querySelectorAll('pre').map(n=>n.textContent),ref.querySelectorAll('pre').map(n=>n.textContent),sample.name)
    const links=d.querySelectorAll('.md-footnote-ref a'), back=d.querySelectorAll('.md-footnote-backref')
    assert.equal(links.length,back.length,sample.name)
    assert.equal(new Set(links.map(n=>n.id)).size,links.length,sample.name)
    for(const a of [...links,...back]) assert.ok(d.getElementById(a.getAttribute('href').slice(1)),sample.name)
  }
})
test('self, mutual and nested definitions terminate while preserving their complete reachable content', () => {
  for(const [name,texts] of [['selfReference',['A[1]']],['mutualReferences',['A[2]','B[1]']],['nestedDefinition',['FIRST[2]','SECOND']],['sharedNested',['A[3]','B[3]','C']]]) {
    const d=doc(cases.find(c=>c.name===name).source)
    assert.deepEqual(d.querySelectorAll('.md-footnote p').map(n=>n.textContent.replace(/^\[\d+\] /,'')),texts)
  }
})
test('footnote resource limits fail explicitly and the next file opens with fresh anchors', async () => {
  const definitions=Array.from({length:4097},(_,i)=>`[^${i}]: VALUE`).join('\n')
  const refs='[^a]'.repeat(16385)+'\n\n[^a]: VALUE'
  const nested=Array.from({length:33},(_,i)=>'    '.repeat(i)+`[^${i}]: VALUE`).join('\n')
  for(const [source,message] of [[definitions,/4096 definitions/],[refs,/16384 references/],[nested,/32 nested definitions/]]) assert.throws(()=>renderMarkdownDocument(source),message)
  let bytes=Buffer.from(refs)
  const page=readerPage({getFileSystemManager:()=>({readFile:o=>o.success({data:bytes})})})
  try {
    page.openSelectedFile({name:'large.md',path:'/large',size:bytes.length});await new Promise(setImmediate)
    assert.match(page.data.error,/16384 references/)
    bytes=Buffer.from('RECOVERED[^z]\n\n[^z]: CURRENT')
    page.openSelectedFile({name:'next.md',path:'/next',size:bytes.length});await new Promise(setImmediate)
    assert.equal(page.data.error,'')
    assert.equal(page._htmlRuntime.document.querySelector('.md-footnote-ref a').id,'md-fn-ref-1-1')
    assert.match(page._htmlRuntime.document.body.textContent,/CURRENT/)
    assert.doesNotMatch(page._htmlRuntime.document.body.textContent,/VALUE/)
  } finally { page.disposeHtmlRuntime() }
})
test('long blank runs preserve following body and do not duplicate notes', () => {
  const d=doc('BODY[^n]\n\n[^n]: NOTE\n'+' \n'.repeat(20000)+'  BODY AFTER')
  assert.equal(d.querySelectorAll('.md-footnote').length,1)
  assert.doesNotMatch(d.querySelector('.md-footnote').textContent,/BODY AFTER/)
  assert.match(d.body.textContent,/BODY AFTER/)
})
