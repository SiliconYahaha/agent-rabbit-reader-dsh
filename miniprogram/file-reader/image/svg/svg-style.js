'use strict'

// SVG 样式：表现属性 + style 属性 + <style> 规则（简单选择器）+ @keyframes 收集，
// 以及 transform / 颜色 / 长度 的解析。给光栅化器和动画时间线共用。

const PRESENTATION_ATTRIBUTES = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'display', 'visibility', 'color', 'overflow',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'clip-path', 'clip-rule',
  'transform', 'transform-origin', 'transform-box', 'stop-color', 'stop-opacity', 'letter-spacing', 'mask', 'filter'
]

const INHERITED = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'visibility', 'color', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'clip-rule', 'letter-spacing'
])

// --- 简单 CSS 解析 ---

function stripComments (css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitDeclarations (body) {
  const declarations = {}
  for (const part of String(body || '').split(';')) {
    const index = part.indexOf(':')
    if (index < 0) continue
    const property = part.slice(0, index).trim().toLowerCase()
    const value = part.slice(index + 1).trim()
    if (property && validDashDeclaration(property, value)) declarations[property] = value
  }
  return declarations
}

// CSS number tokens can be adjacent when a sign or decimal starts the next
// token (12+6 and 12.6.3); commas must separate two values. Return the original
// lengths, since percentages/font units require the renderer's length context.
function parseDashArray (value) {
  const text = String(value).trim()
  if (/^none$/i.test(text)) return []
  const token = /([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)([a-z]+|%)?/iy
  const units = /^(?:%|px|pt|pc|mm|cm|in|q|em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|[sld]?(?:vw|vh|vi|vb|vmin|vmax)|cq(?:w|h|i|b|min|max))?$/i
  const lengths = []
  let index = 0
  while (index < text.length) {
    token.lastIndex = index
    const match = token.exec(text)
    if (!match || Number(match[1]) < 0 || !units.test(match[2] || '')) return null
    lengths.push(match[0])
    index = token.lastIndex
    while (index < text.length && /\s/.test(text[index])) index++
    if (text[index] === ',') {
      index++
      while (index < text.length && /\s/.test(text[index])) index++
      if (index === text.length) return null
    }
  }
  return lengths.length ? lengths : null
}

// Validate before cascading: otherwise an invalid later declaration erases an
// earlier valid value. Function-valued CSS is outside this literal-list parser
// and retains its existing cascade behavior until function resolution exists.
function validDashDeclaration (property, value) {
  if (property !== 'stroke-dasharray') return true
  const text = String(value).trim()
  return /^(inherit|initial|unset|revert|revert-layer)$/i.test(text) || text.includes('(') || parseDashArray(text) !== null
}

// 解析成 { rules: [{ selectors: [parsed], declarations, order }], keyframes: { name: [{ offset, declarations }] } }
function parseStyleSheet (css, options = {}) {
  const result = { rules: [], keyframes: {} }
  const source = stripComments(css)
  let order = 0
  parseBlocks(source, (prelude, body) => {
    const head = prelude.trim()
    if (!head) return
    if (/^@(?:-webkit-)?keyframes\s+/i.test(head)) {
      const name = head.replace(/^@(?:-webkit-)?keyframes\s+/i, '').trim().replace(/^["']|["']$/g, '')
      result.keyframes[name] = parseKeyframeBody(body)
      return
    }
    if (head.startsWith('@media')) {
      // 只支持不带查询的 all；prefers-reduced-motion 之类按不匹配处理
      const query = head.slice(6).trim().toLowerCase()
      if (query && query !== 'all' && query !== 'screen' && !options.matchMedia) return
      if (query && query !== 'all' && query !== 'screen' && !options.matchMedia(query)) return
      const nested = parseStyleSheet(body, options)
      for (const rule of nested.rules) result.rules.push({ ...rule, order: order++ })
      Object.assign(result.keyframes, nested.keyframes)
      return
    }
    if (head.startsWith('@')) return
    const declarations = splitDeclarations(body)
    const selectors = head.split(',').map(parseSelector).filter(Boolean)
    if (selectors.length) result.rules.push({ selectors, declarations, order: order++ })
  })
  return result
}

function parseBlocks (source, visit) {
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    const prelude = source.slice(index, open)
    let depth = 1
    let cursor = open + 1
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth++
      else if (source[cursor] === '}') depth--
      cursor++
    }
    visit(prelude, source.slice(open + 1, cursor - 1))
    index = cursor
  }
}

function parseKeyframeBody (body) {
  const frames = []
  parseBlocks(body, (prelude, declarationsText) => {
    const declarations = splitDeclarations(declarationsText)
    for (const token of prelude.split(',')) {
      const key = token.trim().toLowerCase()
      const offset = key === 'from' ? 0 : key === 'to' ? 1 : /^-?\d*\.?\d+%$/.test(key) ? parseFloat(key) / 100 : NaN
      if (Number.isFinite(offset)) frames.push({ offset: Math.max(0, Math.min(1, offset)), declarations })
    }
  })
  return frames.sort((a, b) => a.offset - b.offset)
}

// 选择器：复合选择器（tag/.class/#id/* 的组合）用后代组合符或子组合符连接
function parseSelector (text) {
  const trimmed = text.trim()
  if (!trimmed || /[[:~+]/.test(trimmed)) return null // 属性、伪类、兄弟组合符不支持
  const parts = trimmed.split(/\s*>\s*|\s+/).map(token => {
    const compound = { tag: '', id: '', classes: [] }
    const pattern = /([#.]?)([^#.]+)/g
    let match
    while ((match = pattern.exec(token))) {
      if (match[1] === '#') compound.id = match[2]
      else if (match[1] === '.') compound.classes.push(match[2])
      else compound.tag = match[2].toLowerCase()
    }
    return compound
  })
  const combinators = []
  const pattern = /\s*>\s*|\s+/g
  let match
  while ((match = pattern.exec(trimmed))) combinators.push(match[0].includes('>') ? 'child' : 'descendant')
  const specificity = parts.reduce((sum, part) => sum + (part.id ? 100 : 0) + part.classes.length * 10 + (part.tag && part.tag !== '*' ? 1 : 0), 0)
  return { parts, combinators, specificity }
}

function matchesCompound (node, compound) {
  if (compound.tag && compound.tag !== '*' && node.name.toLowerCase() !== compound.tag) return false
  if (compound.id && node.attrs.id !== compound.id) return false
  if (compound.classes.length) {
    const classes = String(node.attrs.class || '').split(/\s+/)
    for (const name of compound.classes) if (!classes.includes(name)) return false
  }
  return true
}

// ancestors: 从根到父节点的数组
function matchesSelector (node, ancestors, selector) {
  const parts = selector.parts
  if (!matchesCompound(node, parts[parts.length - 1])) return false
  let ancestorIndex = ancestors.length - 1
  for (let partIndex = parts.length - 2; partIndex >= 0; partIndex--) {
    const combinator = selector.combinators[partIndex]
    if (combinator === 'child') {
      if (ancestorIndex < 0 || !matchesCompound(ancestors[ancestorIndex], parts[partIndex])) return false
      ancestorIndex--
    } else {
      let found = false
      while (ancestorIndex >= 0) {
        if (matchesCompound(ancestors[ancestorIndex], parts[partIndex])) { found = true; ancestorIndex--; break }
        ancestorIndex--
      }
      if (!found) return false
    }
  }
  return true
}

// 元素自身声明的样式（不含继承）：表现属性 < 样式表 < style 属性
function ownStyle (node, ancestors, sheet) {
  const style = {}
  for (const name of PRESENTATION_ATTRIBUTES) {
    if (node.attrs[name] != null && name !== 'transform' && validDashDeclaration(name, node.attrs[name])) style[name] = String(node.attrs[name])
  }
  const matched = []
  for (const rule of sheet.rules) {
    for (const selector of rule.selectors) {
      if (matchesSelector(node, ancestors, selector)) { matched.push({ specificity: selector.specificity, order: rule.order, declarations: rule.declarations }); break }
    }
  }
  matched.sort((a, b) => a.specificity - b.specificity || a.order - b.order)
  for (const entry of matched) Object.assign(style, entry.declarations)
  if (node.attrs.style) Object.assign(style, splitDeclarations(node.attrs.style))
  return style
}

// 计算样式：继承属性沿 ancestors 传递
function computeStyle (own, parentComputed, rootFontSize) {
  const computed = {}
  if (parentComputed) for (const key of INHERITED) if (parentComputed[key] != null) computed[key] = parentComputed[key]
  for (const key of Object.keys(own)) {
    const value = own[key]
    if (value === 'inherit') { if (parentComputed && parentComputed[key] != null) computed[key] = parentComputed[key]; continue }
    computed[key] = value
  }
  // Inherited lengths are computed in their declaring element's font, not
  // reinterpreted when a descendant changes font-size. Percent stroke lengths
  // stay percentages so the renderer can use the applicable SVG viewport.
  const inheritedFont = parentComputed ? parseLength(parentComputed['font-size']) : NaN
  const parentFont = Number.isFinite(inheritedFont) ? inheritedFont : 16
  const fontValue = String(computed['font-size'] || '').toLowerCase()
  const font = fontValue === 'initial' ? 16
    : /^(inherit|unset|revert|revert-layer)$/.test(fontValue) ? parentFont
      : parseLength(computed['font-size'], parentFont, parentFont, rootFontSize == null ? 16 : rootFontSize)
  const fontSize = Number.isFinite(font) && font >= 0 ? font : parentFont
  if (computed['font-size'] != null) computed['font-size'] = String(fontSize)
  const rootFont = rootFontSize == null ? fontSize : rootFontSize
  const resolveFontLength = value => {
    if (!/(?:em|rem)$/i.test(String(value))) return value
    const resolved = parseLength(value, 0, fontSize, rootFont)
    return Number.isFinite(resolved) ? String(resolved) : value
  }
  for (const property of ['stroke-width', 'stroke-dashoffset']) {
    if (computed[property] != null) computed[property] = resolveFontLength(computed[property])
  }
  if (computed['stroke-dasharray'] && /(?:em|rem)/i.test(computed['stroke-dasharray'])) {
    const lengths = parseDashArray(computed['stroke-dasharray'])
    if (lengths) computed['stroke-dasharray'] = lengths.map(resolveFontLength).join(' ')
  }
  return computed
}

// --- 数值与颜色 ---

function parseLength (value, reference = 0, fontSize = 16, rootFontSize = fontSize) {
  if (value == null || value === '') return NaN
  if (typeof value === 'number') return value
  const match = String(value).trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(px|pt|pc|mm|cm|in|em|rem|%)?$/i)
  if (!match) return NaN
  const number = parseFloat(match[1])
  switch ((match[2] || '').toLowerCase()) {
    case '%': return number / 100 * reference
    case 'em': return number * fontSize
    case 'rem': return number * rootFontSize
    case 'pt': return number * 4 / 3
    case 'pc': return number * 16
    case 'mm': return number * 96 / 25.4
    case 'cm': return number * 96 / 2.54
    case 'in': return number * 96
    default: return number
  }
}

const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
  orange: [255, 165, 0], purple: [128, 0, 128], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  navy: [0, 0, 128], teal: [0, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0], lime: [0, 255, 0], aqua: [0, 255, 255],
  cyan: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255], pink: [255, 192, 203], brown: [165, 42, 42],
  gold: [255, 215, 0], coral: [255, 127, 80], salmon: [250, 128, 114], tomato: [255, 99, 71], crimson: [220, 20, 60],
  skyblue: [135, 206, 235], lightblue: [173, 216, 230], darkblue: [0, 0, 139], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105], whitesmoke: [245, 245, 245], beige: [245, 245, 220],
  ivory: [255, 255, 240], khaki: [240, 230, 140], tan: [210, 180, 140], chocolate: [210, 105, 30], sienna: [160, 82, 45],
  peru: [205, 133, 63], wheat: [245, 222, 179], linen: [250, 240, 230], lavender: [230, 230, 250], indigo: [75, 0, 130],
  violet: [238, 130, 238], orchid: [218, 112, 214], plum: [221, 160, 221], turquoise: [64, 224, 208], steelblue: [70, 130, 180],
  royalblue: [65, 105, 225], dodgerblue: [30, 144, 255], deepskyblue: [0, 191, 255], forestgreen: [34, 139, 34], seagreen: [46, 139, 87],
  limegreen: [50, 205, 50], springgreen: [0, 255, 127], darkgreen: [0, 100, 0], firebrick: [178, 34, 34], darkred: [139, 0, 0],
  orangered: [255, 69, 0], darkorange: [255, 140, 0], goldenrod: [218, 165, 32], transparent: [0, 0, 0, 0]
}

// 返回 [r, g, b, a] 或 null（none / url() / 非法）
function parseColor (value, currentColor) {
  const text = String(value == null ? '' : value).trim().toLowerCase()
  if (!text || text === 'none') return null
  if (text === 'currentcolor') return currentColor ? parseColor(currentColor) : [0, 0, 0, 1]
  if (text[0] === '#') {
    let hex = text.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(char => char + char).join('')
    if (hex.length !== 6 && hex.length !== 8) return null
    const number = parseInt(hex.slice(0, 6), 16)
    if (!Number.isFinite(number)) return null
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    return [number >> 16 & 255, number >> 8 & 255, number & 255, alpha]
  }
  const fn = text.match(/^(rgba?|hsla?)\(([^)]*)\)$/)
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const alpha = parts.length > 3 ? parsePercentOrNumber(parts[3], 1) : 1
    if (fn[1].startsWith('rgb')) {
      return [parsePercentOrNumber(parts[0], 255), parsePercentOrNumber(parts[1], 255), parsePercentOrNumber(parts[2], 255), alpha].map((channel, index) => index < 3 ? Math.max(0, Math.min(255, Math.round(channel))) : channel)
    }
    const h = parseFloat(parts[0]) / 360; const s = parseFloat(parts[1]) / 100; const l = parseFloat(parts[2]) / 100
    return [...hslToRgb(h, s, l), alpha]
  }
  if (NAMED_COLORS[text]) { const rgb = NAMED_COLORS[text]; return [rgb[0], rgb[1], rgb[2], rgb.length > 3 ? rgb[3] : 1] }
  return null
}

