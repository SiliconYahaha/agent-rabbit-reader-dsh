'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { rtfToText, rtfToHtml } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases } = require('./helpers/rtf-korean-cases')
for (const sample of cases) test('RTF CP949 ' + sample.id + ' preserves independently encoded text', () => {
  assert.equal(rtfToText(Buffer.from(sample.rtf, 'latin1')), sample.expected)
  if (sample.id.startsWith('extended-hangul')) assert.match(rtfToHtml(Buffer.from(sample.rtf, 'latin1')), /뷁 똠 쀍 안녕하세요/)
})
test('RTF CP949 font switching restores Western bytes after a Korean group', () => {
  const input = "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Western;}{\\f1\\fcharset129 Korean;}}\\f0 caf\\'e9 {\\f1 \\'be\\'c8} \\'80}"
  assert.equal(rtfToText(input), 'café 안 €')
})
test('RTF CP949 malformed and hidden malformed byte runs remain explicit failures', () => {
  for (const body of ["\\'be", "\\'81\\'20", "\\v \\'be"]) {
    assert.throws(() => rtfToText('{\\rtf1\\ansi\\ansicpg949 ' + body + '}'), /不匹配/)
  }
  assert.equal(rtfToText("{\\rtf1\\ansi\\ansicpg949 \\'be\\'c8}"), '안')
})
test('RTF Johab is not silently treated as CP949', () => {
  assert.throws(() => rtfToText("{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset130 Korean;}}\\f0 \\'88\\'61}"), /不支持代码页 1361/)
})
