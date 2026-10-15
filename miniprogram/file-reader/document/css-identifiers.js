'use strict'

const { preprocessCss, consumeCssName } = require('./css-escapes')
const { atomicEnd, blockEnd, trimCssWhitespace } = require('./css-structure')
const nameStart = c => Boolean(c) && (/[a-z_]/i.test(c) || c.codePointAt(0) >= 0x80)
function startsIdentifier (source, i) {
  const c = source[i], next = source[i + 1]
  return nameStart(c) || c === '\\' && next !== '\n' || c === '-' && (next === '-' || nameStart(next) || next === '\\' && source[i + 2] !== '\n')
}
function propertyKey (name) {
  const value = String(name)
  return value.startsWith('--') ? value : value.replace(/[A-Z]/g, c => c.toLowerCase())
}
// Decode names, not grammar. Escaped punctuation must remain a name character,
// never become a declaration separator, quote, function delimiter or number.
function serializeIdentifier (value, hash = false) {
  return Array.from(value, (c, i) => {
    const code = c.codePointAt(0)
    if (code >= 0x80 || /[a-z_-]/i.test(c) || /[0-9]/.test(c) && (hash || i > 0 && !(i === 1 && value[0] === '-'))) return c
    return '\\' + code.toString(16) + ' '
  }).join('')
}
function normalizeValueIdentifiers (value) {
  const source = preprocessCss(value), output = []
  for (let i = 0; i < source.length;) {
    const c = source[i]
    if (c === '"' || c === "'" || source.slice(i, i + 2) === '/*') {
      const end = atomicEnd(source, i); output.push(source.slice(i, end)); i = end; continue
    }
    // Consume numbers first so 1\\32 px remains a dimension with unit '2px',
    // not the entirely different valid length 12px.
    if (/[0-9.+-]/.test(c)) {
      const number = source.slice(i).match(/^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/)
      if (number) {
        output.push(number[0]); i += number[0].length
        if (startsIdentifier(source, i)) { const unit = consumeCssName(source, i); output.push(serializeIdentifier(unit.value)); i = unit.end }
        continue
      }
    }
    if (c === '#') {
      const name = consumeCssName(source, i + 1)
      if (name.end > i + 1) { output.push('#' + serializeIdentifier(name.value, true)); i = name.end; continue }
    }
    if (startsIdentifier(source, i)) {
      const name = consumeCssName(source, i)
      if (name.end > i) {
        output.push(serializeIdentifier(name.value)); i = name.end
        // URL payload is not an identifier sequence. Resource policy examines
        // it afterward; normalizing the function name prevents escape bypass.
        if (name.value.toLowerCase() === 'url' && source[i] === '(') {
          const end = Math.min(source.length, blockEnd(source, i) + 1)
          output.push(source.slice(i, end)); i = end
        }
        continue
      }
    }
    output.push(c); i++
  }
  return output.join('')
}
function parseDeclaration (value) {
  const source = trimCssWhitespace(preprocessCss(value))
  if (!startsIdentifier(source, 0)) return null
  const name = consumeCssName(source)
  let index = name.end
  while (/[\t\n ]/.test(source[index] || '')) index++
  if (!name.value || source[index] !== ':') return null
  const property = propertyKey(name.value)
  // Unknown ordinary properties with escaped punctuation cannot be safely
  // emitted as raw style keys. Custom properties remain internal dictionary keys.
  if (!property.startsWith('--') && !/^-?[_a-z][\w-]*$/.test(property)) return null
  return { property, value: trimCssWhitespace(normalizeValueIdentifiers(source.slice(index + 1))) }
}
module.exports = { startsIdentifier, propertyKey, serializeIdentifier, normalizeValueIdentifiers, parseDeclaration }
