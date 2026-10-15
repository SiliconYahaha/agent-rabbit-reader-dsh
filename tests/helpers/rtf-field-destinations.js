'use strict'
const { unicode, pair } = require('./rtf-alternatives')
const wrap = body => '{\\rtf1\\ansi\\ansicpg1252\\uc1 ' + body + '}'
function field (body, fieldStar = false, resultStar = false, gap = '') {
  return '{' + (fieldStar ? '\\*' + gap : '') + '\\field{\\*\\fldinst HYPERLINK "https://example.com/NEVER-BODY"}{' + (resultStar ? '\\*' + gap : '') + '\\fldrslt ' + body + '}}'
}
const cases = []
function add (id, body, expected, oracle = true) { cases.push({ id, source: wrap(body), expected, oracle }) }
for (const where of ['none', 'field', 'result', 'both']) {
  for (const content of [
    { id: 'plain', source: 'Chosen', text: 'Chosen' },
    { id: 'unicode', source: unicode('中文😀'), text: '中文😀' },
    { id: 'hidden-run', source: '{\\v Secret}{\\v0 Visible}', text: 'Visible' },
    { id: 'fallback', source: '\\uc2\\u20320??\\uc0\\u22909', text: '你好' }
  ]) add(where + '-' + content.id, 'A' + field(content.source, where === 'field' || where === 'both', where === 'result' || where === 'both') + 'Z', 'A' + content.text + 'Z')
}
for (const where of ['field', 'result', 'both']) {
  const make = text => field(text, where !== 'result', where !== 'field')
  add(where + '-in-unknown', 'A{\\*\\unknown ' + make('Secret') + '}Z', 'AZ')
  add(where + '-in-info', 'A{\\info ' + make('Secret') + '}Z', 'AZ')
  add(where + '-in-hidden', 'A{\\v ' + make('Secret') + '}Z', 'AZ')
  add(where + '-restore-hidden', 'A{\\v ' + make('{\\v0 Visible}') + '}Z', 'AVisibleZ')
  add(where + '-upr-result', 'A' + make(pair('ANSI', unicode('Chosen'))) + 'Z', 'AChosenZ', false)
  add(where + '-upr-selected', 'A' + pair(make('ANSI'), make(unicode('Chosen'))) + 'Z', 'AChosenZ', false)
  add(where + '-upr-discarded', 'A' + pair(make('ANSI'), 'Chosen') + 'Z', 'AChosenZ', false)
}
add('nested-fields', 'A' + field('B' + field('C', true, true) + 'D', true, true) + 'Z', 'ABCDZ')
add('star-crlf', 'A' + field('Chosen', true, true, '\r\n') + 'Z', 'AChosenZ')
add('bare-star-result', 'A{\\*\\fldrslt Visible}Z', 'AVisibleZ')
add('escaped-markup', 'A' + field('\\{<b>&\\}\\\\', true, true) + 'Z', 'A{<b>&}\\Z')
add('result-prefix-unknown', 'A{\\*\\fldrsltExtra Secret}Z', 'AZ')
add('field-prefix-unknown', 'A{\\*\\fieldExtra Secret}Z', 'AZ')
add('instruction-remains-hidden', 'A{\\*\\fldinst ' + field('Secret', true, true) + '}Z', 'AZ')
add('binary-braces-in-instruction', 'A{\\*\\field{\\*\\fldinst \\bin8 {\\}abc{}}{\\*\\fldrslt Visible}}Z', 'AVisibleZ', false)
add('unknown-result-child', 'A' + field('B{\\*\\unknown{\\v0 Secret}}C', true, true) + 'Z', 'ABCZ')
const malformed = [
  { id: 'selected-truncated-binary', source: wrap(field('X\\bin99 abc', true, true)) },
  { id: 'selected-invalid-unicode', source: wrap(field('\\u999999?', true, true)) },
  { id: 'selected-invalid-codepage', source: wrap(field("\\ansicpg9999\\'80", true, true)) }
]
module.exports = { cases, malformed, field, wrap }
