'use strict'

const { decodeCharacterReferences: decodeEntities } = require('./html-character-references')

const { mediaQueryMatches } = require('./media-query')
const { atomicEnd, blockEnd, cssRules, mapCssCode, splitCssTopLevel } = require('./css-structure')

const RENDER_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'big', 'blockquote',
  'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li',
  'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'ruby', 'rt', 's', 'samp',
  'section', 'small', 'source', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'video', 'svg'
])

const FALLBACK_TAGS = new Set([
  'button', 'canvas', 'datalist', 'details', 'dialog', 'fieldset', 'form', 'input',
  'legend', 'meter', 'option', 'progress', 'select', 'summary', 'textarea', 'template'
])

const METADATA_TAGS = new Set([
  'base', 'body', 'head', 'html', 'link', 'meta', 'style', 'title'
])

const BLOCKED_TAGS = new Set([
  'applet', 'embed', 'frame', 'frameset', 'iframe', 'object', 'script'
])

const MOBILE_CANVAS_WIDTH = 340
const DEFAULT_REM_SIZE = 16
const ABSOLUTE_UNIT_FACTORS = {
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  pt: 96 / 72,
  pc: 16,
  q: 96 / 101.6
}

function findClosingBrace (source, openingIndex) {
  const end = blockEnd(source, openingIndex)
  return end < source.length ? end : -1
}

function flattenResponsiveCss (source, viewportWidth = MOBILE_CANVAS_WIDTH, mediaEnvironment = {}) {
  const output = [], stack = [{ source: String(source || ''), iterator: cssRules(source) }]
  while (stack.length) {
    const frame = stack[stack.length - 1], next = frame.iterator.next()
    if (next.done) { stack.pop(); continue }
    const rule = next.value, kind = (rule.prelude.match(/^@([\w-]+)/) || [])[1] || ''
    if (/^(?:-[\w]+-)?keyframes$/i.test(kind)) continue
    if (/^(media|supports)$/i.test(kind) && rule.body != null) {
      if (/^supports$/i.test(kind) || mediaQueryMatches(rule.prelude.slice(kind.length + 1), viewportWidth, mediaEnvironment)) stack.push({ source: rule.body, iterator: cssRules(rule.body) })
    } else output.push(frame.source.slice(rule.start, rule.end))
  }
  return output.join('\n')
}

function mapOutsideCssQuotes (source, transform) {
  return mapCssCode(source, transform)
}

function roundCssNumber (value) {
  return Math.round(value * 100) / 100
}

function rootRemSize (source) {
  let size = DEFAULT_REM_SIZE
  String(source || '').replace(/(?:^|})\s*(?:html|:root)\s*\{([^{}]*)\}/gi, (all, declarations) => {
    const match = declarations.match(/(?:^|;)\s*font-size\s*:\s*(-?\d+(?:\.\d+)?)\s*(px|pt|%)(?=\s|;|$)/i)
    if (!match) return all
    const value = Number(match[1])
    const unit = match[2].toLowerCase()
    if (Number.isFinite(value) && value > 0) {
      size = unit === 'pt' ? value * ABSOLUTE_UNIT_FACTORS.pt : unit === '%' ? DEFAULT_REM_SIZE * value / 100 : value
    }
    return all
  })
  return size
}

function convertCssUnits (source, remSize = DEFAULT_REM_SIZE) {
  return mapOutsideCssQuotes(source, part => part.replace(/(-?(?:\d+|\d*\.\d+))\s*(rem|mm|cm|in|pt|pc|q)\b(?![a-z0-9%])/gi, (all, number, unitName) => {
    const unit = unitName.toLowerCase()
    const factor = unit === 'rem' ? remSize : ABSOLUTE_UNIT_FACTORS[unit]
    return `${roundCssNumber(Number(number) * factor)}px`
  }))
}

