'use strict'

// Large embedded assets are data, not additional executable code. Keep literal
// values/AST raw text intact, and enforce both a raw input cap and a syntax cap.
const MAX_SOURCE = 20 * 1024 * 1024
const MAX_NODES = 100000
const DATA = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif)|audio\/(?:wav|x-wav|wave|mpeg|mp3|ogg|aac|mp4|webm));base64,[a-z0-9+/= \t\n\r\f]*$/i
function parseImageScript (interpreter, source, maxSyntax, transform) {
  const fail = (reason = 'executable source') => { throw new Error(`HTML Reader skipped a script larger than the safety limit (${reason})`) }
  if (source.length > MAX_SOURCE) fail('raw source')
  if (source.length > maxSyntax) {
    // Cheap conservative preflight BEFORE parsing. This is not acceptance:
    // only allowlisted image/audio string literals below discount the budget.
    let possible = 0
    for (const m of source.matchAll(/data:(?:image|audio)(?:\/|\\\/)[\w-]+;base64,[a-z0-9+/=\\\r\n]+/gi)) possible += m[0].length
    if (source.length - possible > maxSyntax) fail()
  }
  let ast
  try { ast = interpreter.parse(source) } catch (error) {
    // Some JS engines echo the entire invalid regexp, including megabytes of
    // embedded data. Do not leak that source into UI diagnostics or setData.
    if (source.length > maxSyntax) fail()
    throw error
  }
  if (transform) transform(ast, source)
  let syntax = source.length, count = 0
  const pending = [ast]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { if (node.length > MAX_NODES) fail('syntax nodes'); for (const child of node) pending.push(child); continue }
    if (node.type && ++count > MAX_NODES) fail('syntax nodes')
    const value = node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null
    if (typeof value === 'string' && value.length > 8192 && DATA.test(value)) {
      const data = value.slice(value.indexOf(',') + 1).replace(/[ \t\n\r\f]/g, '')
      if (/^[a-z0-9+/]*={0,2}$/i.test(data) && data.length % 4 !== 1 && (!data.includes('=') || data.length % 4 === 0)) syntax -= node.end - node.start - 64
    }
    for (const key of Object.keys(node)) if (!['loc', 'start', 'end', 'raw'].includes(key)) pending.push(node[key])
  }
  if (syntax > maxSyntax) fail()
  return ast
}
module.exports = { parseImageScript }
