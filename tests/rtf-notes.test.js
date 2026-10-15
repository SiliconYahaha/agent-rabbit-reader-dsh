'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { rtfToText, rtfToHtml } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases, expectedText, wrap, note, ref } = require('./helpers/rtf-notes')
const { readerPage } = require('./helpers/reader-host')
for (const group of ['base', 'writer']) test('RTF body/note content, reference labels and order: ' + group, () => {
  for (const c of cases.filter(c => c.name.startsWith('writer-') === (group === 'writer'))) {
    assert.equal(rtfToText(c.source), expectedText(c), c.name)
    assert.equal(rtfToText(Buffer.from(c.source)), expectedText(c), c.name + ' bytes')
  }
})
test('RTF actual reader entry retains all note contents and reciprocal anchor actions across file opens', () => {
  let bytes, previousNid
  const page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const scrolls = []
  page.scrollToDomNid = nid => scrolls.push(nid)
  for (const c of cases) {
    bytes = Buffer.from(c.source)
    page.openSelectedFile({ name: c.name + '.rtf', path: '/local/input.rtf', size: bytes.length })
    assert.equal(page.data.error, '', c.name)
    assert.equal(page.data.hasContent, true, c.name)
    const d = page._htmlRuntime.document
    const pre = d.querySelectorAll('pre')
    assert.equal(pre[0].textContent, c.body, c.name + ' body')
    assert.deepEqual(Array.from(pre).slice(1).map(n => n.textContent), [...c.footnotes, ...c.endnotes], c.name + ' notes')
    assert.equal(d.querySelector('script'), null, 'literal note markup never executes')
    if (previousNid != null) {
      const count = scrolls.length
      page.onDomTap({ currentTarget: { dataset: { nid: previousNid } } })
      assert.equal(scrolls.length, count, c.name + ' stale node')
    }
    const links = d.querySelectorAll('a')
    for (const a of links) {
      const target = d.getElementById(a.getAttribute('href').slice(1))
      assert.ok(target, c.name + ' reference target')
      page.onDomTap({ currentTarget: { dataset: { nid: a._nid } } })
      assert.equal(scrolls.at(-1), target._nid, c.name + ' host anchor')
    }
    previousNid = links[0]._nid
  }
  page._htmlRuntime.destroy()
})
test('RTF references preserve custom Unicode codepoints across raw text and Unicode runs', () => {
  for (const mark of ['😀', '\\uc0\\u-10179\\u-8704 ']) {
    const source = wrap('A' + mark + '{\\footnote ' + mark + ' NOTE}B')
    assert.equal(rtfToText(source), 'A😀B\n\n脚注\n😀 NOTE')
    assert.ok(rtfToHtml(source).includes('<sup>😀</sup>'))
  }
})
test('RTF note output and numbering metadata cannot leak into parent paragraph or later notes', () => {
  assert.equal(rtfToText(wrap('A' + ref('\\ftnstart999 ONE\\par TWO') + 'B' + ref('THREE'))), 'A1B2\n\n脚注\n1ONE\nTWO\n\n2THREE')
  assert.equal(rtfToText(wrap('A{\\*\\unknown \\ftnstart999 ' + ref('HIDDEN') + '}B' + ref('NOTE'))), 'AB1\n\n脚注\n1NOTE')
  assert.equal(rtfToText(wrap('A' + ref('ONE\\par TWO') + '{\\v HIDDEN}B\\par C')), 'A1B\nC\n\n脚注\n1ONE\nTWO')
})
test('RTF hidden enclosing note groups stay hidden while preserving source numbering for later visible notes', () => {
  assert.equal(rtfToText(wrap('A{\\v\\chftn' + note('HIDDEN') + '}B' + ref('VISIBLE'))), 'AB2\n\n脚注\n2VISIBLE')
  assert.equal(rtfToText(wrap('A{\\v *}{\\footnote * NOTE}B')), 'AB\n\n脚注\n* NOTE')
  assert.ok(rtfToHtml(wrap('A{\\v *}{\\footnote * NOTE}B')).includes('<span id="rtf-ref-1"></span>'))
})
test('RTF unsupported numbering and original page restarts carry a visible bounded fallback', () => {
  for (const header of ['\\ftnnzodiac', '\\ftnnrlc\\ftnstart2000000000', '\\ftnnalc\\ftnstart2000000000']) {
    const text = rtfToText(wrap('A' + ref('NOTE') + 'B', header))
    assert.ok(text.startsWith('A注1B'))
    assert.ok(text.includes('暂未还原'))
    assert.ok(text.length < 200)
  }
  assert.ok(rtfToText(wrap('A' + ref('NOTE') + 'B', '\\ftnrstpg')).includes('未还原原始分页'))
})
test('RTF malformed note destinations/references and bounded-resource failures remain explicit', () => {
  for (const source of [wrap('A\\chftn'), wrap('A\\chftn{\\footnote1 NOTE}'), wrap('A' + ref('B' + note('NESTED'))), wrap('A' + ref('NOTE'), '\\ftnstart0'), wrap('A' + ref('\\bin999 X')), wrap('A{\\*\\unknown{\\footnote\\bin999 X}}')]) assert.throws(() => rtfToText(source), /RTF/)
  assert.throws(() => rtfToText(wrap(ref('N').repeat(4097))), /数量超过安全上限/)
  assert.throws(() => rtfToText(wrap('\\chftn'.repeat(16385))), /数量超过安全上限/)
  assert.equal(rtfToText(wrap('RECOVERY')), 'RECOVERY')
})
test('RTF near-limit note streams and large single note keep order with bounded work', () => {
  const text = rtfToText(wrap('A' + ref('X'.repeat(1024 * 1024)) + 'Z'))
  assert.ok(text.startsWith('A1Z\n\n脚注\n1'))
  assert.equal(text.length, 1024 * 1024 + 'A1Z\n\n脚注\n1'.length)
  const many = rtfToText(wrap(ref('N').repeat(4096)))
  assert.ok(many.endsWith('4096N'))
})
test('RTF stale file reads cannot replace a current note document, and parse failure recovers', () => {
  const reads = [], page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  page.openSelectedFile({ name: 'old.rtf', path: '/old.rtf', size: 10 })
  page.openSelectedFile({ name: 'new.rtf', path: '/new.rtf', size: 10 })
  reads[1].success({ data: Buffer.from(cases[0].source) })
  const current = page._htmlRuntime
  reads[0].success({ data: Buffer.from(wrap('OLD' + ref('OLDNOTE'))) })
  assert.equal(page._htmlRuntime, current)
  page.openSelectedFile({ name: 'bad.rtf', path: '/bad.rtf', size: 10 })
  reads[2].success({ data: Buffer.from(wrap('A\\chftn')) })
  assert.match(page.data.error, /注释引用/)
  page.openSelectedFile({ name: 'recovery.rtf', path: '/recovery.rtf', size: 10 })
  reads[3].success({ data: Buffer.from(cases[0].source) })
  assert.equal(page.data.error, '')
  assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, 'A1B')
  page._htmlRuntime.destroy()
})
test('RTF Writer-produced input retains its independent source bytes', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/rtf-notes/writer-notes.rtf'))
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '05e05656db39f15e4e6be9495021b12b63c44c2ebb9baa1be3d998cb7f70b852')
})
test('RTF retained native Writer evidence keeps source identity and all confirmed content comparisons', () => {
  const reference = require('./fixtures/rtf-notes-reference.json'), compact = s => s.replace(/\s+/g, '')
  assert.equal(reference.results.length, cases.length)
  for (const r of reference.results) {
    const c = cases.find(c => c.name === r.name)
    assert.equal(crypto.createHash('sha256').update(c.source).digest('hex'), r.sourceSha256)
    if (r.nativeContentMatch) assert.equal(compact(r.pages.join('')), compact([c.body, ...c.footnotes, ...c.endnotes].join('')), c.name)
  }
})
