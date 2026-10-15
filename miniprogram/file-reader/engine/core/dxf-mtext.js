'use strict'

const { validateDxfString } = require('./dxf-text')
const MAX_SOURCE = 200000
const MAX_RUNS = 8192
const MAX_DEPTH = 64
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Fixed decimal places can turn legal small heights/width factors into zero.
const n = x => Number(x.toPrecision(14))
const defaults = { height: 1, width: 1, tracking: 1, color: '#171715', family: 'Arial', bold: false, italic: false, underline: false, overline: false, strike: false, oblique: 0 }
const colors = ['#171715', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#171715', '#808080', '#c0c0c0']

// Unicode and escaped literal punctuation are emitted once and retain their
// provenance. A produced backslash/brace cannot become another MTEXT command.
function literalSource (input) {
  const chars = [], literal = new Set()
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\\') {
      const next = input[i + 1]
      if (['\\', '{', '}'].includes(next)) { literal.add(chars.length); chars.push(next); i++; continue }
      const code = /^U\+([a-fA-F0-9]{4})/.exec(input.slice(i + 1, i + 7))
      if (code) { literal.add(chars.length); chars.push(String.fromCharCode(parseInt(code[1], 16))); i += 6; continue }
    }
    chars.push(input[i])
  }
  const text = chars.join('')
  validateDxfString(text)
  return { text, literal }
}

