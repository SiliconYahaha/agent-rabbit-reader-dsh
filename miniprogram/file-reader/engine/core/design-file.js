'use strict'

const { skipPostScriptArray, skipPostScriptString } = require('./legacy-ai-lexical')

const { extensionOf, formatBytes } = require('../../shared/file-names')
const { inflateZlibBounded } = require('./bounded-zlib')
const encodeJpeg = require('./vendor/jpeg-encoder')
const { scanLegacyDsc } = require('./legacy-ai-dsc')
const { parseRgbIccProfile } = require('./icc-rgb')

const PSD_SIGNATURE = '8BPS'
const PSD_COLOR_MODES = {
  0: '位图',
  1: '灰度',
  2: '索引色',
  3: 'RGB',
  4: 'CMYK',
  7: '多通道',
  8: '双色调',
  9: 'Lab'
}

function bytes (input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  const type = Object.prototype.toString.call(input)
  if (type === '[object ArrayBuffer]') return new Uint8Array(input)
  if (/^\[object (?:Uint8Array|Uint8ClampedArray|DataView)\]$/.test(type)) {
    return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength)
  }
  throw new TypeError('需要 ArrayBuffer 或 Uint8Array')
}

function dataView (input) {
  const value = bytes(input)
  return new DataView(value.buffer, value.byteOffset, value.byteLength)
}

function ascii (input, offset, length) {
  const value = bytes(input)
  let output = ''
  for (let index = offset; index < offset + length && index < value.length; index++) output += String.fromCharCode(value[index])
  return output
}

function isPdfCompatibleAi (input) {
  const value = bytes(input)
  const limit = Math.min(value.length, 4096)
  const source = ascii(value, 0, limit)
  // Native PDF readers tolerate a short leading prefix (including a BOM).
  // A preceding PostScript document header, however, owns its comment/data
  // contents: an incidental PDF marker there is not an embedded PDF document.
  const pdf = source.search(/%PDF-\d\.\d(?:[\0\t\n\f\r ]|$)/)
  const postscript = source.search(/^%!PS-Adobe-/m)
  return pdf >= 0 && (postscript < 0 || pdf < postscript)
}

function legacyAiText (input, maxBytes) {
  const value = bytes(input)
  if (value.length > maxBytes) throw new Error(`旧式 Ai 文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 本机解析上限`)
  let output = ''
  const chunkSize = 16 * 1024
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const end = Math.min(value.length, offset + chunkSize)
    output += ascii(value, offset, end - offset)
  }
  return output
}

function extractLegacyAiRasterPreview (input, options = {}) {
  const maxBytes = Number(options.maxBytes || 20 * 1024 * 1024)
  const maxPixels = Number(options.maxPixels || 4_000_000)
  const source = legacyAiText(input, maxBytes)
  if (!/^%!PS-Adobe-/m.test(source.slice(0, 1024))) throw new Error('不是可识别的旧式 PostScript Illustrator 文件')
  // EPS permits CR, LF, CRLF and LFCR. Scan once without building an
  // unbounded array of lines; DSC keywords occupy a complete physical line.
  const dsc = scanLegacyDsc(source)
  if (dsc.previewOffset == null) throw new Error('文件没有 DSC/EPSI 位图预览段')
  let position = dsc.previewOffset
  const nextLine = () => {
    if (position >= source.length) return null
    const start = position
    while (position < source.length && source[position] !== '\r' && source[position] !== '\n') position++
    const line = source.slice(start, position)
    if (position < source.length) {
      const first = source[position++]
      if ((first === '\r' && source[position] === '\n') || (first === '\n' && source[position] === '\r')) position++
    }
    return line
  }
  let begin = null
  let line
  while ((line = nextLine()) !== null) {
    if (!line.startsWith('%%BeginPreview:')) continue
    begin = /^%%BeginPreview:[ \t]*(\d+)[ \t]+(\d+)[ \t]+(\d+)[ \t]+(\d+)[ \t]*$/.exec(line)
    if (!begin) throw new Error('Ai 位图预览头无效')
    break
  }
  if (!begin) throw new Error('文件没有 DSC/EPSI 位图预览段')
  const width = Number(begin[1]); const height = Number(begin[2]); const depth = Number(begin[3]); const declaredLines = Number(begin[4])
  const pixels = width * height
  if (!width || !height || !Number.isSafeInteger(pixels) || pixels > maxPixels) throw new Error('Ai 位图预览尺寸超出本机保护范围')
  if (![1, 2, 4, 8].includes(depth)) throw new Error(`Ai 位图预览位深 ${depth} 暂不支持`)
  if (!Number.isSafeInteger(declaredLines) || declaredLines < 1) throw new Error('Ai 位图预览行数无效')
  const rowBytes = Math.ceil(width * depth / 8)
  const expectedBytes = rowBytes * height
  const packed = new Uint8Array(expectedBytes)
  let actualLines = 0
  let digits = 0
  let ended = false
  let extraData = false
  while ((line = nextLine()) !== null) {
    if (/^%%EndPreview[ \t]*$/.test(line)) { ended = true; break }
    actualLines++
    for (let index = 0; index < line.length; index++) {
      const code = line.charCodeAt(index)
      const nibble = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1
      if (nibble < 0) continue
      if (digits >= expectedBytes * 2) { extraData = true; continue }
      const byte = digits >> 1
      packed[byte] = (digits & 1) ? packed[byte] | nibble : nibble << 4
      digits++
    }
  }
  if (!ended) throw new Error('Ai 位图预览缺少结束标记')
  if (actualLines < declaredLines) throw new Error(`Ai 位图预览行数不完整：声明 ${declaredLines}，实际 ${actualLines}`)
  if (actualLines !== declaredLines) throw new Error(`Ai 位图预览行数不符：声明 ${declaredLines}，实际 ${actualLines}`)
  if (digits < expectedBytes * 2) throw new Error(`Ai 位图预览数据不完整：预期 ${expectedBytes} B`)
  if (extraData) throw new Error('Ai 位图预览数据超过声明尺寸')
  const rgba = new Uint8Array(pixels * 4)
  const maximum = (1 << depth) - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bitOffset = x * depth
      const byte = packed[y * rowBytes + Math.floor(bitOffset / 8)]
      const shift = 8 - depth - (bitOffset % 8)
      const sample = (byte >>> shift) & maximum
      // EPSI 预览以 0 表示白、最大值表示黑，与显示像素亮度方向相反。
      const intensity = Math.round(255 * (1 - sample / maximum))
      const offset = (y * width + x) * 4
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = intensity
      rgba[offset + 3] = 255
    }
  }
  const encoded = encodeJpeg({ data: rgba, width, height }, 88)
  return { width, height, depth, declaredLines, jpeg: bytes(encoded.data), source: 'DSC/EPSI %%BeginPreview' }
}

