'use strict'

// SVG path data → 绝对坐标的规范化指令（M/L/C/Z），椭圆弧展开为三次贝塞尔。
// 基本形状使用同样的渲染指令；包围盒可保留椭圆弧的解析参数。

const { parsePathData } = require('./svg-path-data')

// 返回 [{ type: 'M'|'L'|'C'|'Z', x, y, x1, y1, x2, y2 }]
function parsePath (data, preserveArcs = false) {
  const segments = []
  let x = 0; let y = 0
  let startX = 0; let startY = 0
  let lastCx = 0; let lastCy = 0
  let lastCommand = ''
  for (const { type: upper, args } of parsePathData(data, true)) {
    if (upper === 'Z') {
      segments.push({ type: 'Z' })
      x = startX; y = startY
      lastCommand = 'Z'
      continue
    }
    switch (upper) {
      case 'M': {
        x = args[0]; y = args[1]
        segments.push({ type: 'M', x, y })
        startX = x; startY = y
        break
      }
      case 'L': {
        x = args[0]; y = args[1]
        segments.push({ type: 'L', x, y })
        break
      }
      case 'H': {
        x = args[0]
        segments.push({ type: 'L', x, y })
        break
      }
      case 'V': {
        y = args[0]
        segments.push({ type: 'L', x, y })
        break
      }
      case 'C': {
        const x1 = args[0]; const y1 = args[1]
        const x2 = args[2]; const y2 = args[3]
        x = args[4]; y = args[5]
        segments.push({ type: 'C', x1, y1, x2, y2, x, y })
        lastCx = x2; lastCy = y2
        break
      }
      case 'S': {
        const reflect = lastCommand === 'C' || lastCommand === 'S'
        const x1 = reflect ? 2 * x - lastCx : x; const y1 = reflect ? 2 * y - lastCy : y
        const x2 = args[0]; const y2 = args[1]
        x = args[2]; y = args[3]
        segments.push({ type: 'C', x1, y1, x2, y2, x, y })
        lastCx = x2; lastCy = y2
        break
      }
      case 'Q': {
        const qx = args[0]; const qy = args[1]
        const nx = args[2]; const ny = args[3]
        segments.push(quadraticToCubic(x, y, qx, qy, nx, ny))
        lastCx = qx; lastCy = qy
        x = nx; y = ny
        break
      }
      case 'T': {
        const reflect = lastCommand === 'Q' || lastCommand === 'T'
        const qx = reflect ? 2 * x - lastCx : x; const qy = reflect ? 2 * y - lastCy : y
        const nx = args[0]; const ny = args[1]
        segments.push(quadraticToCubic(x, y, qx, qy, nx, ny))
        lastCx = qx; lastCy = qy
        x = nx; y = ny
        break
      }
      case 'A': {
        const nx = args[5]; const ny = args[6]
        if (preserveArcs) segments.push({ type: 'A', rx: args[0], ry: args[1], rotation: args[2], largeArc: args[3], sweep: args[4], x: nx, y: ny })
        else for (const curve of arcToCubics(x, y, args[0], args[1], args[2], args[3], args[4], nx, ny)) segments.push(curve)
        x = nx; y = ny
        break
      }
    }
    lastCommand = upper
  }
  return segments
}

function quadraticToCubic (x0, y0, qx, qy, x, y) {
  return {
    type: 'C',
    x1: x0 + 2 / 3 * (qx - x0), y1: y0 + 2 / 3 * (qy - y0),
    x2: x + 2 / 3 * (qx - x), y2: y + 2 / 3 * (qy - y),
    x, y
  }
}

function arcParameters (x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry)
  const phi = rotation * Math.PI / 180
  const cosPhi = Math.cos(phi); const sinPhi = Math.sin(phi)
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
  const sign = largeArc === sweep ? -1 : 1
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = coefficient * (rx * y1p / ry)
  const cyp = coefficient * (-ry * x1p / rx)
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    let value = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) value = -value
    return value
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  else if (sweep && delta < 0) delta += 2 * Math.PI
  return { cx, cy, cosPhi, sinPhi, theta1, delta, rx, ry }
}

// SVG 实现说明 F.6.5 的中心参数化，再按 90° 一段拆成三次贝塞尔
function arcToCubics (x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return []
  rx = Math.abs(rx); ry = Math.abs(ry)
  if (rx === 0 || ry === 0) return [{ type: 'L', x: x2, y: y2 }]
  const { cx, cy, cosPhi, sinPhi, theta1, delta, rx: correctedRx, ry: correctedRy } = arcParameters(x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2)
  rx = correctedRx; ry = correctedRy
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2))
  const step = delta / segments
  const curves = []
  let theta = theta1
  const point = t => ({
    x: cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    y: cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi
  })
  const derivative = t => ({
    x: -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    y: -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi
  })
  for (let i = 0; i < segments; i++) {
    const next = theta + step
    const alpha = Math.sin(step) * (Math.sqrt(4 + 3 * Math.tan(step / 2) ** 2) - 1) / 3
    const p0 = point(theta); const p3 = point(next)
    const d0 = derivative(theta); const d3 = derivative(next)
    curves.push({ type: 'C', x1: p0.x + alpha * d0.x, y1: p0.y + alpha * d0.y, x2: p3.x - alpha * d3.x, y2: p3.y - alpha * d3.y, x: p3.x, y: p3.y })
    theta = next
  }
  return curves
}

