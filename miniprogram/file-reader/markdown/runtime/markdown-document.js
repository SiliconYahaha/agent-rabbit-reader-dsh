'use strict'

// Markdown → HTML。在 vendored marked 之上补齐 AGI Bar 阅读页原有的扩展：
// front-matter、TeX 公式（$…$、$$…$$、\(…\)、\[…\]）、脚注、定义列表、diff 代码块高亮、
// mermaid 代码块画成 SVG、==高亮==、~下标~、^上标^。任务列表由 marked 的 GFM 直接产出 checkbox，
// <details> 作为 HTML 块透传，交给后面的 HTML 沙盒。
// 输出的 HTML 仍会经过 html-compat 的净化，这里不负责安全过滤。

const { Marked, Tokenizer } = require('./vendor/marked')
const { quoteToken, quoteListToken, withQuoteSource, quoteBodyTokens, sourceColumns, paragraphHeadingToken } = require('./quote-tokenizer')
const { formatFormulaBlock, formatFormulaText } = require('./tex-text')
const { detectDiagramType, renderMermaid } = require('./mermaid-lite')
const { svgDataUri } = require('./svg-data-uri')

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeText (value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/^﻿/, '')
}

function stripWrappingQuotes (value) {
  const text = String(value || '').trim()
  const match = text.match(/^(['"])([\s\S]*)\1$/)
  return match ? match[2] : text
}

// 只识别最简单的 `key: value` front-matter；嵌套 YAML 不解析，原样留在正文外。
function parseFrontMatter (source) {
  const text = normalizeText(source)
  const opening = /^---[ \t]*\n/.exec(text)
  if (!opening) return { meta: {}, body: text }
  // Delimiters occupy a complete, unindented line. Search from the very next
  // line so an empty block cannot consume body text up to a later separator.
  // The YAML document-end marker is also used by Jekyll front matter.
  const closing = /(?:^|\n)(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text.slice(opening[0].length))
  if (!closing) return { meta: {}, body: text }
  const end = opening[0].length + closing.index
  const closingEnd = end + closing[0].length
  const meta = {}
  for (const line of text.slice(opening[0].length, end).split('\n')) {
    const match = String(line || '').match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/)
    if (match) meta[match[1]] = stripWrappingQuotes(match[2])
  }
  return { meta, body: text.slice(closingEnd).replace(/^\n+/, '') }
}


function mathExtensions () {
  const displayPatterns = [/^\$\$([\s\S]+?)\$\$/, /^\\\[([\s\S]+?)\\\]/]
  // 单个 $ 按 Pandoc 规则：内侧不能有空格，闭合 $ 后不能紧跟数字（$5 和 $10 仍是价格）。
  const inlinePatterns = [/^\\\(([\s\S]+?)\\\)/, /^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/]
  function findStart (src) {
    const candidates = ['$', '\\(', '\\['].map(marker => src.indexOf(marker)).filter(index => index >= 0)
    return candidates.length ? Math.min(...candidates) : undefined
  }
  return [{
    name: 'mathBlock',
    level: 'block',
    start: src => {
      const match = src.match(/(^|\n)\s*(\$\$|\\\[)/)
      return match ? match.index + match[1].length : undefined
    },
    tokenizer (src) {
      const trimmed = src.replace(/^\s+/, '')
      if (!/^(\$\$|\\\[)/.test(trimmed)) return undefined
      for (const pattern of displayPatterns) {
        const match = pattern.exec(trimmed)
        if (match && /^\s*(\n|$)/.test(trimmed.slice(match[0].length))) {
          const trailing = trimmed.slice(match[0].length).match(/^[ \t]*\n?/)[0]
          return { type: 'mathBlock', raw: src.slice(0, src.length - trimmed.length) + match[0] + trailing, text: match[1] }
        }
      }
      return undefined
    },
    renderer: token => `<div class="md-formula-block"><pre class="md-formula">${escapeHtml(formatFormulaBlock(token.text))}</pre></div>\n`
  }, {
    name: 'mathInline',
    level: 'inline',
    start: findStart,
    tokenizer (src) {
      for (const pattern of displayPatterns) {
        const match = pattern.exec(src)
        if (match) return { type: 'mathInline', raw: match[0], text: match[1], display: true }
      }
      for (const pattern of inlinePatterns) {
        const match = pattern.exec(src)
        if (match) return { type: 'mathInline', raw: match[0], text: match[1], display: false }
      }
      return undefined
    },
    renderer: token => token.display
      ? `<span class="md-formula md-formula-display">${escapeHtml(formatFormulaBlock(token.text))}</span>`
      : `<span class="md-formula">${escapeHtml(formatFormulaText(token.text))}</span>`
  }]
}

const MAX_FOOTNOTE_DEFINITIONS = 4096
const MAX_FOOTNOTE_REFERENCES = 16384
const MAX_FOOTNOTE_NESTING = 32
const footnoteBoundaryParser = new Marked({ gfm: true, breaks: false, tokenizer: { fences: fencedCodeToken, code: indentedCodeToken, blockquote: quoteToken, list: quoteListToken, lheading: paragraphHeadingToken } })

// Remove indentation in columns, including tabs which straddle the boundary.
function footnoteIndent (line, startColumn = 0, width = 4) {
  let i = 0, column = startColumn
  while (i < line.length && /[ \t]/.test(line[i]) && column - startColumn < width) {
    column += line[i++] === '\t' ? 4 - column % 4 : 1
  }
  return { columns: column - startColumn, text: ' '.repeat(Math.max(0, column - startColumn - width)) + line.slice(i) }
}

function footnoteExtensions (state) {
  return [{
    name: 'footnoteDefinition',
    level: 'block',
    start: src => {
      const match = src.match(/(^|\n) {0,3}\[\^[^\]\s]+\]:/)
      return match ? match.index + match[1].length : undefined
    },
    tokenizer (src) {
      const match = /^( {0,3}\[\^([^\]\s]+)\]:)([^\n]*)(?:\n|$)/.exec(src)
      if (!match) return undefined
      if (++state.definitionCount > MAX_FOOTNOTE_DEFINITIONS) throw new Error('Markdown footnotes exceed 4096 definitions')
      if (state.definitionDepth >= MAX_FOOTNOTE_NESTING) throw new Error('Markdown footnotes exceed 32 nested definitions')
      const lines = ['> ' + footnoteIndent(match[3], match[1].length).text + (match[0].endsWith('\n') ? '\n' : '')]
      const ends = [match[0].length]
      let offset = match[0].length
      // Translate only the indentation boundary into container markers. Let
      // Marked's own block parser decide lazy paragraph continuation versus a
      // new heading/list/fence. Blank-separated body paragraphs stay outside.
      while (offset < src.length) {
        const end = src.indexOf('\n', offset), next = end < 0 ? src.length : end + 1
        const line = src.slice(offset, end < 0 ? next : end), indent = footnoteIndent(line)
        if (/^[ \t]*$/.test(line)) {
          const blanks = []
          let cursor = offset
          while (cursor < src.length) {
            const eol = src.indexOf('\n', cursor), after = eol < 0 ? src.length : eol + 1
            if (!/^[ \t]*$/.test(src.slice(cursor, eol < 0 ? after : eol))) break
            blanks.push({ after, line: src.slice(cursor, eol < 0 ? after : eol), newline: eol >= 0 }); cursor = after
          }
          for (const blank of blanks) {
            lines.push('> ' + footnoteIndent(blank.line).text + (blank.newline ? '\n' : ''))
            ends.push(blank.after)
          }
          offset = cursor
          const eol = src.indexOf('\n', cursor)
          if (footnoteIndent(src.slice(cursor, eol < 0 ? src.length : eol)).columns < 4) break
          continue
        } else if (indent.columns >= 4) lines.push('> ' + indent.text + (end < 0 ? '' : '\n'))
        else {
          if (/^ {0,3}(?:\[\^[^\]\s]+\]:|>)/.test(line)) break
          lines.push(line + (end < 0 ? '' : '\n'))
        }
        ends.push(next); offset = next
      }
      const definition = { tokens: [] }
      state.definitions[match[2]] = definition
      const top = this.lexer.state.top
      state.definitionDepth++
      try {
        this.lexer.state.top = true
        // Probe block boundaries without running extension tokenizers twice.
        // Marked's blockquote tokenizer trims terminal newlines; parse its
        // dequoted source again with those original newlines restored.
        const probe = new footnoteBoundaryParser.Lexer(footnoteBoundaryParser.defaults)
        const quoted = lines.join('')
        const quote = withQuoteSource(probe, quoted, lines.map(line => line.startsWith('> ') ? -2 : 0), () => probe.tokenizer.blockquote(quoted))
        const consumedLines = quote.raw.split('\n').length - (quote.raw.endsWith('\n') ? 1 : 0)
        const consumed = lines.slice(0, consumedLines).join('')
        const trailing = consumed.slice(quote.raw.length)
        definition.tokens = quoteBodyTokens(this.lexer, quote, trailing)
        return { type: 'footnoteDefinition', raw: src.slice(0, ends[consumedLines - 1]), id: match[2] }
      } finally { state.definitionDepth--; this.lexer.state.top = top }
    },
    renderer: () => ''
  }, {
    name: 'footnoteReference',
    level: 'inline',
    start: src => { const index = src.indexOf('[^'); return index >= 0 ? index : undefined },
    tokenizer (src) {
      const match = /^\[\^([^\]\s]+)\]/.exec(src)
      if (!match || !Object.prototype.hasOwnProperty.call(state.definitions, match[1])) return undefined
      return { type: 'footnoteReference', raw: match[0], id: match[1] }
    },
    renderer (token) {
      if (++state.referenceCount > MAX_FOOTNOTE_REFERENCES) throw new Error('Markdown footnotes exceed 16384 references')
      let number = state.numbers.get(token.id)
      if (number == null) {
        number = state.order.length + 1
        state.numbers.set(token.id, number); state.order.push(token.id); state.references.set(token.id, [])
      }
      const references = state.references.get(token.id), id = `md-fn-ref-${number}-${references.length + 1}`
      references.push(id)
      return `<sup class="md-footnote-ref"><a id="${id}" href="#md-fn-${number}">[${number}]</a></sup>`
    }
  }]
}

