'use strict'

// Native paths belong to this call only. A node unions its children, applies
// its own intersections, and is then unioned with its siblings (CSS Masking 6.1).
const { parsePath } = require('./svg-path')
const MAX_CHILDREN = 64
const MAX_NODES = 256
const MAX_SEGMENTS = 2048
const MAX_SOURCE = 65536

function createClipUnion (kernel) {
  return function union (entries) {
    let size = 0, count = 0, nodes = 0
    function validate (entries, depth = 0) {
      if (depth > 128) throw new Error('SVG clip union geometry nesting exceeds 128 levels')
      if (entries.length > MAX_CHILDREN) throw new Error('SVG clip union exceeds 64 children')
      for (const entry of entries) {
        if (++nodes > MAX_NODES) throw new Error('SVG clip union exceeds 256 geometry nodes')
        if (entry.children) validate(entry.children, depth + 1)
        else {
          size += entry.d.length
          if (size > MAX_SOURCE) throw new Error('SVG clip union exceeds 64 KiB geometry')
          const segments = parsePath(entry.d)
          count += segments.length
          if (count > MAX_SEGMENTS) throw new Error('SVG clip union exceeds 2048 segments')
          const matrix = entry.matrix || [1, 0, 0, 1, 0, 0]
          if (matrix.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7) || segments.some(s => Object.entries(s).some(([k, n]) => k !== 'type' && (!Number.isFinite(n) || Math.abs(n) > 1e7)))) throw new Error('SVG clip union coordinates exceed the safe range')
          for (const s of segments) for (const suffix of ['', '1', '2']) {
            const x = s['x' + suffix], y = s['y' + suffix]
            if (x == null) continue
            const tx = matrix[0] * x + matrix[2] * y + matrix[4], ty = matrix[1] * x + matrix[3] * y + matrix[5]
            if (!Number.isFinite(tx) || !Number.isFinite(ty) || Math.abs(tx) > 1e7 || Math.abs(ty) > 1e7) throw new Error('SVG clip union transformed coordinates exceed the safe range')
          }
        }
        if (entry.clips) validate(entry.clips, depth + 1)
      }
    }
    // Validate the entire tree, including empty intersections, before allocation.
    validate(entries)
    function compose (entries) {
      let result = null
      try {
        for (const entry of entries) {
          let shape = null
          try {
            if (entry.children) shape = compose(entry.children)
            else {
              shape = kernel.FromSVGString(entry.d)
              if (!shape) throw new Error('SVG clip union contains invalid path data')
              shape.setFillType(entry.rule === 'evenodd' ? kernel.FillType.EVENODD : kernel.FillType.WINDING)
              if (entry.matrix) { const m = entry.matrix; shape.transform(m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1) }
            }
            for (const clip of entry.clips || []) {
              if (!shape) break
              const mask = compose([clip])
              try {
                if (!mask) { shape.delete(); shape = null; break }
                const intersection = kernel.MakeFromOp(shape, mask, kernel.PathOp.INTERSECT)
                if (!intersection) throw new Error('SVG clip intersection could not resolve the geometry')
                shape.delete(); shape = intersection
              } finally { if (mask) mask.delete() }
            }
            if (!shape) continue
            if (!result) { result = shape; shape = null } else {
              const combined = kernel.MakeFromOp(result, shape, kernel.PathOp.UNION)
              if (!combined) throw new Error('SVG clip union could not resolve the geometry')
              result.delete(); result = combined
            }
          } finally { if (shape) shape.delete() }
        }
        const owned = result; result = null
        return owned
      } finally { if (result) result.delete() }
    }
    let result = null
    try {
      result = compose(entries)
      const d = result ? result.toSVGString() : ''
      if (d.length > 262144) throw new Error('SVG clip union output exceeds 256 KiB')
      const segments = parsePath(d)
      if (segments.length > 8192) throw new Error('SVG clip union output exceeds 8192 segments')
      return { d, segments, rule: result && result.getFillTypeString() === 'evenodd' ? 'evenodd' : 'nonzero' }
    } finally { if (result) result.delete() }
  }
}

module.exports = { createClipUnion }