function parsePercentOrNumber (token, scale) {
  return token.endsWith('%') ? parseFloat(token) / 100 * scale : parseFloat(token)
}

function hslToRgb (h, s, l) {
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255))
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map(v => Math.round(v * 255))
}

function colorToCss (rgba) {
  if (!rgba) return 'rgba(0,0,0,0)'
  return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${Math.max(0, Math.min(1, rgba[3] == null ? 1 : rgba[3]))})`
}

// --- transform ---

function identity () { return [1, 0, 0, 1, 0, 0] }

function multiply (a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
  ]
}

function parseAngle (token) {
  const match = String(token).trim().match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(deg|rad|turn|grad)?$/i)
  if (!match) return NaN
  const value = parseFloat(match[1])
  switch ((match[2] || 'deg').toLowerCase()) {
    case 'rad': return value * 180 / Math.PI
    case 'turn': return value * 360
    case 'grad': return value * 0.9
    default: return value
  }
}

// 解析 transform 属性或 CSS transform 值为函数列表 [{ name, args }]（args 为数字，角度统一成度、长度统一成 px）
function parseTransformList (value) {
  const list = []
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let match
  while ((match = pattern.exec(String(value || '')))) {
    const name = match[1]
    const raw = match[2].split(/[\s,]+/).filter(Boolean)
    let args
    switch (name) {
      case 'rotate': case 'skewX': case 'skewY': case 'skew':
        args = raw.map((token, index) => name === 'rotate' && index > 0 ? parseLength(token) : parseAngle(token)); break
      case 'scale': case 'scaleX': case 'scaleY': case 'matrix':
        args = raw.map(Number); break
      default:
        args = raw.map(token => parseLength(token))
    }
    if (args.some(number => !Number.isFinite(number))) continue
    list.push({ name, args })
  }
  return list
}

function transformListToMatrix (list) {
  let matrix = identity()
  for (const fn of list) {
    const a = fn.args
    let m
    switch (fn.name) {
      case 'matrix': if (a.length === 6) m = a; break
      case 'translate': m = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break
      case 'translateX': m = [1, 0, 0, 1, a[0] || 0, 0]; break
      case 'translateY': m = [1, 0, 0, 1, 0, a[0] || 0]; break
      case 'scale': m = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break
      case 'scaleX': m = [a[0], 0, 0, 1, 0, 0]; break
      case 'scaleY': m = [1, 0, 0, a[0], 0, 0]; break
      case 'rotate': {
        const radians = (a[0] || 0) * Math.PI / 180
        const cos = Math.cos(radians); const sin = Math.sin(radians)
        m = [cos, sin, -sin, cos, 0, 0]
        if (a.length >= 3) m = multiply(multiply([1, 0, 0, 1, a[1], a[2]], m), [1, 0, 0, 1, -a[1], -a[2]])
        break
      }
      case 'skewX': m = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break
      case 'skewY': m = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break
      case 'skew': m = [1, Math.tan((a[1] || 0) * Math.PI / 180), Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break
    }
    if (m) matrix = multiply(matrix, m)
  }
  return matrix
}

function transformPoint (matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }
}

module.exports = {
  INHERITED,
  PRESENTATION_ATTRIBUTES,
  colorToCss,
  computeStyle,
  identity,
  matchesSelector,
  multiply,
  ownStyle,
  parseAngle,
  parseColor,
  parseDashArray,
  parseLength,
  parseSelector,
  parseStyleSheet,
  parseTransformList,
  splitDeclarations,
  transformListToMatrix,
  transformPoint
}