function definitionListExtension (parseInline) {
  return {
    name: 'definitionList',
    level: 'block',
    start: src => {
      const match = src.match(/(^|\n)[^\n:][^\n]*\n:[ \t]+/)
      return match ? match.index + match[1].length : undefined
    },
    tokenizer (src) {
      const match = /^((?:[^\n:][^\n]*\n)+?)((?::[ \t]+[^\n]*(?:\n|$))+)/.exec(src)
      if (!match) return undefined
      const terms = match[1].split('\n').filter(Boolean)
      // 词条前面不能是别的块结构（标题、列表、引用等）；只接受纯文本行。
      if (terms.some(term => /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||---|\$\$|\\\[)/.test(term))) return undefined
      const definitions = match[2].split('\n').filter(Boolean).map(line => line.replace(/^:[ \t]+/, ''))
      return { type: 'definitionList', raw: match[0], terms, definitions }
    },
    renderer (token) {
      const terms = token.terms.map(term => `<dt>${parseInline(term)}</dt>`).join('')
      const definitions = token.definitions.map(definition => `<dd>${parseInline(definition)}</dd>`).join('')
      return `<dl class="md-deflist">${terms}${definitions}</dl>\n`
    }
  }
}

function inlineMarkExtensions () {
  return [{
    name: 'mark',
    level: 'inline',
    start: src => { const index = src.indexOf('=='); return index >= 0 ? index : undefined },
    tokenizer (src) {
      const match = /^==([^=\n]+)==/.exec(src)
      return match ? { type: 'mark', raw: match[0], text: match[1] } : undefined
    },
    renderer: token => `<mark>${escapeHtml(token.text)}</mark>`
  }, {
    name: 'superscript',
    level: 'inline',
    start: src => { const index = src.indexOf('^'); return index >= 0 ? index : undefined },
    tokenizer (src) {
      const match = /^\^([^\s^]+)\^/.exec(src)
      return match ? { type: 'superscript', raw: match[0], text: match[1] } : undefined
    },
    renderer: token => `<sup>${escapeHtml(token.text)}</sup>`
  }, {
    name: 'subscript',
    level: 'inline',
    start: src => { const index = src.indexOf('~'); return index >= 0 ? index : undefined },
    tokenizer (src) {
      if (src.startsWith('~~')) return undefined
      const match = /^~([^~\s][^~\n]*?)~(?!~)/.exec(src)
      return match ? { type: 'subscript', raw: match[0], text: match[1] } : undefined
    },
    renderer: token => `<sub>${escapeHtml(token.text)}</sub>`
  }]
}

