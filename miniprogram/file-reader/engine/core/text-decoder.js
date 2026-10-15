'use strict'

const { cp936, gbkAdded, gb18030Ranges } = require('./vendor/gb18030-data')
const { shiftJis, cp949, cp950, big5Added } = require('./vendor/legacy-cjk-data')

const WINDOWS_1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
}

let gbkDecodeMap = null
let shiftJisDecodeMap = null
let cp949DecodeMap = null
let big5DecodeMap = null

function toUint8 (input) {
  if (!input) return new Uint8Array(0)
  if (input instanceof Uint8Array) return input
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input)
  if (input.buffer && Number.isFinite(input.byteLength)) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength)
  throw new TypeError('需要 ArrayBuffer 或 Uint8Array')
}

function fromCodePoint (code) {
  if (code <= 0xffff) return String.fromCharCode(code)
  const value = code - 0x10000
  return String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff))
}

function codePointOf (value) {
  if (!value) return 0xfffd
  const first = value.charCodeAt(0)
  if (first >= 0xd800 && first <= 0xdbff && value.length > 1) return 0x10000 + ((first - 0xd800) << 10) + (value.charCodeAt(1) - 0xdc00)
  return first
}

function buildDbcsDecodeMap (chunks) {
  const map = Object.create(null)
  for (const chunk of chunks) {
    let address = parseInt(chunk[0], 16)
    for (let index = 1; index < chunk.length; index++) {
      const part = chunk[index]
      if (typeof part === 'number') {
        let code = codePointOf(map[address - 1]) + 1
        for (let offset = 0; offset < part; offset++) map[address++] = fromCodePoint(code++)
        continue
      }
      for (let offset = 0; offset < part.length;) {
        const first = part.charCodeAt(offset++)
        if (first >= 0xd800 && first <= 0xdbff && offset < part.length) {
          const trail = part.charCodeAt(offset++)
          map[address++] = fromCodePoint(0x10000 + ((first - 0xd800) << 10) + (trail - 0xdc00))
        } else if (first > 0x0ff0 && first <= 0x0fff) {
          const length = 0x0fff - first + 2
          map[address++] = part.slice(offset, offset + length)
          offset += length
        } else map[address++] = String.fromCharCode(first)
      }
    }
  }
  return map
}

function buildGbkDecodeMap () {
  if (!gbkDecodeMap) gbkDecodeMap = buildDbcsDecodeMap(cp936.concat(gbkAdded))
  return gbkDecodeMap
}

function buildShiftJisDecodeMap () {
  if (!shiftJisDecodeMap) shiftJisDecodeMap = buildDbcsDecodeMap(shiftJis)
  return shiftJisDecodeMap
}

function buildCp949DecodeMap () {
  if (!cp949DecodeMap) cp949DecodeMap = buildDbcsDecodeMap(cp949)
  return cp949DecodeMap
}

function buildBig5DecodeMap () {
  if (!big5DecodeMap) big5DecodeMap = buildDbcsDecodeMap(cp950.concat(big5Added))
  return big5DecodeMap
}

function decodeUtf8 (input) {
  const bytes = toUint8(input)
  let text = ''
  let errors = 0
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first < 0x80) {
      text += String.fromCharCode(first)
      continue
    }
    let code = 0
    let needed = 0
    let minimum = 0
    if (first >= 0xc2 && first <= 0xdf) { code = first & 0x1f; needed = 1; minimum = 0x80 } else if (first >= 0xe0 && first <= 0xef) { code = first & 0x0f; needed = 2; minimum = 0x800 } else if (first >= 0xf0 && first <= 0xf4) { code = first & 0x07; needed = 3; minimum = 0x10000 } else {
      text += '\ufffd'
      errors++
      continue
    }
    if (index + needed > bytes.length) {
      text += '\ufffd'
      errors++
      break
    }
    let valid = true
    for (let offset = 0; offset < needed; offset++) {
      const next = bytes[index + offset]
      if ((next & 0xc0) !== 0x80) { valid = false; break }
      code = (code << 6) | (next & 0x3f)
    }
    if (!valid || code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      text += '\ufffd'
      errors++
      continue
    }
    index += needed
    text += fromCodePoint(code)
  }
  return { text, errors }
}

function decodeUtf16 (input, littleEndian) {
  const bytes = toUint8(input)
  let text = ''
  let errors = 0
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = littleEndian ? bytes[index] | (bytes[index + 1] << 8) : (bytes[index] << 8) | bytes[index + 1]
    text += String.fromCharCode(code)
  }
  if (bytes.length % 2) errors++
  return { text, errors }
}

function decodeSingleByte (input, windows1252 = false) {
  const bytes = toUint8(input)
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(windows1252 && WINDOWS_1252[byte] ? WINDOWS_1252[byte] : byte)
  return { text, errors: 0 }
}

function gb18030PointerToCodePoint (pointer) {
  const pointers = gb18030Ranges.gbChars
  let low = 0
  let high = pointers.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (pointers[middle] <= pointer) low = middle + 1
    else high = middle - 1
  }
  if (high < 0) return null
  return gb18030Ranges.uChars[high] + pointer - pointers[high]
}

