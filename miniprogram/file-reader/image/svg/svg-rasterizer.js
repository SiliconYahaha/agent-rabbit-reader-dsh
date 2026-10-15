'use strict'

// 把 SVG 元素表画到 Canvas 2D 上下文上。支持：g/path/rect/circle/ellipse/line/polyline/polygon/
// text/tspan/use/image(data URI)/嵌套 svg、线性与径向渐变、clipPath、变换（含 transform-origin /
// transform-box）、不透明度、描边样式。mask/filter/pattern/marker 忽略并记录到 unsupported。
// 每帧整树重画；动画覆盖由 svg-animation 的 sample() 提供。

const { resolveViewport, viewportTransform } = require('./svg-viewport')
const { createNativePaths } = require('./svg-native-path')
const { geometryLength, ellipseStrokeLength } = require('./svg-path-length')
const { applySegments, ellipsePath, parsePath, pathBounds, polyPath, rectPath } = require('./svg-path')
const { colorToCss, computeStyle, identity, multiply, parseColor, parseDashArray, parseLength, parseTransformList, transformListToMatrix, transformPoint } = require('./svg-style')
const { isRendered, parseViewBox, resolveReference } = require('./svg-document')

const UNSUPPORTED_PROPERTIES = ['mask', 'filter']

function createRenderer (doc, options = {}) {
  const resolveImage = typeof options.resolveImage === 'function' ? options.resolveImage : () => null
  const unsupported = new Set()
  const geometryCache = new Map()
  const nativePaths = createNativePaths(options)
  const unionCache = new Map()
  const ellipseContexts = new WeakMap()
  const roundedRectContexts = new WeakMap()
  let computedStyles = new Map()
  let unionsThisFrame = 0
  let boundsWork = 0
  let lengthWork = { remaining: 262144 }
  let currentViewport = doc.viewBox
  let viewportClips = []
  const useStack = new Set()

  // Track each viewport in its own coordinate system. Mapping geometry forward
  // avoids inverse-transform rounding that can turn exact edge contact into a
  // tiny apparent overlap. Rotated bounding boxes remain conservative.
  function renderTransform (ctx, matrix) {
    ctx.transform(...matrix)
    if (viewportClips.length) viewportClips = viewportClips.map(clip => ({ box: clip.box, matrix: multiply(clip.matrix, matrix) }))
  }

  function fillMayPaintInViewport (bounds, computed) {
    // SVG visibility culling considers the whole painted shape. A stroke can
    // extend beyond the fill and affect edge compositing: preserve that path.
    if (computed.stroke && computed.stroke !== 'none' && strokeLength(computed['stroke-width'], 1) > 0) return true
    return viewportClips.every(clip => {
      const box = mapBox(bounds, clip.matrix)
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return true
      return !(box.x + box.width <= clip.box.x || box.y + box.height <= clip.box.y ||
        box.x >= clip.box.x + clip.box.width || box.y >= clip.box.y + clip.box.height)
    })
  }

  function inViewport (viewport, callback) {
    const previous = currentViewport
    currentViewport = viewport
    try { return callback() } finally { currentViewport = previous }
  }

  function attr (record, name, overrides) {
    const override = overrides && overrides.get(record)
    if (override && override.attrs[name] != null) return override.attrs[name]
    return record.node.attrs[name]
  }

  function style (record, overrides, inheritedStyle) {
    if (!inheritedStyle && computedStyles.has(record)) return computedStyles.get(record)
    const parent = inheritedStyle || (record.parent ? style(record.parent, overrides) : null)
    const override = overrides && overrides.get(record)
    const own = override && Object.keys(override.style).length ? { ...record.own, ...override.style } : record.own
    // Resolve animated declarations before inheritance, including font changes
    // on an ancestor. Each use instance supplies its own inherited style.
    const rootFont = record === doc.rootRecord ? undefined : number(style(doc.rootRecord, overrides)['font-size'], 0, 16)
    const computed = computeStyle(own, parent, rootFont)
    if (!inheritedStyle) computedStyles.set(record, computed)
    return computed
  }

  function number (value, reference = 0, fallback = 0) {
    const parsed = parseLength(value, reference)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function strokeLength (value, fallback = 0) {
    // SVG2 non-axis percentages use the nearest viewport's normalized
    // diagonal in user units, including nested svg and symbol viewBoxes.
    const { width, height } = currentViewport
    return number(value, Math.sqrt((width * width + height * height) / 2), fallback)
  }

  function transformOf (record, computed, overrides, bbox) {
    const override = overrides && overrides.get(record)
    let list
    if (override && override.transformReplace) list = override.transformReplace
    else if (computed.transform && computed.transform !== 'none') list = parseTransformList(computed.transform)
    else list = record.transform
    if (override && override.transformAppend.length) list = list.concat(override.transformAppend)
    if (!list.length) return null
    let matrix = transformListToMatrix(list)
    const origin = transformOrigin(computed, bbox)
    if (origin) matrix = multiply(multiply([1, 0, 0, 1, origin.x, origin.y], matrix), [1, 0, 0, 1, -origin.x, -origin.y])
    return matrix
  }

  function transformOrigin (computed, bbox) {
    const value = computed['transform-origin']
    if (!value) return null
    const tokens = String(value).trim().split(/\s+/)
    const box = computed['transform-box'] === 'fill-box' && bbox ? bbox : { x: 0, y: 0, width: currentViewport.width, height: currentViewport.height }
    const keyword = token => ({ left: 0, top: 0, center: 0.5, right: 1, bottom: 1 })[token]
    const resolve = (token, size, offset) => {
      if (token == null) return offset + size / 2
      if (keyword(token) != null) return offset + keyword(token) * size
      if (String(token).endsWith('%')) return offset + parseFloat(token) / 100 * size
      return offset + number(token, size)
    }
    // fill-box 下百分比与关键字相对元素包围盒；view-box 下相对视口，长度值直接是用户坐标
    if (computed['transform-box'] === 'fill-box' && bbox) {
      return { x: resolve(tokens[0], bbox.width, bbox.x), y: resolve(tokens[1], bbox.height, bbox.y) }
    }
    return { x: resolve(tokens[0], box.width, 0), y: resolve(tokens[1], box.height, 0) }
  }

  function geometry (record, overrides) {
    const node = record.node
    const override = overrides && overrides.get(record)
    const animatedGeometry = override && Object.keys(override.attrs).length > 0
    const cached = geometryCache.get(record)
    if (!animatedGeometry && cached && cached.viewportWidth === currentViewport.width && cached.viewportHeight === currentViewport.height) return cached
    const a = name => attr(record, name, overrides)
    let segments = []
    const vw = currentViewport.width; const vh = currentViewport.height
    switch (node.name) {
      case 'path': segments = parsePath(a('d')); break
      case 'rect': segments = rectPath(number(a('x'), vw), number(a('y'), vh), number(a('width'), vw), number(a('height'), vh), number(a('rx') != null ? a('rx') : a('ry'), vw), number(a('ry') != null ? a('ry') : a('rx'), vh)); break
      case 'circle': { const r = number(a('r'), Math.sqrt((vw * vw + vh * vh) / 2)); segments = ellipsePath(number(a('cx'), vw), number(a('cy'), vh), r, r); break }
      case 'ellipse': segments = ellipsePath(number(a('cx'), vw), number(a('cy'), vh), number(a('rx'), vw), number(a('ry'), vh)); break
      case 'line': segments = [{ type: 'M', x: number(a('x1'), vw), y: number(a('y1'), vh) }, { type: 'L', x: number(a('x2'), vw), y: number(a('y2'), vh) }]; break
      case 'polyline': segments = polyPath(a('points'), false); break
      case 'polygon': segments = polyPath(a('points'), true); break
      default: segments = []
    }
    const boundsSegments = node.name === 'path' ? parsePath(a('d'), true) : segments
    const result = { segments, boundsSegments, bounds: pathBounds(boundsSegments), viewportWidth: currentViewport.width, viewportHeight: currentViewport.height }
    if (!animatedGeometry) geometryCache.set(record, result)
    return result
  }

  // Chrome aggregates each child's local bounding rectangle after its local
  // transform. This can be larger than the tight enclosure of all curves in
  // parent space; match the browser's observable getBBox/clip behavior.
  function mapBox (box, matrix) {
    if (!box || !matrix) return box
    const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(p => transformPoint(matrix, p[0], p[1]))
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }
  }

  function viewportOf (record, overrides) {
    const attrs = {}
    for (const name of ['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio']) attrs[name] = attr(record, name, overrides)
    return resolveViewport(attrs, currentViewport)
  }

  function geometryValue (record, name, overrides, computed = style(record, overrides)) {
    return computed[name] == null ? attr(record, name, overrides) : computed[name]
  }

  function useTarget (record, overrides) {
    const target = doc.byId[String(attr(record, 'href', overrides) || '').replace(/^#/, '')]
    // A use cannot reference itself or an ancestor, even on the first expansion.
    for (let parent = record; parent; parent = parent.parent) if (parent === target) return null
    return target
  }

  function usePosition (record, overrides, computed) {
    return [number(geometryValue(record, 'x', overrides, computed), currentViewport.width), number(geometryValue(record, 'y', overrides, computed), currentViewport.height)]
  }

  // Each use instance establishes its own viewport without changing the source
  // record. Auto dimensions retain the referenced element's defaults (SVG2 5.6.2).
  function useViewport (record, target, overrides, computed) {
    if (!['symbol', 'svg'].includes(target.node.name)) return null
    const targetStyle = style(target, overrides, computed)
    const attrs = {}
    for (const name of ['x', 'y', 'width', 'height']) attrs[name] = geometryValue(target, name, overrides, targetStyle)
    for (const name of ['viewBox', 'preserveAspectRatio']) attrs[name] = attr(target, name, overrides)
    for (const name of ['width', 'height']) {
      const value = geometryValue(record, name, overrides, computed)
      if (value != null && value !== '' && value !== 'auto') attrs[name] = value
    }
    return resolveViewport(attrs, currentViewport)
  }

  function viewportForRecord (record, overrides) {
    const chain = []
    for (let parent = record.parent; parent && parent !== doc.rootRecord; parent = parent.parent) if (parent.node.name === 'svg') chain.unshift(parent)
    let units = parseViewBox(attr(doc.rootRecord, 'viewBox', overrides)) || doc.viewBox
    for (const parent of chain) units = inViewport(units, () => viewportOf(parent, overrides).units)
    return units
  }

  function objectBounds (record, overrides, visiting = new Set(), depth = 0, root = true, inheritedStyle) {
    if (++boundsWork > 10000) throw new Error('SVG bounding box traversal exceeds 10000 nodes per frame')
    if (depth > 64) throw new Error('SVG bounding box nesting exceeds 64 levels')
    if (visiting.has(record)) return null
    const node = record.node, computed = style(record, overrides, inheritedStyle)
    if (!root && (!isRendered(node) || computed.display === 'none')) return null
    visiting.add(record)
    try {
      if (node.name === 'use') {
        const target = useTarget(record, overrides)
        if (!target) return null
        const targetStyle = style(target, overrides, computed)
        const viewport = useViewport(record, target, overrides, computed)
        if (viewport && viewport.disabled) return null
        let box = viewport
          ? inViewport(viewport.units, () => objectBounds(target, overrides, visiting, depth + 1, target.node.name === 'symbol', computed))
          : objectBounds(target, overrides, visiting, depth + 1, false, computed)
        const transform = transformOf(target, targetStyle, overrides, box)
        if (viewport) box = mapBox(box, viewport.matrix)
        box = mapBox(box, transform)
        const [x, y] = usePosition(record, overrides, computed)
        return mapBox(box, [1, 0, 0, 1, x, y])
      }
      if (['g', 'a', 'switch', 'svg', 'symbol'].includes(node.name)) {
        let result = null
        for (const child of node.children) {
          const item = doc.records.get(child)
          if (!item) continue
          const viewport = child.name === 'svg' ? viewportOf(item, overrides) : null
          if (viewport && viewport.disabled) continue
          const childStyle = computed
          let box = viewport ? inViewport(viewport.units, () => objectBounds(item, overrides, visiting, depth + 1, false, childStyle)) : objectBounds(item, overrides, visiting, depth + 1, false, childStyle)
          if (!box) continue
          const transform = transformOf(item, style(item, overrides, childStyle), overrides, box)
          if (viewport) box = mapBox(box, viewport.matrix)
          box = mapBox(box, transform)
          if (!result) result = box
          else { const x = Math.min(result.x, box.x), y = Math.min(result.y, box.y); result = { x, y, width: Math.max(result.x + result.width, box.x + box.width) - x, height: Math.max(result.y + result.height, box.y + box.height) - y } }
        }
        return result
      }
      if (node.name === 'text') throw new Error('SVG text bounding boxes are not supported yet')
      if (node.name === 'image') return pathBounds(rectPath(number(attr(record, 'x', overrides), currentViewport.width), number(attr(record, 'y', overrides), currentViewport.height), number(attr(record, 'width', overrides), currentViewport.width), number(attr(record, 'height', overrides), currentViewport.height)))
      return geometry(record, overrides).bounds
    } finally { visiting.delete(record) }
  }

  function paintServer (ctx, value, computed, bbox, opacity, userSpace = false) {
    const text = String(value == null ? '' : value).trim()
    if (!text || text === 'none') return null
    const reference = /^url\(/.test(text) ? resolveReference(doc, text) : null
    if (reference) {
      const gradient = createGradient(ctx, reference, bbox, opacity, userSpace)
      if (gradient) return gradient
      const fallback = text.replace(/^url\([^)]*\)\s*/, '').trim()
      if (!fallback) return null
      return paintServer(ctx, fallback, computed, bbox, opacity, userSpace)
    }
    const rgba = parseColor(text, computed.color)
    if (!rgba) return null
    return colorToCss([rgba[0], rgba[1], rgba[2], (rgba[3] == null ? 1 : rgba[3]) * opacity])
  }

  function gradientChain (record) {
    const chain = [record]
    let current = record
    for (let depth = 0; depth < 8 && current.node.attrs.href; depth++) {
      const next = doc.byId[String(current.node.attrs.href).replace(/^#/, '')]
      if (!next || chain.includes(next)) break
      chain.push(next)
      current = next
    }
    return chain
  }

  // userSpace=true 时把渐变坐标直接映射到用户坐标系（描边、文字用），不依赖画布变换，线宽不会被包围盒缩放拉扁
  function createGradient (ctx, record, bbox, opacity, userSpace = false) {
    const chain = gradientChain(record)
    const lookup = name => { for (const item of chain) if (item.node.attrs[name] != null) return item.node.attrs[name]; return undefined }
    const stopsOwner = chain.find(item => item.node.children.some(child => child.name === 'stop')) || record
    const stops = stopsOwner.node.children.filter(child => child.name === 'stop').map(child => {
      const stopRecord = doc.records.get(child)
      const computed = stopRecord ? stopRecord.style : {}
      const offsetText = String(child.attrs.offset || '0').trim()
      const offset = offsetText.endsWith('%') ? parseFloat(offsetText) / 100 : parseFloat(offsetText)
      const color = parseColor(computed['stop-color'] || '#000', computed.color) || [0, 0, 0, 1]
      const stopOpacity = computed['stop-opacity'] != null ? Number(computed['stop-opacity']) : 1
      return { offset: Math.max(0, Math.min(1, Number.isFinite(offset) ? offset : 0)), color: colorToCss([color[0], color[1], color[2], (color[3] == null ? 1 : color[3]) * stopOpacity * opacity]) }
    })
    if (!stops.length) return null
    const units = lookup('gradientUnits') || 'objectBoundingBox'
    const objectBox = units === 'objectBoundingBox'
    if (objectBox && (!bbox || !(bbox.width > 0) || !(bbox.height > 0))) {
      // 零面积元素退化为最后一个 stop 的纯色
      return stops[stops.length - 1].color
    }
    const reference = objectBox ? { x: 0, y: 0, width: 1, height: 1 } : { x: doc.viewBox.x, y: doc.viewBox.y, width: currentViewport.width, height: currentViewport.height }
    const coordinate = (name, fallback, size) => {
      const value = lookup(name)
      if (value == null) return fallback
      const text = String(value).trim()
      if (objectBox) return text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
      return text.endsWith('%') ? parseFloat(text) / 100 * size : number(text, size)
    }
    // 渐变坐标空间：objectBoundingBox 映射到包围盒，再叠 gradientTransform。
    let matrix = objectBox ? [bbox.width, 0, 0, bbox.height, bbox.x, bbox.y] : identity()
    const gradientTransform = lookup('gradientTransform')
    if (gradientTransform) matrix = multiply(matrix, transformListToMatrix(parseTransformList(gradientTransform)))
    const isIdentity = matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])
    const map = (x, y) => (userSpace ? transformPoint(matrix, x, y) : { x, y })
    let gradient
    if (record.node.name === 'linearGradient') {
      const x1 = coordinate('x1', 0, reference.width); const y1 = coordinate('y1', 0, reference.height)
      const x2 = coordinate('x2', objectBox ? 1 : reference.width, reference.width); const y2 = coordinate('y2', 0, reference.height)
      const p1 = map(x1, y1); const p2 = map(x2, y2)
      gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y)
    } else {
      const cx = coordinate('cx', objectBox ? 0.5 : reference.width / 2, reference.width)
      const cy = coordinate('cy', objectBox ? 0.5 : reference.height / 2, reference.height)
      const r = coordinate('r', objectBox ? 0.5 : Math.sqrt(reference.width * reference.width + reference.height * reference.height) / Math.SQRT2, Math.sqrt(reference.width * reference.width + reference.height * reference.height) / Math.SQRT2)
      const fx = lookup('fx') != null ? coordinate('fx', cx, reference.width) : cx
      const fy = lookup('fy') != null ? coordinate('fy', cy, reference.height) : cy
      const c = map(cx, cy); const f = map(fx, fy)
      // 用户坐标系下非等比包围盒会把圆变椭圆，Canvas 径向渐变只能是圆：取面积等效半径近似
      const scale = userSpace ? Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) : 1
      gradient = ctx.createRadialGradient(f.x, f.y, 0, c.x, c.y, Math.max(0, r * scale))
    }
    for (const stop of stops) gradient.addColorStop(stop.offset, stop.color)
    // 填充：调用方先建好路径，再用这个矩阵 save/transform 切到渐变坐标系后 fill（路径已固定，不受影响）；
    // 描边/文字：坐标已映射到用户空间，matrix 为 null，不再动画布变换。
    return { gradient, matrix: userSpace || isIdentity ? null : matrix }
  }

  // 必须在路径已经构造好之后调用：渐变的包围盒矩阵会改变画布变换，路径本身不能受影响
  function applyPaint (ctx, paint, kind) {
    if (!paint) return false
    if (typeof paint === 'string') {
      ctx[kind === 'fill' ? 'fillStyle' : 'strokeStyle'] = paint
      return true
    }
    if (!paint.matrix) {
      ctx[kind === 'fill' ? 'fillStyle' : 'strokeStyle'] = paint.gradient
      return true
    }
    ctx.save()
    ctx.transform(paint.matrix[0], paint.matrix[1], paint.matrix[2], paint.matrix[3], paint.matrix[4], paint.matrix[5])
    ctx[kind === 'fill' ? 'fillStyle' : 'strokeStyle'] = paint.gradient
    return 'restore'
  }

  // draw = { path?, fill(rule), stroke() }：path() 构造路径（文字没有），fill/stroke 只负责最后一笔
  function fillAndStroke (ctx, record, computed, bounds, alpha, overrides, draw) {
    const fillOpacity = clamp01(computed['fill-opacity'])
    const strokeOpacity = clamp01(computed['stroke-opacity'])
    const fillValue = computed.fill == null ? '#000' : computed.fill
    const fill = paintServer(ctx, fillValue, computed, bounds, fillOpacity, !draw.path)
    if (fill) {
      if (draw.path) draw.path()
      const applied = applyPaint(ctx, fill, 'fill')
      draw.fill(computed['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', fill.matrix)
      if (applied === 'restore') ctx.restore()
    }
    const strokeWidth = strokeLength(computed['stroke-width'], 1)
    if (computed.stroke && computed.stroke !== 'none' && strokeWidth > 0) {
      // 描边渐变映射到用户坐标（不动画布变换），否则线宽会随包围盒缩放
      const stroke = paintServer(ctx, computed.stroke, computed, bounds, strokeOpacity, true)
      if (stroke) {
        ctx.lineWidth = strokeWidth
        ctx.lineCap = computed['stroke-linecap'] || 'butt'
        ctx.lineJoin = computed['stroke-linejoin'] || 'miter'
        if (computed['stroke-miterlimit']) ctx.miterLimit = Number(computed['stroke-miterlimit']) || 4
        if (draw.path) draw.path()
        if (typeof ctx.setLineDash === 'function') {
          const specified = String(attr(record, 'pathLength', overrides) ?? '').trim()
          const author = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(specified.replace(/^\+/, '')) ? Number(specified) : -1
          let scale = 1
          if (draw.shape && author > 0 && Number.isFinite(author)) {
            const nativeEllipse = ['circle', 'ellipse'].includes(record.node.name) && ellipseContexts.get(ctx) === true
            const key = nativeEllipse ? 'ellipseStrokeLength' : 'length'
            if (draw.shape[key] == null) draw.shape[key] = nativeEllipse
              ? ellipseStrokeLength(draw.shape.bounds.width / 2, draw.shape.bounds.height / 2, lengthWork)
              : geometryLength(record.node.name, draw.shape, lengthWork)
            scale = draw.shape[key] / author
          }
          // Canvas rejects infinite dash values. At author length zero Chromium
          // paints a solid outline; explicitly reset dash state for that case.
          const solid = draw.shape && (author === 0 || !Number.isFinite(scale))
          const dashes = solid ? [] : (parseDashArray(computed['stroke-dasharray'] || 'none') || []).map(token => strokeLength(token) * scale)
          ctx.setLineDash(dashes.length && dashes.some(value => value > 0) ? dashes : [])
          ctx.lineDashOffset = solid ? 0 : strokeLength(computed['stroke-dashoffset']) * scale
        }
        applyPaint(ctx, stroke, 'stroke')
        draw.stroke()
      }
    }
  }

  function clamp01 (value) {
    if (value == null || value === '') return 1
    const text = String(value).trim()
    const parsed = text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1
  }

  function supportsEllipse (ctx) {
    if (ellipseContexts.has(ctx)) return ellipseContexts.get(ctx)
    let supported = false
    ellipseContexts.set(ctx, false)
    if (typeof ctx.ellipse === 'function' && typeof ctx.getTransform === 'function' && typeof ctx.setTransform === 'function' && typeof ctx.isPointInPath === 'function') {
      ctx.save()
      try {
        const transform = ctx.getTransform()
        if (!transform || !['a', 'b', 'c', 'd', 'e', 'f'].every(k => Number.isFinite(transform[k]))) return false
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.ellipse(0, 0, 2, 1, 0, 0, Math.PI * 2)
        supported = ctx.isPointInPath(0, 0) === true && ctx.isPointInPath(3, 0) === false
      } catch (_) {} finally { ctx.restore() }
    }
    ellipseContexts.set(ctx, supported)
    return supported
  }

  function supportsRoundedRect (ctx) {
    if (roundedRectContexts.has(ctx)) return roundedRectContexts.get(ctx)
    let supported = false
    roundedRectContexts.set(ctx, false)
    // Some hosts expose Canvas method stubs. Verify a real elliptical corner
    // before using it, without painting or changing the caller's transform.
    if (typeof ctx.roundRect === 'function' && typeof ctx.setTransform === 'function' && typeof ctx.isPointInPath === 'function') {
      ctx.save()
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath()
        ctx.roundRect(0, 0, 8, 6, [{ x: 2, y: 1 }])
        supported = ctx.isPointInPath(4, 3) === true && ctx.isPointInPath(9, 3) === false && ctx.isPointInPath(0, 0) === false
      } catch (_) {} finally { ctx.restore() }
    }
    roundedRectContexts.set(ctx, supported)
    return supported
  }

  function shapePath (ctx, node, shape) {
    if (['circle', 'ellipse'].includes(node.name) && supportsEllipse(ctx)) {
      const box = shape.bounds
      ctx.beginPath()
      try {
        ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
        ctx.closePath()
        return true
      } catch (_) { ellipseContexts.set(ctx, false) }
    }
    if (node.name === 'rect' && shape.segments.length === 10 && supportsRoundedRect(ctx)) {
      const box = shape.bounds
      // rectPath already resolves and independently clamps SVG rx/ry. Reuse
      // those radii rather than Canvas's proportional overlap scaling.
      const rx = shape.segments[0].x - box.x, ry = shape.segments[2].y - box.y
      ctx.beginPath()
      try {
        ctx.roundRect(box.x, box.y, box.width, box.height, [{ x: rx, y: ry }])
        return true
      } catch (_) { roundedRectContexts.set(ctx, false) }
    }
    // A rejecting primitive may already have appended a partial path.
    // applySegments starts a fresh path; disable retries on this context.
    applySegments(ctx, shape.segments)
  }

  function clipEntries (reference, overrides, clipTransform) {
    const entries = []
    for (const node of reference.node.children) {
      let child = doc.records.get(node)
      if (!child || !isRendered(node)) continue
      let computedChild = style(child, overrides)
      if (computedChild.display === 'none' || /^(hidden|collapse)$/.test(computedChild.visibility)) continue
      let matrix = clipTransform
      const extraClips = []
      if (node.name === 'use') {
        // SVG clip use must directly reference a shape. Indirect/cyclic uses
        // contribute no silhouette in Chrome; never recursively expand them.
        const target = doc.byId[String(node.attrs.href || '').replace(/^#/, '')]
        if (!target || !['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text'].includes(target.node.name)) continue
        const useTransform = transformOf(child, computedChild, overrides, null)
        if (useTransform) matrix = multiply(matrix || identity(), useTransform)
        const [x, y] = usePosition(child, overrides, computedChild)
        matrix = multiply(matrix || identity(), [1, 0, 0, 1, x, y])
        if (computedChild['clip-path'] && computedChild['clip-path'] !== 'none') {
          const box = objectBounds(child, overrides)
          // Like painted use instances, effects run after x/y translation;
          // getBBox(use) already contains that offset, so remove it once.
          const bounds = box && { ...box, x: box.x - x, y: box.y - y }
          extraClips.push({ child, computed: computedChild, bounds, matrix })
        }
        child = target
        computedChild = style(child, overrides)
        if (computedChild.display === 'none' || /^(hidden|collapse)$/.test(computedChild.visibility)) continue
      }
      if (child.node.name === 'text') unsupported.add('clipPath-text')
      const shape = geometry(child, overrides)
      if (!shape.segments.length) continue
      const childMatrix = transformOf(child, computedChild, overrides, shape.bounds)
      if (childMatrix) matrix = multiply(matrix || identity(), childMatrix)
      entries.push({ child, computed: computedChild, shape, matrix, extraClips })
      if (entries.length > 64) throw new Error('SVG clip union exceeds 64 children')
    }
    return entries
  }

  function clipInput (entry, overrides, visiting, budget) {
    if (++budget.nodes > 256) throw new Error('SVG clip union exceeds 256 geometry nodes')
    const input = {
      d: entry.child.node.name === 'path' ? String(attr(entry.child, 'd', overrides) || '') : entry.shape.segments.map(s => s.type === 'Z' ? 'Z' : s.type === 'C' ? `C${s.x1} ${s.y1} ${s.x2} ${s.y2} ${s.x} ${s.y}` : `${s.type}${s.x} ${s.y}`).join(' '),
      rule: entry.computed['clip-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', matrix: entry.matrix
    }
    const clips = []
    for (const target of [...entry.extraClips, { child: entry.child, computed: entry.computed, bounds: entry.shape.bounds, matrix: entry.matrix }]) {
      const clip = clipGeometry(target.child, target.computed, overrides, target.bounds, visiting, target.matrix, budget)
      if (clip) clips.push(clip)
    }
    if (clips.length) input.clips = clips
    return input
  }

  function clipGeometry (record, computed, overrides, bounds, visiting, parentMatrix, budget) {
    const reference = resolveReference(doc, computed['clip-path'])
    if (!reference || reference.node.name !== 'clipPath') return null
    if (++budget.nodes > 256) throw new Error('SVG clip union exceeds 256 geometry nodes')
    if (visiting.has(reference)) return { children: [] }
    if (visiting.size >= 64) throw new Error('SVG clipping reference nesting exceeds 64 levels')
    visiting.add(reference)
    try {
      const clipStyle = style(reference, overrides)
      let matrix = transformOf(reference, clipStyle, overrides, null)
      if (reference.node.attrs.clipPathUnits === 'objectBoundingBox') {
        const box = bounds || objectBounds(record, overrides)
        if (!box || box.width <= 0 || box.height <= 0) return { children: [] }
        matrix = multiply([box.width, 0, 0, box.height, box.x, box.y], matrix || identity())
      }
      if (parentMatrix) matrix = multiply(parentMatrix, matrix || identity())
      const result = { children: clipEntries(reference, overrides, matrix).map(entry => clipInput(entry, overrides, visiting, budget)) }
      // A clipPath's own reference uses the original target coordinates/box.
      const own = clipGeometry(record, clipStyle, overrides, bounds, visiting, parentMatrix, budget)
      if (own) result.clips = [own]
      return result
    } finally { visiting.delete(reference) }
  }

  function applyClip (ctx, record, computed, overrides, bounds, visiting = new Set(), parentMatrix = null) {
    const reference = resolveReference(doc, computed['clip-path'])
    if (!reference || reference.node.name !== 'clipPath') return
    ctx.beginPath()
    if (visiting.has(reference)) { ctx.clip(); return }
    if (visiting.size >= 64) throw new Error('SVG clipping reference nesting exceeds 64 levels')
    visiting.add(reference)
    const clipStyle = style(reference, overrides)
    let clipTransform = transformOf(reference, clipStyle, overrides, null)
    if (reference.node.attrs.clipPathUnits === 'objectBoundingBox') {
      const box = bounds || objectBounds(record, overrides)
      if (box && box.width > 0 && box.height > 0) {
        clipTransform = multiply([box.width, 0, 0, box.height, box.x, box.y], clipTransform || identity())
      } else {
        ctx.clip(); visiting.delete(reference); return
      }
    }
    if (parentMatrix) clipTransform = multiply(parentMatrix, clipTransform || identity())
    // A clipPath may itself reference a clipping path. Intersect that region
    // with the complete silhouette, including multi-child unions (Masking §6.1).
    // The referenced resource keeps the original target box and user space;
    // clipPath transforms/units affect its contents, not another clip resource.
    if (clipStyle['clip-path'] && clipStyle['clip-path'] !== 'none') {
      applyClip(ctx, record, clipStyle, overrides, bounds, visiting, parentMatrix)
    }
    const entries = clipEntries(reference, overrides, clipTransform)
    if (entries.length > 1) {
      if (typeof options.clipUnion !== 'function') throw new Error('SVG clip union kernel is not ready')
      const budget = { nodes: 0 }
      const input = entries.map(entry => clipInput(entry, overrides, visiting, budget))
      const key = JSON.stringify(input)
      let result = unionCache.get(reference)
      if (!result || result.key !== key) {
        if (++unionsThisFrame > 32) throw new Error('SVG clip union exceeds 32 changed clips per frame')
        const geometry = options.clipUnion(input)
        result = { key, ...geometry }
        if (!unionCache.has(reference) && unionCache.size >= 16) unionCache.delete(unionCache.keys().next().value)
        unionCache.set(reference, result)
      }
      ctx.beginPath(); appendSegments(ctx, result.segments, null)
      const path = nativePaths.get(ctx, reference, result.d)
      if (path) {
        try { ctx.clip(path, result.rule) } catch (_) { nativePaths.disable(ctx); ctx.clip(result.rule) }
      } else ctx.clip(result.rule)
      visiting.delete(reference)
      return
    }
    if (entries.length === 1) {
      const entry = entries[0]
      for (const target of entry.extraClips) applyClip(ctx, target.child, target.computed, overrides, target.bounds, visiting, target.matrix)
      applyClip(ctx, entry.child, entry.computed, overrides, entry.shape.bounds, visiting, entry.matrix)
    }
    if (entries.length === 1 && entries[0].child.node.name === 'rect' && entries[0].shape.segments.length === 10 && typeof ctx.getTransform === 'function' && supportsRoundedRect(ctx)) {
      const entry = entries[0]
      let previous
      try { previous = ctx.getTransform() } catch (_) { roundedRectContexts.set(ctx, false) }
      const saved = previous && [previous.a, previous.b, previous.c, previous.d, previous.e, previous.f]
      if (saved && saved.every(Number.isFinite)) {
        let drawn = false
        try {
          if (entry.matrix) ctx.transform(...entry.matrix)
          if (shapePath(ctx, entry.child.node, entry.shape)) {
            ctx.clip(entry.computed['clip-rule'] === 'evenodd' ? 'evenodd' : 'nonzero')
            drawn = true
          }
        } finally {
          // Restore only the matrix: save/restore here would discard the clip.
          ctx.setTransform(...saved)
        }
        if (drawn) { visiting.delete(reference); return }
      } else roundedRectContexts.set(ctx, false)
    }
    if (entries.length === 1 && ['circle', 'ellipse'].includes(entries[0].child.node.name) && supportsEllipse(ctx)) {
      const entry = entries[0], box = entry.shape.bounds
      const previous = ctx.getTransform(), saved = [previous.a, previous.b, previous.c, previous.d, previous.e, previous.f]
      const matrix = multiply(saved, entry.matrix || identity()), center = transformPoint(matrix, box.x + box.width / 2, box.y + box.height / 2)
      const rx = box.width / 2, ry = box.height / 2
      const a = matrix[0] * rx, b = matrix[2] * ry, c = matrix[1] * rx, d = matrix[3] * ry
      const xx = a * a + b * b, yy = c * c + d * d, xy = a * c + b * d
      const major = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2, determinant = a * d - b * c
      const minor = major ? determinant * determinant / major : 0
      let drawn = false
      try {
        // Construct and clip in device coordinates. A tiny unit circle under a
        // large CTM otherwise takes a different, visibly less precise AA route.
        if (![center.x, center.y, major, minor].every(Number.isFinite)) throw new Error('Invalid SVG ellipse transform')
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath()
        if (major > 0 && minor > 0) ctx.ellipse(center.x, center.y, Math.sqrt(major), Math.sqrt(minor), .5 * Math.atan2(2 * xy, xx - yy), 0, Math.PI * 2)
        ctx.clip(entry.computed['clip-rule'] === 'evenodd' ? 'evenodd' : 'nonzero')
        drawn = true
      } catch (_) { ellipseContexts.set(ctx, false) } finally { ctx.setTransform(...saved) }
      if (drawn) { visiting.delete(reference); return }
    }
    ctx.beginPath()
    for (const entry of entries) appendSegments(ctx, entry.shape.segments, entry.matrix)
    const rule = (entries.length === 1 ? entries[0].computed['clip-rule'] : reference.style['clip-rule']) === 'evenodd' ? 'evenodd' : 'nonzero'
    let native = null
    if (entries.length === 1 && ['path', 'circle', 'ellipse'].includes(entries[0].child.node.name)) {
      const entry = entries[0], box = entry.shape.bounds
      const data = entry.child.node.name === 'path' ? String(attr(entry.child, 'd', overrides) || '') : `M${box.x} ${box.y + box.height / 2}A${box.width / 2} ${box.height / 2} 0 1 0 ${box.x + box.width} ${box.y + box.height / 2}A${box.width / 2} ${box.height / 2} 0 1 0 ${box.x} ${box.y + box.height / 2}Z`
      native = nativePaths.get(ctx, entry.child, data)
      if (native && entry.matrix) native = nativePaths.transform(ctx, entry.child, native, entry.matrix)
    }
    if (native) {
      try { ctx.clip(native, rule) } catch (_) { nativePaths.disable(ctx); ctx.clip(rule) }
    } else ctx.clip(rule)
    visiting.delete(reference)
  }

  function appendSegments (ctx, segments, matrix) {
    const map = (x, y) => (matrix ? { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] } : { x, y })
    for (const segment of segments) {
      if (segment.type === 'M') { const p = map(segment.x, segment.y); ctx.moveTo(p.x, p.y) } else if (segment.type === 'L') { const p = map(segment.x, segment.y); ctx.lineTo(p.x, p.y) } else if (segment.type === 'C') {
        const p1 = map(segment.x1, segment.y1); const p2 = map(segment.x2, segment.y2); const p = map(segment.x, segment.y)
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p.x, p.y)
      } else if (segment.type === 'Z') ctx.closePath()
    }
  }

  function fontOf (computed) {
    const size = number(computed['font-size'], 16, 16)
    const weight = computed['font-weight'] || 'normal'
    const fontStyle = computed['font-style'] || 'normal'
    const family = computed['font-family'] || 'sans-serif'
    return { css: `${fontStyle} ${weight} ${size}px ${family}`, size }
  }

  function drawText (ctx, record, computed, alpha, overrides) {
    const font = fontOf(computed)
    ctx.font = font.css
    ctx.textAlign = 'left'
    const baseline = computed['dominant-baseline'] || computed['alignment-baseline'] || ''
    ctx.textBaseline = /middle|central/.test(baseline) ? 'middle' : /hanging|text-before-edge/.test(baseline) ? 'hanging' : 'alphabetic'
    const anchor = computed['text-anchor'] || 'start'
    // 先测量整行宽度再决定起点，tspan 顺序排布
    const runs = []
    const collect = (node, inherited) => {
      for (const child of node.children) {
        if (child.name === '#text') {
          const text = child.text.replace(/\s+/g, ' ')
          if (text) runs.push({ text, style: inherited, x: null, y: null, dx: 0, dy: 0 })
        } else if (child.name === 'tspan') {
          const childRecord = doc.records.get(child)
          const childStyle = childRecord ? style(childRecord, overrides, inherited) : inherited
          const marker = { text: '', style: childStyle, x: child.attrs.x != null ? number(String(child.attrs.x).split(/[\s,]+/)[0], currentViewport.width) : null, y: child.attrs.y != null ? number(String(child.attrs.y).split(/[\s,]+/)[0], currentViewport.height) : null, dx: number(child.attrs.dx, currentViewport.width), dy: number(child.attrs.dy, currentViewport.height), positioned: true }
          runs.push(marker)
          collect(child, childStyle)
        }
      }
    }
    collect(record.node, computed)
    let x = number(String(attr(record, 'x', overrides) || '0').split(/[\s,]+/)[0], currentViewport.width)
    let y = number(String(attr(record, 'y', overrides) || '0').split(/[\s,]+/)[0], currentViewport.height)
    x += number(record.node.attrs.dx, currentViewport.width); y += number(record.node.attrs.dy, currentViewport.height)
    let total = 0
    for (const run of runs) { if (run.text) { ctx.font = fontOf(run.style).css; total += ctx.measureText(run.text).width } }
    if (anchor === 'middle') x -= total / 2
    else if (anchor === 'end') x -= total
    for (const run of runs) {
      if (run.positioned) {
        if (run.x != null) x = run.x
        if (run.y != null) y = run.y
        x += run.dx; y += run.dy
        continue
      }
      const runStyle = run.style
      const runFont = fontOf(runStyle)
      ctx.font = runFont.css
      const width = ctx.measureText(run.text).width
      fillAndStroke(ctx, record, runStyle, { x, y: y - runFont.size, width, height: runFont.size }, alpha, overrides, {
        fill: () => ctx.fillText(run.text, x, y),
        stroke: () => ctx.strokeText(run.text, x, y)
      })
      x += width
    }
  }

  function drawImage (ctx, record, computed, overrides) {
    const href = String(attr(record, 'href', overrides) || '')
    if (!/^data:image\//i.test(href)) { unsupported.add('external-image'); return }
    const image = resolveImage(href)
    if (!image) return
    const x = number(attr(record, 'x', overrides), currentViewport.width)
    const y = number(attr(record, 'y', overrides), currentViewport.height)
    const width = number(attr(record, 'width', overrides), currentViewport.width, image.width || 0)
    const height = number(attr(record, 'height', overrides), currentViewport.height, image.height || 0)
    if (width > 0 && height > 0) ctx.drawImage(image, x, y, width, height)
  }

  function renderRecord (ctx, record, parentAlpha, overrides, depth, inheritedStyle, instanceViewport) {
    const node = record.node
    if (!isRendered(node) && !(node.name === 'symbol' && instanceViewport)) return
    if (depth > 64) throw new Error('SVG render nesting exceeds 64 levels')
    const computed = style(record, overrides, inheritedStyle)
    if (computed.display === 'none' && !(node.name === 'symbol' && instanceViewport)) return
    const isRoot = record === doc.rootRecord
    const opacity = clamp01(computed.opacity)
    const alpha = parentAlpha * opacity
    if (alpha <= 0) return
    for (const property of UNSUPPORTED_PROPERTIES) if (computed[property] && computed[property] !== 'none') unsupported.add(property)
    ctx.save()
    const previousClips = viewportClips
    try {
      ctx.globalAlpha = alpha
      let bounds = null
      if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(node.name)) bounds = geometry(record, overrides).bounds
      const clip = resolveReference(doc, computed['clip-path'])
      if (!bounds && ((clip && clip.node.attrs.clipPathUnits === 'objectBoundingBox') || (computed['transform-origin'] && computed['transform-box'] === 'fill-box'))) bounds = objectBounds(record, overrides)
      const matrix = isRoot ? null : transformOf(record, computed, overrides, bounds)
      if (matrix) renderTransform(ctx, matrix)
      if (node.name === 'use') {
        const [x, y] = usePosition(record, overrides, computed)
        renderTransform(ctx, [1, 0, 0, 1, x, y])
        // getBBox(use) includes x/y; effects now run in the translated use space.
        if (bounds) bounds = { ...bounds, x: bounds.x - x, y: bounds.y - y }
      }
      if ((node.name === 'svg' && !isRoot) || (node.name === 'symbol' && instanceViewport)) {
        const viewport = instanceViewport || viewportOf(record, overrides)
        if (viewport.disabled) return
        const overflow = computed.overflow || node.attrs.overflow || 'hidden'
        // Match current Chrome/Blink inner SVG auto behavior; SVGWG issue #1072
        // remains open and the Firefox-oriented WPT reference differs.
        if (overflow !== 'visible' && overflow !== 'auto') {
          ctx.beginPath(); ctx.rect(viewport.box.x, viewport.box.y, viewport.box.width, viewport.box.height); ctx.clip()
          viewportClips = viewportClips.concat({ box: viewport.box, matrix: identity() })
        }
        renderTransform(ctx, viewport.matrix)
        inViewport(viewport.units, () => {
          if (computed['clip-path'] && computed['clip-path'] !== 'none') applyClip(ctx, record, computed, overrides, objectBounds(record, overrides))
          renderChildren(ctx, record, alpha, overrides, depth, computed)
        })
        return
      }
      if (computed['clip-path'] && computed['clip-path'] !== 'none') applyClip(ctx, record, computed, overrides, bounds)
      const hidden = computed.visibility === 'hidden' || computed.visibility === 'collapse'
      switch (node.name) {
        case 'svg': {
          renderChildren(ctx, record, alpha, overrides, depth, computed)
          break
        }
        case 'g': case 'a': case 'switch':
          renderChildren(ctx, record, alpha, overrides, depth, computed)
          break
        case 'use': {
          const target = useTarget(record, overrides)
          if (target) {
            // Invalid circular references do not render; keep valid siblings readable.
            if (useStack.has(target) || target === record) break
            if (useStack.size >= 32) throw new Error('SVG use reference nesting exceeds 32 levels')
            const viewport = useViewport(record, target, overrides, computed)
            if (viewport && viewport.disabled) break
            useStack.add(target)
            try { renderRecord(ctx, target, alpha, overrides, depth + 1, computed, viewport) } finally { useStack.delete(target) }
          }
          break
        }
        case 'text':
          if (!hidden) drawText(ctx, record, computed, alpha, overrides)
          break
        case 'image':
          if (!hidden) drawImage(ctx, record, computed, overrides)
          break
        default: {
          if (hidden) break
          const shape = geometry(record, overrides)
          if (!shape.segments.length) break
          let nativePath = node.name === 'path' ? nativePaths.get(ctx, record, String(attr(record, 'd', overrides) || '')) : null
          const paintPath = (kind, rule, paintTransform) => {
            if (!nativePath) { if (kind === 'fill') ctx.fill(rule); else ctx.stroke(); return }
            let path = nativePath
            if (paintTransform) {
              const [a, b, c, d, e, f] = paintTransform, determinant = a * d - b * c
              const inverse = [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant]
              path = inverse.every(Number.isFinite) ? nativePaths.transform(ctx, record, nativePath, inverse) : null
            }
            const fallback = () => {
              if (kind === 'fill') ctx.fill(rule); else ctx.stroke()
            }
            if (!path) { fallback(); return }
            try {
              if (kind === 'fill') ctx.fill(path, rule)
              else ctx.stroke(path)
            } catch (_) {
              nativePaths.disable(ctx); nativePath = null
              fallback()
            }
          }
          fillAndStroke(ctx, record, computed, shape.bounds, alpha, overrides, {
            shape,
            // Keep the established current path ready for exact fallback, including
            // hosts rejecting a paint overload after changing the gradient matrix.
            path: () => shapePath(ctx, node, shape),
            fill: (rule, matrix) => {
              // Cull only fills. A stroke can cross the viewport even when its
              // centerline/fill bounds are wholly outside; it must still paint.
              if (!fillMayPaintInViewport(shape.bounds, computed)) return
              // SVG rect and Canvas fillRect share the rectangle rasterizer.
              // A generic closed path rounds fractional edge coverage differently.
              // Object-box paint transforms need the preconstructed path instead.
              if (node.name === 'rect' && shape.segments.length === 5 && !matrix && typeof ctx.fillRect === 'function') {
                ctx.fillRect(shape.bounds.x, shape.bounds.y, shape.bounds.width, shape.bounds.height)
              } else paintPath('fill', rule, matrix)
            },
            stroke: () => {
              // Preserve native rectangle edge coverage under fractional clipping.
              // Rounded rectangles and hosts without the primitive keep the path.
              if (node.name === 'rect' && shape.segments.length === 5 && typeof ctx.strokeRect === 'function') {
                ctx.strokeRect(shape.bounds.x, shape.bounds.y, shape.bounds.width, shape.bounds.height)
              } else paintPath('stroke')
            }
          })
        }
      }
    } finally { viewportClips = previousClips; ctx.restore() }
  }

  function renderChildren (ctx, record, alpha, overrides, depth, inheritedStyle) {
    for (const child of record.node.children) {
      const childRecord = doc.records.get(child)
      if (childRecord) renderRecord(ctx, childRecord, alpha, overrides, depth + 1, inheritedStyle)
    }
  }

  // width/height：画布 CSS 像素尺寸；viewBox 按 xMidYMid meet 适配
  function render (ctx, width, height, overrides) {
    computedStyles = new Map()
    unionsThisFrame = 0
    boundsWork = 0
    lengthWork = { remaining: 262144 }
    const viewBox = parseViewBox(attr(doc.rootRecord, 'viewBox', overrides), true) || doc.viewBox
    const viewport = viewportTransform({ x: 0, y: 0, width, height }, viewBox, attr(doc.rootRecord, 'preserveAspectRatio', overrides))
    ctx.save()
    try {
      ctx.clearRect(0, 0, width, height)
      if (viewport.disabled) return
      ctx.transform(...viewport.matrix)
      inViewport(viewport.units, () => renderRecord(ctx, doc.rootRecord, 1, overrides || null, 0))
    } finally { ctx.restore() }
  }

  return { render, unsupported, getBounds (record, overrides) { boundsWork = 0; return inViewport(viewportForRecord(record, overrides), () => objectBounds(record, overrides)) } }
}

module.exports = { createRenderer }
