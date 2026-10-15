'use strict'

const { consumeCssName } = require('./css-escapes')
const { atomicEnd, blockEnd, trimCssWhitespace } = require('./css-structure')
const { startsIdentifier } = require('./css-identifiers')
const MAX_EXPANDED_CHARS = 1024 * 1024
const MAX_TOTAL_CHARS = 4 * MAX_EXPANDED_CHARS
const MAX_DEPTH = 256
const computedEnvironments = new WeakSet()
const owns = (o, key) => Object.prototype.hasOwnProperty.call(o, key)

// null is guaranteed-invalid; '' is a valid empty custom property. Keep these
// distinct throughout dependency resolution and inheritance.
function parseValue (value, depth = 0) {
  if (depth > MAX_DEPTH) return null
  const source = String(value), parts = []
  let start = 0
  for (let i = 0; i < source.length;) {
    const c = source[i]
    if (c === '"' || c === "'" || source.slice(i, i + 2) === '/*') { i = atomicEnd(source, i); continue }
    if (/[0-9.+-]/.test(c)) {
      const n = source.slice(i).match(/^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/)
      if (n) { i += n[0].length; if (startsIdentifier(source, i)) i = consumeCssName(source, i).end; continue }
    }
    if (c === '#' || c === '@') { i = Math.max(i + 1, consumeCssName(source, i + 1).end); continue }
    if (startsIdentifier(source, i)) {
      const token = consumeCssName(source, i)
      if (token.end > i) {
        if (token.value.toLowerCase() === 'var' && source[token.end] === '(') {
          const end = blockEnd(source, token.end), body = trimCssWhitespace(source.slice(token.end + 1, end)), name = consumeCssName(body)
          const rest = trimCssWhitespace(body.slice(name.end))
          if (name.value === '--' || !name.value.startsWith('--') || rest && rest[0] !== ',') return null
          const fallback = rest.startsWith(',') ? parseValue(trimCssWhitespace(rest.slice(1)), depth + 1) : undefined
          if (fallback === null) return null
          parts.push({ text: source.slice(start, i) }, { name: name.value, fallback })
          start = i = Math.min(source.length, end + 1); continue
        }
        i = token.end; continue
      }
    }
    i++
  }
  parts.push({ text: source.slice(start) }); return parts
}

function separatesTokens (a, b) {
  if (!a || !b || /\s/.test(a) || /\s/.test(b)) return false
  const word = c => /[\w-]/.test(c) || c.codePointAt(0) >= 0x80
  return (word(a) || /[.#\\+]/.test(a)) && (word(b) || /[.(%\\]/.test(b)) || a === '/' && b === '*'
}
function substitute (parts, lookup, depth = 0) {
  if (!parts || depth > MAX_DEPTH) return null
  const output = []
  let length = 0, last = '', boundary = false, invalid = false
  for (const part of parts) {
    const variable = part.name !== undefined
    let text = variable ? lookup(part.name) : part.text
    if (variable && text == null && part.fallback !== undefined) text = substitute(part.fallback, lookup, depth + 1)
    // Still visit later active references: overlapping cycles can occur after
    // an earlier invalid reference. Unused fallback branches stay unvisited.
    if (text == null) { invalid = true; boundary = true; continue }
    if ((variable || boundary) && separatesTokens(last, text[0])) { output.push(' '); length++ }
    length += text.length
    if (length > MAX_EXPANDED_CHARS) return null
    output.push(text)
    if (text) last = text[text.length - 1]
    boundary = variable || boundary && !text
  }
  return invalid ? null : output.join('')
}

function computeCustomProperties (local, inherited = {}) {
  const values = Object.assign(Object.create(null), inherited), parsed = new Map(), done = new Set(), active = new Map(), stack = [], cyclic = new Set()
  let total = 0, steps = 0
  for (const name of Object.keys(local)) {
    const raw = local[name]
    const keyword = raw == null ? 'initial' : trimCssWhitespace(raw).toLowerCase()
    if (keyword === 'inherit' || keyword === 'unset') { values[name] = owns(inherited, name) ? inherited[name] : null; done.add(name) }
    else if (keyword === 'initial') { values[name] = null; done.add(name) }
    else parsed.set(name, parseValue(raw))
  }
  function resolve (name) {
    if (done.has(name) || !parsed.has(name)) return owns(values, name) ? values[name] : null
    if (active.has(name)) { for (let i = active.get(name); i < stack.length; i++) cyclic.add(stack[i]); return null }
    if (++steps > 100000 || stack.length >= MAX_DEPTH) return null
    active.set(name, stack.length); stack.push(name)
    let result = substitute(parsed.get(name), resolve)
    stack.pop(); active.delete(name)
    if (cyclic.has(name)) result = null
    if (result != null) { total += result.length; if (total > MAX_TOTAL_CHARS) result = null }
    values[name] = result; done.add(name); return result
  }
  for (const name of parsed.keys()) resolve(name)
  computedEnvironments.add(values)
  return values
}
function resolveVariables (value, variables) {
  const computed = computedEnvironments.has(variables) ? variables : computeCustomProperties(variables)
  return substitute(parseValue(value), name => owns(computed, name) ? computed[name] : null) || ''
}
module.exports = { computeCustomProperties, resolveVariables, parseValue, MAX_EXPANDED_CHARS, MAX_TOTAL_CHARS, MAX_DEPTH }
