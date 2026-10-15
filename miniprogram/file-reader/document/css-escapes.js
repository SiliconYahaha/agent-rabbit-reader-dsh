'use strict'

// CSS Syntax 3, sections 3.3 and 4.3.5/4.3.7. Not HTML entity decoding:
// CSS consumes at most six hex digits and never applies Windows-1252 aliases.
function preprocessCss (value) {
  const source = String(value == null ? '' : value), output = []
  for (let i = 0; i < source.length; i++) {
    const code = source.codePointAt(i)
    if (code === 13) { if (source[i + 1] === '\n') i++; output.push('\n') }
    else if (code === 12) output.push('\n')
    else if (!code || code >= 0xd800 && code <= 0xdfff) output.push('\ufffd')
    else { output.push(String.fromCodePoint(code)); if (code > 0xffff) i++ }
  }
  return output.join('')
}

function consumeCssEscape (source, start) {
  let end = start + 1
  if (source[end] === '\n') return { value: '', end: end + 1, valid: false }
  if (end >= source.length) return { value: '\ufffd', end, valid: true }
  let hex = ''
  while (hex.length < 6 && /[0-9a-f]/i.test(source[end] || '')) hex += source[end++]
  if (hex) {
    if (/[\t\n ]/.test(source[end] || '')) end++
    const code = parseInt(hex, 16)
    return { value: !code || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? '\ufffd' : String.fromCodePoint(code), end, valid: true }
  }
  const code = source.codePointAt(end)
  return { value: String.fromCodePoint(code), end: end + (code > 0xffff ? 2 : 1), valid: true }
}

function consumeCssName (source, start = 0) {
  let end = start
  const output = []
  while (end < source.length) {
    const code = source.codePointAt(end)
    if (source[end] === '\\') {
      const escape = consumeCssEscape(source, end)
      if (!escape.valid) break
      output.push(escape.value); end = escape.end
    } else if (/[\w-]/.test(source[end]) || code >= 0x80) {
      output.push(String.fromCodePoint(code)); end += code > 0xffff ? 2 : 1
    } else break
  }
  return { value: output.join(''), end }
}

// Resolve only textual generated content. Attribute values are literal DOM
// strings, not CSS source, and must never be decoded a second time.
function parseTextContent (value, getAttribute = () => '') {
  const source = preprocessCss(value), output = []
  let index = 0, count = 0
  while (index < source.length) {
    if (/[\t\n ]/.test(source[index])) { index++; continue }
    const quote = source[index]
    if (quote === '"' || quote === "'") {
      index++; count++
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\n') return null
        if (source[index] === '\\') {
          if (index + 1 === source.length) { index++; break }
          const escape = consumeCssEscape(source, index)
          // Backslash + newline is a string continuation, not a character.
          if (escape.valid) output.push(escape.value)
          index = escape.end
        } else output.push(source[index++])
      }
      if (source[index] === quote) index++
      continue
    }
    if (source.slice(index, index + 5).toLowerCase() === 'attr(') {
      index += 5
      while (/[\t\n ]/.test(source[index] || '')) index++
      const name = consumeCssName(source, index)
      if (!name.value) return null
      index = name.end
      while (/[\t\n ]/.test(source[index] || '')) index++
      if (source[index++] !== ')') return null
      output.push(String(getAttribute(name.value) || '')); count++
      continue
    }
    return null // none/normal and unsupported non-text content are not prose.
  }
  return count ? output.join('') : null
}

module.exports = { preprocessCss, consumeCssEscape, consumeCssName, parseTextContent }
