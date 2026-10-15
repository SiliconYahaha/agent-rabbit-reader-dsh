'use strict'

// Strict SVG path grammar shared by animation and Canvas rendering.
// Full parsing rejects an invalid animated value; prefix parsing preserves
// complete segments before the first syntax error in static path data.
const COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
function parsePathData (source, allowPrefix = false) {
  const text = String(source == null ? '' : source)
  const number = /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y
  const commands = []
  let offset = 0, command = '', x = 0, y = 0, startX = 0, startY = 0
  const whitespace = () => { while (offset < text.length && /[\t\n\r ]/.test(text[offset])) offset++ }
  const read = (comma, flag) => {
    whitespace()
    if (comma && text[offset] === ',') { offset++; whitespace() }
    if (flag) { const c = text[offset]; if (c !== '0' && c !== '1') return null; offset++; return Number(c) }
    number.lastIndex = offset
    const match = number.exec(text)
    if (!match) return null
    offset = number.lastIndex
    const value = Number(match[0])
    return Number.isFinite(value) ? value : null
  }
  while (offset < text.length) {
    whitespace()
    if (offset === text.length) break
    // Chrome's static path parser accepts a single comma before a new
    // command after numeric arguments, but not after Z or another comma.
    if (allowPrefix && command && text[offset] === ',') {
      let next = offset + 1
      while (next < text.length && /[\t\n\r ]/.test(text[next])) next++
      if (next < text.length && Object.prototype.hasOwnProperty.call(COUNTS, text[next].toUpperCase())) offset = next
    }
    const char = text[offset], explicit = Object.prototype.hasOwnProperty.call(COUNTS, char.toUpperCase())
    if (explicit) { command = char; offset++ }
    if (!command || (!commands.length && command.toUpperCase() !== 'M')) return allowPrefix ? commands : null
    const type = command.toUpperCase(), relative = command !== type
    if (type === 'Z') {
      commands.push({ type, args: [] }); x = startX; y = startY; command = ''; continue
    }
    const args = []
    for (let i = 0; i < COUNTS[type]; i++) {
      const value = read(i > 0 || !explicit, type === 'A' && (i === 3 || i === 4))
      if (value === null) return allowPrefix ? commands : null
      args.push(value)
    }
    if (relative) {
      if (type === 'H') args[0] += x
      else if (type === 'V') args[0] += y
      else if (type === 'A') { args[5] += x; args[6] += y }
      else for (let i = 0; i < args.length; i += 2) { args[i] += x; args[i + 1] += y }
    }
    if (!args.every(Number.isFinite)) return allowPrefix ? commands : null
    if (type === 'H') x = args[0]
    else if (type === 'V') y = args[0]
    else { x = args[args.length - 2]; y = args[args.length - 1] }
    if (type === 'M') { startX = x; startY = y; command = relative ? 'l' : 'L' }
    commands.push({ type, args })
  }
  return commands
}

module.exports = { parsePathData }
