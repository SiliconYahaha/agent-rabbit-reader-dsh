'use strict'

const { unicode, pair } = require('./rtf-alternatives')
const wrap = body => '{\\rtf1\\ansi\\ansicpg1252\\uc1 ' + body + '}'
const cases = []
const add = (name, body, expected, oracle = true) => cases.push({ name, source: wrap(body), expected, oracle })
add('scoped', 'A{\\v HIDDEN}B', 'AB')
add('toggle', 'A\\v HIDDEN\\v0 B', 'AB')
add('explicit-on', 'A\\v1 HIDDEN\\v0 B', 'AB')
add('nested-visible', 'A{\\v HIDDEN{\\v0 VISIBLE}HIDDEN}B', 'AVISIBLEB')
add('nested-plain', 'A{\\v HIDDEN{\\plain VISIBLE}HIDDEN}B', 'AVISIBLEB')
add('plain-reset', 'A\\v HIDDEN\\plain B', 'AB')
add('paragraph-format-keeps-hidden', 'A{\\v HIDDEN\\pard STILL HIDDEN}B', 'AB')
add('formatting-keeps-hidden', 'A{\\v HIDDEN\\b\\i STILL HIDDEN}B', 'AB')
add('unicode-fallback', 'A{\\v ' + unicode('隐藏😀') + '}'+unicode('中文😀')+'B', 'A中文😀B')
add('fallback-control-is-not-toggle', 'A\\uc1\\u20320\\v B', 'A你B', false)
add('hidden-fallback-control-is-not-toggle', 'A{\\v\\uc1\\u20320\\v0 HIDDEN}B', 'AB', false)
add('hidden-symbols', 'A{\\v \\~\\_\\-\\emdash\\bullet\\tab HIDDEN}B', 'AB')
add('escaped-braces', 'A{\\v \\{HIDDEN\\}\\\\}B', 'AB')
add('field-result', 'A{\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt Link{\\v HIDDEN}}}B', 'ALinkB')
add('ignored-destination-not-reopened', 'A{\\*\\unknown \\v0\\plain HIDDEN}B', 'AB')
add('metadata-not-reopened', 'A{\\info{\\title \\v0\\plain HIDDEN}}B', 'AB')
add('upr-visible-island', 'A{\\v HIDDEN'+pair('OLD', '\\v0 '+unicode('中文'))+'HIDDEN}B', 'A中文B', false)
add('upr-inherits-hidden', 'A{\\v '+pair('OLD', unicode('隐藏'))+'}B', 'AB', false)
add('upr-discarded-toggle', 'A'+pair('\\v OLD', 'VISIBLE')+'B', 'AVISIBLEB', false)
add('font-restored-by-plain', "{\\fonttbl{\\f0\\fcharset0 Arial;}{\\f1\\fcharset134 SimSun;}}\\deff0 A{\\v\\f1 \\'d6\\'d0\\plain Caf\\'e9}B", 'ACaféB')
add('codepage-after-unhide', "A{\\v\\ansicpg936 \\'d6\\'d0\\v0 \\'ce\\'c4}B", 'A文B')
// The payload tests binary token isolation, not image decoding. Writer emits a
// placeholder space for this invalid picture, retained as an oracle difference.
add('binary-braces', 'A{\\v HIDDEN{\\pict\\bin7 }SECRET}}B', 'AB', false)
add('paragraphs-outside-hidden', 'A{\\v HIDDEN}\\par B{\\v HIDDEN}\\par C', 'A\nB\nC')
add('html-escaped-body', unicode('<script>visible & safe</script>')+'{\\v HIDDEN}', '<script>visible & safe</script>')
add('all-hidden', '\\v HIDDEN', '')

// Generate combinations from an independent visible-segment construction.
// No reader function computes the expected output. Fixed seed makes failures reproducible.
const seed = 20260905
let state = seed
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
for (let i = 0; i < 24; i++) {
  let body = '', expected = ''
  for (let segment = 0; segment < 6; segment++) {
    const visible = ['正文', 'Café', '😀', '日本語', 'Ω', '<&>'][(next() >>> 16) % 6] + segment
    const token = unicode(visible), hidden = unicode('HIDDEN' + i)
    const shape = (next() >>> 16) % 4
    body += [
      '{\\v '+hidden+'{\\v0 '+token+'}'+hidden+'}',
      '{\\v '+hidden+'\\plain '+token+'}',
      '\\v '+hidden+'\\v0 '+token,
      token+'{\\v '+hidden+'{\\b '+hidden+'}}'
    ][shape]
    expected += visible
  }
  add('generated-' + i, body, expected)
}
const malformed = [
  ['hidden-truncated-bin', 'A{\\v\\bin999 x}B'],
  ['hidden-invalid-bin', 'A{\\v\\bin-1 x}B'],
  ['hidden-truncated-group', 'A{\\v HIDDEN'],
  ['hidden-invalid-hex', "A{\\v\\'xz}B"],
  ['hidden-invalid-codepage-bytes', "A{\\v\\ansicpg936\\'d6}B"],
  ['hidden-invalid-unicode', 'A{\\v\\u999999?}B']
].map(([name, body]) => ({ name, source: wrap(body) }))
module.exports = { cases, malformed, seed }