function legacyAiTokens (source, maxTokens) {
  const tokens = []
  const delimiters = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])
  let index = 0
  let procedureDepth = 0
  let arrayDepth = 0
  let dictionaryDepth = 0
  while (index < source.length && tokens.length < maxTokens) {
    const character = source[index]
    if (/\s/.test(character)) { index++; continue }
    if (character === '%') {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++
      continue
    }
    if (character === '(') { index = skipPostScriptString(source, index); continue }
    if (character === '{') { procedureDepth++; index++; continue }
    if (character === '}') { procedureDepth = Math.max(0, procedureDepth - 1); index++; continue }
    if (character === '[') {
      if (procedureDepth || dictionaryDepth || arrayDepth) { arrayDepth++; index++; continue }
      const end = skipPostScriptArray(source, index) - 1
      const content = source.slice(index + 1, end).trim()
      if (content && /^[+\-\d.eE\s]+$/.test(content)) tokens.push(`@array:${content.replace(/\s+/g, ',')}`)
      index = end + 1
      continue
    }
    if (character === ']') { arrayDepth = Math.max(0, arrayDepth - 1); index++; continue }
    if (character === '<' && source[index + 1] === '<') { dictionaryDepth++; index += 2; continue }
    if (character === '>' && source[index + 1] === '>') { dictionaryDepth = Math.max(0, dictionaryDepth - 1); index += 2; continue }
    if (character === '<') { index = skipPostScriptString(source, index); continue }
    if (character === '/') {
      index++
      while (index < source.length && !/\s/.test(source[index]) && !delimiters.has(source[index])) index++
      continue
    }
    const start = index
    while (index < source.length && !/\s/.test(source[index]) && !delimiters.has(source[index])) index++
    if (index === start) { index++; continue }
    if (!procedureDepth && !arrayDepth && !dictionaryDepth) tokens.push(source.slice(start, index))
  }
  return { tokens, truncated: index < source.length }
}

function svgNumber (value) {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function clamp01 (value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

function rgbColor (red, green, blue) {
  return `rgb(${Math.round(clamp01(red) * 255)},${Math.round(clamp01(green) * 255)},${Math.round(clamp01(blue) * 255)})`
}

function grayColor (gray) {
  return rgbColor(gray, gray, gray)
}

function cmykColor (cyan, magenta, yellow, black) {
  const c = clamp01(cyan); const m = clamp01(magenta); const y = clamp01(yellow); const k = clamp01(black)
  return rgbColor(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k))
}

function multiplyMatrix (left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ]
}

