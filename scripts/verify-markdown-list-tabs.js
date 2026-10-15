'use strict'
// Snapshot verification is dependency-free. --oracle-modules PATH also reruns
// commonmark.js 0.31.2 / markdown-it 15.0.1 installed outside the product tree.
const assert = require('node:assert/strict'), path = require('node:path')
const { cases, signature } = require('../tests/helpers/markdown-list-tabs')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const option = process.argv.indexOf('--oracle-modules')
let commonmark, renderer, markdownIt
if (option >= 0) {
  const modules = path.resolve(process.argv[option + 1])
  assert.equal(require(path.join(modules, 'commonmark/package.json')).version, '0.31.2')
  assert.equal(require(path.join(modules, 'markdown-it/package.json')).version, '15.0.1')
  const cm = require(path.join(modules, 'commonmark'))
  commonmark = new cm.Parser(); renderer = new cm.HtmlRenderer()
  markdownIt = new (require(path.join(modules, 'markdown-it')))('commonmark')
}
let checked = 0, oracleChecked = 0, secondaryDisagreements = 0
for (const sample of cases) {
  if (!sample.retainedDifference) {
    assert.deepEqual(signature(renderMarkdownDocument(sample.source).html, sample.suite), signature(sample.referenceHtml, sample.suite), sample.name)
    checked++
  }
  if (commonmark && ['content', 'structure', 'quote-prefix'].includes(sample.suite)) {
    const expected = signature(sample.referenceHtml, sample.suite)
    assert.deepEqual(signature(renderer.render(commonmark.parse(sample.source)), sample.suite), expected, sample.name + ': independent reference')
    oracleChecked++
    if (JSON.stringify(signature(markdownIt.render(sample.source), sample.suite)) !== JSON.stringify(expected)) secondaryDisagreements++
  }
}
console.log(JSON.stringify({ checked, retainedDifferences: cases.length - checked, oracleChecked, secondaryDisagreements }))
