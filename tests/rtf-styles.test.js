'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases } = require('./fixtures/rtf-styles/samples.json')

for (const sample of cases) {
  test('RTF style visible content: ' + sample.name, () => {
    const bytes = Buffer.from(sample.source)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sha256)
    assert.equal(rtfToText(bytes), sample.expected, sample.expectedBasis)
  })
}

const wrap = (styles, body) => '{\\rtf1\\ansi{\\stylesheet' + styles + '}' + body + '}'
const hidden = String.raw`{\s0 Normal;}{\s1\v Hidden;}{\*\cs10\additive\v HiddenChar;}`

test('RTF style metadata and optional destinations cannot leak or redefine display styles', () => {
  const cases = [
    [String.raw`{\s0 {\*\keycode\v\s1 X}Normal;}{\s1\v Hidden;}`, String.raw`A{\s1 SECRET}B`, 'AB'],
    [String.raw`{\v Normal;}`, String.raw`SECRET\v0 VISIBLE`, 'VISIBLE'],
    [hidden + String.raw`{\*\unknown\cs10\v0 Leak;}`, String.raw`A{\cs10 SECRET}B`, 'AB'],
    [hidden + String.raw`{\*\cs20\additive{\v Nested;}Neutral;}`, String.raw`A{\cs20 VISIBLE}B`, 'AVISIBLEB'],
    [hidden + String.raw`{\cs22\v InvalidNonstarChar;}`, 'VISIBLE', 'VISIBLE'],
    [hidden + String.raw`{\ds1\v0 Section;}`, String.raw`\s1 SECRET\par\pard VISIBLE`, 'VISIBLE'],
    [hidden + String.raw`{\s3\shidden MenuHidden;}`, String.raw`\s3 VISIBLE`, 'VISIBLE'],
    [String.raw`{\s0\uc1\u65\v Normal;}`, 'VISIBLE', 'VISIBLE'],
    [hidden + String.raw`{\s3\uc1\u65\s1 Name;}`, String.raw`\s1 SECRET\par\pard\s3 VISIBLE`, 'VISIBLE']
  ]
  for (const [sheet, body, expected] of cases) assert.equal(rtfToText(wrap(sheet, body)), expected)
  assert.equal(rtfToText(String.raw`{\rtf1{\*\unknown{\stylesheet{\s0\v Hidden;}}}VISIBLE}`), 'VISIBLE')
  assert.equal(rtfToText(String.raw`{\rtf1{\upr{{\stylesheet{\s0\v Hidden;}}OLD}{\*\ud VISIBLE}}AFTER}`), 'VISIBLEAFTER')
  assert.equal(rtfToText(String.raw`{\rtf1{\pict\bin26 {\stylesheet{\s0\v Fake;}}}VISIBLE}`), 'VISIBLE')
})

test('RTF style inheritance is forward-resolved, kind-scoped, group-scoped and explicitly overridden', () => {
  const sheet = hidden + String.raw`{\*\cs11\sbasedon12 Child;}{\*\cs12\sbasedon10 Parent;}{\*\cs13\sbasedon11\v0 Visible;}{\*\cs14\sbasedon99 Missing;}{\*\cs15\sbasedon1 WrongKind;}{\s222\v Numbered;}{\s4\sbasedon222 NoBase;}`
  for (const [body, expected] of [
    [String.raw`A{\cs11 SECRET{\v0 INNER}SECRET}B`, 'AINNERB'],
    [String.raw`A{\cs13 VISIBLE}B`, 'AVISIBLEB'],
    [String.raw`\s1{\cs14 SECRET}{\cs15 SECRET}\par\pard VISIBLE`, 'VISIBLE'],
    [String.raw`A{\cs10 SECRET\plain VISIBLE}B`, 'AVISIBLEB'],
    [String.raw`\s222 SECRET\par\pard\s4 VISIBLE`, 'VISIBLE']
  ]) assert.equal(rtfToText(wrap(sheet, body)), expected)
})

test('RTF styles still validate hidden byte runs, Unicode and binary lengths, then recover', () => {
  for (const body of [String.raw`\s1\ansicpg65001\'ff`, String.raw`\cs10\ansicpg1252\'81`, String.raw`\cs10\u999999?`, String.raw`\cs10\bin999 X`, String.raw`\cs10\'xz`]) {
    assert.throws(() => rtfToText(Buffer.from(wrap(hidden, body))), /RTF/)
    assert.equal(rtfToText('{\\rtf1 VISIBLE}'), 'VISIBLE')
  }
  const { encodedRtf } = require('./helpers/rtf-samples')
  const bytes = encodedRtf('A'.repeat(8191) + '中文'.repeat(4500), 'gbk', 936, 2)
  assert.equal(rtfToText(Buffer.concat([Buffer.from(wrap(hidden, 'A{\\cs10 ').slice(0, -1)), bytes, Buffer.from('}B}')])), 'AB')
})

test('RTF style chains have linear resolution, no recursive stack growth, and bounded cycle failure', () => {
  const definitions = Array.from({ length: 20000 }, (_, i) => `{\\s${i + 1000}\\sbasedon${i + 1001} S;}`).join('') + '{\\s21000\\v Hidden;}'
  const body = Array.from({ length: 1000 }, (_, i) => `\\s${i + 1000} SECRET\\par`).join('') + '\\pard VISIBLE'
  assert.equal(rtfToText(wrap(definitions, body)), 'VISIBLE')
  const cycle = String.raw`{\s1\sbasedon2 One;}{\s2\sbasedon1 Two;}`
  assert.equal(rtfToText(wrap(cycle, 'VISIBLE')), 'VISIBLE')
  assert.throws(() => rtfToText(wrap(cycle, '\\s1 UNKNOWN')), /RTF.*循环/)
  assert.equal(rtfToText(wrap('{\\s1\\sbasedon99 Missing;}', '\\s1 VISIBLE')), 'VISIBLE')
  assert.equal(rtfToText('{\\rtf1 VISIBLE}'), 'VISIBLE')
})

test('RTF style file entry preserves visible text, rejects all-hidden/cyclic input and recovers on one host', () => {
  const { readerPage } = require('./helpers/reader-host')
  let bytes
  const page = readerPage({ getFileSystemManager: () => ({ readFile: options => options.success({ data: bytes }) }) })
  const broken = { name: 'cycle', source: wrap(String.raw`{\s1\sbasedon1 Cycle;}`, '\\s1 UNKNOWN'), expected: '' }
  try {
    for (const sample of [...cases, broken, cases[0]]) {
      bytes = Buffer.from(sample.source)
      page.openSelectedFile({ name: sample.name + '.rtf', path: '/local/styles.rtf', size: bytes.length })
      if (!sample.expected) {
        assert.match(page.data.error, /RTF/, sample.name)
        assert.equal(page.data.hasContent, false, sample.name)
      } else {
        assert.equal(page.data.error, '', sample.name)
        assert.equal(page.data.hasContent, true, sample.name)
        assert.equal(page._htmlRuntime.document.body.textContent.trim(), sample.expected, sample.name)
      }
    }
  } finally { page.detached() }
})
