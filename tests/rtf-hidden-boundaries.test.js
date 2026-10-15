'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { readerPage } = require('./helpers/reader-host')
const { cases, contracts } = require('./helpers/rtf-hidden-boundaries')
const original = require('./fixtures/rtf-hidden-boundaries/before.json').cases
const expanded = require('./fixtures/rtf-hidden-boundaries/expanded-before.json').cases

test('RTF table boundaries preserve cells, empty positions and row endings without revealing hidden content', () => {
  for (const c of contracts) {
    assert.equal(rtfToText(Buffer.from(c.source)), c.expected, c.name)
    assert.equal(rtfToText(c.source), c.expected, c.name + ' string')
  }
  for (const c of [...original, ...expanded]) assert.equal(crypto.createHash('sha256').update(c.source).digest('hex'), c.sha256, c.name)
  assert.equal(new Set([...original, ...expanded].map(c => c.sha256)).size, 120)
  assert.deepEqual(cases.map(c => [c.name,c.source,c.expected]), expanded.map(c => [c.name,c.source,c.expected]))
  for (const c of expanded) {
    assert.equal(crypto.createHash('sha256').update(c.nativeHtml).digest('hex'), c.nativeHtmlSha256, c.name + ' native HTML identity')
    const native = c.name.startsWith('nested-') ? c.writer.cells.slice(1) : c.writer.cells
    // Writer's p/br in these two empty cells has one layout newline, not text.
    const expected = c.shape === 'empty-hidden-middle' && c.mode === 'character-style' ? ['LEFT','\n','RIGHT'] : c.expectedCells
    assert.deepEqual(native, expected, c.name + ' retained independent cells')
  }
})

test('actual reader sequential opens retain exact table text and recover from broken and stale RTF reads', () => {
  const reads = []
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  function open (c) {
    page.openSelectedFile({ name: c.name + '.rtf', path: '/fixture/table.rtf', size: Buffer.byteLength(c.source) })
    reads.shift().success({ data: Buffer.from(c.source) })
    assert.equal(page.data.error, '', c.name)
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, c.expected, c.name)
  }
  try {
    for (const c of contracts) open(c)
    page.openSelectedFile({ name: 'broken.rtf', path: '/fixture/broken.rtf' })
    reads.shift().success({ data: Buffer.from('{\\rtf1{\\v\\bin999 x}}') })
    assert.match(page.data.error, /RTF/)
    page.openSelectedFile({ name: 'late.rtf', path: '/fixture/late.rtf' }); const late = reads.shift()
    open({ name: 'current', source: '{\\rtf1 CURRENT}', expected: 'CURRENT' })
    late.success({ data: Buffer.from(cases[0].source) })
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, 'CURRENT')
  } finally { page.disposeHtmlRuntime() }
})

test('table boundaries stay in the correct note stream, preserve anchor navigation and discard hidden notes', () => {
  let bytes
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const row = '\\trowd\\cellx2000\\cellx4000\\intbl LEFT{\\v HIDDEN\\cell}RIGHT{\\v\\cell\\row}\\pard '
  const scrolls = []; page.scrollToDomNid = nid => scrolls.push(nid)
  try {
    for (const kind of ['', '\\ftnalt ']) {
      bytes = Buffer.from('{\\rtf1 BODY\\chftn{\\footnote ' + kind + '\\chftn ' + row + '}\\par AFTER}')
      page.openSelectedFile({ name: 'note.rtf', path: '/fixture/note.rtf', size: bytes.length })
      assert.equal(page.data.error, '')
      const d = page._htmlRuntime.document, pres = d.querySelectorAll('pre')
      assert.match(pres[0].textContent, /^BODY(?:1|i)\nAFTER$/)
      assert.match(pres[1].textContent, /LEFT\tRIGHT/)
      assert.doesNotMatch(d.body.textContent, /HIDDEN/)
      const link = d.querySelector('a[href^="#"]'), id = link.getAttribute('href').slice(1), target = d.getElementById(id)
      page.onDomTap({ currentTarget: { dataset: { nid: link._nid } } })
      assert.equal(scrolls.at(-1), target._nid)
    }
    bytes = Buffer.from('{\\rtf1 BODY{\\v\\chftn{\\footnote\\chftn ' + row + '}}AFTER}')
    page.openSelectedFile({ name: 'hidden-note.rtf', path: '/fixture/note.rtf', size: bytes.length })
    assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.body.textContent, 'BODYAFTER')
  } finally { page.disposeHtmlRuntime() }
})