function decodeGb18030 (input) {
  const bytes = toUint8(input)
  const map = buildGbkDecodeMap()
  let text = ''
  let errors = 0
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first <= 0x7f) { text += String.fromCharCode(first); continue }
    if (first === 0x80) { text += '\u20ac'; continue }
    const second = bytes[index]
    if (first >= 0x81 && first <= 0xfe && second >= 0x30 && second <= 0x39 && index + 2 < bytes.length) {
      const third = bytes[index + 1]
      const fourth = bytes[index + 2]
      if (third >= 0x81 && third <= 0xfe && fourth >= 0x30 && fourth <= 0x39) {
        const pointer = (((first - 0x81) * 10 + (second - 0x30)) * 126 + (third - 0x81)) * 10 + (fourth - 0x30)
        const code = gb18030PointerToCodePoint(pointer)
        text += code == null || code > 0x10ffff ? '\ufffd' : fromCodePoint(code)
        if (code == null || code > 0x10ffff) errors++
        index += 3
        continue
      }
    }
    if (first >= 0x81 && first <= 0xfe && second != null && ((second >= 0x40 && second <= 0x7e) || (second >= 0x80 && second <= 0xfe))) {
      const value = map[(first << 8) | second]
      text += value || '\ufffd'
      if (!value) errors++
      index++
      continue
    }
    text += '\ufffd'
    errors++
  }
  return { text, errors }
}

function decodeShiftJis (input) {
  const bytes = toUint8(input)
  const map = buildShiftJisDecodeMap()
  let text = ''
  let errors = 0
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first <= 0x80) { text += String.fromCharCode(first); continue }
    if (first >= 0xa1 && first <= 0xdf) {
      const value = map[first]
      text += value || '\ufffd'
      if (!value) errors++
      continue
    }
    const second = bytes[index]
    if (((first >= 0x81 && first <= 0x9f) || (first >= 0xe0 && first <= 0xfc)) && second != null && ((second >= 0x40 && second <= 0x7e) || (second >= 0x80 && second <= 0xfc))) {
      const value = map[(first << 8) | second]
      text += value || '\ufffd'
      if (!value) errors++
      index++
      continue
    }
    text += '\ufffd'
    errors++
  }
  return { text, errors }
}

function decodeCp949 (input) {
  const bytes = toUint8(input)
  const map = buildCp949DecodeMap()
  let text = ''
  let errors = 0
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first <= 0x7f) { text += String.fromCharCode(first); continue }
    const second = bytes[index]
    const validTrail = second != null && ((second >= 0x41 && second <= 0x5a) || (second >= 0x61 && second <= 0x7a) || (second >= 0x81 && second <= 0xfe))
    if (first >= 0x81 && first <= 0xfe && validTrail) {
      const value = map[(first << 8) | second]
      if (value) {
        text += value
        index++
      } else {
        // Match the CP949 state machine: reject only the lead byte, then
        // reprocess the following byte from the root state. This preserves an
        // ASCII trail and reports both bytes when an unmapped pair contains a
        // second lead byte.
        text += '\ufffd'
        errors++
      }
      continue
    }
    text += '\ufffd'
    errors++
  }
  return { text, errors }
}

function decodeBig5 (input) {
  const bytes = toUint8(input)
  const map = buildBig5DecodeMap()
  let text = ''
  let errors = 0
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first <= 0x7f) { text += String.fromCharCode(first); continue }
    const second = bytes[index]
    if (first >= 0x81 && first <= 0xfe && second != null && ((second >= 0x40 && second <= 0x7e) || (second >= 0xa1 && second <= 0xfe))) {
      const value = map[(first << 8) | second]
      text += value || '\ufffd'
      if (!value) errors++
      index++
      continue
    }
    text += '\ufffd'
    errors++
  }
  return { text, errors }
}

