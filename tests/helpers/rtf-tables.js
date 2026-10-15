'use strict'

const { wrap, unicode, pair } = require('./rtf-alternatives')
const cell = text => unicode(text) + '\\nestcell{\\nonesttables BACKUP\\par}'
const row = cells => cells.map(cell).join('') + '{\\*\\nesttableprops\\trowd\\cellx1000\\cellx2000\\nestrow}{\\nonesttables OLD ROW\\par}'
const cases = [
  { name: 'destination-source-line-breaks', body: 'A\\nestcell B\\nestcell{\\*\r\n\\nesttableprops\\nestrow}End', expected: 'A\tB\t\nEnd' },
  { name: 'nested-row-properties', body: 'A\\nestcell B\\nestcell{\\*\\nesttableprops\\trowd\\nestrow}C\\cell\\row', expected: 'A\tB\t\nC' },
  { name: 'plain-nested-row', body: 'A\\nestcell B\\nestcell\\nestrow C', expected: 'A\tB\t\nC' },
  { name: 'selected-unicode-table', body: pair('OLD', row(['甲', '乙'])) + 'End', expected: '甲\t乙\t\nEnd' },
  { name: 'hidden-properties', body: 'A{\\*\\unknown{\\*\\nesttableprops\\nestrow}}Z', expected: 'AZ' },
  { name: 'hidden-font-properties', body: 'A{\\fonttbl{\\*\\nesttableprops\\nestrow}}Z', expected: 'AZ' },
  { name: 'discarded-ansi-properties', body: pair('{\\*\\nesttableprops\\nestrow}', 'Selected'), expected: 'Selected' },
  { name: 'property-text-hidden', body: 'A{\\*\\nesttableprops SHOULD NOT SHOW{\\*\\unknown\\nestrow}\\nestrow}Z', expected: 'A\nZ' },
  { name: 'properties-do-not-change-fonts', body: '{\\fonttbl{\\f0\\fcharset0 Arial;}}\\deff0{\\*\\nesttableprops\\fonttbl\\f0\\fcharset134\\nestrow}Caf\\\'e9', expected: 'Café' },
  { name: 'fallback-control-count', body: '\\uc1\\u20320\\nestcell X\\nestcell\\nestrow Z', expected: '你X\t\nZ' },
  { name: 'metadata-prefix-lookalike', body: 'A{\\*\\nesttablepropsExtra\\nestrow}Z', expected: 'AZ' },
  { name: 'properties-not-inherited-by-child', body: 'A{\\*\\nesttableprops{\\nestrow}\\nestrow}Z', expected: 'A\nZ' },
  { name: 'fallback-font-isolation', body: '{\\fonttbl{\\f0\\fcharset0 Arial;}}\\deff0 A{\\nonesttables{\\fonttbl{\\f0\\fcharset134 SimSun;}}BAD}Caf\\\'e9', expected: 'ACafé' },
  { name: 'visible-list-marker', body: '{\\pntext 1.\\tab}{\\*\\pn\\pndec\\pnstart1}One\\par{\\listtext 2.\\tab}Two', expected: '1.\tOne\n2.\tTwo' },
  { name: 'visible-list-unicode-marker', body: '{\\listtext\\u8226?\\tab}'+unicode('条目'), expected: '•\t条目' }
]
for (let n = 0; n < 60; n++) {
  const cells = Array.from({ length: 1 + n % 4 }, (_, c) => ['中文', 'Česká', '😀', 'Cell'][c] + '-' + n)
  const second = cells.map(c => c + 'b')
  cases.push({ name: 'table-variant-' + n, body: 'Before\\par ' + row(cells) + row(second) + 'After', expected: 'Before\n' + cells.join('\t') + '\t\n' + second.join('\t') + '\t\nAfter' })
}
for (const c of cases) c.source = wrap(c.body)
module.exports = { cases, row, cell }
