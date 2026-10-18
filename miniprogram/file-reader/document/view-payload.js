'use strict'

const { splitTopLevel } = require('./html-runtime/html-dom-shim')

const VIEW_ATTRS = new Set([
  'src', 'type', 'value', 'placeholder', 'disabled', 'maxlength', 'checked',
  'min', 'max', 'step'
])
const VIEW_FIELDS = [
  'inputType', 'options', 'selectedIndex', 'displayText', 'percent',
  'canvasBoxStyle', 'canvasSizerStyle', 'canvasStyle', 'svgFallbackSrc', 'svgCanvasSource', 'svgHasSmil', 'tapNid', 'imageMode', 'mediaToken',
  'tableScroll', 'tableScrollStyle'
]
const NON_VISUAL_PROPERTIES = /^(?:animation(?:-.+)?|transition(?:-.+)?|cursor|caret-color|user-select|touch-action|scroll-behavior|scrollbar-.+|-webkit-(?:font-smoothing|tap-highlight-color|text-size-adjust|user-select)|-moz-osx-font-smoothing)$/
const DEFAULT_DOM_CHUNK_BYTES = 160 * 1024
const TEXT_FRAGMENT_BYTES = 8 * 1024

function textFragments (text) {
  if (payloadBytes(text) <= TEXT_FRAGMENT_BYTES) return null
  const fragments = []
  let start = 0, offset = 0, bytes = 2
  // Count escaped JSON bytes, not UTF-16 length. for-of keeps surrogate pairs
  // together; rendering fragments inside one text container retains shaping.
  for (const char of text) {
    const code = char.codePointAt(0)
    const nextBytes = char === '"' || char === '\\' ? 2
      : code < 32 ? ('\b\f\n\r\t'.includes(char) ? 2 : 6)
        : code >= 0xd800 && code <= 0xdfff ? 6
          : code < 128 ? 1 : code < 2048 ? 2 : code <= 65535 ? 3 : 4
    if (bytes + nextBytes > TEXT_FRAGMENT_BYTES && offset > start) {
      fragments.push(text.slice(start, offset)); start = offset; bytes = 2
    }
    offset += char.length; bytes += nextBytes
  }
  if (offset > start) fragments.push(text.slice(start))
  return fragments.map((text, index) => ({ index, text }))
}

