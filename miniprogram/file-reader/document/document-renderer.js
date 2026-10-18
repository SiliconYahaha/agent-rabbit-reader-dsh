'use strict'

const { resolveLength } = require('./css-length')
const { disabledControl } = require('./html-runtime/form-disabled-state')
const { _internals: cssCompat } = require('./html-compat')
const { preprocessCss, parseTextContent, consumeCssEscape } = require('./css-escapes')
const { cssRules, trimCssWhitespace, stripCssComments, mapCssCode } = require('./css-structure')
const { parseDeclaration } = require('./css-identifiers')
const { computeCustomProperties, resolveVariables } = require('./css-variables')
const { canvasStateForElement, hasClickListeners, hasInteractiveListeners, matchSelector, parseHtmlDocument, splitTopLevel } = require('./html-runtime/html-dom-shim')
const { atobSafe, utf8Decode } = require('./html-runtime/html-script-runtime')

const DOM_UA_CSS = `
html,body,article,aside,blockquote,details,dialog,div,dl,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,main,nav,ol,p,pre,section,table,ul{display:block}
a,abbr,b,code,del,em,i,ins,kbd,label,mark,q,ruby,s,samp,small,span,strike,strong,sub,sup,time,u{display:inline}
button,input,select,textarea{display:inline-block;font:inherit;text-align:left;vertical-align:middle}input,textarea{padding:1px 2px;border:2px inset;background:#fff;color:#000}
body{margin:0;color:#000;background:#fff;font-size:16px;line-height:normal}
h1{font-size:2em;margin:.67em 0;font-weight:bold}h2{font-size:1.5em;margin:.83em 0;font-weight:bold}h3{font-size:1.17em;margin:1em 0;font-weight:bold}h4{margin:1.33em 0;font-weight:bold}h5{font-size:.83em;margin:1.67em 0;font-weight:bold}h6{font-size:.67em;margin:2.33em 0;font-weight:bold}
p{margin:1em 0}pre{display:block;font-family:monospace;white-space:pre-wrap;margin:1em 0}blockquote{margin:1em 40px}hr{border:0;border-top:1px solid #808080;margin:.5em auto}
ol,ul{margin:1em 0;padding-left:40px}li{display:list-item}ol{list-style-type:decimal}ul{list-style-type:disc}
table{display:table;border-collapse:separate;border-spacing:2px}thead{display:table-header-group}tbody{display:table-row-group}tfoot{display:table-footer-group}tr{display:table-row}td,th{display:table-cell;padding:1px}th{font-weight:bold;text-align:center}
a{color:#0000ee;text-decoration:underline}address,em,i{font-style:italic}abbr[title]{text-decoration:underline dotted}mark{background:#ffff00;color:#000}strong,b{font-weight:bold}big{font-size:1.2em}small,sub,sup{font-size:.8333em}sub{vertical-align:sub}sup{vertical-align:super}ol ol,ol ul,ul ol,ul ul{margin-top:0;margin-bottom:0}
button{padding:2px 6px;border:2px outset buttonface;background:buttonface;color:buttontext;text-align:center}fieldset{margin:0 2px;padding:.35em .75em .625em;border:2px groove}legend{padding:0 2px}
details:not([open]) > :not(summary){display:none}summary{display:block;cursor:pointer}dialog:not([open]){display:none}dialog[open]{display:block;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:1em;border:solid;background:#fff}
[hidden],noscript{display:none!important}template{display:none}img,svg,video,canvas{max-width:100%}
`

const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'foreignobject'])
const RESOURCE_ATTRS = new Set(['src', 'poster'])
const ABSOLUTE_UNIT_FACTORS = { mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 }
const SVG_TAG_CASE = {
  altglyph: 'altGlyph', animatemotion: 'animateMotion', animatetransform: 'animateTransform', clippath: 'clipPath',
  fecolormatrix: 'feColorMatrix', fecomponenttransfer: 'feComponentTransfer', fecomposite: 'feComposite',
  fedisplacementmap: 'feDisplacementMap', fedistantlight: 'feDistantLight', fedropshadow: 'feDropShadow', feflood: 'feFlood',
  fefunca: 'feFuncA', fefuncb: 'feFuncB', fefuncg: 'feFuncG', fefuncr: 'feFuncR', fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage', femerge: 'feMerge', femergenode: 'feMergeNode', femorphology: 'feMorphology', feoffset: 'feOffset',
  fepointlight: 'fePointLight', fespecularlighting: 'feSpecularLighting', fespotlight: 'feSpotLight', fetile: 'feTile',
  feturbulence: 'feTurbulence', lineargradient: 'linearGradient', radialgradient: 'radialGradient', textpath: 'textPath'
}
const SVG_ATTRIBUTE_CASE = {
  attributename: 'attributeName', attributetype: 'attributeType', basefrequency: 'baseFrequency', baseprofile: 'baseProfile',
  calcmode: 'calcMode', clippathunits: 'clipPathUnits', contentscripttype: 'contentScriptType', contentstyletype: 'contentStyleType',
  diffuseconstant: 'diffuseConstant', edgemode: 'edgeMode', filterunits: 'filterUnits', glyphref: 'glyphRef', gradienttransform: 'gradientTransform',
  gradientunits: 'gradientUnits', kernelmatrix: 'kernelMatrix', kernelunitlength: 'kernelUnitLength', keypoints: 'keyPoints',
  keysplines: 'keySplines', keytimes: 'keyTimes', lengthadjust: 'lengthAdjust', limitingconeangle: 'limitingConeAngle',
  markerheight: 'markerHeight', markerunits: 'markerUnits', markerwidth: 'markerWidth', maskcontentunits: 'maskContentUnits',
  maskunits: 'maskUnits', numoctaves: 'numOctaves', pathlength: 'pathLength', patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform', patternunits: 'patternUnits', pointsatx: 'pointsAtX', pointsaty: 'pointsAtY', pointsatz: 'pointsAtZ',
  preservealpha: 'preserveAlpha', preserveaspectratio: 'preserveAspectRatio', primitiveunits: 'primitiveUnits', refx: 'refX', refy: 'refY',
  repeatcount: 'repeatCount', repeatdur: 'repeatDur', requiredextensions: 'requiredExtensions', requiredfeatures: 'requiredFeatures',
  specularconstant: 'specularConstant', specularexponent: 'specularExponent', spreadmethod: 'spreadMethod', startoffset: 'startOffset',
  stddeviation: 'stdDeviation', stitchtiles: 'stitchTiles', surfacescale: 'surfaceScale', systemlanguage: 'systemLanguage',
  tablevalues: 'tableValues', targetx: 'targetX', targety: 'targetY', textlength: 'textLength', viewbox: 'viewBox',
  viewtarget: 'viewTarget', xchannelselector: 'xChannelSelector', ychannelselector: 'yChannelSelector', zoomandpan: 'zoomAndPan'
}
const SVG_REACT_ATTRIBUTE_CASE = {
  fontfamily: 'font-family', fontsize: 'font-size', fontweight: 'font-weight', letterspacing: 'letter-spacing',
  stopcolor: 'stop-color', strokedasharray: 'stroke-dasharray', strokewidth: 'stroke-width', textanchor: 'text-anchor'
}
const SVG_SMIL_TAGS = new Set(['animate', 'animatemotion', 'animatetransform', 'set'])
const INLINE_DISPLAY_VALUES = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents'])
const PRESERVED_WHITE_SPACE_VALUES = new Set(['pre', 'pre-wrap', 'break-spaces'])