function normalizeEncoding (value) {
  const encoding = String(value || '').trim().toLowerCase().replace(/["']/g, '').replace(/_/g, '-')
  if (!encoding) return ''
  if (['utf8', 'utf-8'].includes(encoding)) return 'utf-8'
  if (['utf16', 'utf-16', 'utf16le', 'utf-16le', 'ucs2', 'ucs-2'].includes(encoding)) return 'utf-16le'
  if (['utf16be', 'utf-16be'].includes(encoding)) return 'utf-16be'
  if (['gbk', 'cp936', 'ms936', 'windows-936', 'gb2312', 'gb18030'].includes(encoding)) return 'gb18030'
  if (['shift-jis', 'shiftjis', 'sjis', 'cp932', 'ms932', 'windows-31j', 'windows-932'].includes(encoding)) return 'shift_jis'
  if (['cp949', 'ms949', 'windows-949', 'uhc', 'euc-kr', 'euckr', 'ks-c-5601', 'ksc5601'].includes(encoding)) return 'cp949'
  if (['big5', 'big5-hkscs', 'big5hkscs', 'cp950', 'windows-950'].includes(encoding)) return 'big5'
  if (['windows-1252', 'cp1252', 'ansi'].includes(encoding)) return 'windows-1252'
  if (['latin1', 'iso-8859-1'].includes(encoding)) return 'latin1'
  return encoding
}

function asciiHead (bytes, length = 8192) {
  return decodeSingleByte(toUint8(bytes).slice(0, length)).text
}

function declaredEncoding (input, options = {}) {
  const bytes = toUint8(input)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', offset: 3, source: 'bom' }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', offset: 2, source: 'bom' }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', offset: 2, source: 'bom' }
  const explicit = normalizeEncoding(options.encoding)
  if (explicit) return { encoding: explicit, offset: 0, source: 'explicit' }
  const head = asciiHead(bytes)
  if (options.kind === 'xhtml') {
    const declaration = head.match(/^<\?xml[\t\n\r ][^?]*\bencoding\s*=\s*(["'])([^"']+)\1/)
    if (declaration) return { encoding: normalizeEncoding(declaration[2]), offset: 0, source: 'xml-declaration' }
  }
  if (options.kind === 'html') {
    const meta = head.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i) || head.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i)
    if (meta) return { encoding: normalizeEncoding(meta[1]), offset: 0, source: 'html-meta' }
  }
  if (options.kind === 'rtf') {
    const codepage = head.match(/\\ansicpg(\d+)/i)
    if (codepage) return { encoding: normalizeEncoding(`cp${codepage[1]}`), offset: 0, source: 'rtf-codepage' }
  }
  const sample = bytes.slice(0, Math.min(bytes.length, 2048))
  let evenNulls = 0
  let oddNulls = 0
  for (let index = 0; index < sample.length; index++) if (sample[index] === 0) index % 2 ? oddNulls++ : evenNulls++
  if (oddNulls > sample.length / 8 && evenNulls < oddNulls / 4) return { encoding: 'utf-16le', offset: 0, source: 'heuristic' }
  if (evenNulls > sample.length / 8 && oddNulls < evenNulls / 4) return { encoding: 'utf-16be', offset: 0, source: 'heuristic' }
  return null
}

function decodeWithEncoding (input, encoding) {
  const normalized = normalizeEncoding(encoding)
  if (normalized === 'utf-8') return decodeUtf8(input)
  if (normalized === 'utf-16le') return decodeUtf16(input, true)
  if (normalized === 'utf-16be') return decodeUtf16(input, false)
  if (normalized === 'gb18030') return decodeGb18030(input)
  if (normalized === 'shift_jis') return decodeShiftJis(input)
  if (normalized === 'cp949') return decodeCp949(input)
  if (normalized === 'big5') return decodeBig5(input)
  if (normalized === 'windows-1252') return decodeSingleByte(input, true)
  if (normalized === 'latin1') return decodeSingleByte(input, false)
  return decodeUtf8(input)
}

function decodeText (input, options = {}) {
  if (typeof input === 'string') return { text: input, encoding: 'unicode-string', source: 'runtime', errors: 0 }
  const bytes = toUint8(input)
  if (options.kind === 'xhtml') {
    const detected = declaredEncoding(bytes, options) || { encoding: 'utf-8', offset: 0, source: 'xml-default' }
    if (!['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'shift_jis', 'big5', 'windows-1252', 'latin1'].includes(detected.encoding)) throw new Error('XHTML 暂不支持声明的字符编码')
    const decoded = decodeWithEncoding(bytes.slice(detected.offset), detected.encoding)
    if (decoded.errors) throw new Error('XHTML 字节与字符编码不匹配或文件不完整')
    const declaration = decoded.text.match(/^<\?xml[\t\n\r ][^?]*\bencoding\s*=\s*(["'])([^"']+)\1/)
    if (declaration && normalizeEncoding(declaration[2]) !== detected.encoding && !(declaration[2].toLowerCase() === 'utf-16' && detected.encoding.startsWith('utf-16'))) throw new Error('XHTML 字节标记与编码声明冲突')
    return { ...decoded, encoding: detected.encoding, source: detected.source }
  }
  if (options.encoding) {
    const encoding = normalizeEncoding(options.encoding)
    const decoded = decodeWithEncoding(bytes, encoding)
    return { ...decoded, encoding, source: 'explicit' }
  }
  const declared = declaredEncoding(bytes, options)
  if (declared) {
    const decoded = decodeWithEncoding(bytes.slice(declared.offset), declared.encoding)
    return { ...decoded, encoding: declared.encoding, source: declared.source }
  }
  const utf8 = decodeUtf8(bytes)
  if (!utf8.errors) return { ...utf8, encoding: 'utf-8', source: 'valid-utf8' }
  const gb18030 = decodeGb18030(bytes)
  if (gb18030.errors < utf8.errors) return { ...gb18030, encoding: 'gb18030', source: 'fallback' }
  return { ...utf8, encoding: 'utf-8', source: 'fallback' }
}

module.exports = {
  decodeBig5,
  decodeCp949,
  decodeGb18030,
  decodeShiftJis,
  decodeSingleByte,
  decodeText,
  decodeUtf8,
  declaredEncoding,
  normalizeEncoding,
  toUint8
}
