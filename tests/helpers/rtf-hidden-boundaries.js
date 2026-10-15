'use strict'
// Construct the visible cell sequence independently of the RTF reader.
const wrap = content => '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Arial;}}{\\stylesheet{\\s0 Normal;}{\\*\\cs1\\v Hidden;}{\\*\\cs2\\v0 Visible;}}\\uc1 BEFORE\\par ' + content + '\\pard\\par AFTER}'
const cases = []
for (const nested of [false, true]) {
  const cell = nested ? '\\nestcell ' : '\\cell '
  const rowEnd = nested ? '{\\*\\nesttableprops\\trowd\\itap2\\cellx2000\\cellx4000\\cellx6000\\nestrow}' : '\\row '
  const rowStart = nested ? '\\intbl\\itap2 ' : '\\trowd\\cellx2000\\cellx4000\\cellx6000\\intbl '
  const specs = [
    ['hidden-cell-mark', 'LEFT\\v ' + cell + '\\v0 RIGHT' + cell + rowEnd, 'LEFT\tRIGHT\t\n'],
    ['hidden-content-and-cell', 'LEFT{\\v HIDDEN' + cell + '}RIGHT' + cell + rowEnd, 'LEFT\tRIGHT\t\n'],
    ['empty-hidden-middle', 'LEFT' + cell + '{\\v ' + cell + '}RIGHT' + cell + rowEnd, 'LEFT\t\tRIGHT\t\n'],
    ['whole-hidden-middle', 'LEFT' + cell + '{\\v HIDDEN' + cell + '}RIGHT' + cell + rowEnd, 'LEFT\t\tRIGHT\t\n'],
    ['hidden-row-end', 'LEFT' + cell + 'RIGHT' + cell + '{\\v ' + rowEnd + '}', 'LEFT\tRIGHT\t\n'],
    ['hidden-final-cell-and-row', 'LEFT' + cell + 'RIGHT{\\v ' + cell + rowEnd + '}', 'LEFT\tRIGHT\t\n'],
    ['whole-hidden-row', '{\\v HIDDEN' + cell + 'SECRET' + cell + rowEnd + '}', '\t\t\n'],
    ['nested-visible-island', '{\\v HIDDEN{\\v0 LEFT}' + cell + 'SECRET{\\v0 RIGHT}' + cell + rowEnd + '}', 'LEFT\tRIGHT\t\n']
  ]
  for (const [shape, body, visible] of specs) for (const mode of ['direct', 'character-style', 'field-result']) {
    let value = rowStart + body
    if (!shape.includes('middle')) value = value.replace(/\\cellx6000/g, '')
    const expectedCells = shape.includes('middle') ? ['LEFT', '', 'RIGHT'] : shape === 'whole-hidden-row' ? ['', ''] : ['LEFT', 'RIGHT']
    if (mode === 'character-style') value = value.replace(/\\v0\b/g, '\\cs2').replace(/\\v\b/g, '\\cs1')
    if (mode === 'field-result') value = '{\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt ' + value + '}}'
    if (nested) value = '\\trowd\\cellx8000\\intbl\\itap1 OUTER\\par ' + value + '\\pard\\intbl\\itap1 END\\cell\\row '
    const expected = 'BEFORE\n' + (nested ? 'OUTER\n' : '') + visible + (nested ? 'END\t\n' : '') + '\nAFTER'
    cases.push({ name: `${nested ? 'nested' : 'table'}-${shape}-${mode}`, shape, mode, source: wrap(value), expected, expectedCells })
  }
}
// Destination boundaries and Unicode fallback have their own visibility rules.
const isolation = [
  ['hidden-tab-is-text', 'A{\\v \\tab}B', 'AB'],
  ['hidden-line-is-text', 'A{\\v \\line}B', 'AB'],
  ['unknown-does-not-emit', 'A{\\*\\unknown \\cell\\nestcell\\row\\nestrow}B', 'AB'],
  ['metadata-does-not-emit', 'A{\\info \\cell\\nestcell\\row\\nestrow}B', 'AB'],
  ['fallback-cell-consumed', 'A\\uc1\\u20320\\cell B', 'A你B'],
  ['fallback-row-consumed', 'A\\uc1\\u20320\\row B', 'A你B'],
  ['fallback-nested-cell-consumed', 'A\\uc1\\u20320\\nestcell B', 'A你B'],
  ['fallback-nested-row-consumed', 'A\\uc1\\u20320\\nestrow B', 'A你B'],
  ['discarded-alternative', 'A{\\upr{\\cell\\row OLD}{\\*\\ud NEW}}B', 'ANEWB'],
  ['nonesttables-copy', 'A{\\nonesttables\\cell\\row OLD}B', 'AB']
].map(([name, body, expected]) => ({ name, source: '{\\rtf1\\ansi ' + body + '}', expected }))
const original = require('../fixtures/rtf-hidden-boundaries/before.json').cases
const originalExpected = c => {
  const body = { plain: 'LEFT', unicode: '你好', field: 'LINK', hiddenIsland: 'VISIBLE', fallbackControl: '你TAIL', fallbackGroup: '你TAIL' }[c.body]
  if (c.container === 'paragraph') return 'BEFORE\n' + body + (c.boundary === 'visible' ? '\n' : '') + 'RIGHT\nAFTER'
  return 'BEFORE\n' + (c.container === 'nested' ? 'OUTER\n' : '') + body + '\tRIGHT\t\n' + (c.container === 'nested' ? 'END\t\n' : '') + '\nAFTER'
}
const contracts = [...original.map(c => ({ ...c, expected: originalExpected(c) })), ...cases, ...isolation]

module.exports = { cases, isolation, contracts }