function stripCssResourceUrls (source) {
  source = String(source || '')
  const output = []; let start = 0
  for (let i = 0; i < source.length;) {
    const match = source.slice(i, i + 16).match(/^url\s*\(/i)
    if (match && (i === 0 || !/[\w-]/.test(source[i - 1]))) {
      const open = i + match[0].length - 1, end = blockEnd(source, open)
      let target = source.slice(open + 1, end).trim()
      if ((target[0] === '"' || target[0] === "'") && target[target.length - 1] === target[0]) target = target.slice(1, -1)
      const safe = safeResourceUrl(target)
      output.push(source.slice(start, i), safe && /^(?:data:|wxfile:|\/[^/])/i.test(safe) ? `url("${safe.replace(/"/g, '%22')}")` : 'none')
      start = i = Math.min(source.length, end + 1)
    } else i = atomicEnd(source, i)
  }
  output.push(source.slice(start)); return output.join('')
}

function extractKeyframeFinalStyles (source) {
  const keyframes = Object.create(null)
  const css = String(source || '')
  const output = []
  for (const rule of cssRules(css)) {
    const match = rule.prelude.match(/^@(?:-\w+-)?keyframes\s+([_a-zA-Z][\w-]*)\s*$/i)
    if (!match || rule.body == null) { output.push(css.slice(rule.start, rule.end)); continue }
    const body = rule.body
    let finalStyle = ''
    let finalPercent = -1
    for (const frame of cssRules(body)) {
      if (frame.body == null) continue
      splitCssTopLevel(frame.prelude, ',').forEach(item => {
        const token = item.trim().toLowerCase()
        const percent = token === 'to' ? 100 : /^(?:\d+(?:\.\d+)?)%$/.test(token) ? Number(token.slice(0, -1)) : -1
        if (percent >= finalPercent) {
          finalPercent = percent
          finalStyle = frame.body.trim()
        }
      })
    }
    if (finalPercent >= 0 && finalStyle) keyframes[match[1]] = finalStyle
  }
  return { css: output.join('\n'), keyframes }
}

function applyAnimationFinalStyles (source, keyframes) {
  const names = Object.keys(keyframes || {})
  if (!names.length) return String(source || '')
  source = String(source || '')
  return Array.from(cssRules(source), rule => {
    const all = source.slice(rule.start, rule.end), selector = rule.prelude, declarations = rule.body
    if (rule.atRule || declarations == null) return all
    const animations = splitCssTopLevel(declarations, ';').filter(item => /^animation(?:-[\w-]+)?\s*:/i.test(item)).join(';')
    if (!/\bforwards\b/i.test(animations)) return all
    const finalStyles = names
      .filter(name => new RegExp(`(?:^|[;:\\s,])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[;\\s,])`, 'i').test(animations))
      .map(name => keyframes[name])
    if (!finalStyles.length) return all
    const withoutAnimation = splitCssTopLevel(declarations, ';').filter(item => !/^animation(?:-[\w-]+)?\s*:/i.test(item)).join(';')
    return `${selector}{${withoutAnimation};${finalStyles.join(';')}}`
  }).join('\n')
}

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripTags (value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAttributes (source) {
  const attrs = Object.create(null)
  const body = String(source || '').replace(/^\s*[^\s/>]+/, '')
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match
  while ((match = matcher.exec(body))) {
    const value = match[2] != null
      ? match[2]
      : match[3] != null
        ? match[3]
        : match[4] != null ? match[4] : true
    attrs[match[1].toLowerCase()] = value === true ? true : decodeEntities(value, true)
  }
  return attrs
}

function getTagStatus (name) {
  if (RENDER_TAGS.has(name)) return 'rendered'
  if (FALLBACK_TAGS.has(name)) return 'fallback'
  if (METADATA_TAGS.has(name)) return 'metadata'
  if (BLOCKED_TAGS.has(name)) return 'removed'
  return 'fallback'
}

function analyzeHtml (input) {
  const html = String(input || '')
  const counts = Object.create(null)
  const tagMatcher = /<\s*(?![!?])\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g
  let match
  while ((match = tagMatcher.exec(html))) {
    const raw = match[0]
    if (/^<\s*\//.test(raw)) continue
    const name = match[1].toLowerCase()
    counts[name] = (counts[name] || 0) + 1
  }

  const tags = Object.keys(counts).sort().map(name => ({
    name,
    count: counts[name],
    status: getTagStatus(name)
  }))
  const summary = { rendered: 0, fallback: 0, metadata: 0, removed: 0 }
  tags.forEach(tag => { summary[tag.status] += 1 })

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)
  return {
    bytes: utf8Length(html),
    elementCount: tags.reduce((total, tag) => total + tag.count, 0),
    uniqueTagCount: tags.length,
    title: titleMatch ? stripTags(titleMatch[1]) : '',
    tags,
    summary,
    scriptCount: (html.match(/<script\b/gi) || []).length,
    styleCount: (html.match(/<style\b/gi) || []).length,
    eventAttributeCount: (html.match(/\son[a-z]+\s*=/gi) || []).length
  }
}

function utf8Length (value) {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

function safeUrl (value) {
  // URL parsers remove embedded ASCII tab/newline before recognizing a scheme.
  // Validate that same spelling after HTML entity decoding, not the obfuscation.
  const url = String(value || '').replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').trim()
  return /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(url) ? '' : url
}

function safeResourceUrl (value) {
  const url = safeUrl(value)
  if (!url) return ''
  if (/^(?:https?:)?\/\//i.test(url) || /^(?:blob|cloud):/i.test(url)) return ''
  if (/^data:/i.test(url) && !/^data:(?:image\/(?:png|jpe?g|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+);base64,/i.test(url)) return ''
  return url
}

function displayValue (attrs, fallback) {
  const value = attrs.value === true ? '' : attrs.value
  const placeholder = attrs.placeholder === true ? '' : attrs.placeholder
  return escapeHtml(value || placeholder || fallback || '')
}

function inputFallback (tag) {
  const attrs = parseAttributes(tag)
  const type = String(attrs.type || 'text').toLowerCase()
  if (type === 'hidden') return ''
  if (type === 'checkbox' || type === 'radio') {
    return `<span style="display:inline-block;margin:3px 2px;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">${attrs.checked ? '☑' : '☐'} ${displayValue(attrs, type === 'radio' ? '单选项' : '复选项')}</span>`
  }
  if (type === 'range') {
    return `<span style="display:inline-block;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">范围：${displayValue(attrs, '0')} / ${escapeHtml(attrs.max || '100')}</span>`
  }
  if (type === 'color') return `<span style="display:inline-block;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">色彩：${displayValue(attrs, '#000000')}</span>`
  if (type === 'file') return '<span style="display:inline-block;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">📎 文件选择（阅读模式不可操作）</span>'
  const labels = { date: '日期', time: '时间', number: '数字', email: '邮箱', password: '密码', search: '搜索' }
  return `<span style="display:inline-block;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">${escapeHtml(labels[type] || '输入框')}：${displayValue(attrs, '未填写')}</span>`
}

function progressFallback (tag, kind) {
  const attrs = parseAttributes(tag)
  const value = Number(attrs.value || 0)
  const max = Number(attrs.max || 100) || 100
  const percent = Math.max(0, Math.min(100, Math.round(value / max * 100)))
  return `<div style="margin:8px 0;padding:9px;border:1px solid #d0d5dd;border-radius:8px;background:#f8fafc"><span>${kind} ${escapeHtml(value)} / ${escapeHtml(max)}</span><span style="display:block;margin-top:6px;width:${percent}%;height:8px;background:#e85d3f;border-radius:8px"></span></div>`
}

function getCssVariables (source) {
  const variables = Object.create(null)
  String(source || '').replace(/:root\s*\{([^{}]*)\}/gi, (_, declarations) => {
    declarations.replace(/(--[\w-]+)\s*:\s*([^;}{]+)\s*;?/g, (all, name, value) => {
      variables[name] = value.trim()
      return all
    })
    return _
  })
  return variables
}

function resolveCssVariables (source, variables) {
  let output = String(source || '')
  for (let pass = 0; pass < 4; pass++) {
    output = output.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g, (all, name, fallback) =>
      variables[name] || (fallback ? fallback.trim() : 'inherit'))
  }
  return output
}

function findLargeFixedCanvasWidth (source) {
  let largest = 0
  String(source || '').replace(/(?:^|[;{])\s*width\s*:\s*(\d+(?:\.\d+)?)px\b/gi, (all, width) => {
    const value = Number(width)
    if (value > largest && value <= 2400) largest = value
    return all
  })
  return largest > 480 ? largest : 0
}

function scaleCssPixels (source, scale, canvasWidth) {
  let output = String(source || '').replace(/(-?\d+(?:\.\d+)?)px\b/g, (all, value) => {
    const scaled = Math.round(Number(value) * scale * 100) / 100
    return `${scaled}px`
  })
  const escapedWidth = String(canvasWidth).replace('.', '\\.')
  output = output.replace(new RegExp(`width\\s*:\\s*${escapedWidth}px`, 'gi'), `width:100%;max-width:${canvasWidth}px`)
  return output
}

function getFixedCanvasClasses (css) {
  const classes = new Set()
  String(css || '').replace(/([^{}]+)\{([^{}]*)\}/g, (all, selector, declarations) => {
    if (!findLargeFixedCanvasWidth(`{${declarations}}`)) return all
    selector.replace(/\.([_a-zA-Z][\w-]*)/g, (_, name) => {
      classes.add(name)
      return _
    })
    return all
  })
  return classes
}

function getCanvasDescendantClasses (html, fixedClasses) {
  const classes = new Set(fixedClasses)
  const stack = []
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  String(html || '').replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g, tag => {
    const closing = /^<\s*\//.test(tag)
    if (closing) {
      if (stack.length) stack.pop()
      return tag
    }
    const classMatch = tag.match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const ownClasses = (classMatch ? (classMatch[1] || classMatch[2] || '') : '').split(/\s+/).filter(Boolean)
    const inside = Boolean(stack[stack.length - 1]) || ownClasses.some(name => fixedClasses.has(name))
    if (inside) ownClasses.forEach(name => classes.add(name))
    const name = (tag.match(/^<\s*([\w:-]+)/) || [])[1]
    if (name && !voidTags.has(name.toLowerCase()) && !/\/\s*>$/.test(tag)) stack.push(inside)
    return tag
  })
  return classes
}

function scaleLayoutSpacing (declarations, scale) {
  return String(declarations || '').replace(/((?:^|;)\s*(?:margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:\s*)([^;}]*)/gi, (all, prefix, value) =>
    `${prefix}${String(value).replace(/(-?\d+(?:\.\d+)?)px\b/g, (match, pixels) => `${Math.round(Number(pixels) * scale * 100) / 100}px`)}`)
}

function scaleCanvasCss (css, scale, canvasWidth, canvasClasses) {
  return String(css || '').replace(/([^{}]+)\{([^{}]*)\}/g, (all, selector, declarations) => {
    const selectorClasses = []
    selector.replace(/\.([_a-zA-Z][\w-]*)/g, (_, name) => {
      selectorClasses.push(name)
      return _
    })
    const belongsToCanvas = selectorClasses.some(name => canvasClasses.has(name))
    const scaled = belongsToCanvas
      ? scaleCssPixels(declarations, scale, canvasWidth)
      : scaleLayoutSpacing(declarations, scale)
    return `${selector}{${scaled}}`
  })
}

function scaleCanvasInlineStyles (html, scale, canvasWidth, fixedClasses) {
  const stack = []
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  return String(html || '').replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g, tag => {
    if (/^<\s*\//.test(tag)) {
      if (stack.length) stack.pop()
      return tag
    }
    const classMatch = tag.match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const ownClasses = (classMatch ? (classMatch[1] || classMatch[2] || '') : '').split(/\s+/).filter(Boolean)
    const inside = Boolean(stack[stack.length - 1]) || ownClasses.some(name => fixedClasses.has(name))
    let output = tag
    if (inside) {
      output = output.replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i, (all, prefix, quote, style) =>
        `${prefix}${quote}${scaleCssPixels(style, scale, canvasWidth)}${quote}`)
    }
    const name = (tag.match(/^<\s*([\w:-]+)/) || [])[1]
    if (name && !voidTags.has(name.toLowerCase()) && !/\/\s*>$/.test(tag)) stack.push(inside)
    return output
  })
}

function adaptLargeFixedCanvas (html, css) {
  const inlineStyles = []
  String(html || '').replace(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (all, doubleQuoted, singleQuoted) => {
    inlineStyles.push(doubleQuoted != null ? doubleQuoted : singleQuoted)
    return all
  })
  const designWidth = findLargeFixedCanvasWidth(`${css}\n${inlineStyles.join('\n')}`)
  if (!designWidth) return { html, css, designWidth: 0, scale: 1 }

  const scale = MOBILE_CANVAS_WIDTH / designWidth
  const fixedClasses = getFixedCanvasClasses(css)
  const canvasClasses = getCanvasDescendantClasses(html, fixedClasses)
  const scaledCss = `${scaleCanvasCss(css, scale, MOBILE_CANVAS_WIDTH, canvasClasses)}\nbody{box-sizing:border-box;width:100%;max-width:100%;padding-left:0!important;padding-right:0!important;overflow-x:hidden}`
  const scaledHtml = scaleCanvasInlineStyles(html, scale, MOBILE_CANVAS_WIDTH, fixedClasses)
  return { html: scaledHtml, css: scaledCss, designWidth, scale }
}

function prepareCss (source) {
  let css = String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|charset)\b[^;]*;?/gi, '')
    .replace(/@font-face\s*\{[^{}]*\}/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:[^;}{]+;?/gi, '')
  const remSize = rootRemSize(css)
  css = convertCssUnits(stripCssResourceUrls(css), remSize)
  const extracted = extractKeyframeFinalStyles(css)
  css = applyAnimationFinalStyles(extracted.css, extracted.keyframes)
  const variables = getCssVariables(css)

  css = flattenResponsiveCss(css)
  css = css.replace(/:root\s*\{[^{}]*\}/gi, '')
  return resolveCssVariables(css, variables).trim()
}

