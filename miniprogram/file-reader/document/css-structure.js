'use strict'

const { consumeCssEscape } = require('./css-escapes')
const space = c => /[\t\n\f\r ]/.test(c || '')

// CSS strings/comments/escapes are indivisible for structural scanning. A bad
// string ends before its raw newline; EOF closes an otherwise unclosed string.
function atomicEnd (source, index) {
  const char = source[index]
  if (char === '\\') return consumeCssEscape(source, index).end
  if (char === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2)
    return end < 0 ? source.length : end + 2
  }
  if (char !== '"' && char !== "'") return index + 1
  let end = index + 1
  while (end < source.length) {
    if (source[end] === char) return end + 1
    if (source[end] === '\n' || source[end] === '\r' || source[end] === '\f') return end
    end = source[end] === '\\' ? consumeCssEscape(source, end).end : end + 1
  }
  return end
}

function trimCssWhitespace (value) {
  const source = String(value || '')
  let start = 0, end = 0
  while (space(source[start])) start++
  for (let i = start; i < source.length;) {
    const next = atomicEnd(source, i)
    if (!space(source[i])) end = next
    i = next
  }
  return source.slice(start, Math.max(start, end))
}

function stripCssComments (value) {
  const source = String(value || ''), output = []
  let start = 0
  for (let i = 0; i < source.length;) {
    const end = atomicEnd(source, i)
    if (source.slice(i, i + 2) === '/*') { output.push(source.slice(start, i)); start = end }
    i = end
  }
  output.push(source.slice(start)); return output.join('')
}

function mapCssCode (value, transform) {
  const source = String(value || ''), output = []
  let start = 0
  for (let i = 0; i < source.length;) {
    const end = atomicEnd(source, i)
    if (source[i] === '"' || source[i] === "'" || source[i] === '\\' || source.slice(i, i + 2) === '/*') {
      output.push(transform(source.slice(start, i)), source.slice(i, end)); start = end
    }
    i = end
  }
  output.push(transform(source.slice(start))); return output.join('')
}

function splitCssTopLevel (value, delimiter) {
  const source = String(value || ''), output = [], stack = []
  const closing = { '(': ')', '[': ']', '{': '}' }
  let start = 0
  for (let i = 0; i < source.length;) {
    const c = source[i], end = atomicEnd(source, i)
    if (end === i + 1 && c !== '"' && c !== "'" && c !== '\\') {
      if (closing[c]) stack.push(closing[c])
      else if (stack.length && c === stack[stack.length - 1]) stack.pop()
      else if (!stack.length && c === delimiter) { output.push(trimCssWhitespace(source.slice(start, i))); start = i + 1 }
    }
    i = end
  }
  output.push(trimCssWhitespace(source.slice(start))); return output.filter(Boolean)
}

function blockEnd (source, opening) {
  const closing = { '(': ')', '[': ']', '{': '}' }, stack = [closing[source[opening]]]
  for (let i = opening + 1; i < source.length;) {
    const c = source[i], end = atomicEnd(source, i)
    if (end === i + 1 && c !== '"' && c !== "'" && c !== '\\') {
      if (closing[c]) stack.push(closing[c])
      else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i }
    }
    i = end
  }
  return source.length // EOF implicitly closes blocks; do not drop their body.
}

function * cssRules (value) {
  const source = String(value || '')
  let i = 0
  while (i < source.length) {
    if (space(source[i]) || source[i] === ';') { i++; continue }
    if (source.slice(i, i + 2) === '/*') { i = atomicEnd(source, i); continue }
    if (source.slice(i, i + 4) === '<!--') { i += 4; continue }
    if (source.slice(i, i + 3) === '-->') { i += 3; continue }
    const start = i, atRule = source[i] === '@'
    let yielded = false
    for (; i < source.length;) {
      const c = source[i], end = atomicEnd(source, i)
      if (end === i + 1 && c !== '"' && c !== "'" && c !== '\\') {
        if (c === '(' || c === '[') { i = Math.min(source.length, blockEnd(source, i) + 1); continue }
        if (c === '{') {
          const close = blockEnd(source, i), prelude = trimCssWhitespace(source.slice(start, i))
          yield { prelude, body: source.slice(i + 1, close), start, end: Math.min(close + 1, source.length), atRule }
          i = Math.min(close + 1, source.length); yielded = true; break
        }
        if (atRule && c === ';') {
          yield { prelude: trimCssWhitespace(source.slice(start, i)), body: null, start, end: i + 1, atRule }
          i++; yielded = true; break
        }
      }
      i = end
    }
    if (!yielded) break
  }
}

module.exports = { atomicEnd, trimCssWhitespace, stripCssComments, mapCssCode, splitCssTopLevel, blockEnd, cssRules }