// Some AI-exported HTML files contain private-use citation transport markers such as
// `\uE200filecite\uE202turn0file0\uE202L1-L2\uE201`. Browsers display these as tofu boxes,
// even though they are not part of the article. Keep the source DOM intact for scripts,
// but remove this specific non-content token from the visible reading layer.
function sanitizeVisibleText (value) {
  return String(value == null ? '' : value)
    .replace(/\uE200filecite\uE202[^\uE201]*\uE201/g, '')
    .replace(/(?:\[object Object\]\s*,?\s*){2,}(?=(?:条|件|张|个|项|份|次|人))/g, match => `${(match.match(/\[object Object\]/g) || []).length} `)
}

function normalizeVisibleText (value, whiteSpace = 'normal') {
  // HTML parsing already normalizes source CR/CRLF. A CR introduced through a
  // character reference or script is a CSS space, not a forced line break.
  let source = sanitizeVisibleText(value)
  const mode = String(whiteSpace || 'normal').trim().toLowerCase()
  if (PRESERVED_WHITE_SPACE_VALUES.has(mode)) return source
  source = source.replace(/\r/g, ' ')
  if (mode === 'pre-line') return source.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n')
  // CSS document whitespace is not JavaScript \s: NBSP, ideographic spaces,
  // thin spaces and other Unicode separators are actual content.
  return source.replace(/[ \t\n]+/g, ' ')
}

function collapsibleTextOnly (text, whiteSpace, parentDisplay) {
  if (/^(?:inline-)?(?:flex|grid)$/.test(parentDisplay || '')) return /^[ \t\r\n]*$/.test(text)
  const mode = String(whiteSpace || 'normal').trim().toLowerCase()
  if (PRESERVED_WHITE_SPACE_VALUES.has(mode)) return false
  return (mode === 'pre-line' ? /^[ \t\r]*$/ : /^[ \t\r\n]*$/).test(text)
}

function parseCssColor (value) {
  const source = String(value || '').trim().toLowerCase()
  const named = { black: '#000000', white: '#ffffff', transparent: '#00000000' }
  const normalized = named[source] || source
  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let raw = hex[1]
    if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(char => char + char).join('')
    if (raw.length !== 6 && raw.length !== 8) return null
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
      a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
    }
  }
  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)(%)?[,\s]+([\d.]+)(%)?[,\s]+([\d.]+)(%)?(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i)
  if (!rgb) return null
  // Multiplying 50 by 2.55 yields 127.49999999999999, incorrectly rounding
  // a standard 50% channel down to 127 during CSSOM serialization.
  const channel = (item, percentage) => Math.max(0, Math.min(255, percentage ? Number(item) / 100 * 255 : Number(item)))
  const alpha = rgb[7] == null ? 1 : Math.max(0, Math.min(1, Number(rgb[7]) * (rgb[8] ? 0.01 : 1)))
  return { r: channel(rgb[1], rgb[2]), g: channel(rgb[3], rgb[4]), b: channel(rgb[5], rgb[6]), a: alpha }
}

function compositeColor (foreground, background) {
  if (!foreground) return null
  if (!background || foreground.a >= 1) return { ...foreground, a: 1 }
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (!alpha) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  }
}

