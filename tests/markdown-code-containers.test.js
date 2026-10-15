'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases } = require('./fixtures/markdown-code-containers.json')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { readerPage } = require('./helpers/reader-host')
const { signature } = require('./helpers/markdown-list-tabs')
const content = page => page._htmlRuntime.document.querySelector('article').childNodes.filter(n => n.localName !== 'style').map(serializeNode).join('')

test('nested code and paragraph continuations preserve all dual-reference container and heading contracts', () => {
  assert.equal(cases.length, 768)
  assert.equal(new Set(cases.map(c => c.sha256)).size, cases.length)
  assert.equal(cases.filter(c => !c.baselineExact).length, 158)
  for (const c of cases) {
    assert.equal(crypto.createHash('sha256').update(c.source).digest('hex'), c.sha256, c.name)
    assert.deepEqual(signature(c.secondaryHtml), signature(c.referenceHtml), c.name + ': oracle agreement')
    assert.deepEqual(signature(renderMarkdownDocument(c.source).html), signature(c.referenceHtml), c.name)
  }
})

test('real Markdown file entry keeps code, outside paragraphs and legitimate headings across successive opens', async () => {
  let bytes
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  try {
    for (const c of cases) {
      bytes = Buffer.from(c.source)
      page.openSelectedFile({ name: c.name + '.md', path: '/fixtures/nested-code.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(page.data.error, '', c.name)
      assert.deepEqual(signature(content(page)), signature(c.referenceHtml), c.name)
    }
  } finally { page.disposeHtmlRuntime() }
})

test('lazy underline metadata is released after nested failure and does not suppress the next real heading', () => {
  assert.throws(() => renderMarkdownDocument('- ' + '> '.repeat(257) + 'TOO DEEP\n'), /嵌套过深/)
  for (let i = 0; i < 20; i++) {
    assert.doesNotMatch(renderMarkdownDocument('- > PARAGRAPH\nTAIL\n===\n').html, /<h1/)
    assert.match(renderMarkdownDocument('PARAGRAPH\n    CONTINUED\n===\n').html, /<h1>PARAGRAPH\n {4}CONTINUED<\/h1>/)
    assert.match(renderMarkdownDocument('-     CODE\nOUTSIDE\n').html, /<\/ul>\n<p>OUTSIDE<\/p>/)
  }
})
