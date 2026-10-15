'use strict'

// Canvas.createPath2D's SVG-string overload is not guaranteed by all WeChat
// hosts. Verify real geometry rather than trusting the presence of a method.
function createNativePaths (options = {}) {
  const factory = options.nativePaths === false ? null
    : typeof options.createPath2D === 'function' ? options.createPath2D
      : typeof Path2D === 'function' ? source => new Path2D(source) : null
  const contexts = new WeakMap()
  function stateFor (ctx) {
    if (contexts.has(ctx)) return contexts.get(ctx)
    const state = { enabled: false, paths: new Map() }
    contexts.set(ctx, state)
    if (!factory || typeof ctx.isPointInPath !== 'function' || typeof ctx.getTransform !== 'function' || typeof ctx.setTransform !== 'function') return state
    ctx.save()
    try {
      const matrix = ctx.getTransform()
      if (!matrix || !['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]))) return state
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const hole = factory('M0 0H8V8H0Z M2 2H6V6H2Z')
      const arc = factory('M10 0A10 10 0 0 1 0 10L0 0Z')
      state.enabled = ctx.isPointInPath(hole, 1, 1, 'evenodd') === true &&
        ctx.isPointInPath(hole, 4, 4, 'evenodd') === false &&
        ctx.isPointInPath(hole, 20, 20, 'nonzero') === false &&
        ctx.isPointInPath(arc, 7, 7, 'nonzero') === true &&
        ctx.isPointInPath(arc, 9, 9, 'nonzero') === false
    } catch (_) { state.enabled = false } finally { ctx.restore() }
    return state
  }
  return {
    get (ctx, record, source) {
      const state = stateFor(ctx)
      if (!state.enabled) return null
      const previous = state.paths.get(record)
      if (previous && previous.source === source) return previous.path
      let path = null
      try { path = factory(source) || null } catch (_) {}
      // One current path per element, not one path per animation frame.
      state.paths.set(record, { source, path })
      return path
    },
    transform (ctx, record, path, matrix) {
      const state = stateFor(ctx)
      if (!state.enabled) return null
      if (state.transforms == null) {
        state.transforms = false
        ctx.save()
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          const source = factory('M0 0H2V2H0Z'), moved = factory('')
          moved.addPath(source, { a: 1, b: 0, c: 0, d: 1, e: 20, f: 0 })
          state.transforms = ctx.isPointInPath(moved, 21, 1) === true && ctx.isPointInPath(moved, 1, 1) === false
        } catch (_) {} finally { ctx.restore() }
      }
      if (!state.transforms) return null
      const entry = state.paths.get(record), key = matrix.join(',')
      if (!entry || entry.path !== path) return null
      if (entry.transformed && entry.transformed.key === key) return entry.transformed.path
      let transformed = null
      try {
        transformed = factory('')
        transformed.addPath(path, { a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] })
      } catch (_) { state.transforms = false; transformed = null }
      entry.transformed = { key, path: transformed }
      return transformed
    },
    disable (ctx) {
      const state = contexts.get(ctx)
      if (state) { state.enabled = false; state.paths.clear() }
    }
  }
}
module.exports = { createNativePaths }
