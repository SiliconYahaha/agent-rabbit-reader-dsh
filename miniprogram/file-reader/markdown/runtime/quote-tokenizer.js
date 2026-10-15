'use strict'

const { Tokenizer } = require('./vendor/marked')
const { listToken, interruptsParagraph } = require('./list-tokenizer')
const frames = new WeakMap()
const origins = new WeakMap()
const lazyParagraphs = new WeakMap()
const listOrigins = new WeakMap()

function endsInParagraph (token) {
  if (!token) return false
  if (token.type === 'blockquote' && lazyParagraphs.has(token)) return lazyParagraphs.get(token)
  if (token.type === 'list') {
    const item = token.items[token.items.length - 1]
    if (!item) return false
    return endsInParagraph(item.tokens.filter(t => t.type !== 'space').at(-1))
  }
  if (token.type === 'blockquote') return endsInParagraph(token.tokens.filter(t => t.type !== 'space').at(-1))
  return token.type === 'paragraph' || token.type === 'text'
}

function withQuoteSource (lexer, text, columns, parse, rawLines = null, lazyLines = null) {
  const previous = frames.get(lexer)
  frames.set(lexer, { text, columns, rawLines, lazyLines })
  try { return parse() } finally {
    if (previous) frames.set(lexer, previous)
    else frames.delete(lexer)
  }
}

function sourceColumns (lexer, source, count) {
  const frame = frames.get(lexer)
  if (!frame) return Array(count == null ? source.split('\n').length : count).fill(0)
  // blockTokens consumes suffixes of this frame. Manufactured list item
  // sources are isolated by quoteListToken; comparing every entire suffix
  // would make a long sequence of fences quadratic.
  const offset = frame.text.length - source.length
  if (offset < 0) return null
  if (!frame.lineStarts) {
    frame.lineStarts = [0]
    for (let end = frame.text.indexOf('\n'); end >= 0; end = frame.text.indexOf('\n', end + 1)) frame.lineStarts.push(end + 1)
  }
  let low = 0, high = frame.lineStarts.length
  while (low + 1 < high) {
    const mid = (low + high) >>> 1
    if (frame.lineStarts[mid] <= offset) low = mid
    else high = mid
  }
  return frame.columns.slice(low, count == null ? undefined : low + count)
}

function sourceOriginAt (lexer, source) {
  const frame = frames.get(lexer)
  if (!frame) return (index, text) => ({ text, column: 0 })
  const offset = frame.text.length - source.length
  if (offset < 0) return (index, text) => ({ text, column: 0 })
  if (!frame.lineStarts) {
    frame.lineStarts = [0]
    for (let end = frame.text.indexOf('\n'); end >= 0; end = frame.text.indexOf('\n', end + 1)) frame.lineStarts.push(end + 1)
  }
  let low = 0, high = frame.lineStarts.length
  while (low + 1 < high) {
    const mid = (low + high) >>> 1
    if (frame.lineStarts[mid] <= offset) low = mid
    else high = mid
  }
  return (index, text) => ({ text: frame.rawLines ? frame.rawLines[low + index] ?? text : text, column: frame.columns[low + index] || 0, lazy: Boolean(frame.lazyLines && frame.lazyLines[low + index]) })
}

// A paragraph may contain indented continuation lines before its Setext
// underline. Marked's standalone expression excludes those lines and can
// promote only the final fragment. Stop at actual paragraph interruptions.
function paragraphHeadingToken (source) {
  const body = []
  let consumed = 0
  for (const line of source.split('\n')) {
    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
    const length = line.length + (source[consumed + line.length] === '\n' ? 1 : 0)
    if (underline && body.length) {
      const text = body.join('\n').trim()
      return { type: 'heading', raw: source.slice(0, consumed + length), depth: underline[1][0] === '=' ? 1 : 2, text, tokens: this.lexer.inline(text) }
    }
    if (!line.trim() || (!body.length && /^ {4}/.test(line)) || interruptsParagraph(this.rules, line)) break
    body.push(line); consumed += length
  }
  return false
}

