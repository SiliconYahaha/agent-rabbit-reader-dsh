'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases } = require('./fixtures/markdown-html-boundaries/cases.json')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { parseHtmlDocument, serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { signature } = require('./helpers/markdown-list-tabs')
const { readerPage } = require('./helpers/reader-host')
const html = source => renderMarkdownDocument(source).html
const content = page => {
  const article = page._htmlRuntime.document.querySelector('article')
  return article.childNodes.filter((n, i) => !(i === 0 && n.localName === 'style')).map(serializeNode).join('')
}

test('authored HTML/quote/list boundaries retain independent source identity, content and nesting', () => {
  assert.equal(cases.length, 1056)
  assert.equal(new Set(cases.map(c => c.sha256)).size, cases.length)
  for (const c of cases) {
    assert.equal(crypto.createHash('sha256').update(c.source).digest('hex'), c.sha256, c.name)
    assert.deepEqual(signature(html(c.source), 'mixed'), signature(c.referenceHtml, 'mixed'), c.name)
  }
  assert.equal(cases.filter(c => !c.oracleAgreement).length, 18)
})

test('each formerly swallowed tail stays outside closed containers while genuine lazy paragraphs remain inside', () => {
  const lost = cases.filter(c => c.source.includes('TAIL') && !c.beforeReaderHtml.includes('TAIL'))
  assert.ok(lost.length >= 15)
  for (const c of lost) assert.ok(html(c.source).includes('TAIL'), c.name)
  const doc = parseHtmlDocument(html('> > FIRST\nSECOND\n')).document
  assert.equal(doc.querySelectorAll('blockquote').length, 2)
  assert.match(doc.querySelector('blockquote blockquote p').textContent, /FIRST\s+SECOND/)
  const heading = parseHtmlDocument(html('- > FIRST\n  lazy\n  > ---\n  > LAST\nTAIL\n')).document
  assert.match(heading.querySelector('h2').textContent, /FIRST\s+lazy/)
  assert.match(heading.querySelector('p').textContent, /LAST\s+TAIL/)
})

test('actual Markdown host preserves independently agreed boundaries across consecutive files', async () => {
  let bytes
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  try {
    for (const c of cases.filter(c => c.oracleAgreement)) {
      bytes = Buffer.from(c.source)
      page.openSelectedFile({ name: c.name + '.md', path: '/fixture/body.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(page.data.error, '', c.name)
      assert.deepEqual(signature(content(page), 'mixed'), signature(c.referenceHtml, 'mixed'), c.name)
    }
  } finally { page.disposeHtmlRuntime() }
})

test('restored tail links use the actual tap bridge and stale/error reads cannot replace a later document', async () => {
  const reads = [], scrolls = []
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  page.scrollToDomNid = nid => scrolls.push(nid)
  const source = cases.find(c => c.name === 'div-blank-doubleQuote').source + '\n<a id="after"></a>\n'
  async function open (source) {
    const bytes = Buffer.from(source)
    page.openSelectedFile({ name: 'body.md', path: '/fixture/body.md', size: bytes.length })
    await reads.shift().success({ data: bytes }); await new Promise(setImmediate)
  }
  try {
    await open(source)
    let d = page._htmlRuntime.document
    const link = d.querySelector('a[href="#after"]'), target = d.getElementById('after')
    assert.ok(link); assert.ok(target)
    page.onDomTap({ currentTarget: { dataset: { nid: link._nid } } })
    assert.equal(scrolls.at(-1), target._nid)
    page.openSelectedFile({ name: 'broken.md', path: '/fixture/broken.md' })
    await reads.shift().fail({ errMsg: 'fixture read failure' }); assert.match(page.data.error, /fixture read failure/)
    page.openSelectedFile({ name: 'old.md', path: '/fixture/old.md' }); const late = reads.shift()
    await open('CURRENT\n\n<a id="current"></a>\n')
    await late.success({ data: Buffer.from(source) }); await new Promise(setImmediate)
    assert.equal(page.data.error, '')
    assert.match(content(page), /CURRENT/); assert.doesNotMatch(content(page), /TAIL/)
  } finally { page.disposeHtmlRuntime() }
})

test('many quote marker transitions preserve all inline content and restore tokenizer state after a bounded error', () => {
  const source = '> BEGIN\n' + 'lazy\n> <span>VALUE</span>\n'.repeat(1000) + 'END\n'
  const result = html(source)
  assert.equal((result.match(/VALUE/g) || []).length, 1000)
  assert.match(result, /BEGIN/); assert.match(result, /END/)
  assert.throws(() => html('- ' + '> '.repeat(257) + 'TOO DEEP\n'), /嵌套过深/)
  assert.match(html('> AFTER\nlazy\n'), /AFTER\s+lazy/)
  assert.match(html('<div>FRESH</div>\n'), /^<div>FRESH<\/div>/)
})