function presentationAttributes (source) {
  const attrs = parseAttributes(`x ${source || ''}`)
  let output = ''
  if (attrs.class && attrs.class !== true) output += ` class="${escapeHtml(attrs.class)}"`
  if (attrs.id && attrs.id !== true) output += ` id="${escapeHtml(attrs.id)}"`
  if (attrs.style && attrs.style !== true) output += ` style="${escapeHtml(attrs.style)}"`
  return { attrs, output }
}

function firstSafeSrcsetUrl (source) {
  const value = String(source || '').trim()
  const data = value.match(/data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+/i)
  if (data) return safeResourceUrl(data[0])
  return value.split(',').map(item => item.trim().split(/\s+/)[0]).map(safeResourceUrl).find(Boolean) || ''
}

function removeDangerousAttributes (html, remSize = DEFAULT_REM_SIZE) {
  return String(html || '').replace(/<img\b[^>]*>/gi, tag => {
    if (/\ssrc\s*=/i.test(tag)) return tag
    const match = tag.match(/\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (!match) return tag
    const srcset = match[1] != null ? match[1] : match[2] != null ? match[2] : match[3]
    const source = firstSafeSrcsetUrl(srcset)
    return source ? tag.replace(/>$/, ` src="${escapeHtml(source)}">`) : tag
  })
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|poster|xlink:href|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (full, name, doubleQuoted, singleQuoted, bare) => {
      const value = doubleQuoted != null ? doubleQuoted : singleQuoted != null ? singleQuoted : bare
      const decoded = decodeEntities(value, true)
      const attribute = name.toLowerCase()
      const safe = attribute === 'href'
        ? safeUrl(decoded)
        : attribute === 'xlink:href' && decoded.trim()[0] === '#'
          ? decoded.trim()
          : attribute === 'formaction' ? '' : safeResourceUrl(decoded)
      if (!safe) return ''
      const quote = doubleQuoted != null ? '"' : singleQuoted != null ? "'" : '"'
      return ` ${name}=${quote}${value}${quote}`
    })
    .replace(/\s+style\s*=\s*("|')([\s\S]*?)\1/gi, (full, quote, css) => {
      const safe = convertCssUnits(stripCssResourceUrls(css), remSize)
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/behavior\s*:[^;]+;?/gi, '')
      return safe.trim() ? ` style=${quote}${safe}${quote}` : ''
    })
}