function quoteListToken (source) {
  if (!this.rules.block.list.test(source)) return false
  const originAt = sourceOriginAt(this.lexer, source)
  const top = this.lexer.state.top
  let token
  try { token = listToken.call(this, source, {
    originAt,
    parseItem: (text, columns, lazyLines) => {
      const rawLines = text.split('\n')
      const lines = prepareLines(this.lexer, rawLines.map((text, i) => ({ text, column: columns[i] || 0 })))
      // Lazy lines lack an ancestor marker. Protect Setext-looking text at
      // every nested item, rather than letting stripped prefixes turn it into
      // a heading. The original text and lazy flags remain in the source frame.
      const prepared = lines.map((line, i) => lazyLines[i] && /^[ \t]*(?:=+|-+)[ \t]*$/.test(line.text) ? '    ' + line.text.trimStart() : line.text).join('\n')
      return withQuoteSource(this.lexer, prepared, columns, () => this.lexer.blockTokens(prepared, []), rawLines, lazyLines)
    }
  }) } finally { this.lexer.state.top = top }
  if (token) listOrigins.set(token, token.raw.split('\n').map((text, i) => originAt(i, text)))
  return token
}

function dequoteLine (line, column) {
  const startColumn = column
  let offset = 0, indent = 0
  while (offset < line.length && /[ \t]/.test(line[offset])) {
    const width = line[offset] === '\t' ? 4 - column % 4 : 1
    if (indent + width > 3) return { text: line, column: startColumn }
    indent += width; column += width; offset++
  }
  if (line[offset] !== '>') return { text: line, column: startColumn }
  offset++; column++
  let remainder = ''
  if (line[offset] === ' ') { offset++; column++ }
  else if (line[offset] === '\t') {
    // A quote consumes one column of optional whitespace, not a whole tab.
    remainder = ' '.repeat(4 - column % 4 - 1)
    offset++; column++
  }
  return { text: remainder + line.slice(offset), column }
}

function normalizeIndent ({ text: rest, column: start }) {
  let column = start
  let width = 0, count = 0
  // Normalize only structural indentation. Tabs after the four-column code
  // boundary belong to the code body and must remain literal tab characters.
  while (count < rest.length && width < 4 && /[ \t]/.test(rest[count])) {
    const step = rest[count++] === '\t' ? 4 - column % 4 : 1
    column += step; width += step
  }
  return { text: ' '.repeat(width) + rest.slice(count), column: start }
}

function prepareLines (lexer, lines) {
  let fence = null, htmlUntil = -1
  return lines.map((line, index) => {
    if (index < htmlUntil) return line
    const normalized = normalizeIndent(line)
    if (fence) {
      const closing = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \t]*$')
      if (closing.test(normalized.text)) { fence = null; return normalized }
      return line
    }
    if (/^ {0,3}</.test(normalized.text) && lexer.tokenizer.rules.block.html.test(normalized.text + '\n')) {
      const source = [normalized.text, ...lines.slice(index + 1).map(line => line.text)].join('\n')
      const html = Tokenizer.prototype.html.call(lexer.tokenizer, source)
      if (html) {
        htmlUntil = index + html.raw.split('\n').length - (html.raw.endsWith('\n') ? 1 : 0)
        return normalized
      }
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(normalized.text)
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) fence = opening[1]
    return normalized
  })
}

function parseBody (lexer, text, columns, tokens, rawLines = null) {
  const previous = tokens.at(-1)
  if (!previous || previous.type !== 'paragraph') return withQuoteSource(lexer, text, columns, () => lexer.blockTokens(text, tokens, true), rawLines)
  const tokenizer = lexer.tokenizer
  const originals = Object.fromEntries(['html', 'code', 'lheading'].map(key => [key, { method: tokenizer[key], own: Object.hasOwn(tokenizer, key) }]))
  const continues = source => source === text && tokens.at(-1) === previous
  try {
    // A physical quote-marker change does not begin a new paragraph. Suppress
    // only first-leaf interpretations which cannot interrupt that paragraph.
    tokenizer.html = function (source) {
      if (continues(source) && !interruptsParagraph(this.rules, source.split('\n', 1)[0])) return
      return originals.html.method.call(this, source)
    }
    tokenizer.code = function (source) {
      if (continues(source)) return
      return originals.code.method.call(this, source)
    }
    tokenizer.lheading = function (source) {
      const joins = continues(source)
      let heading = originals.lheading.method.call(this, source)
      if (joins && !heading) {
        // Marked's standalone Setext expression excludes inline HTML and
        // indented continuation lines, even when a paragraph is already open.
        const body = []
        let consumed = 0
        for (const line of source.split('\n')) {
          const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
          const length = line.length + (source[consumed + line.length] === '\n' ? 1 : 0)
          if (underline && body.length) {
            const value = body.join('\n')
            heading = { type: 'heading', raw: source.slice(0, consumed + length), depth: underline[1][0] === '=' ? 1 : 2, text: value, tokens: lexer.inline(value) }
            break
          }
          if (interruptsParagraph(this.rules, line)) break
          body.push(line); consumed += length
        }
      }
      if (joins && heading) {
        tokens.pop()
        const old = lexer.inlineQueue.findIndex(entry => entry.tokens === previous.tokens)
        if (old >= 0) lexer.inlineQueue.splice(old, 1)
        // raw measures only this call's consumed source; adding the old
        // paragraph length would swallow following blocks.
        heading.text = previous.text + '\n' + heading.text
        const entry = lexer.inlineQueue.find(entry => entry.tokens === heading.tokens)
        if (entry) entry.src = heading.text
      }
      return heading
    }
    return withQuoteSource(lexer, text, columns, () => lexer.blockTokens(text, tokens, true), rawLines)
  } finally {
    for (const [key, original] of Object.entries(originals)) {
      if (original.own) tokenizer[key] = original.method
      else delete tokenizer[key]
    }
  }
}

