'use strict'

const { decodeText, normalizeEncoding, toUint8 } = require('./text-decoder')
const { singleByteHigh } = require('./vendor/legacy-cjk-data')
const { createNotes, documentText, documentHtml } = require('./rtf-notes')
const { decodeSymbol } = require('./rtf-symbol')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_DEPTH = 1024
const RUN_BYTES = 8192
const DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'filetbl', 'datastore', 'themedata', 'fldinst', 'datafield', 'xmlnstbl', 'listtable', 'listoverridetable', 'generator', 'nonesttables'])
const WORD_TEXT = { par: '\n', line: '\n', tab: '\t', cell: '\t', nestcell: '\t', row: '\n', nestrow: '\n', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”' }
// RTF1.9.1 pp143-144: these are body characters, not formatting hints.
// Keep them on appendText's existing hidden/destination/fallback path. The
// continuous text view represents required page/column breaks as newlines.
Object.assign(WORD_TEXT, { page: '\n', column: '\n', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005', zwj: '\u200d', zwnj: '\u200c', zwbo: '\u200b', zwnbo: '\u2060', ltrmark: '\u200e', rtlmark: '\u200f' })
const SYMBOL_TEXT = { '~': '\u00a0', '_': '\u2011', '-': '\u00ad' }
const CHARSETS = { 0: 1252, 2: 42, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250, 255: 850 }
const ENCODINGS = new Set(['windows-1252', 'latin1', 'gb18030', 'big5', 'shift_jis', 'cp949', 'utf-8'])

function isLetter (char) { return Boolean(char && /[a-z]/i.test(char)) }
function isDigit (char) { return Boolean(char && /[0-9]/.test(char)) }

// Body and separate note text. No OLE execution, picture decoding, or rich layout is implied.
// Unicode fallback rules: Microsoft RTF 1.9.1 pp.14–15. A control word/symbol
// counts as one fallback character; bin + payload counts as one; braces end it.
function parseRtf (input) {
  const binary = typeof input !== 'string'
  const raw = binary ? toUint8(input) : input
  if (raw.length > MAX_BYTES) throw new Error('RTF 文件超过 5 MB，暂时不直接排版')
  // Latin-1 identity mapping preserves bytes until a complete text run is decoded.
  const sourceParts = []
  if (binary) {
    for (let offset = 0; offset < raw.length; offset += RUN_BYTES) sourceParts.push(String.fromCharCode.apply(null, raw.subarray(offset, offset + RUN_BYTES)))
  }
  const source = binary ? sourceParts.join('') : raw
  if (!/^\s*\{\\rtf1\b/.test(source)) throw new Error('RTF 文件头无效')
  let state = { skip: false, discard: false, hidden: null, paragraphStyle: 0, characterStyle: null, styleSheet: null, styleDefinition: null, upr: null, udExpected: false, fontTable: false, font: null, tableFont: null, codepage: 1252, uc: 1 }
  const stack = []
  const fonts = Object.create(null)
  const styles = { s: new Map(), cs: new Map() }
  const styleHidden = { s: new Map(), cs: new Map() }
  const body = { parts: [], paragraphHasText: false, note: null }
  state.stream = body
  const notes = createNotes(body)
  let defaultFont = null
  let bytes = []
  let fallback = 0
  let index = 0
  let closedRoot = false

  function fontNameText (text) {
    if (!state.fontTable || state.discard || state.tableFont == null) return
    const font = fonts[state.tableFont]
    if (!font || font.nameComplete) return
    const end = text.indexOf(';')
    font.name = (font.name || '') + (end < 0 ? text : text.slice(0, end))
    if (font.name.length > 128) { font.name = ''; font.nameComplete = true }
    if (end >= 0) font.nameComplete = true
  }

  // Resolve only the displayed property, iteratively and once per style chain.
  // A used cycle without a terminating property is malformed; unused metadata
  // and absent bases do not turn an otherwise readable file into a failure.
  function inheritedHidden (kind, id) {
    const table = styles[kind], cache = styleHidden[kind]
    const trail = [], seen = new Set()
    let hidden = null
    while (id != null) {
      if (cache.has(id)) { hidden = cache.get(id); break }
      if (seen.has(id)) throw new Error('RTF 样式继承存在循环，无法确定正文显示属性')
      const style = table.get(id)
      if (!style) break
      seen.add(id)
      trail.push(id)
      if (style.hidden != null) { hidden = style.hidden; break }
      id = style.basedOn
    }
    for (const item of trail) cache.set(item, hidden)
    return hidden
  }

  function isHidden () {
    if (state.hidden != null) return state.hidden
    const character = inheritedHidden('cs', state.characterStyle)
    return character == null ? inheritedHidden('s', state.paragraphStyle) === true : character
  }

  function rememberHiddenCharacter (text, hidden) {
    if (!text.length) return
    const tail = ((state.stream.lastHiddenCharacter || '') + text).slice(-2)
    state.stream.lastHiddenCharacter = hidden ? Array.from(tail).pop() : ''
  }

  function flush (final = true) {
    if (!bytes.length) return
    const font = fonts[state.font == null ? defaultFont : state.font]
    const cp = font && (font.codepage || font.charsetCodepage) || state.codepage
    const encoding = cp === 65001 ? 'utf-8' : normalizeEncoding(`cp${cp}`)
    const singleByteTable = singleByteHigh[cp]
    if (cp !== 42 && !singleByteTable && !ENCODINGS.has(encoding) && bytes.some(byte => byte > 0x7f)) throw new Error(`RTF 暂不支持代码页 ${cp} 的正文解码`)
    let cut = bytes.length
    let decoded
    // At most three trailing bytes may be the start of an incomplete UTF-8 or
    // GB18030 character. Keep them for the next run, never emit U+FFFD as success.
    for (let carry = 0; carry <= (final || singleByteTable ? 0 : 3); carry++) {
      cut = bytes.length - carry
      if (cp === 42) {
        decoded = { text: bytes.slice(0, cut).map(byte => decodeSymbol(byte, font)).join(''), errors: 0 }
      } else if (singleByteTable) {
        const text = bytes.slice(0, cut).map(byte => byte < 128 ? String.fromCharCode(byte) : singleByteTable[byte - 128]).join('')
        decoded = { text, errors: text.includes('\ufffd') ? 1 : 0 }
      } else decoded = decodeText(Uint8Array.from(bytes.slice(0, cut)), { encoding: ENCODINGS.has(encoding) ? encoding : 'latin1' })
      if (!decoded.errors) break
    }
    if (decoded.errors) throw new Error(`RTF 正文字节与代码页 ${cp} 不匹配，文件可能损坏`)
    // Flatten each bounded run; do not retain millions of single-character ropes.
    // Hidden character formatting affects display, not parsing or validation.
    // Keep decoding its bytes so a malformed run cannot become a silent success.
    rememberHiddenCharacter(decoded.text, isHidden())
    if (!isHidden()) {
      state.stream.parts.push(decoded.text.split('').join(''))
      state.stream.paragraphHasText = state.stream.paragraphHasText || decoded.text.length > 0
    }
    bytes = bytes.slice(cut)
  }

  function appendByte (byte) {
    if (state.udExpected) throw new Error('RTF Unicode 备选分组必须以 \\*\\ud 开始')
    if (fallback > 0) { fallback--; return }
    fontNameText(String.fromCharCode(byte))
    if (!state.skip && !state.discard) {
      bytes.push(byte)
      if (bytes.length >= RUN_BYTES) flush(false)
    }
  }

  function appendText (text) {
    flush()
    fontNameText(text)
    if (!state.skip && !state.discard) {
      const currentFont = fonts[state.font == null ? defaultFont : state.font]
      const symbolFont = currentFont && (currentFont.codepage || currentFont.charsetCodepage) === 42 ? currentFont : fonts[state.symbolFont]
      if (symbolFont) text = text.replace(/[\uf020-\uf0ff]/g, char => decodeSymbol(char.charCodeAt(0) - 0xf000, symbolFont))
    }
    if (!state.skip && !state.discard) rememberHiddenCharacter(text, isHidden())
    if (!state.skip && !state.discard && !isHidden()) {
      state.stream.parts.push(text)
      state.stream.paragraphHasText = state.stream.paragraphHasText || text.length > 0
    }
  }

  function appendTableBoundary (word) {
    // Table marks partition cells/rows even when their character format is
    // hidden. Call only after destination and Unicode fallback checks; this
    // must not revive metadata, discarded alternatives or hidden note text.
    state.stream.parts.push(WORD_TEXT[word])
    state.stream.paragraphHasText = false
    state.stream.lastHiddenCharacter = ''
  }

  while (index < source.length) {
    const char = source[index++]
    if (closedRoot) {
      if (char !== '\0' && !/\s/.test(char)) throw new Error('RTF 根分组后存在意外数据')
      continue
    }
    if (char === '\r' || char === '\n') continue
    if (char === '{') {
      flush()
      fallback = 0
      if (stack.length >= MAX_DEPTH) throw new Error('RTF 嵌套层数超过安全上限')
      if (state.udExpected) throw new Error('RTF Unicode 备选分组缺少 \\*\\ud')
      const alternative = state.upr ? ++state.upr.children : 0
      if (alternative > 2) throw new Error('RTF upr 必须包含两个备选分组')
      stack.push(state)
      state = { ...state, upr: null, nestProps: false, unicodeDestination: false, udExpected: alternative === 2, udStar: false, udInheritedSkip: state.skip }
      // Only immediate stylesheet children define styles. Nested keycodes,
      // optional destinations and unselected upr branches cannot mutate them.
      state.styleDefinition = state.styleSheet === stack.length - 1 && !state.discard
        ? { kind: 's', id: 0, hidden: null, basedOn: null, first: true, star: false }
        : null
      // Discard ANSI events, not just their displayed text: an unselected font
      // table must not alter the encoding of the selected Unicode branch.
      if (alternative === 1) state.discard = true
      if (alternative === 2) state.skip = true
      continue
    }
    if (char === '}') {
      flush()
      fallback = 0
      if (state.udExpected || state.upr && state.upr.children !== 2) throw new Error('RTF Unicode 备选结构不完整')
      if (!stack.length) throw new Error('RTF 分组不完整')
      if (state.styleDefinition && !state.discard && styles[state.styleDefinition.kind]) {
        const style = state.styleDefinition
        styles[style.kind].set(style.id, style)
        styleHidden[style.kind].clear()
      }
      if (state.noteDepth === stack.length) notes.finish(state.stream.note)
      state = stack.pop()
      if (!stack.length) closedRoot = true
      continue
    }
    if (char !== '\\') {
      if (state.styleDefinition) state.styleDefinition.first = false
      if (!stack.length) continue // leading whitespace before the root
      if (state.upr) {
        if (/^[ \t]$/.test(char)) continue
        throw new Error('RTF upr 的正文必须位于备选分组内')
      }
      if (state.udExpected) throw new Error('RTF Unicode 备选分组必须以 \\*\\ud 开始')
      if (!binary && char.charCodeAt(0) > 0x7f) {
        if (fallback > 0) fallback--
        else appendText(char)
      } else appendByte(char.charCodeAt(0))
      continue
    }

    if (state.upr) throw new Error('RTF upr 的控制符必须位于备选分组内')
    const next = source[index++]
    if (next === "'") {
      const hex = source.slice(index, index + 2)
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error('RTF 十六进制字符不完整')
      index += 2
      appendByte(parseInt(hex, 16))
      continue
    }
    if (next === '\\' || next === '{' || next === '}') {
      appendByte(next.charCodeAt(0))
      continue
    }
    if (!isLetter(next)) {
      if (state.udExpected) {
        if (next !== '*' || state.udStar) throw new Error('RTF Unicode 备选前缀无效')
        state.udStar = true
        continue
      }
      if (fallback > 0) { fallback--; continue }
      if (next === '*') {
        flush()
        if (state.styleDefinition && state.styleDefinition.first && !state.discard) {
          state.styleDefinition.first = false
          state.styleDefinition.star = true
          continue
        }
        let destinationIndex = index
        while (source[destinationIndex] === '\r' || source[destinationIndex] === '\n') destinationIndex++
        // A known Unicode destination remains readable outside an upr pair too.
        // Preserve inherited skip/hidden state; never revive a discarded parent.
        if (!state.discard && /^\\ud(?=[^a-zA-Z]|$)/.test(source.slice(destinationIndex, destinationIndex + 5))) {
          state.unicodeDestination = true
          continue
        }
        // The optional marker skips unknown destinations, not known content.
        // Preserve field result text without executing its instruction. Keep
        // inherited discard/skip so no field or note can revive hidden metadata
        // or the unselected ANSI branch of a Unicode alternative.
        if (!state.skip && !state.discard && /^\\(?:footnote|field|fldrslt)(?=[^a-zA-Z]|$)/.test(source.slice(destinationIndex, destinationIndex + 10))) continue
        // Only a visible nested-table property destination may contribute its
        // row boundary. Its text/font metadata remains discarded (RTF pp.95–96).
        state.nestProps = !state.skip && !state.discard && /^\\nesttableprops\b/.test(source.slice(destinationIndex, destinationIndex + 17))
        state.skip = true
        state.discard = true
      }
      else if (SYMBOL_TEXT[next]) appendText(SYMBOL_TEXT[next])
      else if (next === '\r' || next === '\n') appendText('\n')
      else if (next == null) throw new Error('RTF 控制符不完整')
      continue
    }

    const start = index - 1
    while (isLetter(source[index])) index++
    if (index - start > 32) throw new Error('RTF 控制字过长')
    // RTF keywords are case-sensitive. An unknown mixed-case word must not
    // acquire lowercase semantics such as hiding text or consuming binary data.
    const word = source.slice(start, index)
    const numberStart = index
    if (source[index] === '-') index++
    while (isDigit(source[index])) index++
    const number = source.slice(numberStart, index)
    const value = number ? Number(number) : null
    if (number && !Number.isSafeInteger(value)) throw new Error('RTF 控制字数值无效')
    if (source[index] === ' ') index++

    if (state.udExpected) {
      if (word !== 'ud' || !state.udStar || value != null) throw new Error('RTF Unicode 备选分组缺少 \\*\\ud')
      state.udExpected = false
      state.skip = state.udInheritedSkip
      continue
    }
    if (state.unicodeDestination) {
      if (word !== 'ud' || value != null) throw new Error('RTF Unicode 目标分组的 \\ud 不接受数值参数')
      state.unicodeDestination = false
      continue
    }

    if (word === 'bin') {
      flush()
      if (value == null || value < 0 || value > source.length - index) throw new Error('RTF 二进制长度无效或文件已截断')
      index += value
      if (fallback > 0) fallback--
      continue
    }
    if (fallback > 0) { fallback--; continue }
    flush()

    if (state.styleDefinition && state.styleDefinition.star) {
      state.styleDefinition.star = false
      if (word !== 'cs' || value == null) state.discard = true
      else { state.styleDefinition.kind = 'cs'; state.styleDefinition.id = value }
    }
    if (state.nestProps && word === 'nestrow') appendTableBoundary(word)
    if (state.discard) continue
    if (state.upr) throw new Error('RTF upr 只能包含两个备选分组')
    if (word === 'upr' && (!state.skip || state.fontTable)) {
      if (value != null) throw new Error('RTF upr 不接受数值参数')
      state.upr = { children: 0 }
      continue
    }

    if (word === 'stylesheet' && !state.skip) {
      state.styleSheet = stack.length
      state.skip = true
      continue
    }
    if (state.styleSheet != null) {
      const style = state.styleDefinition
      if (DESTINATIONS.has(word)) { state.discard = true; continue }
      // Style names also have Unicode fallback tokens. A fallback \v or \s
      // is a character substitute, never a display-property definition.
      if (word === 'uc') {
        if (value == null || value < 0 || value > 32767) throw new Error('RTF Unicode 回退长度无效')
        state.uc = value
      } else if (word === 'u') {
        if (value == null || value < -32768 || value > 65535) throw new Error('RTF Unicode 字符无效')
        fallback = state.uc
      }
      if (style) {
        style.first = false
        if ((word === 's' || word === 'ds') && value != null) { style.kind = word; style.id = value }
        else if (word === 'sbasedon' && value != null) style.basedOn = value === 222 ? null : value
        else if (word === 'cs' && style.kind !== 'cs') state.discard = true
        else if (word === 'v') style.hidden = value !== 0
        else if (word === 'plain') style.hidden = null
      }
      continue
    }
    if (word === 'fonttbl') state.fontTable = true
    if (DESTINATIONS.has(word)) {
      state.skip = true
      if (word !== 'fonttbl') { state.discard = true; continue }
    }
    if (state.fontTable) {
      if (word === 'f' && value != null) {
        state.tableFont = value
        if (!fonts[value]) fonts[value] = {}
        fonts[value].name = ''
        fonts[value].nameComplete = false
      } else if (state.tableFont != null && (word === 'fcharset' || word === 'cpg') && value != null) {
        const font = fonts[state.tableFont]
        if (word === 'cpg') font.codepage = value
        else font.charsetCodepage = value === 1 ? null : (CHARSETS[value] || `charset-${value}`)
      } else if (word === 'uc') {
        if (value == null || value < 0 || value > 32767) throw new Error('RTF Unicode 回退长度无效')
        state.uc = value
      } else if (word === 'u') {
        if (value == null || value < -32768 || value > 65535) throw new Error('RTF Unicode 字符无效')
        fontNameText(String.fromCharCode(value & 0xffff))
        fallback = state.uc
      }
      continue
    }
    if (state.skip) continue
    if (word === 'footnote') {
      if (value != null || state.stream.note) throw new Error('RTF 注释分组无效或嵌套')
      state.stream = notes.begin(isHidden())
      state.noteDepth = stack.length
      continue
    }
    if (word === 'ftnalt' && state.stream.note) { state.stream.note.kind = 'endnote'; continue }
    if (word === 'chftn') {
      notes.reference(state.stream)
      continue
    }
    if (!state.stream.note) notes.control(word, value)
    if (word === 'ansicpg' && value != null) state.codepage = value
    else if (word === 'mac') state.codepage = 10000
    else if (word === 'pc') state.codepage = 437
    else if (word === 'pca') state.codepage = 850
    else if (word === 'deff' && value != null) defaultFont = value
    else if (word === 'f' && value != null) {
      state.font = value
      const font = fonts[value]
      if (font && (font.codepage || font.charsetCodepage) === 42) state.symbolFont = value
    }
    else if (word === 's' && styles.s.has(value)) state.paragraphStyle = value
    else if (word === 'cs' && styles.cs.has(value)) state.characterStyle = value
    else if (word === 'pard') state.paragraphStyle = 0
    // Unlike a discarded destination, hidden text can become visible in a child
    // group or after \v0 / \plain. The group stack restores character formatting.
    else if (word === 'v') state.hidden = value !== 0
    else if (word === 'plain') { state.font = defaultFont; state.hidden = null; state.characterStyle = null }
    else if (word === 'uc') {
      if (value == null || value < 0 || value > 32767) throw new Error('RTF Unicode 回退长度无效')
      state.uc = value
    } else if (word === 'u') {
      if (value == null || value < -32768 || value > 65535) throw new Error('RTF Unicode 字符无效')
      appendText(String.fromCharCode(value & 0xffff))
      fallback = state.uc
    } else if (word === 'par' || word === 'sect') {
      // A partly visible styled paragraph still separates its visible text
      // from the next paragraph. Preserve existing explicit hidden-mark rules.
      if (state.hidden == null && isHidden() && state.stream.paragraphHasText) state.stream.parts.push('\n')
      else appendText('\n')
      state.stream.paragraphHasText = false
    } else if (word === 'cell' || word === 'nestcell' || word === 'row' || word === 'nestrow') {
      appendTableBoundary(word)
    } else if (Object.prototype.hasOwnProperty.call(WORD_TEXT, word)) appendText(WORD_TEXT[word])
  }
  if (stack.length || !closedRoot) throw new Error('RTF 分组不完整，文件可能已截断')
  flush()
  return notes.result()
}

function rtfToText (input) { return documentText(parseRtf(input)) }
function rtfToHtml (input) { return documentHtml(parseRtf(input)) }

module.exports = { rtfToText, rtfToHtml }
