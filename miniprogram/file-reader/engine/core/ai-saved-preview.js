'use strict'
const encodeJpeg = require('./vendor/jpeg-encoder')

function latin (bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return text
}

// A deliberately narrow reader for classic, single-page Illustrator PDF wrappers.
// Follow the xref and PieceInfo ownership chain; never search arbitrary embedded
// data for a thumbnail, decompress private artwork, or execute PostScript.
function thumbnailStream (bytes) {
  if (bytes.length > 25 * 1024 * 1024 || latin(bytes.subarray(0, 8)).indexOf('%PDF-') !== 0) return null
  const tail = latin(bytes.subarray(Math.max(0, bytes.length - 1024)))
  const start = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)
  if (!start) return null
  const offset = Number(start[1])
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || bytes.length - offset > 200000) return null
  const xref = latin(bytes.subarray(offset))
  const section = /^xref\s+0\s+(\d+)\s*\r?\n/.exec(xref)
  if (!section || Number(section[1]) > 4096) return null
  const count = Number(section[1]), refs = new Map()
  let cursor = section[0].length
  for (let i = 0; i < count; i++) {
    const entry = /^(\d{10}) (\d{5}) ([nf])(?:\r\n|\n|\r)/.exec(xref.slice(cursor))
    if (!entry) return null
    if (entry[3] === 'n') {
      const at = Number(entry[1])
      if (entry[2] !== '00000' || at < 8 || at >= offset || [...refs.values()].includes(at)) return null
      refs.set(i, at)
    }
    cursor += entry[0].length
  }
  const trailer = xref.slice(cursor)
  if (!/^trailer\s*<</.test(trailer) || /\/(?:Prev|XRefStm|Encrypt)\b/.test(trailer)) return null
  const reference = (text, key) => {
    const matches = [...text.matchAll(new RegExp('/' + key + '\\s+(\\d+) 0 R\\b', 'g'))]
    if (matches.length !== 1) throw new Error('Ai 预览来源不明确')
    return Number(matches[0][1])
  }
  const ordered = [...refs.values(), offset].sort((a, b) => a - b)
  const object = id => {
    const at = refs.get(id), end = ordered[ordered.indexOf(at) + 1]
    if (at == null || end - at > 1024 * 1024) throw new Error('Ai 预览对象过大或缺失')
    const source = latin(bytes.subarray(at, end))
    if (!source.startsWith(id + ' 0 obj') || !/endobj\s*$/.test(source)) throw new Error('Ai 预览对象不完整')
    return source
  }
  try {
    const root = object(reference(trailer, 'Root'))
    const pages = object(reference(root, 'Pages'))
    const kids = /\/Kids\s*\[\s*(\d+) 0 R\s*\]/.exec(pages)
    if (!/\/Count\s+1\b/.test(pages) || !kids) return null
    const page = object(Number(kids[1]))
    if (!/\/Type\s*\/Page\b/.test(page) || !/\/PieceInfo\s*<<\s*\/Illustrator\s+\d+ 0 R\s*>>/.test(page)) return null
    const owner = object(reference(page, 'Illustrator'))
    const privateData = object(reference(owner, 'Private'))
    const stream = object(reference(privateData, 'AIPrivateData1'))
    const header = /^\d+ 0 obj\s*<<\s*\/Length\s+(\d+)\s*>>\s*stream\r?\n/.exec(stream)
    if (!header) return null // Compressed or indirect-length streams need another decoder.
    const length = Number(header[1]), payload = stream.slice(header[0].length, header[0].length + length)
    if (payload.length !== length || !/^\s*endstream\s*endobj\s*$/.test(stream.slice(header[0].length + length))) return null
    return payload
  } catch (_) { return null }
}

function decodeThumbnail (source) {
  const match = /^%AI7_Thumbnail:[ \t]*(\d+) (\d+) (8|24)\r?\n%%BeginData:[ \t]*(\d+) Hex Bytes\r?\n([\s\S]*?)%%EndData\s*$/.exec(source)
  if (!match) throw new Error('Ai 内嵌缩略图结构不受支持')
  const width = Number(match[1]), height = Number(match[2]), depth = Number(match[3]), count = Number(match[4])
  if (!width || !height || width > 1024 || height > 1024 || count > 2 * 1024 * 1024 || count % 2) throw new Error('Ai 内嵌缩略图超过限制')
  const lines = match[5].trim().split(/\r?\n/)
  if (!lines.every(line => /^%[0-9a-f]+$/i.test(line))) throw new Error('Ai 内嵌缩略图编码无效')
  const hex = lines.map(line => line.slice(1)).join('')
  if (hex.length !== count) throw new Error('Ai 内嵌缩略图长度不完整')
  const data = new Uint8Array(count / 2)
  for (let i = 0; i < data.length; i++) data[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let input = depth === 8 ? 768 : 0, output = 0
  if (data.length < input) throw new Error('Ai 缩略图调色板不完整')
  const pixels = new Uint8Array(width * height * depth / 8)
  const rle = data[input] === 82 && data[input + 1] === 76 && data[input + 2] === 69
  if (rle) input += 3
  while (input < data.length) {
    let value = data[input++], repeat = 1
    if (rle && value === 253) {
      if (input >= data.length) throw new Error('Ai 缩略图压缩数据不完整')
      value = data[input++]
      if (value !== 253) {
        repeat = value
        if (!repeat || input >= data.length) throw new Error('Ai 缩略图压缩数据不完整')
        value = data[input++]
      }
    }
    if (output + repeat > pixels.length) throw new Error('Ai 缩略图解压越界')
    pixels.fill(value, output, output + repeat); output += repeat
  }
  if (output !== pixels.length) throw new Error('Ai 缩略图像素不完整')
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const palette = depth === 8 ? pixels[i] * 3 : i * 3, colors = depth === 8 ? data : pixels
    rgba.set(colors.subarray(palette, palette + 3), i * 4); rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}
function extractAiSavedPreview (input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const source = thumbnailStream(bytes)
  if (!source) return null
  const result = decodeThumbnail(source)
  return { width: result.width, height: result.height, jpeg: encodeJpeg({ data: result.rgba, width: result.width, height: result.height }, 90).data }
}
module.exports = { extractAiSavedPreview, decodeThumbnail }
