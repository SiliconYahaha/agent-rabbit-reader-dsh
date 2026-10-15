'use strict'
const { arcParameters } = require('./svg-path')

// Integrate speed, not the control polygon. Adaptive Simpson subdivision is
// bounded even at cusps; static shapes cache the result with their geometry.
function integrate (evaluate, start, end, budget) {
  const speed = t => { if (--budget.remaining < 0) throw Error('SVG pathLength measurement exceeds work limit'); return evaluate(t) }
  const middle = (start + end) / 2
  const a = speed(start), b = speed(middle), c = speed(end)
  const whole = (end - start) * (a + 4 * b + c) / 6
  const epsilon = 1e-8 * Math.max(1, Math.abs(whole))
  function part (left, right, f0, fm, f1, estimate, tolerance, depth) {
    const mid = (left + right) / 2, fl = speed((left + mid) / 2), fr = speed((mid + right) / 2)
    const first = (mid - left) * (f0 + 4 * fl + fm) / 6
    const second = (right - mid) * (fm + 4 * fr + f1) / 6
    const delta = first + second - estimate
    if (!depth || Math.abs(delta) <= 15 * tolerance) return first + second + delta / 15
    return part(left, mid, f0, fl, fm, first, tolerance / 2, depth - 1) + part(mid, right, fm, fr, f1, second, tolerance / 2, depth - 1)
  }
  return Math.abs(part(start, end, a, b, c, whole, epsilon, 12))
}
function ellipseLength (rx, ry, start = 0, delta = 2 * Math.PI, budget = { remaining: 262144 }) {
  if (rx === ry) return Math.abs(rx * delta)
  // Split whole turns: otherwise symmetric samples can miss eccentricity.
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
  let length = 0
  for (let i = 0; i < pieces; i++) length += integrate(t => Math.hypot(rx * Math.sin(t), ry * Math.cos(t)), start + delta * i / pieces, start + delta * (i + 1) / pieces, budget)
  return length
}
function pathLength (segments, budget = { remaining: 262144 }) {
  let x = 0, y = 0, sx = 0, sy = 0, total = 0
  for (const s of segments) {
    if (--budget.remaining < 0) throw Error('SVG pathLength measurement exceeds work limit')
    if (s.type === 'M') { x = sx = s.x; y = sy = s.y; continue }
    if (s.type === 'Z') { total += Math.hypot(x - sx, y - sy); x = sx; y = sy; continue }
    if (s.type === 'L') total += Math.hypot(s.x - x, s.y - y)
    else if (s.type === 'C') {
      const ax = s.x1 - x, ay = s.y1 - y, bx = s.x2 - s.x1, by = s.y2 - s.y1, cx = s.x - s.x2, cy = s.y - s.y2
      total += integrate(t => { const u = 1 - t; return 3 * Math.hypot(u * u * ax + 2 * u * t * bx + t * t * cx, u * u * ay + 2 * u * t * by + t * t * cy) }, 0, 1, budget)
    } else if (s.type === 'A' && (s.x !== x || s.y !== y)) {
      if (!s.rx || !s.ry) total += Math.hypot(s.x - x, s.y - y)
      else {
        const arc = arcParameters(x, y, s.rx, s.ry, s.rotation, s.largeArc, s.sweep, s.x, s.y)
        total += ellipseLength(arc.rx, arc.ry, arc.theta1, arc.delta, budget)
      }
    }
    x = s.x; y = s.y
  }
  return total
}
function geometryLength (name, shape, budget) {
  if (name === 'circle' || name === 'ellipse') return ellipseLength(shape.bounds.width / 2, shape.bounds.height / 2, 0, 2 * Math.PI, budget)
  if (name === 'rect' && shape.segments.length === 10) {
    const box = shape.bounds, rx = shape.segments[0].x - box.x, ry = shape.segments[2].y - box.y
    return 2 * (box.width + box.height) - 4 * (rx + ry) + ellipseLength(rx, ry, 0, 2 * Math.PI, budget)
  }
  return pathLength(shape.boundsSegments, budget)
}
// Native Canvas ellipses use rational quadratic arcs. Their dash ruler uses
// a bounded chord subdivision (Skia contour measure, default0.5 user-unit
// midpoint flatness and depth8), rather than the analytical circumference.
// Use the same geometric ruler only when the native ellipse actually painted.
function ellipseStrokeLength (rx, ry, budget) {
  const weight = Math.SQRT1_2
  const point = t => {
    if (--budget.remaining < 0) throw Error('SVG pathLength measurement exceeds work limit')
    const u = 1 - t, middle = 2 * weight * t * u, denominator = u * u + middle + t * t
    return [rx * (u * u + middle) / denominator, ry * (middle + t * t) / denominator]
  }
  function span (start, first, end, last, depth) {
    const middle = (start + end) / 2, center = point(middle)
    if (depth < 8 && Math.max(Math.abs(center[0] - (first[0] + last[0]) / 2), Math.abs(center[1] - (first[1] + last[1]) / 2)) > .5) {
      return span(start, first, middle, center, depth + 1) + span(middle, center, end, last, depth + 1)
    }
    return Math.hypot(last[0] - first[0], last[1] - first[1])
  }
  return 4 * span(0, [rx, 0], 1, [0, ry], 0)
}
module.exports = { pathLength, ellipseLength, geometryLength, ellipseStrokeLength }
