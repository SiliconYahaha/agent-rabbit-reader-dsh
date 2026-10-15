'use strict'
const fixture = require('../fixtures/rtf-korean/characters.json')
const hex = bytes => bytes.map(byte => "\\'" + byte.toString(16).padStart(2, '0')).join('')
const cases = []
for (const source of fixture.sources) {
  const text = 'A'.repeat(source.prefix) + source.text
  const characters = [...Array.from({ length: source.prefix }, () => [65]), ...source.characters]
  const bytes = characters.flat(), body = hex(bytes)
  const fallback = Array.from(text, (char, i) => characters[i].length === 2
    ? '\\u' + (char.charCodeAt(0) > 32767 ? char.charCodeAt(0) - 65536 : char.charCodeAt(0)) + hex(characters[i]) : hex(characters[i])).join('')
  const mixed = bytes.map((byte, i) => [92, 123, 125].includes(byte) || i % 2 ? hex([byte]) : String.fromCharCode(byte)).join('')
  const definitions = [
    ['document', '{\\rtf1\\ansi\\ansicpg949 ' + body + '}', text],
    ['font-charset', '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset129 Korean;}}\\f0 ' + body + '}', text],
    ['font-codepage', '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0\\cpg949 Korean;}}\\f0 ' + body + '}', text],
    ['group-switch', '{\\rtf1\\ansi\\ansicpg1252 caf' + hex([233]) + ' {\\ansicpg949 ' + body + '} ' + hex([128]) + '}', 'café ' + text + ' €'],
    ['unicode-fallback', '{\\rtf1\\ansi\\ansicpg949\\uc2 ' + fallback + '}', text],
    ['mixed-raw-hex', '{\\rtf1\\ansi\\ansicpg949 ' + mixed + '}', text]
  ]
  for (const [kind, rtf, expected] of definitions) cases.push({ id: source.id + '-' + kind, rtf, expected })
}
module.exports = { cases, seed: fixture.seed }