function parseMText (input, baseHeight = 1) {
  if (input.length > MAX_SOURCE) throw new Error('DXF 多行文字超过安全长度上限')
  const { text, literal } = literalSource(input)
  const tokens = [], groups = [], warnings = new Set()
  let style = { ...defaults }, buffer = ''
  function push (token) {
    if (tokens.length >= MAX_RUNS) throw new Error('DXF 多行文字格式片段超过安全上限')
    tokens.push({ ...token, style: { ...style } })
  }
  function flush () { if (buffer) { validateDxfString(buffer); push({ type: 'text', text: buffer }); buffer = '' } }
  function update (key, value) { flush(); style = { ...style, [key]: value } }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\n' || char === '\r') { flush(); push({ type: 'break' }); if (char === '\r' && text[i + 1] === '\n') i++; continue }
    if (literal.has(i)) { buffer += char; continue }
    if (char === '{') { flush(); if (groups.length >= MAX_DEPTH) throw new Error('DXF 多行文字格式嵌套过深'); groups.push(style); continue }
    if (char === '}') { if (groups.length) { flush(); style = groups.pop() } else { buffer += char; warnings.add('unbalanced-group') } continue }
    if (char === '%' && text[i + 1] === '%' && !literal.has(i + 1) && /[dDpPcC]/.test(text[i + 2] || '')) {
      buffer += ({ d: '°', p: '±', c: 'Ø' })[text[i + 2].toLowerCase()]; i += 2; continue
    }
    if (char !== '\\') { buffer += char; continue }
    const code = text[i + 1]
    if (code === 'P') { flush(); push({ type: 'break' }); i++; continue }
    if (code === '~') { buffer += '\u00a0'; i++; continue }
    if ('LlOoKk'.includes(code || '\0')) { update(({ L: 'underline', l: 'underline', O: 'overline', o: 'overline', K: 'strike', k: 'strike' })[code], code === code.toUpperCase()); i++; continue }
    if ('CcHWTQAFfpS'.includes(code || '\0')) {
      let end = i + 2
      while (end < text.length) {
        if (!literal.has(end) && (text[end] === ';' || text[end] === '{' || text[end] === '}')) break
        if (text[end] === '\n' || text[end] === '\r') break
        if (text[end] === '\\' && !literal.has(end)) {
          if (code === 'S' && text[end + 1] === ';') { end += 2; continue }
          break
        }
        end++
      }
      if (text[end] !== ';') { warnings.add('unterminated-control'); buffer += char; continue }
      const arg = text.slice(i + 2, end)
      if (code === 'S') {
        let divider = -1
        for (let j = i + 2; j < end; j++) if ('/#^'.includes(text[j]) && !literal.has(j) && text[j - 1] !== '\\') { divider = j; break }
        if (divider < 0 || text[divider] === '^' && text[divider + 1] !== ' ') {
          warnings.add('unsupported-stack'); buffer += text.slice(i, end + 1); i = end; continue
        }
        const upper = text.slice(i + 2, divider).replace(/\\;/g, ';')
        const lower = text.slice(divider + (text[divider] === '^' ? 2 : 1), end).replace(/\\;/g, ';')
        flush(); push({ type: 'stack', upper, lower, divider: text[divider] }); i = end; continue
      }
      if (code === 'f' || code === 'F') {
        const parts = arg.split('|'), family = parts[0]
        if (!family || /[{}\\;]/.test(family)) { warnings.add('unsupported-font'); buffer += text.slice(i, end + 1); i = end; continue }
        flush(); style = { ...style, family, bold: parts.includes('b1'), italic: parts.includes('i1') }; i = end; continue
      }
      if (code === 'p' || code === 'A') { warnings.add('paragraph-alignment'); buffer += text.slice(i, end + 1); i = end; continue }
      const numeric = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(x?)$/.exec(arg)
      const value = numeric && Number(numeric[1])
      if (!numeric || !Number.isFinite(value) || numeric[2] && code !== 'H') { warnings.add('invalid-control'); buffer += text.slice(i, end + 1); i = end; continue }
      if (code === 'C' && Number.isInteger(value) && value >= 0 && value <= 9) update('color', colors[value])
      else if (code === 'c' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) update('color', '#' + ((value & 255) * 65536 + (value & 0xff00) + (value >>> 16)).toString(16).padStart(6, '0'))
      else if (code === 'H' && value > 0) update('height', numeric[2] ? style.height * value : value / baseHeight)
      else if ((code === 'W' || code === 'T') && value > 0) update(code === 'W' ? 'width' : 'tracking', value)
      else if (code === 'Q' && Math.abs(value) < 85) update('oblique', value)
      else { warnings.add('unsupported-control'); buffer += text.slice(i, end + 1); i = end; continue }
      if (style.height <= 0 || style.width <= 0 || style.tracking <= 0) throw new Error('DXF 多行文字格式数值超过安全范围')
      if (Object.values(style).some(value => typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1000000))) throw new Error('DXF 多行文字格式数值超过安全范围')
      i = end; continue
    }
    warnings.add('unknown-control'); buffer += char
  }
  flush()
  if (groups.length) warnings.add('unbalanced-group')
  return { tokens, warnings: [...warnings] }
}