function transformedPoint (matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

function extractLegacyAiPreview (input, options = {}) {
  const maxBytes = Number(options.maxBytes || 20 * 1024 * 1024)
  const maxTokens = Number(options.maxTokens || 250_000)
  const maxPaths = Number(options.maxPaths || 12_000)
  const source = legacyAiText(input, maxBytes)
  if (!/^%!PS-Adobe-/m.test(source.slice(0, 1024))) throw new Error('不是可识别的旧式 PostScript Illustrator 文件')
  if (isPdfCompatibleAi(input)) throw new Error('文件已包含 PDF 兼容数据，应使用 PDF 预览')

  const dsc = scanLegacyDsc(source)
  const declaredBoundingBox = dsc.boundingBox
  const tokenResult = legacyAiTokens(dsc.code, maxTokens)
  const operands = []
  const shapes = []
  const graphicsStack = []
  let arrayOperand = null
  let path = []
  let currentPoint = null
  let commandCount = 0
  let unsupportedCount = 0
  let pointCount = 0
  let bounds = [Infinity, Infinity, -Infinity, -Infinity]
  let state = {
    fill: '#000000',
    stroke: '#000000',
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    matrix: [1, 0, 0, 1, 0, 0]
  }

  const updateBounds = point => {
    bounds[0] = Math.min(bounds[0], point[0]); bounds[1] = Math.min(bounds[1], point[1])
    bounds[2] = Math.max(bounds[2], point[0]); bounds[3] = Math.max(bounds[3], point[1])
    pointCount++
  }
  const take = count => {
    if (operands.length < count) return null
    const values = operands.splice(operands.length - count, count)
    operands.length = 0
    return values
  }
  const addPointCommand = (operator, values) => {
    const point = transformedPoint(state.matrix, values[values.length - 2], values[values.length - 1])
    updateBounds(point)
    if (operator === 'M' || operator === 'L') path.push(`${operator}${svgNumber(point[0])} ${svgNumber(point[1])}`)
    return point
  }
  const paint = (fill, stroke, evenOdd, close) => {
    if (close && path.length) path.push('Z')
    if (!path.length || shapes.length >= maxPaths) { path = []; currentPoint = null; return }
    const attributes = [
      `d="${path.join(' ')}"`,
      `fill="${fill ? state.fill : 'none'}"`,
      `stroke="${stroke ? state.stroke : 'none'}"`
    ]
    if (stroke) {
      attributes.push(`stroke-width="${svgNumber(Math.max(0.01, state.lineWidth))}"`)
      attributes.push(`stroke-linecap="${['butt', 'round', 'square'][state.lineCap] || 'butt'}"`)
      attributes.push(`stroke-linejoin="${['miter', 'round', 'bevel'][state.lineJoin] || 'miter'}"`)
    }
    if (fill && evenOdd) attributes.push('fill-rule="evenodd"')
    shapes.push(`<path ${attributes.join(' ')}/>`)
    path = []
    currentPoint = null
  }

  const aliases = {
    moveto: 'm', lineto: 'l', curveto: 'c', closepath: 'h', newpath: 'n',
    fill: 'f', eofill: 'f*', stroke: 'S', setgray: 'g', setrgbcolor: 'r',
    setcmykcolor: 'k', setlinewidth: 'w', gsave: 'q', grestore: 'Q'
  }
  for (const rawToken of tokenResult.tokens) {
    if (rawToken.startsWith('@array:')) {
      const values = rawToken.slice(7).split(',').filter(Boolean).map(Number)
      arrayOperand = values.every(Number.isFinite) ? values : null
      operands.length = 0
      continue
    }
    const number = Number(rawToken)
    if (rawToken !== '' && Number.isFinite(number)) {
      operands.push(number)
      if (operands.length > 32) operands.splice(0, operands.length - 32)
      continue
    }
    const token = aliases[rawToken] || rawToken
    if (token !== 'concat') arrayOperand = null
    commandCount++
    let values
    if (token === 'm' || token === 'M') {
      values = take(2); if (!values) continue
      currentPoint = addPointCommand('M', values)
    } else if (token === 'l' || token === 'L') {
      values = take(2); if (!values) continue
      currentPoint = addPointCommand('L', values)
    } else if (token === 'c' || token === 'C') {
      values = take(6); if (!values) continue
      const first = transformedPoint(state.matrix, values[0], values[1])
      const second = transformedPoint(state.matrix, values[2], values[3])
      const end = transformedPoint(state.matrix, values[4], values[5])
      updateBounds(first); updateBounds(second); updateBounds(end)
      path.push(`C${svgNumber(first[0])} ${svgNumber(first[1])} ${svgNumber(second[0])} ${svgNumber(second[1])} ${svgNumber(end[0])} ${svgNumber(end[1])}`)
      currentPoint = end
    } else if (token === 'v' || token === 'V') {
      values = take(4); if (!values || !currentPoint) continue
      const second = transformedPoint(state.matrix, values[0], values[1])
      const end = transformedPoint(state.matrix, values[2], values[3])
      updateBounds(second); updateBounds(end)
      path.push(`C${svgNumber(currentPoint[0])} ${svgNumber(currentPoint[1])} ${svgNumber(second[0])} ${svgNumber(second[1])} ${svgNumber(end[0])} ${svgNumber(end[1])}`)
      currentPoint = end
    } else if (token === 'y' || token === 'Y') {
      values = take(4); if (!values) continue
      const first = transformedPoint(state.matrix, values[0], values[1])
      const end = transformedPoint(state.matrix, values[2], values[3])
      updateBounds(first); updateBounds(end)
      path.push(`C${svgNumber(first[0])} ${svgNumber(first[1])} ${svgNumber(end[0])} ${svgNumber(end[1])} ${svgNumber(end[0])} ${svgNumber(end[1])}`)
      currentPoint = end
    } else if (token === 're') {
      values = take(4); if (!values) continue
      const [x, y, width, height] = values
      const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(point => transformedPoint(state.matrix, point[0], point[1]))
      points.forEach(updateBounds)
      path.push(`M${svgNumber(points[0][0])} ${svgNumber(points[0][1])}`, ...points.slice(1).map(point => `L${svgNumber(point[0])} ${svgNumber(point[1])}`), 'Z')
      currentPoint = points[0]
    } else if (token === 'h' || token === 'H') {
      operands.length = 0
      if (path.length) path.push('Z')
    } else if (token === 'f' || token === 'F') paint(true, false, false, false)
    else if (token === 'f*') paint(true, false, true, false)
    else if (token === 'S') paint(false, true, false, false)
    else if (token === 's') paint(false, true, false, true)
    else if (token === 'B') paint(true, true, false, false)
    else if (token === 'B*') paint(true, true, true, false)
    else if (token === 'b') paint(true, true, false, true)
    else if (token === 'b*') paint(true, true, true, true)
    else if (token === 'n' || token === 'N') { operands.length = 0; path = []; currentPoint = null }
    else if (token === 'g') { values = take(1); if (values) state.fill = grayColor(values[0]) }
    else if (token === 'G') { values = take(1); if (values) state.stroke = grayColor(values[0]) }
    else if (token === 'r' || token === 'rg') { values = take(3); if (values) state.fill = rgbColor(...values) }
    else if (token === 'R' || token === 'RG') { values = take(3); if (values) state.stroke = rgbColor(...values) }
    else if (token === 'k') { values = take(4); if (values) state.fill = cmykColor(...values) }
    else if (token === 'K') { values = take(4); if (values) state.stroke = cmykColor(...values) }
    else if (token === 'w') { values = take(1); if (values) state.lineWidth = Math.max(0.01, Math.abs(values[0])) }
    else if (token === 'J') { values = take(1); if (values) state.lineCap = Math.max(0, Math.min(2, Math.round(values[0]))) }
    else if (token === 'j') { values = take(1); if (values) state.lineJoin = Math.max(0, Math.min(2, Math.round(values[0]))) }
    else if (token === 'q' || token === 'u') { operands.length = 0; graphicsStack.push({ ...state, matrix: state.matrix.slice() }) }
    else if (token === 'Q' || token === 'U') { operands.length = 0; if (graphicsStack.length) state = graphicsStack.pop() }
    else if (token === 'translate') { values = take(2); if (values) state.matrix = multiplyMatrix(state.matrix, [1, 0, 0, 1, values[0], values[1]]) }
    else if (token === 'scale') { values = take(2); if (values) state.matrix = multiplyMatrix(state.matrix, [values[0], 0, 0, values[1], 0, 0]) }
    else if (token === 'rotate') {
      values = take(1)
      if (values) {
        const angle = values[0] * Math.PI / 180
        state.matrix = multiplyMatrix(state.matrix, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0])
      }
    } else if (token === 'cm') { values = take(6); if (values) state.matrix = multiplyMatrix(state.matrix, values) }
    else if (token === 'concat') {
      operands.length = 0
      if (arrayOperand && arrayOperand.length === 6) state.matrix = multiplyMatrix(state.matrix, arrayOperand)
      else unsupportedCount++
      arrayOperand = null
    }
    else {
      if (!['showpage', '%%EOF', 'def', 'bind', 'readonly', 'save', 'restore'].includes(token)) unsupportedCount++
      operands.length = 0
    }
    if (shapes.length >= maxPaths) break
  }

  if (!shapes.length) throw new Error('没有找到可安全还原的基础矢量路径')
  const contentBounds = bounds.every(Number.isFinite) && bounds[2] > bounds[0] && bounds[3] > bounds[1] ? bounds : null
  const box = declaredBoundingBox || contentBounds
  if (!box) throw new Error('文件缺少有效画布范围')
  const width = box[2] - box[0]
  const height = box[3] - box[1]
  const viewBox = `${svgNumber(box[0])} ${svgNumber(-box[3])} ${svgNumber(width)} ${svgNumber(height)}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><g transform="scale(1,-1)">${shapes.join('')}</g></svg>`
  return {
    svg,
    width,
    height,
    paths: shapes.length,
    points: pointCount,
    commands: commandCount,
    unsupportedCount,
    truncated: tokenResult.truncated || shapes.length >= maxPaths,
    boundingBoxSource: declaredBoundingBox ? '文件声明' : '路径计算'
  }
}

