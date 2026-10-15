'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cases } = require('./fixtures/markdown-code-indent-reference.json')
test('indented code removes four columns and preserves remaining whitespace across body and footnotes', () => {
  for (const sample of cases) {
    assert.equal(crypto.createHash('sha256').update(sample.source).digest('hex'), sample.sha256, sample.name)
    const d = parseHtmlDocument(renderMarkdownDocument(sample.source).html).document
    const ref = parseHtmlDocument(sample.referenceHtml).document
    assert.deepEqual(d.querySelectorAll('pre').map(n => n.textContent), sample.expected, sample.name)
    assert.deepEqual(ref.querySelectorAll('pre').map(n => n.textContent), sample.expected, sample.name + ': independent reference')
    for (const tag of ['blockquote', 'ul', 'li']) assert.equal(d.querySelectorAll(tag).length, ref.querySelectorAll(tag).length, sample.name + ': ' + tag)
  }
})
test('large mixed-indent code remains exact and subsequent render has no old content', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => ' '.repeat(i % 4) + '\t' + i + '\tvalue')
  const d = parseHtmlDocument(renderMarkdownDocument(lines.join('\n')).html).document
  assert.equal(d.querySelector('pre').textContent, lines.map((_, i) => i + '\tvalue').join('\n') + '\n')
  const next = parseHtmlDocument(renderMarkdownDocument('    NEXT').html).document
  assert.equal(next.querySelector('pre').textContent, 'NEXT\n')
})
