'use strict'

const { parseLength } = require('./svg-style')
const { parseViewBox } = require('./svg-document')

// SVG2 equivalent viewport transform. A zero viewBox is valid but disables
// painting; a malformed/negative viewBox is ignored instead of disabling it.
function viewportTransform (box, viewBox, preserveAspectRatio) {
  if (!(box.width > 0) || !(box.height > 0) || (viewBox && (!viewBox.width || !viewBox.height))) return { disabled: true, box, matrix: null, units: viewBox || box }
  if (!viewBox) return { disabled: false, box, matrix: [1, 0, 0, 1, box.x, box.y], units: { width: box.width, height: box.height } }
  let parts = String(preserveAspectRatio || '').trim().split(/\s+/)
  if (parts[0] === 'defer') parts = parts.slice(1)
  const valid = /^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))$/.test(parts[0]) && parts.length <= 2 && (!parts[1] || /^(meet|slice)$/.test(parts[1]))
  const align = valid ? parts[0] : 'xMidYMid', mode = valid && parts[1] === 'slice' ? 'slice' : 'meet'
  let sx = box.width / viewBox.width, sy = box.height / viewBox.height
  if (align !== 'none') sx = sy = mode === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy)
  let x = box.x - viewBox.x * sx, y = box.y - viewBox.y * sy
  if (align.includes('xMid')) x += (box.width - viewBox.width * sx) / 2
  if (align.includes('xMax')) x += box.width - viewBox.width * sx
  if (align.includes('YMid')) y += (box.height - viewBox.height * sy) / 2
  if (align.includes('YMax')) y += box.height - viewBox.height * sy
  const matrix = [sx, 0, 0, sy, x, y]
  if (!matrix.every(Number.isFinite)) throw new Error('SVG viewport transform exceeds finite coordinates')
  return { disabled: false, box, matrix, units: { width: viewBox.width, height: viewBox.height } }
}

function resolveViewport (attrs, parent) {
  const length = (name, reference, fallback) => {
    const value = attrs[name]
    if (value == null || value === '' || value === 'auto') return fallback
    const parsed = parseLength(value, reference)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const box = { x: length('x', parent.width, 0), y: length('y', parent.height, 0), width: length('width', parent.width, parent.width), height: length('height', parent.height, parent.height) }
  return viewportTransform(box, parseViewBox(attrs.viewBox, true), attrs.preserveAspectRatio)
}

module.exports = { resolveViewport, viewportTransform }