function transformHtml (input) {
  const source = String(input || '').replace(/^\uFEFF/, '')
  const analysis = analyzeHtml(source)
  const notes = []
  let html = source
  const styleBlocks = []

  html = html.replace(/<!--([\s\S]*?)-->/g, '')
  html = html.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (_, css) => {
    styleBlocks.push(css)
    return ''
  })
  html = html.replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, () => {
    notes.push('已移除网页 JavaScript；微信小程序不会执行任意脚本。')
    return ''
  })
  html = html.replace(/<(iframe|object|embed|applet|frame)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi, (_, name, attrs) => {
    const parsed = parseAttributes(`${name} ${attrs}`)
    const src = safeUrl(parsed.src || parsed.data || '')
    notes.push(`${name} 已转换为外部内容提示。`)
    return `<div class="hr-warning">外部 ${escapeHtml(name)} 内容未直接加载${src ? `：${escapeHtml(src)}` : ''}</div>`
  })
  html = html.replace(/<(iframe|object|embed|applet|frame)\b([^>]*)\/?\s*>/gi, (_, name, attrs) => {
    const parsed = parseAttributes(`${name} ${attrs}`)
    const src = safeUrl(parsed.src || parsed.data || '')
    notes.push(`${name} 已转换为外部内容提示。`)
    return `<div class="hr-warning">外部 ${escapeHtml(name)} 内容未直接加载${src ? `：${escapeHtml(src)}` : ''}</div>`
  })

  const body = html.match(/<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i)
  if (body) html = `<body${body[1]}>${body[2]}</body>`
  html = html.replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|meta|link|base|title)\b[^>]*>/gi, '')

  const cssSource = styleBlocks.join('\n')
  const remSize = rootRemSize(cssSource)
  html = removeDangerousAttributes(html, remSize)
  // mp-html's CSS plugin cannot match attribute selectors. Keep author-hidden
  // modals hidden even if interactive rendering fails, including hidden="false".
  html = html.replace(/<[a-z][^>]*>/gi, tag => {
    const attrs = parseAttributes(tag)
    if (!Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return tag
    if (/\sstyle\s*=/i.test(tag)) return tag.replace(/(\sstyle\s*=\s*)("|')([\s\S]*?)\2/i, (_, prefix, quote, style) => `${prefix}${quote}${style};display:none!important${quote}`)
    return tag.replace(/\s*\/?>$/, ending => ` style="display:none!important"${ending}`)
  })

  html = html.replace(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi, (_, attrs, content) => {
    const options = []
    content.replace(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi, (all, optionAttrs, label) => {
      const parsed = parseAttributes(`option ${optionAttrs}`)
      if (parsed.selected || !options.length) options.unshift(stripTags(label) || String(parsed.value || ''))
      else options.push(stripTags(label) || String(parsed.value || ''))
      return all
    })
    return `<span style="display:inline-block;padding:5px 9px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">选择框：${escapeHtml(options[0] || '无选项')}</span>`
  })
  html = html.replace(/<textarea\b[^>]*>([\s\S]*?)<\/textarea\s*>/gi, (_, content) =>
    `<div style="margin:6px 0;padding:8px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">多行输入：${escapeHtml(stripTags(content) || '未填写')}</div>`)
  html = html.replace(/<datalist\b[^>]*>([\s\S]*?)<\/datalist\s*>/gi, (_, content) => {
    const values = []
    content.replace(/<option\b([^>]*)>([\s\S]*?)(?:<\/option\s*>)?/gi, (all, attrs, label) => {
      const parsed = parseAttributes(`option ${attrs}`)
      values.push(String(parsed.value || stripTags(label)))
      return all
    })
    return `<div style="margin:6px 0;padding:8px;border:1px solid #d0d5dd;border-radius:7px;background:#f8fafc">建议选项：${escapeHtml(values.filter(Boolean).join('、') || '无')}</div>`
  })
  html = html.replace(/<input\b[^>]*\/?\s*>/gi, inputFallback)
  html = html.replace(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi, (_, attrsSource, content) => {
    const presentation = presentationAttributes(attrsSource)
    const classes = ['hr-origin-button']
    if (presentation.attrs.class && presentation.attrs.class !== true) classes.push(presentation.attrs.class)
    const id = presentation.attrs.id && presentation.attrs.id !== true ? ` id="${escapeHtml(presentation.attrs.id)}"` : ''
    const style = presentation.attrs.style && presentation.attrs.style !== true ? ` style="${escapeHtml(presentation.attrs.style)}"` : ''
    return `<span class="${escapeHtml(classes.join(' '))}"${id}${style}>${escapeHtml(stripTags(content) || '按钮')}</span>`
  })
  html = html.replace(/<canvas\b([^>]*)>([\s\S]*?)<\/canvas\s*>/gi, (_, attrs, content) => {
    const parsed = parseAttributes(`canvas ${attrs}`)
    return `<div style="margin:10px 0;padding:18px;border:1px dashed #98a2b3;border-radius:9px;text-align:center;color:#667085;background:#f8fafc">🖼 Canvas ${escapeHtml(parsed.width || '?')} × ${escapeHtml(parsed.height || '?')}<br>${escapeHtml(stripTags(content) || '画布绘图在阅读模式中以占位信息显示')}</div>`
  })
  html = html.replace(/<progress\b[^>]*>[\s\S]*?<\/progress\s*>/gi, tag => progressFallback(tag, '进度'))
  html = html.replace(/<meter\b[^>]*>[\s\S]*?<\/meter\s*>/gi, tag => progressFallback(tag, '测量值'))
  html = html.replace(/<dialog\b[^>]*>/gi, '<div style="margin:10px 0;padding:14px;border:1px solid #f0b8a9;border-radius:9px;background:#fff3e8"><strong>对话框内容</strong>')
    .replace(/<\/dialog\s*>/gi, '</div>')
    .replace(/<details\b[^>]*>/gi, '<div style="margin:8px 0;padding:10px;border:1px solid #d0d5dd;border-radius:8px">')
    .replace(/<\/details\s*>/gi, '</div>')
    .replace(/<summary\b[^>]*>/gi, '<strong>▾ ')
    .replace(/<\/summary\s*>/gi, '</strong>')
    .replace(/<form\b[^>]*>/gi, '<div style="margin:10px 0;padding:12px;border:1px solid #e4e7ec;border-radius:9px">')
    .replace(/<\/form\s*>/gi, '</div>')
    .replace(/<fieldset\b[^>]*>/gi, '<div style="margin:8px 0;padding:10px;border:1px solid #d0d5dd;border-radius:8px">')
    .replace(/<\/fieldset\s*>/gi, '</div>')
    .replace(/<legend\b[^>]*>/gi, '<strong>')
    .replace(/<\/legend\s*>/gi, '</strong>')
    .replace(/<template\b[^>]*>/gi, '<div style="margin:8px 0;padding:10px;border:1px dashed #98a2b3;border-radius:8px;color:#667085">模板内容：')
    .replace(/<\/template\s*>/gi, '</div>')
    .replace(/<option\b[^>]*>/gi, '<span>')
    .replace(/<\/option\s*>/gi, '</span>')

  const cssVariables = getCssVariables(cssSource)
  html = resolveCssVariables(html, cssVariables)
  const adapted = adaptLargeFixedCanvas(html, prepareCss(cssSource))
  html = adapted.html
  const css = adapted.css
  if (css) {
    html = `<style>${css}</style>${html}`
    notes.push('已保留并适配网页 CSS；浏览器专属效果可能自动降级。')
  }
  if (adapted.designWidth) notes.push(`已将 ${adapted.designWidth}px 固定宽度画布按手机屏幕等比缩放。`)

  return {
    html: html.trim(),
    analysis,
    notes: Array.from(new Set(notes))
  }
}

module.exports = {
  analyzeHtml,
  getTagStatus,
  transformHtml,
  _internals: { adaptLargeFixedCanvas, applyAnimationFinalStyles, convertCssUnits, extractKeyframeFinalStyles, findClosingBrace, findLargeFixedCanvasWidth, flattenResponsiveCss, getCanvasDescendantClasses, getCssVariables, getFixedCanvasClasses, mediaQueryMatches, parseAttributes, prepareCss, presentationAttributes, removeDangerousAttributes, resolveCssVariables, rootRemSize, safeResourceUrl, safeUrl, scaleCanvasCss, scaleCanvasInlineStyles, scaleCssPixels, scaleLayoutSpacing, stripCssResourceUrls, stripTags }
}