function quoteBodyTokens (lexer, quote, trailing, tokens = []) {
  const data = origins.get(quote)
  const text = quote.text + trailing
  const columns = data ? data.textColumns.slice() : text.split('\n').map(() => 0)
  while (columns.length < text.split('\n').length) columns.push(0)
  const rawLines = data && data.originalText != null ? (data.originalText + trailing).split('\n') : null
  return parseBody(lexer, text, columns, tokens, rawLines)
}

// Adapted from Marked 18.0.11 Tokenizer.blockquote (MIT; see vendor/LICENSE-MARKED).
// Keep its lazy-continuation/list/setext boundaries while preserving the
// physical source column across nested quote markers.
function quoteToken (source) {
  const cap = this.rules.block.blockquote.exec(source)
  if (!cap) return false
  const columns = sourceColumns(this.lexer, source, cap[0].split('\n').length)
  // Unknown manufactured sources cannot safely inherit physical coordinates.
  if (!columns) return Tokenizer.prototype.blockquote.call(this, source)
  const originAt = sourceOriginAt(this.lexer, source)
  const physicalLines = cap[0].split('\n').length
  let lines = cap[0].replace(/\n+$/, '').split('\n').map((raw, index) => ({ raw, originalRaw: originAt(index, raw).text, inheritedLazy: originAt(index, raw).lazy, column: columns[index] || 0, hasEnding: index < physicalLines - 1 }))
  let raw = '', text = ''
  let rawColumns = [], textColumns = []
  const tokens = []
  let mayContinue = false
  while (lines.length) {
    let inBlockquote = false, index = 0
    const current = []
    for (; index < lines.length; index++) {
      if (this.rules.other.blockquoteStart.test(lines[index].raw)) { current.push(lines[index]); inBlockquote = true }
      else if (!inBlockquote) current.push(lines[index])
      else break
    }
    lines = lines.slice(index)
    const currentRaw = current.map(line => line.raw).join('\n')
    const prepared = currentRaw.replace(this.rules.other.blockquoteSetextReplace, '\n    $1').split('\n')
    const originals = prepared.map((line, index) => {
      const original = dequoteLine(line === current[index].raw ? current[index].originalRaw ?? line : line, line === current[index].raw ? current[index].column : 0)
      if (current[index].inheritedLazy && /^[ \t]*(?:=+|-+)[ \t]*$/.test(original.text)) original.text = '    ' + original.text.trimStart()
      return original
    })
    const stripped = prepareLines(this.lexer, originals)
    const currentText = stripped.map(line => line.text).join('\n')
    raw = raw ? raw + '\n' + currentRaw : currentRaw
    text = text ? text + '\n' + currentText : currentText
    rawColumns.push(...current.map(line => line.column))
    textColumns.push(...stripped.map(line => line.column))
    const top = this.lexer.state.top
    try {
      this.lexer.state.top = true
      const ending = current[current.length - 1].hasEnding ? '\n' : ''
      const originalLines = (originals.map(line => line.text).join('\n') + ending).split('\n')
      parseBody(this.lexer, currentText + ending, stripped.map(line => line.column), tokens, originalLines)
      // Keep the physical ending inside a code leaf, while retaining the
      // upstream lazy-continuation decision on the last nonempty block.
      const spacer = tokens[tokens.length - 1]
      if (ending && spacer && spacer.type === 'space' && spacer.raw.endsWith('\n')) {
        spacer.raw = spacer.raw.slice(0, -1)
        if (!spacer.raw) tokens.pop()
      }
      const container = tokens[tokens.length - 1]
      if (ending && container && ['blockquote', 'list'].includes(container.type) && container.raw.endsWith('\n')) container.raw = container.raw.slice(0, -1)
    } finally { this.lexer.state.top = top }
    const lastToken = tokens[tokens.length - 1]
    // Only an open paragraph can absorb a line without its quote marker.
    // Carry the child's decision through nested containers, including an
    // explicit blank quote line that has no corresponding visible token.
    mayContinue = !!stripped.at(-1).text.trim() && endsInParagraph(lastToken)
    if (!lines.length || !mayContinue) break
    if (lastToken && lastToken.type === 'blockquote') {
      const continuation = lines.map(line => line.raw).join('\n')
      const continued = lines.map(line => dequoteLine(line.raw, line.column))
      const newText = lastToken.raw + '\n' + continued.map(line => line.text).join('\n')
      const oldOrigins = origins.get(lastToken)
      const newColumns = [...(oldOrigins ? oldOrigins.rawColumns : lastToken.raw.split('\n').map(() => 0)), ...continued.map(line => line.column)]
      const newToken = withQuoteSource(this.lexer, newText, newColumns, () => this.blockquote(newText))
      tokens[tokens.length - 1] = newToken
      mayContinue = endsInParagraph(newToken)
      raw += '\n' + continuation
      rawColumns.push(...lines.map(line => line.column))
      text = text.slice(0, text.length - lastToken.text.length) + newToken.text
      // These coordinates are only needed if this token is used by an outer
      // lazy continuation; all actual child parsing has already completed.
      textColumns = text.split('\n').map((_, i) => textColumns[i] || 0)
      break
    }
    if (lastToken && lastToken.type === 'list') {
      const newText = lastToken.raw + '\n' + lines.map(line => line.raw).join('\n')
      // This manufactured source is not a suffix of the outer frame. Keep
      // its own dequoted originals or a parent quote marker can be reinserted.
      const original = listOrigins.get(lastToken) || lastToken.raw.split('\n').map(text => ({ text, column: 0 }))
      const continued = lines.map(line => ({ text: line.originalRaw ?? line.raw, column: line.column, lazy: line.inheritedLazy || !this.rules.other.blockquoteStart.test(line.raw) }))
      const combined = [...original, ...continued]
      const newToken = withQuoteSource(this.lexer, newText, combined.map(line => line.column), () => this.list(newText), combined.map(line => line.text), combined.map(line => Boolean(line.lazy)))
      tokens[tokens.length - 1] = newToken
      raw = raw.slice(0, raw.length - lastToken.raw.length) + newToken.raw
      text = text.slice(0, text.length - lastToken.raw.length) + newToken.raw
      let remainingText = newText.slice(newToken.raw.length)
      // list.raw excludes its physical line terminator; that terminator is
      // not a new blank quote line and must not close an open paragraph.
      if (remainingText.startsWith('\n')) remainingText = remainingText.slice(1)
      const remaining = remainingText ? remainingText.split('\n') : []
      lines = remaining.map((line, i) => ({ raw: line, column: lines[i] ? lines[i].column : 0, hasEnding: i < remaining.length - 1 }))
    }
  }
  const token = { type: 'blockquote', raw, tokens, text }
  const rawLines = raw.split('\n')
  const preparedLines = raw.replace(this.rules.other.blockquoteSetextReplace, '\n    $1').split('\n')
  const originalText = preparedLines.map((line, i) => dequoteLine(line === rawLines[i] ? originAt(i, line).text : line, line === rawLines[i] ? rawColumns[i] || 0 : 0).text).join('\n')
  origins.set(token, { rawColumns, textColumns, originalText })
  lazyParagraphs.set(token, mayContinue)
  return token
}

module.exports = { quoteToken, quoteListToken, withQuoteSource, quoteBodyTokens, sourceColumns, paragraphHeadingToken }