function responsiveWidthDeclarations (property, value) {
  const match = String(value || '').trim().match(/^min\(([\s\S]+)\)$/i)
  if (!match || property !== 'width') return null
  const parts = splitTopLevel(match[1], ',').map(part => part.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  const fluid = parts.find(part => /%/.test(part))
  const fixed = parts.find(part => /^-?\d+(?:\.\d+)?px$/i.test(part))
  if (!fluid || !fixed) return null
  return [['width', fluid], ['max-width', fixed]]
}

function compactStyle (style) {
  const declarations = []
  splitTopLevel(String(style || ''), ';').forEach(item => {
    const colon = item.indexOf(':')
    if (colon < 1) return
    const property = item.slice(0, colon).trim().toLowerCase()
    const value = item.slice(colon + 1).trim()
    if (!property || !value || NON_VISUAL_PROPERTIES.test(property)) return
    const responsive = responsiveWidthDeclarations(property, value)
    if (responsive) declarations.push(...responsive)
    else declarations.push([property, value])
  })
  const byProperty = new Map()
  declarations.forEach(([property, value]) => byProperty.set(property, value))
  // 部分真机 WebView 对 WXML 内联样式里的 calc(100% - Npx) + auto margin
  // 组合处理不一致，会让居中卡片铺到屏幕边缘，左右边框随即被宿主裁掉。
  // 在手机宽度下把等价的居中留白展开成明确左右外边距，避免只剩上下边框。
  const width = byProperty.get('width') || ''
  const margin = byProperty.get('margin') || ''
  const gutter = width.match(/^calc\(100%\s*-\s*(\d+(?:\.\d+)?)px\)$/i)
  if (gutter && /\bauto\b/i.test(margin)) {
    const side = Number(gutter[1]) / 2
    byProperty.set('width', 'auto')
    byProperty.set('margin-left', `${side}px`)
    byProperty.set('margin-right', `${side}px`)
  }
  return Array.from(byProperty, ([property, value]) => `${property}:${value}`).join(';')
}

function compactDomTreeForView (nodes, textCache) {
  const styles = ['']
  const styleIds = new Map([['', 0]])
  const usedText = new Set()

  function styleIdFor (style) {
    const compacted = compactStyle(style)
    if (styleIds.has(compacted)) return styleIds.get(compacted)
    const id = styles.length
    styles.push(compacted)
    styleIds.set(compacted, id)
    return id
  }

  function compactNode (node) {
    if (!node || node.type === 'text') {
      const output = { type: 'text', text: String(node && node.text || ''), nid: node && node.nid }
      usedText.add(output.nid)
      const cached = textCache && textCache.get(output.nid)
      const fragments = cached && cached.text === output.text ? cached.fragments : textFragments(output.text)
      if (fragments) { delete output.text; output.textFragments = fragments }
      if (textCache) {
        if (fragments) textCache.set(output.nid, { text: String(node && node.text || ''), fragments })
        else textCache.delete(output.nid)
      }
      if (node && node.tapNid != null) output.tapNid = node.tapNid
      return output
    }
    const output = { type: 'element', name: node.name, nid: node.nid, attrs: {} }
    const attrs = node.attrs || {}
    Object.keys(attrs).forEach(name => {
      if (VIEW_ATTRS.has(name) && attrs[name] !== undefined) output.attrs[name] = attrs[name]
    })
    const styleId = styleIdFor(attrs.style)
    if (styleId) output.styleId = styleId
    if (node.touch) output.touch = true
    VIEW_FIELDS.forEach(field => {
      if (node[field] !== undefined && node[field] !== false && node[field] !== '') output[field] = node[field]
    })
    output.children = (node.children || []).map(compactNode)
    return output
  }

  const compacted = (nodes || []).map(compactNode)
  if (textCache) for (const nid of textCache.keys()) if (!usedText.has(nid)) textCache.delete(nid)
  return { nodes: compacted, styles }
}

const { payloadBytes } = require('./kernel').textCodec

function domNodeShell (node) {
  if (node && node.type === 'text' && node.textFragments) return { ...node, textFragments: [] }
  if (!node || node.type === 'text') return node
  return { ...node, children: [] }
}

function buildProgressiveDomPlan (nodes, maxChunkBytes = DEFAULT_DOM_CHUNK_BYTES, initialBudget = maxChunkBytes) {
  const limit = Math.max(16 * 1024, Number(maxChunkBytes) || DEFAULT_DOM_CHUNK_BYTES)
  const source = Array.isArray(nodes) ? nodes : []
  let initial = source.map(domNodeShell)
  const chunks = []
  // Root shells already exist in the initial update. Their independent child
  // paths can share a byte-bounded patch instead of one bridge round-trip per
  // paragraph. Keep explicit flushes at parent/descendant dependencies below.
  let patch = {}
  let patchBytes = 2

  function flushPatch () {
    if (Object.keys(patch).length) chunks.push(patch)
    patch = {}
    patchBytes = 2
  }

  function planChildren (children, parentPath) {
    ;(children || []).forEach((child, index) => {
      const path = `${parentPath}.children[${index}]`
      const childBytes = payloadBytes(child) + payloadBytes(path) + 4
      if (childBytes <= limit) {
        if (patchBytes + childBytes > limit) {
          flushPatch()
        }
        patch[path] = child
        patchBytes += childBytes
        return
      }

      // 父节点必须先上屏，后续 setData 才能安全写入其 children 路径；因此
      // 大子树的壳和它的后代永远分属不同批次，避免微信对同批深路径的
      // 应用顺序在不同基础库中出现差异。
      flushPatch()
      chunks.push({ [path]: domNodeShell(child) })
      if (child.textFragments) planFragments(child.textFragments, path)
      else planChildren(child.children, path)
    })
  }

  function planFragments (fragments, parentPath) {
    fragments.forEach((fragment, index) => {
      const path = `${parentPath}.textFragments[${index}]`, bytes = payloadBytes(fragment) + payloadBytes(path) + 4
      if (patchBytes + bytes > limit) flushPatch()
      patch[path] = fragment; patchBytes += bytes
    })
  }

  if (payloadBytes(initial) > Math.max(0, initialBudget)) {
    const shells = initial; initial = []
    shells.forEach((shell, index) => {
      const path = `domTree[${index}]`, bytes = payloadBytes(shell) + payloadBytes(path) + 4
      if (patchBytes + bytes > limit) flushPatch()
      patch[path] = shell; patchBytes += bytes
    })
    flushPatch()
  }

  source.forEach((node, index) => {
    if (node && node.textFragments) planFragments(node.textFragments, `domTree[${index}]`)
    else if (node && node.type !== 'text') planChildren(node.children, `domTree[${index}]`)
  })
  flushPatch()

  return {
    initial,
    chunks,
    totalBytes: payloadBytes(source),
    maxChunkBytes: Math.max(payloadBytes(initial), ...chunks.map(payloadBytes), 0)
  }
}

// Subsequent updates need the same transport bound as initial loading. Replace
// large arrays/objects with a shell before filling their independent paths;
// never put an ancestor and its descendants in one platform update.
function buildDomPatchPlan (updates, maxChunkBytes = DEFAULT_DOM_CHUNK_BYTES) {
  const limit = Math.max(16 * 1024, Number(maxChunkBytes) || DEFAULT_DOM_CHUNK_BYTES)
  const chunks = [], oversizedFields = []
  let patch = {}, bytes = 2
  function flush () { if (Object.keys(patch).length) chunks.push(patch); patch = {}; bytes = 2 }
  function append (path, value) {
    const size = payloadBytes(value) + payloadBytes(path) + 4
    if (size <= limit || !value || typeof value !== 'object') {
      if (bytes + size > limit) flush()
      // Non-text scalar fields retain their previous behavior. Record these
      // independently; splitting text cannot make a huge input value safe.
      if (size > limit) oversizedFields.push(path)
      patch[path] = value; bytes += size; return
    }
    flush(); chunks.push({ [path]: Array.isArray(value) ? [] : {} })
    for (const [key, item] of Object.entries(value)) append(Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, item)
    flush()
  }
  for (const [path, value] of Object.entries(updates)) append(path, value)
  flush()
  return { initial: {}, chunks, oversizedFields, maxChunkBytes: Math.max(0, ...chunks.map(payloadBytes)) }
}

module.exports = {
  DEFAULT_DOM_CHUNK_BYTES,
  TEXT_FRAGMENT_BYTES,
  buildDomPatchPlan,
  buildProgressiveDomPlan,
  compactDomTreeForView,
  compactStyle,
  payloadBytes,
  responsiveWidthDeclarations
}
