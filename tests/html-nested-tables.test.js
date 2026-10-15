'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cases, snapshot } = require('./helpers/html-nested-tables')
const reference = require('./fixtures/html-nested-tables-reference.json')
const { readerPage, flush } = require('./helpers/reader-host')

test('nested HTML tables preserve native row, cell and group ownership including omitted ends', () => {
  for (const fixture of cases()) {
    const expected = reference.cases.find(row => row.id === fixture.id)
    assert.equal(crypto.createHash('sha256').update(fixture.source).digest('hex'), expected.sourceSha256, 'oracle must match original bytes')
    assert.deepEqual(snapshot(parseHtmlDocument(fixture.source).document), expected.expected, fixture.id)
  }
})

test('a nested row cannot close its outer row; stray table end tags cannot escape the inner table', () => {
  const { document } = parseHtmlDocument('<table id="outer"><tbody><tr id="outer-row"><td id="holder">Before<table id="inner"></tbody><tr id="inner-row"><td>Inner</td></tr></table>After</td><td id="tail">Tail</td></tr></tbody></table>')
  assert.equal(document.getElementById('inner-row').closest('table').id, 'inner')
  assert.equal(document.getElementById('tail').closest('tr').id, 'outer-row')
  assert.equal(document.getElementById('holder').textContent, 'BeforeInnerAfter')
  assert.equal(document.getElementById('outer').children.length, 1)
})

test('full-table HTML fragments retain nesting after replacement and insertAdjacentHTML', () => {
  const { document } = parseHtmlDocument('<main id="target"></main>')
  const target = document.getElementById('target'), fixture = cases().find(row => row.id === 'td-tbody-omitted-2')
  const markup = fixture.source.match(/<body>([\s\S]*)<\/body>/)[1]
  target.innerHTML = markup
  assert.deepEqual(snapshot(document), reference.cases.find(row => row.id === fixture.id).expected)
  target.innerHTML = ''
  target.insertAdjacentHTML('beforeend', markup)
  assert.deepEqual(snapshot(document), reference.cases.find(row => row.id === fixture.id).expected)
})

test('actual HTML/Markdown opens preserve nested cells and current-file tap ownership', async () => {
  const reads = [], page = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  let oldNid
  try {
    for (const name of ['first.html', 'raw-table.md', 'again.html']) {
      const table = '<table id="outer"><tr><td id="holder"><table id="inner"><tr><td id="inside"><button id="tap">Read</button><span id="out">Ready</span></td></tr></table></td></tr></table>'
      const source = name.endsWith('.md') ? table : table + '<script>document.getElementById("tap").onclick=function(){document.getElementById("out").textContent=this.closest("td").id}</script>'
      page.openSelectedFile({ name, path: '/local/' + name, size: Buffer.byteLength(source) })
      reads.shift().success({ data: Buffer.from(source) }); await flush()
      assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true)
      const d = page._htmlRuntime.document
      assert.equal(d.getElementById('inside').closest('table').id, 'inner')
      if (oldNid) { page.onDomTap({ currentTarget: { dataset: { nid: oldNid } } }); await flush(); assert.equal(d.getElementById('out').textContent, 'Ready') }
      if (!name.endsWith('.md')) {
        oldNid = d.getElementById('tap')._nid
        page.onDomTap({ currentTarget: { dataset: { nid: oldNid } } }); await flush()
        assert.equal(d.getElementById('out').textContent, 'inside')
      }
    }
  } finally { page.detached() }
})
