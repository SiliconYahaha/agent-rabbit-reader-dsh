'use strict'

// Return the original byte-string offset after a PostScript string. Both DSC
// scanning and the supported vector tokenizer use the same delimiter rules.
function skipPostScriptString (source, start) {
  if (source[start] === '(') {
    let depth = 1
    for (let i = start + 1; i < source.length; i++) {
      const char = source[i]
      if (char === '\\') { i++; continue }
      if (char === '(' && ++depth > 1024) throw new Error('Ai 字符串嵌套超过本机保护范围')
      if (char === ')' && --depth === 0) return i + 1
    }
    throw new Error('Ai PostScript 字符串缺少结束括号')
  }
  if (source[start] !== '<' || source[start + 1] === '<') return null
  const ascii85 = source[start + 1] === '~'
  const delimiter = ascii85 ? '~>' : '>'
  const end = source.indexOf(delimiter, start + (ascii85 ? 2 : 1))
  if (end < 0) throw new Error('Ai PostScript 数据字符串缺少结束标记')
  return end + delimiter.length
}

// Find a numeric-array candidate without letting literal closing brackets,
// nested arrays or comments expose their data as executable vector tokens.
function skipPostScriptArray (source, start) {
  let depth = 1
  for (let i = start + 1; i < source.length;) {
    const char = source[i]
    if (char === '%') {
      while (i < source.length && source[i] !== '\r' && source[i] !== '\n') i++
      continue
    }
    if (char === '<' && source[i + 1] === '<') { i += 2; continue }
    const end = skipPostScriptString(source, i)
    if (end != null) { i = end; continue }
    if (char === '[' && ++depth > 1024) throw new Error('Ai 数组嵌套超过本机保护范围')
    if (char === ']' && --depth === 0) return i + 1
    i++
  }
  throw new Error('Ai PostScript 数组缺少结束括号')
}

module.exports = { skipPostScriptArray, skipPostScriptString }
