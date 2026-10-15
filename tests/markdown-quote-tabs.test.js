'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases, signature } = require('./helpers/markdown-quote-tabs')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { readerPage } = require('./helpers/reader-host')
const { serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')

test('quote columns preserve structural nesting and literal code against CommonMark reference', () => {
  for (const sample of cases) {
    assert.equal(crypto.createHash('sha256').update(sample.source).digest('hex'), sample.sha256, sample.name)
    assert.deepEqual(signature(renderMarkdownDocument(sample.source).html), signature(sample.referenceHtml), sample.name)
  }
})

test('many separate quoted fences keep every body and release their coordinate frame', () => {
  const bodies = Array.from({ length: 4000 }, (_, i) => '\t\t' + i + '\tBODY\n')
  const source = bodies.map(body => '> ```\n> ' + body + '> ```\n>\n').join('')
  const d = parseHtmlDocument(renderMarkdownDocument(source).html).document
  assert.deepEqual(d.querySelectorAll('pre').map(n => n.textContent), bodies)
  const next = parseHtmlDocument(renderMarkdownDocument('> \tNEXT\n').html).document
  assert.equal(next.querySelector('pre'), null)
  assert.equal(next.querySelector('p').textContent.trim(), 'NEXT')
})

test('actual Markdown file opens retain quoted code and recover after a read error', async () => {
  let bytes, fail = false
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => fail ? o.fail({ errMsg: 'fixture read failure' }) : o.success({ data: bytes }) }) })
  try {
    for (const sample of cases.filter(c => !c.source.includes('<script>') && !c.source.includes('<style>'))) {
      bytes = Buffer.from(sample.source)
      page.openSelectedFile({ name: sample.name + '.md', path: '/local/quote.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(page.data.error, '', sample.name)
      const article = page._htmlRuntime.document.querySelector('article')
      assert.ok(article, sample.name + ': Markdown host wrapper')
      const actual = article.childNodes.filter(n => n.localName !== 'style').map(serializeNode).join('')
      assert.deepEqual(signature(actual), signature(sample.referenceHtml), sample.name)
    }
    fail = true
    page.openSelectedFile({ name: 'bad.md', path: '/local/bad.md' })
    assert.match(page.data.error, /fixture read failure/)
    fail = false; bytes = Buffer.from('>\t\tRECOVERED\tCONTENT\n')
    page.openSelectedFile({ name: 'next.md', path: '/local/next.md' })
    await new Promise(setImmediate)
    assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, '  RECOVERED\tCONTENT\n')
  } finally { page.disposeHtmlRuntime() }
})
