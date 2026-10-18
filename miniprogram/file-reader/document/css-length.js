'use strict'

// Resolve the small, side-effect-free length expressions used for document and
// container viewports. Unsupported CSS is left to the native layout engine.
function resolveLength (source, units, depth = 0) {
  const text = String(source || '').trim()
  if (depth > 12 || text.length > 2048) return null
  const scalar = /^([+-]?(?:\d*\.\d+|\d+))(px|em|rem|%|[dsl]?v[wh]|vmin|vmax|cq[whib]|cqmin|cqmax|mm|cm|in|pt|pc|q)?$/i.exec(text)
  if (scalar) {
    const number = Number(scalar[1]), unit = (scalar[2] || '').toLowerCase()
    if (!unit) return number === 0 ? 0 : null
    const factor = unit === 'px' ? 1 : units[unit]
    return Number.isFinite(number * factor) ? number * factor : null
  }
  const fn = /^(min|max|clamp|calc)\((.*)\)$/is.exec(text)
  if (!fn) return null
  fn[1] = fn[1].toLowerCase()
  const args = []; let start = 0, nesting = 0
  for (let i = 0; i < fn[2].length; i++) {
    const c = fn[2][i]
    if (c === '(') nesting++
    if (c === ')') nesting--
    if (!nesting && (c === ',' || fn[1] === 'calc' && /[+-]/.test(c) && /\s/.test(fn[2][i - 1] || '') && /\s/.test(fn[2][i + 1] || ''))) {
      args.push(fn[2].slice(start, i)); start = i + (c === ',' ? 1 : 0)
    }
  }
  args.push(fn[2].slice(start))
  const values = args.map(arg => {
    const sign = /^\s*([+-])\s+/.exec(arg)
    const value = resolveLength(sign ? arg.slice(sign[0].length) : arg, units, depth + 1)
    return value == null ? null : value * (sign?.[1] === '-' ? -1 : 1)
  })
  if (values.some(value => value == null)) return null
  if (fn[1] === 'calc') return values.reduce((a, b) => a + b, 0)
  if (fn[1] === 'clamp') return values.length === 3 ? Math.max(values[0], Math.min(values[1], values[2])) : null
  return (fn[1] === 'min' ? Math.min : Math.max)(...values)
}
module.exports = { resolveLength }