function rectPath (x, y, width, height, rx, ry) {
  if (!(width > 0) || !(height > 0)) return []
  rx = Math.min(Math.max(0, rx || 0), width / 2); ry = Math.min(Math.max(0, ry || 0), height / 2)
  if (rx === 0 && ry === 0) {
    return [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }]
  }
  const k = 0.5522847498
  const ox = rx * k; const oy = ry * k
  return [
    { type: 'M', x: x + rx, y },
    { type: 'L', x: x + width - rx, y },
    { type: 'C', x1: x + width - rx + ox, y1: y, x2: x + width, y2: y + ry - oy, x: x + width, y: y + ry },
    { type: 'L', x: x + width, y: y + height - ry },
    { type: 'C', x1: x + width, y1: y + height - ry + oy, x2: x + width - rx + ox, y2: y + height, x: x + width - rx, y: y + height },
    { type: 'L', x: x + rx, y: y + height },
    { type: 'C', x1: x + rx - ox, y1: y + height, x2: x, y2: y + height - ry + oy, x, y: y + height - ry },
    { type: 'L', x, y: y + ry },
    { type: 'C', x1: x, y1: y + ry - oy, x2: x + rx - ox, y2: y, x: x + rx, y },
    { type: 'Z' }
  ]
}

function ellipsePath (cx, cy, rx, ry) {
  if (!(rx > 0) || !(ry > 0)) return []
  const k = 0.5522847498
  const ox = rx * k; const oy = ry * k
  return [
    { type: 'M', x: cx + rx, y: cy },
    { type: 'C', x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
    { type: 'C', x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
    { type: 'C', x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
    { type: 'C', x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    { type: 'Z' }
  ]
}

function polyPath (points, close) {
  const numbers = String(points || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
  const segments = []
  for (let i = 0; i + 1 < numbers.length; i += 2) segments.push({ type: i === 0 ? 'M' : 'L', x: numbers[i], y: numbers[i + 1] })
  if (close && segments.length) segments.push({ type: 'Z' })
  return segments
}

// 计算曲线极值与椭圆弧解析边界，供 objectBoundingBox 与 fill-box 使用。
function pathBounds (segments, matrix) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  const map = (x, y) => matrix ? { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] } : { x, y }
  const include = p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  const roots = (p0, p1, p2, p3) => {
    const magnitude = Math.max(Math.abs(p0), Math.abs(p1), Math.abs(p2), Math.abs(p3))
    if (!magnitude) return []
    p0 /= magnitude; p1 /= magnitude; p2 /= magnitude; p3 /= magnitude
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
    if (!scale) return []
    const A = a / scale, B = b / scale, C = c / scale
    if (Math.abs(A) < 1e-14) return Math.abs(B) < 1e-14 ? [] : [-C / B]
    const d = B * B - 4 * A * C
    if (d < 0) return []
    const q = -.5 * (B + (B >= 0 ? 1 : -1) * Math.sqrt(d))
    return q === 0 ? [-B / (2 * A)] : [q / A, C / q]
  }
  const value = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d }
  let current = map(0, 0), start = current, raw = { x: 0, y: 0 }, rawStart = raw
  for (const segment of segments) {
    if (segment.type === 'Z') { current = start; raw = rawStart; continue }
    const end = map(segment.x, segment.y)
    include(end)
    if (segment.type === 'C') {
      const p1 = map(segment.x1, segment.y1), p2 = map(segment.x2, segment.y2)
      for (const t of [...roots(current.x, p1.x, p2.x, end.x), ...roots(current.y, p1.y, p2.y, end.y)]) {
        if (t > 0 && t < 1) include({ x: value(current.x, p1.x, p2.x, end.x, t), y: value(current.y, p1.y, p2.y, end.y, t) })
      }
    }
    if (segment.type === 'A' && segment.rx && segment.ry && (raw.x !== segment.x || raw.y !== segment.y)) {
      const a = arcParameters(raw.x, raw.y, segment.rx, segment.ry, segment.rotation, segment.largeArc, segment.sweep, segment.x, segment.y)
      const center = map(a.cx, a.cy), origin = map(0, 0), u = map(a.rx * a.cosPhi, a.rx * a.sinPhi), v = map(-a.ry * a.sinPhi, a.ry * a.cosPhi)
      u.x -= origin.x; u.y -= origin.y; v.x -= origin.x; v.y -= origin.y
      const tau = 2 * Math.PI, mod = x => (x % tau + tau) % tau
      for (const angle of [Math.atan2(v.x, u.x), Math.atan2(v.x, u.x) + Math.PI, Math.atan2(v.y, u.y), Math.atan2(v.y, u.y) + Math.PI]) {
        const distance = a.delta >= 0 ? mod(angle - a.theta1) : mod(a.theta1 - angle)
        if (distance <= Math.abs(a.delta) + 1e-12) include({ x: center.x + u.x * Math.cos(angle) + v.x * Math.sin(angle), y: center.y + u.y * Math.cos(angle) + v.y * Math.sin(angle) })
      }
    }
    if (segment.type === 'M') { start = end; rawStart = { x: segment.x, y: segment.y } }
    current = end; raw = { x: segment.x, y: segment.y }
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function applySegments (ctx, segments) {
  ctx.beginPath()
  for (const segment of segments) {
    if (segment.type === 'M') ctx.moveTo(segment.x, segment.y)
    else if (segment.type === 'L') ctx.lineTo(segment.x, segment.y)
    else if (segment.type === 'C') ctx.bezierCurveTo(segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y)
    else if (segment.type === 'Z') ctx.closePath()
  }
}

module.exports = { arcParameters, applySegments, arcToCubics, ellipsePath, parsePath, pathBounds, polyPath, rectPath }
