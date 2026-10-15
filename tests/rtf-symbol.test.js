'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { readerPage } = require('./helpers/reader-host')
const head = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset2 Symbol;}{\f2\fcharset134 SimSun;}}`
const read = body => rtfToText(Buffer.from(head + body + '}'))

test('Symbol byte runs preserve Greek and mathematical content through raw and escaped syntax', () => {
  assert.equal(read(String.raw`\f1 ABC abc \'a3\'a5\'b1\'b4\'b6`), 'ΑΒΧ αβχ ≤∞±×∂')
  assert.equal(read(String.raw`\f1 \'41\'42\'43 \'61\'62\'63`), 'ΑΒΧ αβχ')
  assert.equal(read(String.raw`\f1 \\ \{ \}`), '∴ { }')
  assert.equal(read(String.raw`\f1 \'e6\'e7\'e8 \'f6\'f7\'f8`), '⎛⎜⎝ ⎞⎟⎠')
  assert.equal(read(String.raw`\f1 \'d2\'d3\'d4 \'e2\'e3\'e4`), '®©™ ®©™')
  assert.equal(read('\\f1 A\tB'), 'Α\tΒ')
  assert.equal(read(String.raw`\f1 A\tab B`), 'Α\tΒ')
  assert.equal(read(String.raw`\f1 A\'7fB`), 'Α\u007fΒ')
})

test('Symbol font switches restore Latin and CJK content and plain resets to the default', () => {
  assert.equal(read(String.raw`\f0 START {\f1 ABC abc} END`), 'START ΑΒΧ αβχ END')
  assert.equal(read(String.raw`\f1 ABC{\f2 \'d6\'d0}abc\plain ABC`), 'ΑΒΧ中αβχABC')
  const source = String.raw`{\rtf1\ansi\deff1{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset2 Symbol;}}ABC {\f0 abc\plain abc}}`
  assert.equal(rtfToText(Buffer.from(source)), 'ΑΒΧ abcαβχ')
})

test('Unicode has priority over fallback and Word PUA uses the symbol face in scope', () => {
  assert.equal(read(String.raw`\f1 \u913?\u914?\u935?`), 'ΑΒΧ')
  assert.equal(read(String.raw`\f1 \u-4031?\u-4030?\u-4029?`), 'ΑΒΧ')
  assert.equal(read(String.raw`\f1 \uc2\u945ab\uc1\u946\'ff\u967\bin2 {}`), 'αβχ')
  assert.equal(read(String.raw`{\f1 ABC}\u-4031?`), 'ΑΒΧ\uf041')
  assert.equal(read(String.raw`\f1 ABC\f0 \u-4031?`), 'ΑΒΧΑ')
  assert.equal(read(String.raw`\u-4031?`), '\uf041')
  assert.equal(read(String.raw`\f1 {\upr{old}{\*\ud \u945?}}`), 'α')
})

test('font name parsing ignores optional names, respects Unicode fallbacks and ungrouped entries', () => {
  for (const name of ['Symbol', 'symbol', String.raw`S\'79mbol`, String.raw`\uc1\u83?ymbol`, String.raw`{\*\fname Wrong;}Symbol`, String.raw`Symbol{\*\falt Wrong}`, String.raw`{\upr{Wingdings}{\*\ud Symbol}}`, String.raw`\uc1\u83\bin1 ?ymbol`, String.raw`Sy{\*\unknown mbol}mbol`]) {
    const source = String.raw`{\rtf1\ansi\deff0{\fonttbl\f0\fcharset0 Arial;\f1\fcharset2 ` + name + String.raw`;}\f1 ABC\f0 abc}`
    assert.equal(rtfToText(Buffer.from(source)), 'ΑΒΧabc', name)
  }
  const source = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset2 Other{\*\falt Symbol};}}\f1 ABC}`
  assert.throws(() => rtfToText(Buffer.from(source)), /符号字体/)
})

test('explicit codepages override charset and unknown glyphs do not become Latin success', () => {
  assert.equal(rtfToText(Buffer.from(String.raw`{\rtf1\ansi{\fonttbl{\f1\fcharset2\cpg1252 Symbol;}}\f1 ABC\'e9}`)), 'ABCé')
  assert.equal(rtfToText(Buffer.from(String.raw`{\rtf1\ansi{\fonttbl{\f1\fcharset0\cpg42 Symbol;}}\f1 ABC}`)), 'ΑΒΧ')
  for (const face of ['Wingdings', 'Arial', 'Symbolic', 'x'.repeat(129) + 'Symbol']) {
    assert.throws(() => rtfToText(Buffer.from(head.replace('Symbol;', face + ';') + String.raw`\f1 ABC}`)), /符号字体/)
    assert.equal(rtfToText(Buffer.from(head.replace('Symbol;', face + ';') + String.raw`\f1 \u945?}`)), 'α')
  }
  for (const byte of ['60', '80', '9f', 'f0', 'ff']) assert.throws(() => read(String.raw`\f1 \'` + byte), /字形/)
})

test('hidden symbol text, discarded metadata and bounded runs remain isolated', () => {
  assert.equal(read(String.raw`A{\v\f1 SECRET{\v0 abc}}Z`), 'AαβχZ')
  assert.equal(read(String.raw`A{\*\unknown\f1\'ff}Z`), 'AZ')
  assert.equal(read(String.raw`\f1 ` + 'a'.repeat(8193)), 'α'.repeat(8193))
  assert.throws(() => read(String.raw`\f1 ` + 'a'.repeat(8192) + String.raw`\'ff`), /字形/)
  assert.equal(read(String.raw`\f0 recovered`), 'recovered')
})

test('actual reader entry shows Symbol content and recovers after unsupported fonts and stale reads', async () => {
  let bytes, delayed
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => { if (o.filePath === '/local/late.rtf') delayed = o; else o.success({ data: bytes }) } }) })
  const open = async (body, name = 'symbols.rtf') => {
    bytes = Buffer.from(head + body + '}')
    host.openSelectedFile({ name, path: '/local/' + name, size: bytes.length })
    await new Promise(setImmediate)
  }
  try {
    await open(String.raw`\f1 ABC abc \'a3\'a5`)
    assert.equal(host.data.error, '')
    assert.equal(host._htmlRuntime.document.body.textContent.trim(), 'ΑΒΧ αβχ ≤∞')
    await open(String.raw`\f1 \'ff`)
    assert.match(host.data.error, /字形/)
    assert.equal(host.data.hasContent, false)
    await open(String.raw`\f1 ABC`, 'late.rtf')
    await open(String.raw`\f0 recovered`)
    delayed.success({ data: Buffer.from(head + String.raw`\f1 ABC}`) })
    await new Promise(setImmediate)
    assert.equal(host._htmlRuntime.document.body.textContent.trim(), 'recovered')
    assert.equal(host.data.error, '')
  } finally { host.detached() }
})
