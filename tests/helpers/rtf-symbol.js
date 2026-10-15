'use strict'
const header = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset2 Symbol;}{\f2\fcharset134 SimSun;}}`
const cases = [
  ['ascii-greek', String.raw`\f1 ABC abc`, 'ΑΒΧ αβχ'],
  ['hex-greek', String.raw`\f1 \'41\'42\'43 \'61\'62\'63`, 'ΑΒΧ αβχ'],
  ['word-private-use', String.raw`\f1 \u-4031?\u-4030?\u-4029?`, 'ΑΒΧ'],
  ['unicode-fallback', String.raw`\f1 \u913?\u914?\u935?`, 'ΑΒΧ'],
  ['font-switch', String.raw`\f0 START {\f1 ABC abc} END`, 'START ΑΒΧ αβχ END'],
  ['math', String.raw`\f1 \'a3\'a5\'b1\'b4\'b6`, '≤∞±×∂'],
  ['escaped-operators', String.raw`\f1 \\ \{ \}`, '∴ { }'],
  ['fragments', String.raw`\f1 \'e6\'e7\'e8 \'f6\'f7\'f8`, '⎛⎜⎝ ⎞⎟⎠'],
  ['copyright-variants', String.raw`\f1 \'d2\'d3\'d4 \'e2\'e3\'e4`, '®©™ ®©™'],
  ['vertical-extender', String.raw`\f1 \'bd`, '⏐'],
  ['cjk-switch', String.raw`\f1 ABC{\f2 \'d6\'d0}abc\plain ABC`, 'ΑΒΧ中αβχABC'],
  ['upr', String.raw`\f1 {\upr{old}{\*\ud \u945?}}`, 'α'],
  ['unicode-only-unknown-face', String.raw`\f1 \u945?`, 'α', 'Wingdings'],
  ['unknown-face', String.raw`\f1 ABC`, null, 'Wingdings'],
  ['unused-unknown-face', String.raw`\f0 ABC`, 'ABC', 'Wingdings'],
  ['unsupported-radical-extender', String.raw`\f1 \'60`, null],
  ['unsupported-undefined', String.raw`\f1 \'ff`, null],
  ['hidden', String.raw`A{\v\f1 SECRET{\v0 abc}}Z`, 'AαβχZ'],
  ['plain-reset', String.raw`\f1 ABC\plain abc`, 'ΑΒΧabc'],
  ['recovery', String.raw`\f0 recovered`, 'recovered']
].map(([name, body, expected, face]) => ({ name, source: (face ? header.replace('Symbol;', face + ';') : header) + body + '}', expected }))
for (const [name, face] of [['hex-name', String.raw`S\'79mbol`], ['unicode-name', String.raw`\uc1\u83?ymbol`], ['alternate-name', String.raw`Symbol{\*\falt Wingdings}`], ['non-tagged-name', String.raw`{\*\fname Wingdings;}Symbol`]]) {
  cases.push({ name, source: header.replace('Symbol;', face + ';') + String.raw`\f1 ABC}`, expected: 'ΑΒΧ' })
}
module.exports = { cases }
