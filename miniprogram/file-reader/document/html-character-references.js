'use strict'

const names = require('./html-named-entities')
const hasOwn = (key) => Object.prototype.hasOwnProperty.call(names, key)
const longestName = 32
// HTML numeric references preserve controls except these Windows-1252 aliases.
const c1 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178]

function decodeCharacterReferences (value, inAttribute = false) {
  const source = String(value == null ? '' : value)
  const output = []
  let cursor = 0, literalStart = 0
  while ((cursor = source.indexOf('&', cursor)) !== -1) {
    const start = cursor++
    let end = cursor, replacement
    if (source[cursor] === '#') {
      end = cursor + 1
      const hex = source[end] === 'x' || source[end] === 'X'
      if (hex) end++
      const digitsStart = end
      let code = 0
      while (end < source.length) {
        const char = source.charCodeAt(end)
        const digit = char >= 48 && char <= 57 ? char - 48 : hex && char >= 65 && char <= 70 ? char - 55 : hex && char >= 97 && char <= 102 ? char - 87 : -1
        if (digit < 0) break
        // Saturate while consuming all digits: no overflow, huge integer, or retry.
        code = Math.min(0x110000, code * (hex ? 16 : 10) + digit)
        end++
      }
      if (end === digitsStart) continue
      if (source[end] === ';') end++
      if (code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) code = 0xfffd
      else if (code >= 0x80 && code <= 0x9f) code = c1[code - 0x80]
      replacement = String.fromCodePoint(code)
    } else {
      let matched = ''
      for (let stop = cursor; stop < source.length && stop - cursor < longestName; stop++) {
        const char = source[stop]
        if (!/[a-zA-Z0-9;]/.test(char)) break
        const candidate = source.slice(cursor, stop + 1)
        if (hasOwn(candidate)) { matched = candidate; end = stop + 1 }
        if (char === ';') break
      }
      if (!matched) continue
      if (inAttribute && !matched.endsWith(';') && /[a-zA-Z0-9=]/.test(source[end] || '')) continue
      replacement = names[matched]
    }
    output.push(source.slice(literalStart, start), replacement)
    literalStart = cursor = end
  }
  output.push(source.slice(literalStart))
  return output.join('')
}

module.exports = { decodeCharacterReferences }
