'use strict'
const retained = require('../fixtures/ai-lexical/before.json')
const head = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n'
const rect = (x, color) => `${color} setrgbcolor\n${x} 0 moveto\n${x + 20} 0 lineto\n${x + 20} 20 lineto\n${x} 20 lineto\nclosepath fill\n`
const fakePreview = '%%BeginPreview: 1 1 8 1\n% ff\n%%EndPreview'
function expandedCases () {
  const bodies = {
    escapedClose: '(escaped \\)\n%%EOF\n) pop',
    escapedOpen: '(escaped \\(\n%%EOF\n) pop',
    escapedSlash: '(escaped \\\\\n%%EOF\n) pop',
    continuation: '(continued\\\n%%EOF\n) pop',
    midlineComment: '(text)%%EOF\n',
    multilineMidline: '(\ntext)%%HiResBoundingBox: 0 0 1 1\n',
    commentParens: '% ( unmatched parentheses in a real comment\n',
    commentEnd: '(text) % ( not a new string\n',
    twoStrings: '(first\n%%EOF\n) (second\n%%BeginBinary: 999999\n) pop pop',
    hexDictionary: '<< /text <283e0a2525454f460a29> >> pop',
    ascii85: '<~!!!!!>\n%%EOF\n!!!!~> pop',
    ascii85VectorProse: '<~> 0 0 9 9 re f !!!!!!!~> pop',
    nestedDocument: '%%BeginDocument: child.eps\n(\n%%EndDocument\n%%EOF\n) pop\n%%EOF\n%%EndDocument',
    opaqueBytes: '%%BeginBinary: 7\n()(<~\r\n%%EndBinary',
    realNextLine: '(\nignored) pop\n%%BeginDocument: child\n%%HiResBoundingBox: 0 0 1 1\n%%EndDocument'
  }
  const rows = []
  for (const [ending, eol] of [['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n']]) {
    for (const [id, body] of Object.entries(bodies)) {
      // Binary has a byte count, so preserve its exact opaque bytes independently.
      if (id === 'opaqueBytes' && ending !== 'lf') continue
      const source = (head + rect(0, '1 0 0') + body + '\n' + rect(20, '0 0 1') + '%%EOF\n').replace(/\n/g, eol)
      rows.push({ name: `${id}-${ending}`, source, expected: { width: 40, height: 20, paths: 2, rasterPreview: false }, native: !['opaqueBytes', 'ascii85VectorProse'].includes(id) && (ending === 'lf' || id === 'continuation') })
    }
  }
  rows.push({ name: 'fake-preview-only', source: head + '(\n' + fakePreview + '\n) pop\n%%EOF\n', expected: { noPreview: true }, native: true })
  rows.push({ name: 'real-preview-after-string', source: head + '(\n' + fakePreview + '\n) pop\n' + fakePreview.replace('% ff', '% 00') + '\n%%EOF\n', expected: { rasterPreview: true, pixel: [255, 255, 255, 255] }, native: false })
  return rows.concat(require('../fixtures/ai-lexical/array-before.json').cases)
}
function malformedCases () {
  return ['(unterminated', '<1234', '<~!!!!!', '('.repeat(1025) + ')'.repeat(1025)].map((body, index) => ({ name: `malformed-${index}`, source: head + rect(0, '1 0 0') + body, expected: { error: /字符串/ } }))
}
module.exports = { originalCases: retained.cases, expandedCases, malformedCases, head, rect }
