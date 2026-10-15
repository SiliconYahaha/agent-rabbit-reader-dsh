'use strict'
// Only a byte-identical official library body and exact exports can use native code.
const metadata = require('./vendor/three169-source')
const { sha256 } = require('./trusted-source-sha256')
function substituteTrustedThree (ast, source, getLibrary) {
  const pending = [ast]; let visited = 0, replaced = 0
  while (pending.length && ++visited < 500000) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { for (const child of node) pending.push(child); continue }
    const fn = node.type === 'CallExpression' && !node.optional && !node.arguments.length && node.callee
    if (fn && ['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type) && !fn.async && !fn.generator && !fn.params.length && fn.body.type === 'BlockStatement') {
      const body = fn.body.body, first = body[0], last = body[body.length - 1]
      const marker = first?.type === 'VariableDeclaration' && first.declarations[0]
      const props = last?.type === 'ReturnStatement' && last.argument?.type === 'ObjectExpression' && last.argument.properties
      if (marker?.id?.name === 't' && marker.init?.value === '169' && props && props.length === Object.keys(metadata.bindings).length) {
        const names = new Set()
        const valid = props.every(p => p.type === 'Property' && p.kind === 'init' && !p.method && !p.computed && p.key.type === 'Identifier' && p.value.type === 'Identifier' && !names.has(p.key.name) && names.add(p.key.name) && metadata.bindings[p.key.name] === p.value.name)
        if (valid && sha256(source.slice(first.start, last.start).trim()) === metadata.bodySha256) {
          node.callee = { type: 'Literal', value: getLibrary, raw: 'null' }; replaced++; continue
        }
      }
    }
    for (const key of Object.keys(node)) if (!['loc', 'start', 'end', 'raw'].includes(key)) pending.push(node[key])
  }
  return replaced
}
module.exports = { substituteTrustedThree }