function parsePsdHeader (input) {
  const value = bytes(input)
  if (value.length < 30) throw new Error('PSD 文件头不完整')
  const view = dataView(value)
  const signature = ascii(value, 0, 4)
  if (signature !== PSD_SIGNATURE) throw new Error('不是有效的 PSD/PSB 文件')
  const version = view.getUint16(4, false)
  if (version !== 1 && version !== 2) throw new Error(`不支持的 Photoshop 文件版本：${version}`)
  const channels = view.getUint16(12, false)
  const height = view.getUint32(14, false)
  const width = view.getUint32(18, false)
  const depth = view.getUint16(22, false)
  const colorMode = view.getUint16(24, false)
  const colorDataLength = view.getUint32(26, false)
  return {
    signature,
    version,
    kind: version === 2 ? 'PSB' : 'PSD',
    channels,
    height,
    width,
    depth,
    colorMode,
    colorModeName: PSD_COLOR_MODES[colorMode] || `模式 ${colorMode}`,
    colorDataLength,
    resourceLengthOffset: 30 + colorDataLength
  }
}

function extractPsdThumbnail (input) {
  const value = bytes(input)
  const view = dataView(value)
  let legacy = null
  let offset = 0
  while (offset + 12 <= value.length) {
    if (ascii(value, offset, 4) !== '8BIM') break
    const resourceId = view.getUint16(offset + 4, false)
    const nameLength = value[offset + 6]
    let nameBlockLength = 1 + nameLength
    if (nameBlockLength % 2) nameBlockLength++
    const sizeOffset = offset + 6 + nameBlockLength
    if (sizeOffset + 4 > value.length) break
    const size = view.getUint32(sizeOffset, false)
    const dataOffset = sizeOffset + 4
    const dataEnd = dataOffset + size
    if (dataEnd > value.length) break

    if ((resourceId === 1033 || resourceId === 1036) && size >= 28) {
      const format = view.getUint32(dataOffset, false)
      const width = view.getUint32(dataOffset + 4, false)
      const height = view.getUint32(dataOffset + 8, false)
      const rowBytes = view.getUint32(dataOffset + 12, false)
      const totalSize = view.getUint32(dataOffset + 16, false)
      const compressedSize = view.getUint32(dataOffset + 20, false)
      const pixelOffset = dataOffset + 28
      const available = dataEnd - pixelOffset
      // Keep the existing composite pixel ceiling for raw fallback allocation.
      // The JPEG encoder uses 16-bit frame dimensions. Validate before creating
      // any RGBA buffer, including when malformed modern data follows V4 data.
      if (width > 0 && height > 0 && width <= 65535 && height <= 65535 && width * height <= 2_000_000) {
        let candidate = null
        const jpegLength = compressedSize || available
        if (format === 1 && jpegLength > 4 && jpegLength <= available && value[pixelOffset] === 0xff && value[pixelOffset + 1] === 0xd8) {
          candidate = { resourceId, width, height, sourceFormat: 'jpeg', pixelOffset, length: jpegLength }
        } else if (format === 0 && view.getUint16(dataOffset + 24, false) === 24 && view.getUint16(dataOffset + 26, false) === 1 &&
          rowBytes === Math.ceil(width * 3 / 4) * 4 && totalSize === rowBytes * height && compressedSize === totalSize && totalSize === available) {
          candidate = { resourceId, width, height, sourceFormat: 'raw', pixelOffset, rowBytes }
        }
        // Photoshop 5's 1036 supersedes Photoshop 4's 1033, independent of
        // resource ordering. Do not allocate/decode an unused legacy preview.
        if (candidate && resourceId === 1036) return decodePsdThumbnail(value, candidate)
        if (candidate && !legacy) legacy = candidate
      }
    }
    offset = dataEnd + (size % 2)
  }
  return legacy ? decodePsdThumbnail(value, legacy) : null
}