// The basic CAD preview uses locally available fonts, not embedded CAD glyphs.
// Advance estimates position styled spans/stacks; conservative bounds below are
// independent and never squeeze or truncate the actual SVG text.
function advance (text, size, style) {
  let units = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    units += char === '\t' ? 4 : code >= 0x2e80 ? 1 : /[ilI.,'!:;| ]/.test(char) ? 0.28 : /[MW@%]/.test(char) ? 0.9 : 0.6
  }
  return units * size * style.width * style.tracking
}
function renderMText (model, size, x, y) {
  const fragments = [], bounds = []
  let cursor = 0, baseline = 0
  const include = (left, top, width, height) => {
    const b = { x: x + left, y: y + top, width, height }
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) throw new Error('DXF 多行文字范围过大')
    bounds.push(b)
  }
  function draw (text, left, base, fontSize, style, role = '') {
    validateDxfString(text)
    const widthUnits = Array.from(text).reduce((sum, char) => sum + (char === '\t' ? 8 : 1.5), 0)
    const width = Math.max(1, widthUnits) * fontSize * style.width * Math.max(1, style.tracking)
    const shear = Math.abs(Math.tan(style.oblique * Math.PI / 180)) * fontSize * 1.5
    include(left - fontSize * 0.5 - shear, base - fontSize * 1.5, width + fontSize + 2 * shear, fontSize * 2)
    const decoration = [style.underline && 'underline', style.overline && 'overline', style.strike && 'line-through'].filter(Boolean).join(' ')
    const transform = `translate(${n(x + left)} ${n(y + base)}) skewX(${n(-style.oblique)}) scale(${n(style.width)} 1)`
    fragments.push(`<text transform="${transform}" x="0" y="0" font-family="${xml(style.family)}, Arial, sans-serif" font-size="${n(fontSize)}" fill="${style.color}" stroke="none" xml:space="preserve" style="white-space:pre"${style.bold ? ' font-weight="bold"' : ''}${style.italic ? ' font-style="italic"' : ''}${decoration ? ` text-decoration="${decoration}"` : ''}${style.tracking !== 1 ? ` letter-spacing="${n((style.tracking - 1) * fontSize * 0.6)}"` : ''}${role ? ` data-dxf-stack="${role}"` : ''}>${xml(text)}</text>`)
  }
  const lines = [[]]
  for (const token of model.tokens) {
    if (token.type === 'break') lines.push([])
    else lines[lines.length - 1].push(token)
  }
  const heights = lines.map(line => Math.max(size, ...line.map(token => size * token.style.height)))
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    if (row) baseline += heights[row - 1] * 0.5 + heights[row] * 1.2
    cursor = 0
    if (line.length && line.every(token => token.type === 'text' && token.style.width === 1 && token.style.oblique === 0)) {
      const start = fragments.length
      for (const token of line) {
        draw(token.text, cursor, baseline, size * token.style.height, token.style)
        cursor += advance(token.text, size * token.style.height, token.style)
      }
      const isolated = fragments.splice(start)
      if (isolated.length === 1) fragments.push(isolated[0])
      else {
        const spans = isolated.map(svg => svg.replace(/^<text transform="[^"]*" x="0" y="0"/, '<tspan').replace(/<\/text>$/, '</tspan>')).join('')
        fragments.push(`<text x="${n(x)}" y="${n(y + baseline)}" xml:space="preserve" style="white-space:pre">${spans}</text>`)
      }
      continue
    }
    for (const token of line) {
      const style = token.style, fontSize = size * style.height
      if (token.type === 'stack') {
        const small = fontSize * 0.7, upperWidth = advance(token.upper, small, style), lowerWidth = advance(token.lower, small, style)
        const diagonal = token.divider === '#'
        const width = diagonal ? upperWidth + lowerWidth + fontSize * 0.6 : Math.max(upperWidth, lowerWidth) + fontSize * 0.25
        const upperX = diagonal ? cursor : cursor + (width - upperWidth) / 2
        const lowerX = diagonal ? cursor + upperWidth + fontSize * 0.35 : cursor + (width - lowerWidth) / 2
        draw(token.upper, upperX, baseline - fontSize * 0.55, small, style, 'numerator')
        draw(token.lower, lowerX, baseline + fontSize * 0.35, small, style, 'denominator')
        if (token.divider !== '^') {
          fragments.push(`<path data-dxf-stack="divider" d="M ${n(x + cursor + (diagonal ? upperWidth * 0.65 : 0))} ${n(y + baseline + (diagonal ? fontSize * 0.4 : -fontSize * 0.25))} L ${n(x + cursor + (diagonal ? upperWidth + fontSize * 0.32 : width))} ${n(y + baseline + (diagonal ? -fontSize * 0.8 : -fontSize * 0.25))}" fill="none" stroke="${style.color}" stroke-width="${n(fontSize * 0.05)}"/>`)
        }
        include(cursor, baseline - fontSize * 1.5, width, fontSize * 2)
        cursor += width + fontSize * 0.15
      } else { draw(token.text, cursor, baseline, fontSize, style); cursor += advance(token.text, fontSize, style) }
    }
  }
  return { svg: fragments.join(''), bounds }
}

module.exports = { parseMText, renderMText }
