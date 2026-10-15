'use strict'
const wrap = (body, header = '') => '{\\rtf1\\ansi' + header + ' ' + body + '}'
const note = (text, end = false, star = false) => '{' + (star ? '\\*' : '') + '\\footnote' + (end ? '\\ftnalt' : '') + '\\pard\\plain\\chftn ' + text + '}'
const ref = (text, end = false, star = false) => '\\chftn' + note(text, end, star)
const cases = []
const add = (name, source, body, footnotes = [], endnotes = [], oracle = true) => cases.push({ name, source, body, footnotes, endnotes, oracle })
for (const star of [false, true]) {
  const suffix = star ? '-starred' : ''
  add('single' + suffix, wrap('A' + ref('NOTE', false, star) + 'B'), 'A1B', ['1NOTE'])
  add('two' + suffix, wrap('A' + ref('FIRST', false, star) + 'B' + ref('SECOND', false, star) + 'C'), 'A1B2C', ['1FIRST', '2SECOND'])
  add('endnote' + suffix, wrap('A' + ref('NOTE', true, star) + 'B'), 'AiB', [], ['iNOTE'])
  add('paragraph' + suffix, wrap('A' + ref('FIRST\\par SECOND', false, star) + 'B'), 'A1B', ['1FIRST\nSECOND'])
  add('field' + suffix, wrap('A' + ref('{\\field{\\*\\fldinst HYPERLINK "about:blank"}{\\fldrslt LINK}}', false, star) + 'B'), 'A1B', ['1LINK'])
}
add('mixed', wrap('A' + ref('FOOT') + 'B' + ref('END', true) + 'C' + ref('SECOND') + 'D'), 'A1BiC2D', ['1FOOT', '2SECOND'], ['iEND'])
add('sibling-reference', wrap('A{\\super\\chftn}' + note('NOTE') + 'B'), 'A1B', ['1NOTE'])
add('custom-mark', wrap('A*{\\*\\footnote\\pard\\plain * NOTE}B'), 'A*B', ['* NOTE'], [], false)
for (const [name, header, labels] of [
  ['arabic-start', '\\ftnstart9', ['9', '10']],
  ['alpha-lower', '\\ftnnalc\\ftnstart27', ['aa', 'bb']],
  ['alpha-upper', '\\ftnnauc\\ftnstart26', ['Z', 'AA']],
  ['roman-lower', '\\ftnnrlc\\ftnstart4', ['iv', 'v']],
  ['roman-upper', '\\ftnnruc\\ftnstart9', ['IX', 'X']],
  ['chicago', '\\ftnnchi\\ftnstart7', ['‡‡', '§§']],
  ['circle', '\\ftnncnum\\ftnstart19', ['⑲', '⑳']],
  ['wide', '\\ftnndbar\\ftnstart12', ['１２', '１３']],
  ['section-roman', '\\sectd\\sftnnruc\\sftnstart4', ['IV', 'V']]
]) add(name, wrap('A' + ref('FIRST') + 'B' + ref('SECOND') + 'C', header), 'A' + labels[0] + 'B' + labels[1] + 'C', [labels[0] + 'FIRST', labels[1] + 'SECOND'])
add('section-restart', wrap('A' + ref('FIRST') + '\\sect\\sectd B' + ref('SECOND'), '\\ftnrestart'), 'A1\nB1', ['1FIRST', '1SECOND'])
add('section-continuous', wrap('A' + ref('FIRST') + '\\sect\\sectd B' + ref('SECOND')), 'A1\nB2', ['1FIRST', '2SECOND'])
add('unicode', wrap('A' + ref('\\u20320?\\u22909?') + 'B'), 'A1B', ['1你好'])
add('cp1250', wrap('A' + ref("\\'c8esk\\'fd") + 'B', '\\ansicpg1250'), 'A1B', ['1Český'])
add('note-hidden-run', wrap('A' + ref('ONE{\\v HIDDEN}TWO') + 'B'), 'A1B', ['1ONETWO'])
add('note-style-hidden', wrap('A' + ref('ONE{\\cs1 HIDDEN}TWO') + 'B', '{\\stylesheet{\\s0 Normal;}{\\*\\cs1\\v Hidden;}}'), 'A1B', ['1ONETWO'])
add('body-paragraph-state', wrap('A' + ref('FIRST\\par SECOND') + '\\par B'), 'A1\nB', ['1FIRST\nSECOND'])
add('note-table', wrap('A' + ref('\\trowd\\cellx2000\\cellx4000\\intbl X\\cell Y\\cell\\row') + 'B'), 'A1B', ['1X\tY'], [], false)
add('unknown-parent', wrap('A{\\*\\unknown ' + ref('HIDDEN', false, true) + '}B' + ref('NOTE')), 'AB1', ['1NOTE'])
add('ansi-discard', wrap('A{\\upr{' + ref('OLD') + '}{\\*\\ud NEW}}B' + ref('NOTE')), 'ANEWB1', ['1NOTE'], [], false)
add('note-unicode-alternative', wrap('A' + ref('{\\upr{OLD}{\\*\\ud NEW}}') + 'B'), 'A1B', ['1NEW'], [], false)
add('html-escape', wrap('A' + ref('<script>BAD</script> & <img>') + 'B'), 'A1B', ['1<script>BAD</script> & <img>'])
add('missing-note-marker', wrap('A\\chftn{\\footnote NOTE}B'), 'A1B', ['1 NOTE'], [], false)
add('literal-number-note', wrap('A\\chftn{\\footnote 123}B'), 'A1B', ['1 123'], [], false)
add('hidden-enclosing-note', wrap('A{\\v\\chftn' + note('HIDDEN') + '}B' + ref('VISIBLE')), 'AB2', ['2VISIBLE'])
const fs = require('node:fs'), path = require('node:path')
const numberingBase = fs.readFileSync(path.join(__dirname, '../fixtures/rtf-notes/writer-numbering-base.rtf'), 'utf8')
for (const c of cases.filter(c => ['arabic-start', 'alpha-lower', 'alpha-upper', 'roman-lower', 'roman-upper', 'chicago', 'circle', 'wide', 'section-roman'].includes(c.name))) {
  const format = c.source.match(/\\s?ftnn([a-z]+)/)?.[1] || 'ar', start = c.source.match(/\\s?ftnstart(\d+)/)[1]
  const source = numberingBase.replace(/\\sftnnar\b/g, '\\sftnn' + format).replace(/\\ftnnar\b/g, '\\ftnn' + format).replace(/\\ftnstart1\b/g, '\\ftnstart' + start)
  add('writer-' + c.name, source, c.body, c.footnotes.map(n => n.replace(/(FIRST|SECOND)/, '\t$1')), [], !['circle', 'wide'].includes(c.name))
}
add('writer-export', fs.readFileSync(path.join(__dirname, '../fixtures/rtf-notes/writer-notes.rtf'), 'utf8'), 'Body A1 B.\nBody Ci D.\nBody E* F.', ['1\tFirst footnote.\nSecond note paragraph.', '*\tCustom marked note.'], ['i\tSeparate endnote.'])
const expectedText = c => [c.body, c.footnotes.length ? '脚注\n' + c.footnotes.join('\n\n') : '', c.endnotes.length ? '尾注\n' + c.endnotes.join('\n\n') : ''].filter(Boolean).join('\n\n')
module.exports = { cases, wrap, note, ref, expectedText }