function decodePsdThumbnail (value, candidate) {
  const { resourceId, width, height, sourceFormat, pixelOffset } = candidate
  if (sourceFormat === 'jpeg') return { resourceId, width, height, sourceFormat, jpeg: value.slice(pixelOffset, pixelOffset + candidate.length) }
  const rgba = new Uint8Array(width * height * 4)
  const red = resourceId === 1033 ? 2 : 0
  const blue = resourceId === 1033 ? 0 : 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const input = pixelOffset + y * candidate.rowBytes + x * 3
      const output = (y * width + x) * 4
      rgba[output] = value[input + red]
      rgba[output + 1] = value[input + 1]
      rgba[output + 2] = value[input + blue]
      rgba[output + 3] = 255
    }
  }
  return { resourceId, width, height, sourceFormat, rgba }
}

function findPsdImageResource (input, targetId) {
  const value = bytes(input)
  const view = dataView(value)
  let offset = 0
  while (offset + 12 <= value.length) {
    if (ascii(value, offset, 4) !== '8BIM') return null
    const resourceId = view.getUint16(offset + 4, false)
    const nameLength = value[offset + 6]
    let nameBlockLength = 1 + nameLength
    if (nameBlockLength % 2) nameBlockLength++
    const sizeOffset = offset + 6 + nameBlockLength
    if (sizeOffset + 4 > value.length) return null
    const size = view.getUint32(sizeOffset, false)
    const dataOffset = sizeOffset + 4
    const dataEnd = dataOffset + size
    if (dataEnd > value.length) return null
    if (resourceId === targetId) return value.slice(dataOffset, dataEnd)
    offset = dataEnd + (size % 2)
  }
  return null
}

function compositeRgbaOnCheckerboard (input, width, tileSize = 8) {
  const value = bytes(input)
  const output = new Uint8Array(value)
  const safeWidth = Math.max(1, Number(width) || 1)
  const safeTile = Math.max(1, Number(tileSize) || 8)
  for (let offset = 0, pixel = 0; offset + 3 < output.length; offset += 4, pixel++) {
    const alpha = output[offset + 3] / 255
    if (alpha >= 1) continue
    const x = pixel % safeWidth
    const y = Math.floor(pixel / safeWidth)
    const background = ((Math.floor(x / safeTile) + Math.floor(y / safeTile)) % 2) ? 224 : 248
    output[offset] = Math.round(output[offset] * alpha + background * (1 - alpha))
    output[offset + 1] = Math.round(output[offset + 1] * alpha + background * (1 - alpha))
    output[offset + 2] = Math.round(output[offset + 2] * alpha + background * (1 - alpha))
    output[offset + 3] = 255
  }
  return output
}

function readUint64 (view, offset) {
  const high = view.getUint32(offset, false)
  const low = view.getUint32(offset + 4, false)
  const value = high * 0x100000000 + low
  if (!Number.isSafeInteger(value)) throw new Error('PSB 区段长度超过可安全处理范围')
  return value
}

function decodePackBitsRow (value, cursor, width) {
  const row = new Uint8Array(width)
  let output = 0
  while (output < width && cursor < value.length) {
    const marker = value[cursor++]
    if (marker <= 127) {
      const count = marker + 1
      if (cursor + count > value.length || output + count > width) throw new Error('PSD RLE 直接数据越界')
      row.set(value.slice(cursor, cursor + count), output)
      cursor += count
      output += count
    } else if (marker >= 129) {
      const count = 257 - marker
      if (cursor >= value.length || output + count > width) throw new Error('PSD RLE 重复数据越界')
      row.fill(value[cursor++], output, output + count)
      output += count
    }
  }
  if (output !== width) throw new Error('PSD RLE 行长度不完整')
  return row
}

function reversePrediction (data, width, height, channels, depth) {
  const output = new Uint8Array(data)
  const bytesPerSample = depth / 8
  const rowBytes = width * bytesPerSample
  const planeBytes = rowBytes * height
  for (let channel = 0; channel < channels; channel++) {
    const planeOffset = channel * planeBytes
    for (let row = 0; row < height; row++) {
      const rowOffset = planeOffset + row * rowBytes
      if (depth === 8) {
        for (let column = 1; column < width; column++) {
          const index = rowOffset + column
          output[index] = (output[index] + output[index - 1]) & 0xff
        }
      } else if (depth === 16) {
        let previous = (output[rowOffset] << 8) | output[rowOffset + 1]
        for (let column = 1; column < width; column++) {
          const index = rowOffset + column * 2
          const delta = (output[index] << 8) | output[index + 1]
          previous = (previous + delta) & 0xffff
          output[index] = previous >>> 8
          output[index + 1] = previous & 0xff
        }
      } else if (depth === 32) {
        const predicted = output.slice(rowOffset, rowOffset + rowBytes)
        for (let index = 1; index < predicted.length; index++) predicted[index] = (predicted[index] + predicted[index - 1]) & 0xff
        for (let column = 0; column < width; column++) {
          const index = rowOffset + column * 4
          output[index] = predicted[column]
          output[index + 1] = predicted[width + column]
          output[index + 2] = predicted[width * 2 + column]
          output[index + 3] = predicted[width * 3 + column]
        }
      }
    }
  }
  return output
}