function indentedCodeToken (source) {
  // Keep Marked's block boundaries and paragraph interruption rules. Its
  // character-count regexp can remove spaces while leaving the tab which
  // completes the four-column indentation (CommonMark 0.31.2 §2.2/4.4).
  const token = Tokenizer.prototype.code.call(this, source)
  if (!token) return false
  token.text = token.raw.split('\n').map(line => footnoteIndent(line).text).join('\n')
  return token
}

function codeContent (token, columns) {
  if (token.codeBlockStyle === 'indented') return String(token.text || '').replace(/\n*$/, '\n')
  const opening = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw || '')
  if (!opening) return String(token.text || '')
  let body = token.raw.slice(opening[0].length)
  const fence = opening[2]
  const closing = new RegExp('(?:^|\\n) {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*(?:\\n|$)').exec(body)
  if (closing) body = body.slice(0, closing.index + (closing[0][0] === '\n' ? 1 : 0))
  if (opening[1].length) body = body.split('\n').map((line, index) => footnoteIndent(line, columns ? columns[index + 1] || 0 : 0, opening[1].length).text).join('\n')
  return body
}

function fencedCodeToken (source) {
  const opening = /^( {0,3})(`{3,}|~{3,})([^\n]*)(?:\n|$)/.exec(source)
  if (!opening || (opening[2][0] === '`' && opening[3].includes('`'))) return false
  const rest = source.slice(opening[0].length), fence = opening[2]
  // JavaScript multiline anchors also recognize U+2028/U+2029; Markdown
  // line endings do not. Match LF boundaries explicitly.
  const closing = new RegExp('(?:^|\\n) {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*(?:\\n|$)').exec(rest)
  const raw = closing ? source.slice(0, opening[0].length + closing.index + closing[0].length) : source
  const token = { type: 'code', raw, lang: opening[3].trim().replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1') }
  token.text = codeContent(token, sourceColumns(this.lexer, source, raw.split('\n').length))
  return token
}

function renderCode (token, options) {
  const language = String(token.lang || '').trim().split(/\s+/)[0].toLowerCase()
  const content = token.codeBlockStyle === 'indented' ? codeContent(token) : String(token.text || ''), lines = content.split('\n')
  if (language === 'mermaid') {
    const svg = renderMermaid(token.text, { colors: options.mermaidColors })
    if (svg) return `<figure class="md-mermaid"><img class="md-mermaid-image" src="${svgDataUri(svg)}" alt="${escapeHtml(detectDiagramType(token.text))}"></figure>\n`
    return `<div class="md-diagram-placeholder"><span class="md-diagram-label">${escapeHtml(detectDiagramType(token.text))}</span><pre class="md-diagram-source">${escapeHtml(content)}</pre></div>\n`
  }
  if (language === 'diff') {
    const body = lines.map(line => {
      const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'text'
      return `<span class="md-diff-${kind}">${escapeHtml(line)}</span>`
    }).join('\n')
    return `<pre class="md-code md-code-diff"><code class="language-diff">${body}</code></pre>\n`
  }
  const className = language ? ` class="language-${escapeHtml(language)}"` : ''
  return `<pre class="md-code"><code${className}>${escapeHtml(lines.join('\n'))}</code></pre>\n`
}

function renderFootnotes (state, parseBlocks) {
  const contents = []
  // Parsing a note can discover another reachable note. Iterate the growing
  // order once; the number map terminates cycles without dropping their links.
  for (let index = 0; index < state.order.length; index++) contents.push(parseBlocks(state.definitions[state.order[index]].tokens))
  if (!contents.length) return ''
  const items = state.order.map((id, index) => {
    const label = `<span class="md-footnote-num">[${index + 1}]</span>`
    const body = contents[index].startsWith('<p>') ? contents[index].replace('<p>', `<p>${label} `) : label + contents[index]
    const backlinks = state.references.get(id).map((target, reference) => `<a class="md-footnote-backref" href="#${target}" aria-label="返回第 ${reference + 1} 处引用">↩</a>`).join(' ')
    return `<li id="md-fn-${index + 1}" class="md-footnote">${body}${backlinks}</li>`
  }).join('')
  return `<section class="md-footnotes"><ol class="md-footnote-list">${items}</ol></section>\n`
}

// 返回 { html, meta }。meta 是 front-matter 的键值对（可能为空对象）。
function renderMarkdownDocument (source, options = {}) {
  const { meta, body } = parseFrontMatter(source)
  const state = { definitions: Object.create(null), order: [], numbers: new Map(), references: new Map(), definitionCount: 0, definitionDepth: 0, referenceCount: 0 }
  let parseInline = () => ''
  const marked = new Marked({
    gfm: true,
    breaks: false,
    tokenizer: { fences: fencedCodeToken, code: indentedCodeToken, blockquote: quoteToken, list: quoteListToken, lheading: paragraphHeadingToken },
    extensions: [
      ...mathExtensions(),
      ...footnoteExtensions(state),
      definitionListExtension(text => parseInline(text)),
      ...inlineMarkExtensions()
    ],
    renderer: {
      code: token => renderCode(token, options)
    }
  })
  parseInline = text => marked.parseInline(text)
  let html = marked.parse(body)
  html += renderFootnotes(state, tokens => marked.Parser.parse(tokens, marked.defaults))
  return { html, meta }
}

module.exports = { parseFrontMatter, renderMarkdownDocument }