function relativeLuminance (color) {
  const linear = channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

function contrastRatio (foreground, background) {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (light + 0.05) / (dark + 0.05)
}

function colorToHex (color) {
  const channel = value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

function readableForeground (foreground, background, minimumRatio) {
  const composited = compositeColor(foreground, background)
  if (!composited || !background || contrastRatio(composited, background) >= minimumRatio) return null
  const target = relativeLuminance(background) < 0.45 ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }
  let low = 0
  let high = 1
  for (let index = 0; index < 12; index++) {
    const amount = (low + high) / 2
    const candidate = {
      r: composited.r + (target.r - composited.r) * amount,
      g: composited.g + (target.g - composited.g) * amount,
      b: composited.b + (target.b - composited.b) * amount,
      a: 1
    }
    if (contrastRatio(candidate, background) >= minimumRatio) high = amount
    else low = amount
  }
  return colorToHex({
    r: composited.r + (target.r - composited.r) * high,
    g: composited.g + (target.g - composited.g) * high,
    b: composited.b + (target.b - composited.b) * high
  })
}

function pixelLength (value, fallback = 0) {
  const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
  return match ? Number(match[1]) : fallback
}

function boxSideLengths (styles, property) {
  let shorthand = String(styles[property] || '').trim()
  if (!shorthand && property === 'border-width') {
    const borderWidth = String(styles.border || '').trim().match(/(?:^|\s)(-?\d+(?:\.\d+)?px)(?:\s|$)/i)
    shorthand = borderWidth ? borderWidth[1] : ''
  }
  const tokens = shorthand.split(/\s+/).filter(Boolean)
  const values = tokens.map(token => pixelLength(token, 0))
  let top = 0; let right = 0; let bottom = 0; let left = 0
  if (values.length === 1) top = right = bottom = left = values[0]
  else if (values.length === 2) { top = bottom = values[0]; right = left = values[1] }
  else if (values.length === 3) { top = values[0]; right = left = values[1]; bottom = values[2] }
  else if (values.length >= 4) [top, right, bottom, left] = values
  top = pixelLength(styles[`${property}-top`], top)
  right = pixelLength(styles[`${property}-right`], right)
  bottom = pixelLength(styles[`${property}-bottom`], bottom)
  left = pixelLength(styles[`${property}-left`], left)
  return { top, right, bottom, left }
}

function normalizedControlStyles (styles, inherited = {}) {
  const output = { ...styles }
  const fontSize = Math.max(12, pixelLength(output['font-size'], pixelLength(inherited.fontSize, 16)))
  const rawLineHeight = String(output['line-height'] || inherited.lineHeight || '').trim()
  const lineHeight = /^\d+(?:\.\d+)?$/.test(rawLineHeight)
    ? Number(rawLineHeight) * fontSize
    : Math.max(fontSize * 1.35, pixelLength(rawLineHeight, 0))
  const padding = boxSideLengths(output, 'padding')
  const border = boxSideLengths(output, 'border-width')
  const explicitHeight = pixelLength(output.height, 0)
  const explicitMinHeight = pixelLength(output['min-height'], 0)
  const naturalHeight = Math.ceil(lineHeight + padding.top + padding.bottom + border.top + border.bottom)
  const height = Math.max(36, explicitHeight, explicitMinHeight, naturalHeight)
  const contentHeight = Math.max(fontSize, height - border.top - border.bottom)
  output.height = `${Math.round(height * 1000) / 1000}px`
  output['min-height'] = output.height
  output['line-height'] = `${Math.round(contentHeight * 1000) / 1000}px`
  output['padding-top'] = '0'
  output['padding-bottom'] = '0'
  output['box-sizing'] = 'border-box'
  return output
}

function backgroundColorForStyles (styles, inheritedBackground) {
  // Images and gradients do not have one known background color. Never
  // recolor their text using an ancestor's unrelated solid surface.
  if (/(?:gradient|url|image-set)\s*\(/i.test([styles.background, styles['background-image']].join(' '))) return null
  let explicit = null
  for (const name of Object.keys(styles)) if (name === 'background' || name === 'background-color') {
    const color = parseCssColor(styles[name])
    if (color) explicit = color
  }
  return explicit ? (explicit.a < 1 && !inheritedBackground ? null : compositeColor(explicit, inheritedBackground)) : inheritedBackground
}

function minimumTextContrast (styles) {
  const fontSize = pixelLength(styles['font-size'], 16)
  const fontWeight = Number.parseInt(styles['font-weight'], 10) || (/bold/i.test(styles['font-weight'] || '') ? 700 : 400)
  return fontSize >= 24 || fontSize >= 18.66 && fontWeight >= 700 ? 3 : 4.5
}

function readableComputedStyles (styles, context, element) {
  const output = { ...styles }
  const background = backgroundColorForStyles(output, context.effectiveBackground)
  const foregroundSource = output.color || context.effectiveForeground
  const foreground = parseCssColor(foregroundSource)
  // Dark themes may leave fixed light cards behind. Repair near-invisible light
  // text there too, without recoloring normal brand colors on light pages.
  const darkSurface = background && relativeLuminance(background) < 0.25
  const invisibleLightText = foreground && background && relativeLuminance(background) > 0.7 && relativeLuminance(foreground) > 0.7 && contrastRatio(compositeColor(foreground, background), background) < 1.5
  if (foreground && background && (darkSurface || invisibleLightText) && element.textContent.trim()) {
    const replacement = readableForeground(foreground, background, minimumTextContrast(output))
    if (replacement) output.color = replacement
  }
  return {
    styles: output,
    effectiveBackground: background,
    effectiveForeground: output.color || foregroundSource || context.effectiveForeground
  }
}

function cascadeForRender (element, context) {
  if (context.cascadeCache.has(element)) return context.cascadeCache.get(element)
  const cascade = cascadeForElement(element, context.rules, context.variables, context.remSize)
  context.cascadeCache.set(element, cascade)
  return cascade
}

function inlineFormattingDisplay (display) {
  return INLINE_DISPLAY_VALUES.has(String(display || 'inline').trim().toLowerCase())
}

function siblingCreatesInlineBox (node, context) {
  if (!node) return false
  if (node.nodeType === 3) return !collapsibleTextOnly(normalizeVisibleText(node.data, context.whiteSpace), context.whiteSpace)
  if (node.nodeType !== 1) return false
  return inlineFormattingDisplay(cascadeForRender(node, context).styles.display)
}

function omitCollapsibleWhitespace (element, index, context, parentDisplay) {
  if (/^(?:inline-)?(?:flex|grid)$/.test(parentDisplay || '')) return true
  if (inlineFormattingDisplay(parentDisplay)) return false
  const siblings = element.childNodes
  let previous = null
  let next = null
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (siblings[cursor].nodeType === 1 || siblings[cursor].nodeType === 3 && !collapsibleTextOnly(siblings[cursor].data, context.whiteSpace)) { previous = siblings[cursor]; break }
  }
  for (let cursor = index + 1; cursor < siblings.length; cursor++) {
    if (siblings[cursor].nodeType === 1 || siblings[cursor].nodeType === 3 && !collapsibleTextOnly(siblings[cursor].data, context.whiteSpace)) { next = siblings[cursor]; break }
  }
  if (!previous || !next) return true
  return !siblingCreatesInlineBox(previous, context) || !siblingCreatesInlineBox(next, context)
}

function splitStyleDeclarations (source, remSize = 16, options = {}) {
  const output = []
  splitTopLevel(String(source || ''), ';').forEach((item, order) => {
    const declaration = parseDeclaration(item)
    if (!declaration) return
    const property = declaration.property
    let value = declaration.value
    let unsafe = false, hasBrace = false
    mapCssCode(`${property}:${value}`, part => {
      if (/(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|@import)/i.test(part)) unsafe = true
      if (/[{}]/.test(part)) hasBrace = true
      return part
    })
    if (!property || !value && !property.startsWith('--') || unsafe || hasBrace && !property.startsWith('--')) return
    value = cssCompat.stripCssResourceUrls(value)
    if (!options.preserveUnits) value = cssCompat.convertCssUnits(value, remSize)
    const important = /\s*!important\s*$/i.test(value)
    value = value.replace(/\s*!important\s*$/i, '').trim()
    if (!value && !property.startsWith('--')) return
    output.push({ property, value, important, order })
  })
  return output
}

function selectorSpecificity (selector) {
  // Escaped punctuation is part of a name, not a new class/id/combinator.
  let masked = ''
  const source = preprocessCss(selector)
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { masked += 'x'; i = consumeCssEscape(source, i).end - 1 }
    else masked += source.charCodeAt(i) >= 0x80 ? 'x' : source[i]
  }
  const withoutNot = masked.replace(/:not\(([^()]*)\)/g, '$1')
  const ids = (withoutNot.match(/#[\w-]+/g) || []).length
  const classes = (withoutNot.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length
  const tags = (withoutNot.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) || []).length
  return ids * 10000 + classes * 100 + tags
}

function validRenderSelector (selector) {
  const value = String(selector || '').trim()
  if (!value) return false
  const pseudos = Array.from(value.matchAll(/(^|[^\\]):{1,2}([\w-]+)/g), match => match[2].toLowerCase())
  return pseudos.every(name => ['before', 'after', 'root', 'empty', 'first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-of-type', 'nth-last-of-type', 'not', 'checked', 'disabled', 'enabled', 'required', 'optional', 'read-only', 'read-write'].includes(name))
}

function prepareRendererCss (source, viewportWidth, mediaEnvironment = {}, preserveUnits = false) {
  let css = stripCssComments(preprocessCss(source))
  css = Array.from(cssRules(css), rule => /^@(?:import|charset|font-face)\b/i.test(rule.prelude) ? '' : css.slice(rule.start, rule.end)).join('\n')
  const remSize = cssCompat.rootRemSize(css)
  css = cssCompat.stripCssResourceUrls(css)
  if (!preserveUnits) {
    css = cssCompat.convertCssUnits(css, remSize)
    css = mapCssCode(css, part => part.replace(/(-?\d*\.?\d+)(?:d|s|l)?vh\b/gi, (_, n) => `${Number(n) * (Number(mediaEnvironment.viewportHeight) || 667) / 100}px`))
  }
  const extracted = cssCompat.extractKeyframeFinalStyles(css)
  return cssCompat.flattenResponsiveCss(cssCompat.applyAnimationFinalStyles(extracted.css, extracted.keyframes), viewportWidth, mediaEnvironment)
}

function stripPseudoElement (selector) {
  const match = String(selector).match(/::?(before|after)\s*$/i)
  if (!match) return { selector: trimCssWhitespace(selector), pseudo: '' }
  let base = selector.slice(0, match.index)
  // `div ::before` means `div *::before`, not `div::before`. Do not mistake
  // whitespace consumed by a name escape for a descendant combinator.
  const trimmed = trimCssWhitespace(base)
  if (!trimmed || !base.endsWith(trimmed) || /[>+~]$/.test(trimmed) && !/\\[>+~]$/.test(trimmed)) base += '*'
  return { selector: trimCssWhitespace(base), pseudo: match[1].toLowerCase() }
}

function parseCssRules (source, options = {}) {
  const ua = Boolean(options.ua)
  const remSize = Number(options.remSize || 16)
  const prepared = options.prepared ? String(source || '') : prepareRendererCss(source, options.viewportWidth, options, options.preserveUnits)
  const rules = []
  let order = Number(options.orderStart || 0)
  for (const rule of cssRules(prepared)) {
    if (rule.atRule || rule.body == null) continue
    const declarations = splitStyleDeclarations(rule.body, remSize, options)
    if (!declarations.length) continue
    splitTopLevel(rule.prelude, ',').forEach(raw => {
      const normalized = raw.replace(/:root\b/gi, 'html')
      const info = stripPseudoElement(normalized)
      if (!validRenderSelector(normalized) || !info.selector) return
      rules.push({ selector: info.selector, pseudo: info.pseudo, declarations, specificity: selectorSpecificity(stripPseudoElement(raw).selector), ua, order: order++ })
    })
  }
  return rules
}

function cascadeForElement (element, rules, inheritedVariables = {}, remSize = 16, options = {}) {
  const declarations = Object.create(null)
  const variableDeclarations = Object.create(null)
  const localVariables = Object.create(null)
  const expand = options.expandDeclaration || (declaration => [declaration])
  const matched = rules.filter(rule => rule.pseudo === (options.pseudo || '') && matchSelector(element, rule.selector))
  const inline = options.pseudo ? [] : splitStyleDeclarations(element.getAttribute('style') || '', remSize, options).flatMap(expand)
  matched.forEach(rule => rule.declarations.flatMap(expand).forEach((declaration, declarationOrder) => {
    const candidate = { ...declaration, origin: rule.ua ? 0 : 2, specificity: rule.specificity, order: rule.order, declarationOrder }
    if (declaration.property.startsWith('--')) {
      if (wins(candidate, variableDeclarations[declaration.property])) variableDeclarations[declaration.property] = candidate
    }
    else if (wins(candidate, declarations[declaration.property])) declarations[declaration.property] = candidate
  }))
  ;(options.pseudo ? [] : presentationalDeclarations(element).flatMap(expand)).forEach((declaration, index) => {
    const candidate = { ...declaration, origin: 1, specificity: 0, order: 500000 + index }
    if (wins(candidate, declarations[declaration.property])) declarations[declaration.property] = candidate
  })
  inline.forEach((declaration, index) => {
    const candidate = { ...declaration, origin: 3, specificity: 1000000, order: 1000000 + index }
    if (declaration.property.startsWith('--')) {
      if (wins(candidate, variableDeclarations[declaration.property])) variableDeclarations[declaration.property] = candidate
    }
    else if (wins(candidate, declarations[declaration.property])) declarations[declaration.property] = candidate
  })
  Object.keys(variableDeclarations).forEach(property => { localVariables[property] = variableDeclarations[property].value })
  const variables = computeCustomProperties(localVariables, inheritedVariables)
  const styles = Object.create(null)
  // The output is one inline declaration block. Object insertion order is not
  // cascade order: replacing a winner does not move its key, and a weaker
  // shorthand could reset a stronger longhand. Emit weak-to-strong so the native
  // CSS engine resolves overlapping properties with the original precedence.
  orderedDeclarationNames(declarations).forEach(property => {
    const value = resolveVariables(declarations[property].value, variables)
    if (value) styles[property] = value
  })
  return { styles, variables }
}

function wins (candidate, current) {
  return !current || compareDeclarations(candidate, current) >= 0
}

function compareDeclarations (a, b) {
  return Number(Boolean(a.important)) - Number(Boolean(b.important)) ||
    (a.origin || 0) - (b.origin || 0) ||
    a.specificity - b.specificity || a.order - b.order ||
    (a.declarationOrder || 0) - (b.declarationOrder || 0)
}

function orderedDeclarationNames (declarations) {
  return Object.keys(declarations).sort((a, b) => compareDeclarations(declarations[a], declarations[b]))
}

function presentationalDeclarations (element) {
  const declarations = []
  const add = (property, value) => { if (value != null && String(value).trim()) declarations.push({ property, value: String(value).trim(), important: false }) }
  const attr = name => element.getAttribute(name)
  const tag = element.localName
  const direction = String(attr('dir') || '').trim().toLowerCase()
  if (direction === 'ltr' || direction === 'rtl') add('direction', direction)
  if (/^(?:body|table|thead|tbody|tfoot|tr|td|th)$/.test(tag)) add('background-color', attr('bgcolor'))
  if (tag === 'body') add('color', attr('text'))
  if (/^(?:table|td|th|img)$/.test(tag)) add('width', normalizeDimension(attr('width')))
  if (/^(?:img|video|canvas)$/.test(tag)) add('height', normalizeDimension(attr('height')))
  if (/^(?:table|td|th)$/.test(tag)) { add('text-align', attr('align')); add('vertical-align', attr('valign')) }
  if (tag === 'center') add('text-align', 'center')
  if (tag === 'font') {
    add('color', attr('color')); add('font-family', attr('face'))
    const sizes = { '1': '10px', '2': '13px', '3': '16px', '4': '18px', '5': '24px', '6': '32px', '7': '48px' }
    add('font-size', sizes[attr('size')])
  }
  if (tag === 'img') {
    add('border-width', normalizeDimension(attr('border'))); if (attr('border')) add('border-style', 'solid')
    add('margin-left', normalizeDimension(attr('hspace'))); add('margin-right', normalizeDimension(attr('hspace')))
    add('margin-top', normalizeDimension(attr('vspace'))); add('margin-bottom', normalizeDimension(attr('vspace')))
    add('vertical-align', attr('align'))
  }
  if (tag === 'hr') { add('height', normalizeDimension(attr('size'))); add('width', normalizeDimension(attr('width'))); add('background-color', attr('color')) }
  if (tag === 'table') {
    const border = normalizeDimension(attr('border')); add('border-width', border); if (border) add('border-style', 'solid')
    add('border-spacing', normalizeDimension(attr('cellspacing')))
  }
  if (/^(?:td|th)$/.test(tag)) {
    const table = element.closest('table')
    if (table) {
      add('padding', normalizeDimension(table.getAttribute('cellpadding')))
      const border = normalizeDimension(table.getAttribute('border')); add('border-width', border); if (border) add('border-style', 'inset')
    }
  }
  return declarations
}

function normalizeDimension (value) {
  if (value == null || value === '') return ''
  const text = String(value).trim()
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}px` : /^\d+(?:\.\d+)?(?:px|%)$/i.test(text) ? text : ''
}

function pseudoNode (element, pseudo, rules, variables) {
  const matched = rules.filter(rule => rule.pseudo === pseudo && matchSelector(element, rule.selector))
  if (!matched.length) return null
  const declarations = Object.create(null)
  matched.forEach(rule => rule.declarations.forEach((declaration, declarationOrder) => {
    const candidate = { ...declaration, origin: rule.ua ? 0 : 2, specificity: rule.specificity, order: rule.order, declarationOrder }
    if (wins(candidate, declarations[declaration.property])) declarations[declaration.property] = candidate
  }))
  const contentDeclaration = declarations.content
  if (!contentDeclaration) return null
  const raw = resolveVariables(contentDeclaration.value, variables)
  const explicitlyEmpty = /^(?:""|'')$/.test(contentDeclaration.value.trim())
  if ((!raw && !explicitlyEmpty) || /^(?:none|normal)$/i.test(raw)) return null
  const content = parseTextContent(raw, name => element.getAttribute(name))
  if (content == null) return null
  // Pseudo-elements default to inline. The native host for this synthetic span
  // is a view, so omitting display incorrectly puts generated text on its own line.
  const style = 'display:inline;' + orderedDeclarationNames(declarations).filter(name => name !== 'content').map(name => `${name}:${resolveVariables(declarations[name].value, variables)}`).filter(value => !value.endsWith(':')).join(';')
  return { type: 'element', name: 'span', nid: `${element._nid}-${pseudo}`, attrs: { class: `hr-pseudo-${pseudo}`, style }, children: [{ type: 'text', text: content, nid: `${element._nid}-${pseudo}-text` }] }
}

function sanitizeAttributes (element, context) {
  const output = Object.create(null)
  element.attributes.forEach(attribute => {
    const name = attribute.name
    const lower = name.toLowerCase()
    // XML ID and id are distinct. Uppercase HTML attributes must not become
    // real id/class/src attributes when emitted into a case-insensitive host.
    if (element.ownerDocument._xmlMode && element.namespaceURI === 'http://www.w3.org/1999/xhtml' && name !== lower) return
    if (/^on/.test(lower) || lower === 'srcset' || lower === 'formaction') return
    if (RESOURCE_ATTRS.has(lower)) {
      const safe = element.localName === 'img' && lower === 'src'
        ? sanitizeEmbeddedSvgDataUri(attribute.value, context) || cssCompat.safeResourceUrl(attribute.value)
        : cssCompat.safeResourceUrl(attribute.value)
      if (safe) output[name] = safe
      return
    }
    if (lower === 'href' || lower === 'xlink:href') {
      const safe = lower === 'xlink:href' && attribute.value.trim()[0] === '#' ? attribute.value.trim() : cssCompat.safeUrl(attribute.value)
      if (safe) output[name] = safe
      return
    }
    if (lower !== 'style') output[name] = attribute.value
  })
  if (element.localName === 'img' && !output.src) {
    const srcset = element.getAttribute('srcset') || ''
    const data = srcset.match(/data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+/i)
    const candidate = data ? cssCompat.safeResourceUrl(data[0]) : srcset.split(',').map(item => item.trim().split(/\s+/)[0]).map(cssCompat.safeResourceUrl).find(Boolean)
    if (candidate) output.src = candidate
  }
  output['data-hr-nid'] = String(element._nid)
  return output
}

function escapeXmlText (value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlAttribute (value) {
  return escapeXmlText(value).replace(/"/g, '&quot;')
}

function sanitizeSvgCssValue (value) {
  const source = String(value || '')
  if (/(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|@import)/i.test(source)) return ''
  return source.replace(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_, double, single, bare) => {
    const target = String(double != null ? double : single != null ? single : bare || '').trim()
    return /^#[-\w:.]+$/.test(target) ? `url(${target})` : 'none'
  })
}

function svgAttributeName (name) {
  const lower = String(name || '').toLowerCase()
  return SVG_REACT_ATTRIBUTE_CASE[lower] || SVG_ATTRIBUTE_CASE[lower] || (lower === 'xlink:href' ? 'xlink:href' : name)
}

function sanitizeSvgAttributes (element, computedStyles) {
  const attrs = Object.create(null)
  element.attributes.forEach(attribute => {
    const lower = attribute.name.toLowerCase()
    if (/^on/.test(lower) || lower === 'srcset' || lower === 'formaction' || lower === 'xmlns') return
    if (lower === 'href' || lower === 'xlink:href') {
      const value = String(attribute.value || '').trim()
      if (/^#[-\w:.]+$/.test(value) || /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) attrs[svgAttributeName(attribute.name)] = value
      return
    }
    if (lower === 'style') return
    const value = /^(?:fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end)$/i.test(lower)
      ? sanitizeSvgCssValue(attribute.value)
      : String(attribute.value)
    if (value) attrs[svgAttributeName(attribute.name)] = value
  })
  const style = Object.keys(computedStyles || {}).map(property => {
    const value = sanitizeSvgCssValue(computedStyles[property])
    return value ? `${property}:${value}` : ''
  }).filter(Boolean).join(';')
  if (style) attrs.style = style
  return attrs
}

function serializeSvgElement (element, context, stripSmil = false) {
  if (!element || element.nodeType !== 1 || BLOCKED_TAGS.has(element.localName) || stripSmil && SVG_SMIL_TAGS.has(element.localName)) return ''
  const cascade = cascadeForElement(element, context.authorRules, context.variables, context.remSize)
  const tag = SVG_TAG_CASE[element.localName] || element.localName
  const svgStyles = { ...cascade.styles }
  // A serialized SVG is a new image document: preserve currentColor inherited
  // from the HTML button/card instead of silently reverting to black.
  if (tag === 'svg' && !svgStyles.color && context.effectiveForeground) svgStyles.color = context.effectiveForeground
  const attrs = sanitizeSvgAttributes(element, svgStyles)
  if (tag === 'svg') attrs.xmlns = 'http://www.w3.org/2000/svg'
  const attrText = Object.keys(attrs).map(name => ` ${name}="${escapeXmlAttribute(attrs[name])}"`).join('')
  const children = element.childNodes.map(child => {
    if (child.nodeType === 3) return escapeXmlText(child.data)
    if (child.nodeType === 1) return serializeSvgElement(child, { ...context, variables: cascade.variables }, stripSmil)
    return ''
  }).join('')
  return `<${tag}${attrText}>${children}</${tag}>`
}

function serializeSharedSvgDefs (svg, context, stripSmil) {
  const ownIds = new Set(svg.querySelectorAll('[id]').map(element => element.id).filter(Boolean))
  return (context.sharedDefNodes || []).filter(node => {
    const id = node.id
    return id && !ownIds.has(id) && !svg.contains(node)
  }).map(node => serializeSvgElement(node, context, stripSmil)).join('')
}

function encodeSvgDataUri (element, context, stripSmil = false) {
  let source = serializeSvgElement(element, context, stripSmil)
  const sharedDefs = serializeSharedSvgDefs(element, context, stripSmil)
  if (sharedDefs) source = source.replace(/(<svg\b[^>]*>)/i, `$1<defs>${sharedDefs}</defs>`)
  return `data:image/svg+xml,${encodeURIComponent(source)}`
}

const embeddedSvgCache = new Map()

function sanitizeEmbeddedSvgDataUri (uri, context = {}, animated = false) {
  const source = String(uri || '')
  if (!/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(source)) return ''
  const cacheKey=(animated?'animated:':'static:')+source
  if (embeddedSvgCache.has(cacheKey)) return embeddedSvgCache.get(cacheKey)
  try {
    const comma = source.indexOf(',')
    const encoded = source.slice(comma + 1)
    const raw = /;base64$/i.test(source.slice(0, comma))
      ? utf8Decode(Uint8Array.from(atobSafe(encoded), char => char.charCodeAt(0)))
      : decodeURIComponent(encoded)
    const parsed = parseHtmlDocument(raw)
    const svg = parsed.document.querySelector('svg')
    if (!svg) return ''
    const viewportWidth = Number(context.viewportWidth || 390)
    const prepared = prepareRendererCss(parsed.styles.join('\n'), viewportWidth, context)
    const remSize = cssCompat.rootRemSize(prepared)
    const authorRules = parseCssRules(prepared, { prepared: true, remSize, viewportWidth })
    let safe = encodeSvgDataUri(svg, {
      ...context,
      authorRules,
      rules: authorRules,
      variables: {},
      remSize,
      sharedDefNodes: collectSharedDefNodes(parsed.document)
    }, !animated)
    if(animated) {
      const text=decodeSvgDataUri(safe)
      safe=/(?:<(?:animate|animateTransform|animateMotion|set)\b|animation(?:-name)?\s*:)/i.test(text)
        ? text.replace(/(<svg\b[^>]*>)/i,(_,open)=>open+'<style>'+parsed.styles.join('\n').replace(/</g,'\\3c ')+'</style>') : ''
      if(safe.length>=32000)safe=''
    }
    if (embeddedSvgCache.size >= 128) embeddedSvgCache.clear()
    embeddedSvgCache.set(cacheKey, safe)
    return safe
  } catch (_) {
    return ''
  }
}

function decodeSvgDataUri (uri) {
  const source = String(uri || '')
  if (!source.startsWith('data:image/svg+xml,')) throw new Error('文件中没有可预览的 SVG 图形')
  return decodeURIComponent(source.slice('data:image/svg+xml,'.length))
}

function sanitizeStandaloneSvg (source, options = {}) {
  const rendered = renderHtmlDomTree(String(source || ''), options)
  const queue = rendered.nodes.slice()
  while (queue.length) {
    const node = queue.shift()
    if (node && node.name === 'img' && /^data:image\/svg\+xml,/.test(node.attrs && node.attrs.src || '')) {
      return {
        source: decodeSvgDataUri(node.attrs.src),
        fallbackSource: decodeSvgDataUri(node.svgFallbackSrc || node.attrs.src),
        hasSmil: Boolean(node.svgHasSmil)
      }
    }
    if (node && node.children) queue.push(...node.children)
  }
  throw new Error('文件中没有可预览的 SVG 图形')
}

function renderElement (element, context) {
  if (BLOCKED_TAGS.has(element.localName)) return null
  const cascade = cascadeForRender(element, context)
  const readable = readableComputedStyles(cascade.styles, context, element)
  let computedStyles = readable.styles
  const queryWidth = context.containerWidth || element.ownerDocument._viewportWidth
  const queryHeight = context.containerHeight || element.ownerDocument._viewportHeight
  for (const key of Object.keys(computedStyles)) if (/cq(?:[whib]|min|max)\b/i.test(computedStyles[key])) computedStyles[key] = mapCssCode(computedStyles[key], part => part.replace(/(-?\d*\.?\d+)cq(w|h|i|b|min|max)\b/gi, (_, n, axis) => `${Number(n) * ({w:queryWidth,i:queryWidth,h:queryHeight,b:queryHeight,min:Math.min(queryWidth,queryHeight),max:Math.max(queryWidth,queryHeight)}[axis.toLowerCase()]) / 100}px`))
  let containerWidth = context.containerWidth, containerHeight = context.containerHeight
  if (/inline-size|size/.test(computedStyles['container-type'] || computedStyles.container || '')) {
    const w=element.ownerDocument._viewportWidth,h=element.ownerDocument._viewportHeight
    const units={vw:w/100,vh:h/100,dvw:w/100,dvh:h/100,'%':queryWidth/100,em:16,rem:context.remSize}
    containerWidth = resolveLength(computedStyles.width, units) || queryWidth
    containerHeight = resolveLength(computedStyles.height, {...units,'%':queryHeight/100}) || queryHeight
  }
  const attrs = sanitizeAttributes(element, context)
  // Only the host presentation receives the inherited flag; the author DOM
  // keeps its own attributes and reflected .disabled value.
  if (disabledControl(element)) attrs.disabled = ''
  // A table has its own horizontal viewport; its width must not shrink the
  // whole document. The same applies to fixed-width content inside its cells.
  ;(context.withinTable || element.localName === 'table' ? [] : [cascade.styles.width, cascade.styles['min-width']]).forEach(value => {
    if (/^-?\d+(?:\.\d+)?px\s*$/.test(value || '')) context.maxWidth = Math.max(context.maxWidth, parseFloat(value))
  })
  if (element.localName === 'svg') {
    const svgHasSmil = Boolean(element.querySelector('animate,animateTransform,animateMotion,set'))
    for (const dimension of ['width', 'height']) {
      const value = element.getAttribute(dimension)
      if (!computedStyles[dimension] && /^\d+(?:\.\d+)?(?:px|%|em|rem)?$/.test(value || '')) computedStyles[dimension] = /^\d+(?:\.\d+)?$/.test(value) ? value + 'px' : value
    }
    const style = Object.keys(computedStyles).map(property => `${property}:${computedStyles[property]}`).join(';')
    const svgUri = encodeSvgDataUri(element, context)
    let svgCanvasSource = ''
    const source = decodeSvgDataUri(svgUri)
    if (svgHasSmil || /animation(?:-name)?\s*:/i.test(source)) {
      const animated = source.replace(/(<svg\b[^>]*>)/i, (_, open) => open + '<style>' + (context.authorCss || '').replace(/</g, '\\3c ') + '</style>')
      if (animated.length < 32000) svgCanvasSource = animated
    }
    return { type: 'element', name: 'img', nid: element._nid, touch: true, svgCanvasSource, attrs: { ...attrs, ...(style ? { style } : {}), src: svgUri, mode: 'widthFix' }, svgFallbackSrc: svgHasSmil ? encodeSvgDataUri(element, context, true) : svgUri, svgHasSmil, imageMode: computedStyles.height && computedStyles.height !== 'auto' ? 'aspectFit' : 'widthFix', children: [] }
  }
  const hostName = element.ownerDocument._xmlMode && element.namespaceURI === 'http://www.w3.org/1999/xhtml' && element.localName !== element.localName.toLowerCase() ? 'span' : element.localName
  const node = { type: 'element', name: hostName, nid: element._nid, attrs, children: [] }
  if (hostName === 'img') {
    const source=element.getAttribute('src')||''
    if(/^data:image\/svg\+xml[;,]/i.test(source))node.svgCanvasSource=sanitizeEmbeddedSvgDataUri(source,context,true)
    const fixedHeight = computedStyles.height && !/^(auto|initial|unset)$/.test(computedStyles.height)
    node.imageMode = fixedHeight ? ({ cover: 'aspectFill', contain: 'aspectFit' }[computedStyles['object-fit']] || 'scaleToFill') : 'widthFix'
  }
  node.touch = hasInteractiveListeners(element)
  // selectable 文本在部分微信真机上使用独立选择层，点击按钮文字时不会稳定
  // 冒泡到外层 view。记录 click 作用域后，WXML 会把交互区文字的 tap 明确
  // 回传给它的直接父节点，同时普通正文仍可选择复制。
  const clickScope = Boolean(context.clickScope || hasClickListeners(element) || /^(?:a|button|label|summary)$/.test(element.localName))
  if (element.localName === 'input') {
    const type = element.type.toLowerCase()
    node.attrs.value = element.value
    node.attrs.checked = element.checked
    if (type === 'checkbox' || type === 'radio' || type === 'range') node.name = type === 'range' ? 'slider' : type
    else if (type === 'date' || type === 'time') node.name = `picker-${type}`
    else node.inputType = /^(?:number|digit|idcard|nickname)$/.test(type) ? type : 'text'
    if (!/^(?:checkbox|radio|range|file|color|button|submit|reset|image|hidden)$/.test(type)) computedStyles = normalizedControlStyles(computedStyles, context)
  } else if (element.localName === 'textarea') node.attrs.value = element.value
  else if (element.localName === 'select') {
    computedStyles = normalizedControlStyles(computedStyles, context)
    node.options = element.options.map(option => ({ label: option.textContent, value: option.getAttribute('value') == null ? option.textContent : option.getAttribute('value') }))
    const selectedIndex = element.selectedIndex
    node.selectedIndex = Math.max(0, selectedIndex)
    node.displayText = node.options[selectedIndex] ? node.options[selectedIndex].label : ''
  } else if (element.localName === 'progress' || element.localName === 'meter') {
    const value = Number(element.getAttribute('value') || 0)
    const maximum = Number(element.getAttribute('max') || 1)
    node.name = 'progress'
    node.percent = maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0
  } else if (element.localName === 'canvas') {
    node.canvas = canvasStateForElement(element)
    const ratio = element.width > 0 ? element.height / element.width * 100 : 50
    const width = cascade.styles.width || `${element.width}px`
    const maxWidth = cascade.styles['max-width'] || '100%'
    const margins = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'].filter(name => cascade.styles[name]).map(name => `${name}:${cascade.styles[name]}`).join(';')
    const paint = ['background', 'background-color', 'border', 'border-radius', 'box-shadow', 'opacity'].filter(name => cascade.styles[name]).map(name => `${name}:${cascade.styles[name]}`).join(';')
    const positioning = ['position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index', 'transform', 'transform-origin', 'pointer-events', 'display', 'visibility'].filter(name => computedStyles[name]).map(name => `${name}:${computedStyles[name]}`).join(';')
    const authoredHeight = cascade.styles.height
    const sized = authoredHeight && authoredHeight !== 'auto' && !/^\d+(?:\.\d+)?px$/.test(authoredHeight) || ['absolute', 'fixed'].includes(computedStyles.position)
    node.canvasBoxStyle = `position:relative;box-sizing:border-box;width:${width};max-width:${maxWidth};overflow:hidden;${margins};${positioning}${sized && authoredHeight ? ';height:' + authoredHeight : ''}`
    // Percentage padding resolves against the containing block. Put it inside
    // the width-constrained wrapper so a 240px square stays square on a 390px page.
    node.canvasSizerStyle = sized && authoredHeight ? 'position:relative;height:100%' : `position:relative;height:0;padding-top:${Math.round(ratio * 1000) / 1000}%`
    node.canvasStyle = `position:absolute;left:0;top:0;width:100%;height:100%;${paint}`
  }
  const style = Object.keys(computedStyles).map(property => `${property}:${computedStyles[property]}`).join(';')
  if (style) attrs.style = style
  const before = pseudoNode(element, 'before', context.rules, cascade.variables)
  if (before) node.children.push(before)
  // 浏览器不会为 flex/grid 容器中的纯空白文本生成匿名布局项；WXML 的 <text>
  // 会成为真实子节点并占用 grid 单元格，因此必须在这里对齐浏览器语义。
  const parentDisplay = computedStyles.display || ''
  const whiteSpace = computedStyles['white-space'] || context.whiteSpace || 'normal'
  const childContext = {
    ...context,
    withinTable: context.withinTable || element.localName === 'table',
    variables: cascade.variables,
    containerWidth, containerHeight,
    effectiveBackground: readable.effectiveBackground,
    effectiveForeground: computedStyles.color || readable.effectiveForeground,
    whiteSpace,
    fontSize: computedStyles['font-size'] || context.fontSize,
    lineHeight: computedStyles['line-height'] || context.lineHeight
  }
  element.childNodes.forEach((child, index) => {
    if (child.nodeType === 3) {
      const text = normalizeVisibleText(child.data, whiteSpace)
      const collapsibleWhitespace = collapsibleTextOnly(text, whiteSpace, parentDisplay)
      if (text && !(collapsibleWhitespace && omitCollapsibleWhitespace(element, index, childContext, parentDisplay))) {
        const textNode = { type: 'text', text, nid: child._nid }
        if (clickScope) textNode.tapNid = element._nid
        node.children.push(textNode)
      }
    }
    else if (child.nodeType === 1) {
      const rendered = renderElement(child, { ...childContext, clickScope })
      if (rendered) node.children.push(rendered)
    }
  })
  const after = pseudoNode(element, 'after', context.rules, cascade.variables)
  if (after) node.children.push(after)
  if (node.name === 'summary') {
    const open = Boolean(element.parentNode && element.parentNode.localName === 'details' && element.parentNode.hasAttribute('open'))
    node.children.unshift({ type: 'text', text: open ? '▾ ' : '▸ ', nid: `${element._nid}-marker`, tapNid: element._nid })
  }
  if (node.name === 'table') normalizeRenderedTable(node)
  if (/^(?:audio|video)$/.test(node.name)) {
    node.name = 'div'
    node.attrs.class = `${node.attrs.class || ''} hr-media-placeholder`.trim()
    node.children = element.localName === 'video' && node.attrs.poster
      ? [{ type: 'element', name: 'img', nid: `${element._nid}-poster`, attrs: { src: node.attrs.poster, mode: 'widthFix' }, children: [] }]
      : [{ type: 'text', text: `${element.localName === 'audio' ? '音频' : '视频'}内容（阅读器不连接网络播放）`, nid: `${element._nid}-media` }]
  }
  return node
}

function setStyleProperties (style, properties) {
  const names = new Set(Object.keys(properties))
  const kept = String(style || '').split(';').map(item => item.trim()).filter(Boolean).filter(item => !names.has(item.split(':')[0].trim().toLowerCase()))
  Object.keys(properties).forEach(name => {
    if (properties[name] !== '') kept.push(`${name}:${properties[name]}`)
  })
  return kept.join(';')
}

function normalizeRenderedTable (table) {
  const captions = []
  const rows = []
  function walk (node) {
    if (!node || !node.children) return
    if (node.name === 'caption') captions.push(node)
    if (node.name === 'tr') rows.push(node)
    else node.children.forEach(walk)
  }
  table.children.forEach(walk)
  if (!rows.length) return
  const occupied = []
  const placed = []
  let columnCount = 0
  rows.forEach((row, rowIndex) => {
    if (!occupied[rowIndex]) occupied[rowIndex] = []
    let column = 0
    ;(row.children || []).filter(cell => cell.name === 'td' || cell.name === 'th').forEach(cell => {
      while (occupied[rowIndex][column]) column++
      const colspan = Math.max(1, parseInt(cell.attrs && cell.attrs.colspan || 1, 10) || 1)
      const rowspan = Math.max(1, parseInt(cell.attrs && cell.attrs.rowspan || 1, 10) || 1)
      for (let r = rowIndex; r < rowIndex + rowspan; r++) {
        if (!occupied[r]) occupied[r] = []
        for (let c = column; c < column + colspan; c++) occupied[r][c] = true
      }
      placed.push({ cell, row: rowIndex, column, colspan, rowspan })
      column += colspan
      columnCount = Math.max(columnCount, column)
    })
  })
  if (!columnCount) return
  table.tableScroll = true
  const hidden = /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(table.attrs.style || '')
  if (hidden) table.tableScrollStyle = 'display:none'
  const rowOffset = captions.length ? 1 : 0
  captions.forEach((caption, index) => {
    caption.attrs.style = setStyleProperties(caption.attrs.style, { display: 'block', 'grid-column': `1 / span ${columnCount}`, 'grid-row': String(index + 1) })
  })
  placed.forEach(({ cell, row, column, colspan, rowspan }) => {
    cell.attrs.style = setStyleProperties(cell.attrs.style, {
      display: 'block',
      'grid-column': `${column + 1} / span ${colspan}`,
      'grid-row': `${row + 1 + rowOffset} / span ${rowspan}`,
      'overflow-wrap': 'normal',
      'word-break': 'normal',
      'min-width': '0'
    })
  })
  table.attrs.style = setStyleProperties(table.attrs.style, {
    display: hidden ? 'none' : 'grid',
    'grid-template-columns': `repeat(${columnCount},minmax(88px,1fr))`,
    'min-width': `${columnCount * 88}px`
  })
  table.children = [...captions, ...placed.map(item => item.cell)]
}

function collectSharedDefNodes (document) {
  return document.querySelectorAll('defs').flatMap(defs => defs.children)
}

const renderRuleCache = new WeakMap()
function renderHtmlDomTree (input, options = {}) {
  const viewportWidth = Number(options.viewportWidth || 375)
  const parsed = typeof input === 'string' ? parseHtmlDocument(input, { contentType: options.contentType, viewportWidth, viewportHeight: options.viewportHeight }) : { document: input.document || input, styles: input.styles || [] }
  const document = parsed.document
  const authorCss = options.styles ? options.styles.join('\n') : (parsed.styles || []).join('\n')
  const remSize = cssCompat.rootRemSize(authorCss)
  const ruleKey = JSON.stringify([authorCss, remSize, viewportWidth, options.viewportHeight || document._viewportHeight, options.colorScheme, options.reducedMotion])
  let cached = renderRuleCache.get(document)
  if (!cached || cached.key !== ruleKey) {
    const uaRules = parseCssRules(DOM_UA_CSS, { ua: true, prepared: true, remSize, viewportWidth })
    const authorRules = parseCssRules(authorCss, { ua: false, remSize, viewportWidth, viewportHeight: options.viewportHeight || document._viewportHeight, colorScheme: options.colorScheme, reducedMotion: options.reducedMotion, orderStart: uaRules.length })
    cached = { key: ruleKey, authorRules, rules: uaRules.concat(authorRules) }
    renderRuleCache.set(document, cached)
  }
  const { authorRules, rules } = cached
  const rootCascade = cascadeForElement(document.documentElement, rules, {}, remSize)
  const bodyCascade = cascadeForElement(document.body, rules, rootCascade.variables, remSize)
  const pageBackground = { r: 255, g: 255, b: 255, a: 1 }
  const rootBackground = backgroundColorForStyles(rootCascade.styles, pageBackground)
  const bodyReadable = readableComputedStyles(bodyCascade.styles, {
    effectiveBackground: rootBackground,
    effectiveForeground: rootCascade.styles.color || '#000000'
  }, document.body)
  const bodyStyles = bodyReadable.styles
  // The document lives below a file bar and above an optional queue. Give
  // authored percentage heights and fixed children their own viewport.
  const viewportHeight = Number(options.viewportHeight || document._viewportHeight || 667)
  if (bodyStyles.height === '100%' || /^(?:100(?:d|s|l)?vh|-webkit-fill-available)$/.test(bodyStyles.height || '')) bodyStyles.height = `${viewportHeight}px`
  if (bodyStyles.position === 'fixed') { bodyStyles.position = 'relative'; delete bodyStyles.inset; delete bodyStyles.top; delete bodyStyles.bottom }
  bodyStyles['min-height'] ||= `${viewportHeight}px`
  bodyStyles.position ||= 'relative'
  // A transform establishes the containing block for position:fixed descendants.
  bodyStyles.transform ||= 'translateZ(0)'
  const bodyWhiteSpace = bodyStyles['white-space'] || rootCascade.styles['white-space'] || 'normal'
  const context = {
    rules,
    authorRules,
    authorCss,
    variables: bodyCascade.variables,
    remSize,
    maxWidth: viewportWidth,
    sharedDefNodes: collectSharedDefNodes(document),
    cascadeCache: new WeakMap(),
    effectiveBackground: bodyReadable.effectiveBackground,
    effectiveForeground: bodyStyles.color || bodyReadable.effectiveForeground,
    whiteSpace: bodyWhiteSpace,
    fontSize: bodyStyles['font-size'] || rootCascade.styles['font-size'] || '16px',
    lineHeight: bodyStyles['line-height'] || rootCascade.styles['line-height'] || 'normal'
  }
  const nodes = []
  document.body.childNodes.forEach((child, index) => {
    if (child.nodeType === 3) {
      const text = normalizeVisibleText(child.data, bodyWhiteSpace)
      const collapsibleWhitespace = collapsibleTextOnly(text, bodyWhiteSpace, bodyStyles.display)
      if (text && !(collapsibleWhitespace && omitCollapsibleWhitespace(document.body, index, context, bodyStyles.display || 'block'))) nodes.push({ type: 'text', text, nid: child._nid })
    }
    else if (child.nodeType === 1) {
      const node = renderElement(child, context)
      if (node) nodes.push(node)
    }
  })
  const wrapperStyle = Object.keys(bodyStyles).map(property => `${property}:${bodyStyles[property]}`).join(';')
  return { nodes, wrapperStyle, contentWidth: Math.min(2400, Math.max(viewportWidth, context.maxWidth)), rules, document }
}

module.exports = {
  ABSOLUTE_UNIT_FACTORS,
  DOM_UA_CSS,
  cascadeForElement,
  parseCssColor,
  encodeSvgDataUri,
  parseCssRules,
  renderHtmlDomTree,
  sanitizeStandaloneSvg,
  resolveVariables,
  selectorSpecificity,
  splitStyleDeclarations,
  validRenderSelector
}