function samplePlane8 (plane, depth, pixelCount, linearRgb = false, matteAlpha = null) {
  if (depth === 8 && !matteAlpha) return plane
  const output = new Uint8Array(pixelCount)
  const floatView = depth === 32 ? new DataView(plane.buffer, plane.byteOffset, plane.byteLength) : null
  const alphaView = depth === 32 && matteAlpha ? dataView(matteAlpha) : null
  const sampleAt = (data, index, floats) => depth === 8 ? data[index] / 255
    : depth === 16 ? ((data[index * 2] << 8) | data[index * 2 + 1]) / 65535 : floats.getFloat32(index * 4, false)
  for (let index = 0; index < pixelCount; index++) {
    if (matteAlpha && depth !== 32) {
      // Keep integer samples through white-matte subtraction and scale before
      // division. Normalizing each plate first introduces cancellation error
      // at exact half-integer output boundaries (16-bit color 383, alpha 65280 -> 0.5).
      const color = depth === 8 ? plane[index] : (plane[index * 2] << 8) | plane[index * 2 + 1]
      const alpha = depth === 8 ? matteAlpha[index] : (matteAlpha[index * 2] << 8) | matteAlpha[index * 2 + 1]
      const maximum = depth === 8 ? 255 : 65535
      output[index] = alpha > 0 ? Math.round(Math.max(0, Math.min(255, (color + alpha - maximum) * 255 / alpha))) : 0
      continue
    }
    let sample = sampleAt(plane, index, floatView)
    if (matteAlpha) {
      const alpha = sampleAt(matteAlpha, index, alphaView)
      // RGB merged previews contain a white matte. Undo it at the original
      // precision BEFORE 32-bit linear RGB is converted to sRGB; otherwise
      // partially transparent edges acquire a white halo.
      sample = alpha > 0 ? (sample + alpha - 1) / alpha : 0
    }
    const unit = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0
    // Float grayscale stores encoded tone (Y'), while RGB uses linear light.
    // Applying the RGB transfer to grayscale would brighten saved midtones.
    output[index] = depth === 32 && linearRgb ? linearToSrgb8(unit) : Math.round(unit * 255)
  }
  return output
}

function linearToSrgb8 (value) {
  const linear = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, srgb)) * 255)
}

