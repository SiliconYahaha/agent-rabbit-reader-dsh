'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases, signature } = require('./helpers/markdown-list-tabs')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { parseHtmlDocument, serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { readerPage } = require('./helpers/reader-host')

for (const suite of ['content', 'structure', 'footnote', 'mixed', 'quote-prefix']) {
  test('list tabs: independent ' + suite + ' references retain content and boundaries', () => {
    for (const sample of cases.filter(c => c.suite === suite && !c.retainedDifference)) {
      assert.equal(crypto.createHash('sha256').update(sample.source).digest('hex'), sample.sha256, sample.name)
      assert.deepEqual(signature(renderMarkdownDocument(sample.source).html, suite), signature(sample.referenceHtml, suite), sample.name)
    }
  })
}

test('quoted tasks preserve checkbox support for spaces and literal tab separators', () => {
  for (const sample of cases.filter(c => c.retainedDifference && c.name.includes('task'))) {
    const document = parseHtmlDocument(renderMarkdownDocument(sample.source).html).document
    const checkbox = document.querySelector('input')
    assert.ok(checkbox, sample.name)
    assert.equal(checkbox.hasAttribute('checked'), /\[[xX]\]/.test(sample.source), sample.name)
    assert.equal(document.querySelector('code').textContent, 'X\tCOL', sample.name)
    assert.match(document.querySelector('li').textContent, /continuation/, sample.name)
  }
})

test('many list fences release their source frames before the next document', () => {
  const bodies = Array.from({ length: 2000 }, (_, i) => '\t' + i + '\tEND\n')
  const source = bodies.map(body => '- ```\n  ' + body + '  ```\n').join('')
  const document = parseHtmlDocument(renderMarkdownDocument(source).html).document
  assert.deepEqual(document.querySelectorAll('pre').map(n => n.textContent), bodies)
  assert.equal(parseHtmlDocument(renderMarkdownDocument('> ```\n> X\tCOL\n> ```\n').html).document.querySelector('pre').textContent, 'X\tCOL\n')
})

test('actual file entry retains nested list code and recovers from a read failure', async () => {
  let bytes, failed = false
  const host = readerPage({ getFileSystemManager: () => ({ readFile: options => failed ? options.fail({ errMsg: 'fixture read failure' }) : options.success({ data: bytes }) }) })
  try {
    const selected = cases.filter((c, i) => !c.retainedDifference && i % 10 === 0 && !/<(?:script|style)>/.test(c.source))
    for (const sample of selected) {
      bytes = Buffer.from(sample.source)
      host.openSelectedFile({ name: sample.name + '.md', path: '/local/list-tabs.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '', sample.name)
      const article = host._htmlRuntime.document.querySelector('article')
      assert.ok(article, sample.name)
      const html = article.childNodes.filter(n => n.localName !== 'style').map(serializeNode).join('')
      assert.deepEqual(signature(html, sample.suite), signature(sample.referenceHtml, sample.suite), sample.name)
    }
    failed = true
    host.openSelectedFile({ name: 'broken.md', path: '/local/broken.md' })
    assert.match(host.data.error, /fixture read failure/)
    failed = false; bytes = Buffer.from('- ```\n  NEXT\tFILE\n  ```\n')
    host.openSelectedFile({ name: 'next.md', path: '/local/next.md', size: bytes.length })
    await new Promise(setImmediate)
    assert.equal(host.data.error, '')
    assert.equal(host._htmlRuntime.document.querySelector('pre').textContent, 'NEXT\tFILE\n')
  } finally { host.disposeHtmlRuntime() }
})