function labToSrgb (lightness8, a8, b8) {
  // Encoded 0..255 coordinates may be fractional: do not quantize a 16-bit
  // Lab source before the nonlinear conversion and final sRGB rounding.
  const lightness = lightness8 * 100 / 255
  const a = a8 - 128
  const b = b8 - 128
  const fy = (lightness + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const epsilon = 216 / 24389
  const kappa = 24389 / 27
  const inverse = value => {
    const cube = value * value * value
    return cube > epsilon ? cube : (116 * value - 16) / kappa
  }
  const x50 = 0.96422 * inverse(fx)
  const y50 = inverse(fy)
  const z50 = 0.82521 * inverse(fz)
  const x65 = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50
  const y65 = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50
  const z65 = 0.0122982 * x50 - 0.020483 * y50 + 1.3299098 * z50
  return [
    linearToSrgb8(3.2404542 * x65 - 1.5371385 * y65 - 0.4985314 * z65),
    linearToSrgb8(-0.969266 * x65 + 1.8760108 * y65 + 0.041556 * z65),
    linearToSrgb8(0.0556434 * x65 - 0.2040259 * y65 + 1.0572252 * z65)
  ]
}

// Only inspect bounded structural records. Extra channels alone may be saved
// selections or spot inks, and an 8BIM string inside a payload is not a tag.
function psdMergedTransparency (value, header, offset) {
  const view = dataView(value)
  const lengthBytes = header.version === 2 ? 8 : 4
  if (offset + lengthBytes > value.length) throw new Error('PSD 图层区长度缺失')
  const length = lengthBytes === 8 ? readUint64(view, offset) : view.getUint32(offset, false)
  offset += lengthBytes
  const end = offset + length
  if (!Number.isSafeInteger(end) || end > value.length) throw new Error('PSD 图层区长度不完整')
  if (!length) return { end, source: null, firstAlpha: false }
  if (offset + lengthBytes > end) throw new Error('PSD 图层信息长度不完整')
  const infoLength = lengthBytes === 8 ? readUint64(view, offset) : view.getUint32(offset, false)
  offset += lengthBytes
  if (infoLength === 1 || offset + infoLength > end) throw new Error('PSD 图层信息长度不完整')
  let source = infoLength && view.getInt16(offset, false) < 0 ? 'layer-count' : null
  let firstAlpha = !!source
  offset += infoLength
  // GIMP exports may end exactly after layer info, omitting the optional global
  // mask and tag records entirely. A partial length is still malformed.
  if (offset === end) return { end, source, firstAlpha }
  if (offset + 4 > end) throw new Error('PSD 全局图层蒙版长度不完整')
  const maskLength = view.getUint32(offset, false)
  offset += 4 + maskLength
  if (offset > end) throw new Error('PSD 全局图层蒙版长度不完整')
  const mergedKey = { 8: 'Mtrn', 16: 'Mt16', 32: 'Mt32' }[header.depth]
  const layerKey = { 8: 'Layr', 16: 'Lr16', 32: 'Lr32' }[header.depth]
  const longKeys = ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']
  const isTag = pos => pos + 8 <= end && ['8BIM', '8B64'].includes(ascii(value, pos, 4))
  while (offset < end) {
    if (end - offset <= 3 && value.subarray(offset, end).every(byte => byte === 0)) break
    if (!isTag(offset)) throw new Error('PSD 图层标签签名不正确')
    const signature = ascii(value, offset, 4)
    const key = ascii(value, offset + 4, 4)
    const sizeBytes = signature === '8B64' || (header.version === 2 && longKeys.includes(key)) ? 8 : 4
    if (offset + 8 + sizeBytes > end) throw new Error('PSD 图层标签长度不完整')
    const size = sizeBytes === 8 ? readUint64(view, offset + 8) : view.getUint32(offset + 8, false)
    const start = offset + 8 + sizeBytes
    const dataEnd = start + size
    if (!Number.isSafeInteger(dataEnd) || dataEnd > end) throw new Error('PSD 图层标签数据长度不完整')
    if (key === mergedKey) {
      if (size !== 0) throw new Error('PSD 合成透明标签长度应为零')
      if (!source) source = key
    } else if (key === layerKey) {
      if (size < 2) throw new Error('PSD 图层标签计数不完整')
      if (view.getInt16(start, false) < 0) { source = key; firstAlpha = true }
    }
    // Global tagged blocks commonly use four-byte padding; accept the spec's
    // two-byte form only at the exact next record boundary, never by searching.
    const padded4 = dataEnd + (4 - size % 4) % 4
    const padded2 = dataEnd + size % 2
    if (padded4 === end || isTag(padded4)) offset = padded4
    else if (padded2 === end || isTag(padded2)) offset = padded2
    else if (dataEnd === end) offset = end
    else throw new Error('PSD 图层标签填充或后续长度不完整')
  }
  return { end, source, firstAlpha }
}

function extractPsdComposite (input, options = {}) {
  const value = bytes(input)
  const view = dataView(value)
  const header = parsePsdHeader(value)
  const pixelCount = header.width * header.height
  const maxPixels = Number(options.maxPixels || 2_000_000)
  const bitmap = header.colorMode === 0
  if (bitmap && (header.depth !== 1 || header.channels !== 1)) throw new Error('PSD 位图合成需要 1 bit 单通道数据')
  if (!bitmap && ![8, 16, 32].includes(header.depth)) throw new Error(`合成图暂只支持 1-bit 位图或 8/16/32 bit，当前是 ${header.depth} bit`)
  if (!pixelCount || pixelCount > maxPixels) throw new Error(`画布 ${header.width} × ${header.height} 超过本机合成上限`)
  if (![0, 1, 2, 3, 4, 9].includes(header.colorMode)) throw new Error(`暂不支持 ${header.colorModeName} 合成图`)
  if (header.depth === 32 && ![1, 3].includes(header.colorMode)) throw new Error(`32 bit ${header.colorModeName} 合成图暂不支持可靠颜色转换`)
  if (header.colorMode === 2 && (header.depth !== 8 || header.colorDataLength < 768)) throw new Error('索引色 PSD 需要 8 bit 像素索引和 768 字节 RGB 调色板')

  let offset = header.resourceLengthOffset
  if (offset + 4 > value.length) throw new Error('PSD 图像资源长度缺失')
  const resourceLength = view.getUint32(offset, false)
  const resourceStart = offset + 4
  const resourceEnd = resourceStart + resourceLength
  if (resourceEnd > value.length) throw new Error('PSD 图像资源数据不完整')
  const iccBytes = findPsdImageResource(value.subarray(resourceStart, resourceEnd), 1039)
  const icc = iccBytes ? (header.colorMode === 3 && header.depth !== 32 ? parseRgbIccProfile(iccBytes) : { status: 'unsupported' }) : null
  const managedRgb = icc && icc.status === 'applied'
  const transparencyResource = header.colorMode === 2
    ? findPsdImageResource(value.slice(resourceStart, resourceEnd), 1047)
    : null
  if (transparencyResource && transparencyResource.length < 2) throw new Error('PSD 索引色透明索引资源不完整')
  const transparentIndex = transparencyResource
    ? dataView(transparencyResource).getUint16(0, false)
    : null
  if (transparentIndex != null && transparentIndex > 255) throw new Error(`PSD 索引色透明索引越界：${transparentIndex}`)
  const transparency = psdMergedTransparency(value, header, resourceEnd)
  offset = transparency.end
  if (offset + 2 > value.length) throw new Error('PSD 合成图数据缺失')
  const compression = view.getUint16(offset, false)
  offset += 2

  const channelData = []
  const requiredChannels = bitmap || header.colorMode === 1 || header.colorMode === 2 ? 1 : header.colorMode === 4 ? 4 : 3
  let alphaChannel = -1
  if (transparency.source) {
    if (header.channels <= requiredChannels) throw new Error('PSD 声明合成透明度但缺少透明通道')
    alphaChannel = requiredChannels
    if (!transparency.firstAlpha && header.channels > requiredChannels + 1) {
      const identifiers = findPsdImageResource(value.subarray(resourceStart, resourceEnd), 1053)
      if (!identifiers || identifiers.length % 4) throw new Error('PSD 合成透明通道位置不明确：缺少有效 alpha 标识')
      const ids = dataView(identifiers)
      const count = identifiers.length / 4
      const matches = []
      for (let i = 0; i < count; i++) if (ids.getUint32(i * 4, false) === 0) matches.push(header.channels - count + i)
      if (count > header.channels - requiredChannels || matches.length !== 1 || matches[0] < requiredChannels) throw new Error('PSD 合成透明通道标识不正确')
      alphaChannel = matches[0]
    }
  }
  const needed = channel => channel < requiredChannels || channel === alphaChannel
  const decodePlane = (plane, channel) => { channelData[channel] = plane }
  const bytesPerSample = header.depth / 8
  // Bitmap scan lines restart at a byte boundary; unused low bits never
  // spill into the next row. All compression paths use the packed size.
  const rowBytes = bitmap ? Math.ceil(header.width / 8) : header.width * bytesPerSample
  const channelBytes = rowBytes * header.height
  if (bitmap && compression === 3) throw new Error('1-bit PSD 位图暂不支持 ZIP Prediction 合成图')
  if (header.channels < requiredChannels) throw new Error(`PSD 通道不足：需要 ${requiredChannels}，实际 ${header.channels}`)
  if (compression === 0) {
    if (offset + channelBytes * header.channels > value.length) throw new Error('PSD 原始合成图数据不完整')
    for (let channel = 0; channel < header.channels; channel++) {
      if (needed(channel)) decodePlane(value.subarray(offset + channel * channelBytes, offset + (channel + 1) * channelBytes), channel)
    }
  } else if (compression === 1) {
    const countBytes = header.version === 2 ? 4 : 2
    const rowCount = header.channels * header.height
    const tableBytes = rowCount * countBytes
    if (offset + tableBytes > value.length) throw new Error('PSD RLE 行长度表不完整')
    const lengths = []
    for (let row = 0; row < rowCount; row++) lengths.push(countBytes === 2 ? view.getUint16(offset + row * 2, false) : view.getUint32(offset + row * 4, false))
    let cursor = offset + tableBytes
    for (let channel = 0; channel < header.channels; channel++) {
      const plane = needed(channel) ? new Uint8Array(channelBytes) : null
      for (let row = 0; row < header.height; row++) {
        const length = lengths[channel * header.height + row]
        const end = cursor + length
        if (end > value.length) throw new Error('PSD RLE 数据不完整')
        if (plane) plane.set(decodePackBitsRow(value.slice(cursor, end), 0, rowBytes), row * rowBytes)
        cursor = end
      }
      if (plane) decodePlane(plane, channel)
    }
  } else if (compression === 2 || compression === 3) {
    const expectedBytes = channelBytes * header.channels
    const maxInflatedBytes = options.maxInflatedBytes == null ? 32 * 1024 * 1024 : Number(options.maxInflatedBytes)
    if (expectedBytes > maxInflatedBytes) throw new Error(`PSD ZIP 合成数据预计 ${expectedBytes} 字节，超过本机解压上限`)
    let inflated
    try {
      inflated = inflateZlibBounded(value.subarray(offset), expectedBytes, maxInflatedBytes)
    } catch (error) {
      const reason = error.message || String(error)
      const prefix = /本机.*上限|预设字典/.test(reason) ? 'PSD ZIP 合成图暂不能还原' : 'PSD ZIP 合成数据损坏'
      throw new Error(`${prefix}：${reason}`)
    }
    if (inflated.length !== expectedBytes) throw new Error(`PSD ZIP 合成数据长度不符：预期 ${expectedBytes}，实际 ${inflated.length}`)
    if (compression === 3) inflated = reversePrediction(inflated, header.width, header.height, header.channels, header.depth)
    for (let channel = 0; channel < header.channels; channel++) {
      if (needed(channel)) decodePlane(inflated.subarray(channel * channelBytes, (channel + 1) * channelBytes), channel)
    }
  } else throw new Error(`PSD 合成图压缩方式 ${compression} 暂不支持`)

  const rawAlpha = alphaChannel < 0 ? null : channelData[alphaChannel]
  for (let channel = 0; channel < header.channels; channel++) {
    const preserveColorPrecision = (managedRgb && channel < 3) || (header.colorMode === 4 && channel < 4) || (header.colorMode === 9 && channel < 3)
    if (!bitmap && needed(channel) && !preserveColorPrecision) channelData[channel] = samplePlane8(channelData[channel], header.depth, pixelCount, header.colorMode === 3 && channel < 3,
      header.colorMode === 3 && channel < 3 ? rawAlpha : null)
  }
  // PSD stores inverted CMYK plates. The unprofiled preview multiplies each
  // inverted color plate by inverted K; retain 16-bit samples until final RGB
  // rounding instead of quantizing each plate to eight bits first.
  const colorSample = (plane, index) => header.depth === 16 ? (plane[index * 2] << 8) | plane[index * 2 + 1] : plane[index]
  const cmykScale = header.depth === 16 ? 255 / (65535 * 65535) : 1 / 255
  const labDivisor = header.depth === 16 ? 257 : 1
  const rgba = new Uint8Array(pixelCount * 4)
  let transparentPixels = 0
  for (let index = 0; index < pixelCount; index++) {
    if (bitmap) {
      const x = index % header.width
      const byte = channelData[0][Math.floor(index / header.width) * rowBytes + (x >> 3)]
      const gray = byte & (0x80 >> (x & 7)) ? 0 : 255
      rgba[index * 4] = rgba[index * 4 + 1] = rgba[index * 4 + 2] = gray
    } else if (header.colorMode === 1) rgba[index * 4] = rgba[index * 4 + 1] = rgba[index * 4 + 2] = channelData[0][index]
    else if (header.colorMode === 2) {
      const paletteIndex = channelData[0][index]
      rgba[index * 4] = value[30 + paletteIndex]
      rgba[index * 4 + 1] = value[30 + 256 + paletteIndex]
      rgba[index * 4 + 2] = value[30 + 512 + paletteIndex]
    }
    else if (managedRgb) {
      const maximum = header.depth === 8 ? 255 : 65535
      const alpha = rawAlpha ? colorSample(rawAlpha, index) : maximum
      const rgb = alpha > 0 ? icc.transform(
        (colorSample(channelData[0], index) + alpha - maximum) / alpha,
        (colorSample(channelData[1], index) + alpha - maximum) / alpha,
        (colorSample(channelData[2], index) + alpha - maximum) / alpha
      ) : icc.transform(0, 0, 0)
      rgba[index * 4] = rgb[0]; rgba[index * 4 + 1] = rgb[1]; rgba[index * 4 + 2] = rgb[2]
    }
    else if (header.colorMode === 3) {
      rgba[index * 4] = channelData[0][index]
      rgba[index * 4 + 1] = channelData[1][index]
      rgba[index * 4 + 2] = channelData[2][index]
    } else if (header.colorMode === 4) {
      const black = colorSample(channelData[3], index)
      for (let channel = 0; channel < 3; channel++) rgba[index * 4 + channel] = Math.round(colorSample(channelData[channel], index) * black * cmykScale)
    } else {
      const rgb = labToSrgb(colorSample(channelData[0], index) / labDivisor, colorSample(channelData[1], index) / labDivisor, colorSample(channelData[2], index) / labDivisor)
      rgba[index * 4] = rgb[0]
      rgba[index * 4 + 1] = rgb[1]
      rgba[index * 4 + 2] = rgb[2]
    }
    const alpha = header.colorMode === 2 && channelData[0][index] === transparentIndex ? 0 : alphaChannel < 0 ? 255 : channelData[alphaChannel][index]
    rgba[index * 4 + 3] = alpha
    if (alpha < 255) transparentPixels++
  }
  const compressionNames = ['Raw', 'RLE', 'ZIP', 'ZIP Prediction']
  return { width: header.width, height: header.height, depth: header.depth, rgba, compression: compressionNames[compression] || `方式 ${compression}`, transparentIndex, transparentPixels, transparencySource: transparency.source, alphaChannel, colorProfile: icc ? icc.status : null }
}

module.exports = {
  compositeRgbaOnCheckerboard,
  extensionOf,
  extractLegacyAiPreview,
  extractLegacyAiRasterPreview,
  extractPsdComposite,
  extractPsdThumbnail,
  formatBytes,
  isPdfCompatibleAi,
  parsePsdHeader
}
