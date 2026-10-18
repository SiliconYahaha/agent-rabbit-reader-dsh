'use strict'

const { actuallyDisabled, disabledClick, disabledControl, supportsDisabled } = require('./form-disabled-state')
const { decodeCharacterReferences: decodeEntities } = require('../html-character-references')
const { preprocessCss, consumeCssEscape, consumeCssName } = require('../css-escapes')
const { splitCssTopLevel } = require('../css-structure')
const { parseDeclaration, propertyKey, serializeIdentifier } = require('../css-identifiers')

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_TEXT_TAGS = new Set(['script', 'style'])
const RCDATA_TAGS = new Set(['textarea', 'title'])
const P_CLOSING_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'table', 'ul'
])
const IMPLICIT_CLOSE_ON_OPEN = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  tr: new Set(['tr']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  option: new Set(['option']),
  optgroup: new Set(['optgroup']),
  thead: new Set(['thead', 'tbody', 'tfoot']),
  tbody: new Set(['thead', 'tbody', 'tfoot']),
  tfoot: new Set(['thead', 'tbody', 'tfoot'])
}
// HTML in-body li/dt/dd recovery stops at a special element, except
// address/div/p. It must not close an item across a nested list/container.
const LIST_ITEM_BOUNDARIES = new Set(('applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp').split(' '))
const BUTTON_SCOPE_BOUNDARIES = new Set('applet caption html table td th marquee object select template button'.split(' '))
const TABLE_SCOPE_BOUNDARIES = new Set(['html', 'table', 'template'])
const TABLE_END_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])
let nextNodeId = 1
let nextCanvasResourceId = 1
const offscreenCanvasFactories = new WeakMap()
const runtimeImages = new WeakMap()
const imageDocuments = new WeakMap()
const real2dCanvases = new WeakMap()
const realWebGlCanvases = new WeakMap()
const canvasContextResetters = new WeakMap()
const nativeCanvasValues = new WeakMap()
const nativeCanvasBudgets = new WeakMap()
const nativeCanvasAllocations = new WeakMap()
const nativeCanvasDocuments = new WeakMap()
const imageDataBudgets = new WeakMap()
const canvasSnapshotDocuments = new WeakMap()
const pixelWorkObservers = new WeakMap()
function observePixelWork (document, callback) { pixelWorkObservers.set(document, callback) }

function canvasPixels (width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 0 && n <= 16384) || width * height > 16 * 1024 * 1024) throw new Error('Canvas 尺寸或像素超过安全上限')
  return width * height
}
function imageDataExtent (width, height) {
  const integer = value => {
    const n = Number(value)
    if (!Number.isFinite(n) || Math.trunc(n) < -2147483648 || Math.trunc(n) > 2147483647) throw new TypeError('ImageData 坐标或尺寸必须为有限整数')
    return Math.trunc(n)
  }
  const w = integer(width), h = integer(height)
  if (!w || !h) { const error = new Error('ImageData 宽高不能为零'); error.name = 'IndexSizeError'; throw error }
  return { width: Math.abs(w), height: Math.abs(h), w, h, integer, pixels: canvasPixels(Math.abs(w), Math.abs(h)) }
}
function reserveImageData (document, pixels) {
  const used = imageDataBudgets.get(document) || 0
  if (used + pixels > 32 * 1024 * 1024) throw new Error('Canvas 本次文件的累计像素读写缓冲超过安全上限')
  imageDataBudgets.set(document, used + pixels)
}
function disposeRuntimeCanvases (document) {
  const canvases = nativeCanvasDocuments.get(document)
  if (canvases) for (const canvas of canvases) { try { canvas.width = 0; canvas.height = 0 } catch (_) {} }
  nativeCanvasDocuments.delete(document); nativeCanvasBudgets.delete(document); imageDataBudgets.delete(document); canvasSnapshotDocuments.delete(document)
}

function reserveNativePixels (document, pixels) {
  const used = nativeCanvasBudgets.get(document) || 0
  if (!Number.isFinite(pixels) || used + pixels < 0 || used + pixels > (document._directCanvasFrames ? 64 : 32) * 1024 * 1024) throw new Error('Canvas 本次文件的累计像素超过安全上限')
  nativeCanvasBudgets.set(document, used + pixels)
}

function imageDocument (document) {
  if (!imageDocuments.has(document)) imageDocuments.set(document, { states: new Set(), loads: 0, pixels: 0, canvas: null })
  return imageDocuments.get(document)
}
function imageEncodingError () { const error = new Error('Image cannot be decoded'); error.name = 'EncodingError'; return error }
function cancelImage (element) {
  const state = runtimeImages.get(element), resources = imageDocument(element.ownerDocument)
  state.revision++
  clearTimeout(state.timeout)
  if (state.pendingImage) state.pendingImage.onload = state.pendingImage.onerror = null
  state.pendingImage = null
  resources.pixels -= state.pixels
  state.pixels = 0; state.image = null; state.status = 'empty'
  state.waiters.splice(0).forEach(({ reject }) => reject(imageEncodingError()))
}
function disposeRuntimeImages (document) {
  const resources = imageDocuments.get(document)
  if (!resources) return
  for (const element of resources.states) cancelImage(element)
  resources.states.clear(); resources.canvas = null
}
function loadRuntimeImage (element, source) {
  cancelImage(element)
  const state = runtimeImages.get(element), document = element.ownerDocument
  const resources = imageDocument(document), revision = state.revision
  state.status = source ? 'pending' : 'empty'
  const active = () => revision === state.revision && !document._runtimeDisposed
  const finish = (image, error) => {
    if (!active() || state.status === 'loaded' || state.status === 'failed') return
    clearTimeout(state.timeout)
    if (state.pendingImage) state.pendingImage.onload = state.pendingImage.onerror = null
    state.pendingImage = null
    if (image) {
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height
      const pixels = width * height
      if (!(width > 0 && height > 0) || !Number.isFinite(pixels) || pixels > 16 * 1024 * 1024 || resources.pixels + pixels > 32 * 1024 * 1024) error = imageEncodingError()
      else { state.image = image; state.pixels = pixels; resources.pixels += pixels }
    }
    state.status = error ? 'failed' : 'loaded'
    state.waiters.splice(0).forEach(({ resolve, reject }) => error ? reject(imageEncodingError()) : resolve())
    element._markDirty()
    try { if (resources.loads <= 129) element.dispatchEvent(new ShimEvent(error ? 'error' : 'load', { bubbles: false })) } catch (cause) {
      if (resources.onError) resources.onError(cause)
    }
  }
  // Queue host decoding, so callers can set onload after src, including markup
  // and innerHTML images. Bound attempts as well as decoded live pixels.
  Promise.resolve().then(async () => {
    if (!active()) return
    const allowed = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(source) || /^(?:wxfile:\/\/|\/).*\/reader-inline-[\w.-]+$/.test(source)
    if (!allowed || ++resources.loads > 128) throw imageEncodingError()
    const factory = offscreenCanvasFactories.get(document)
    if (!resources.canvas) resources.canvas = factory && factory({ type: '2d', width: 1, height: 1 })
    if (!resources.canvas || typeof resources.canvas.createImage !== 'function') throw imageEncodingError()
    state.timeout = setTimeout(() => finish(null, imageEncodingError()), resources.timeoutMs || 15000)
    // The host may need a local path. The author-visible .src never changes.
    const resolved = resources.resolveSource ? await resources.resolveSource(source) : source
    if (!active() || state.status === 'failed') return
    const image = resources.canvas.createImage()
    state.pendingImage = image
    image.onload = () => Promise.resolve().then(() => finish(image))
    image.onerror = () => Promise.resolve().then(() => finish(null, imageEncodingError()))
    image.src = resolved
  }).catch(() => finish(null, imageEncodingError()))
}

function imageConstructor (document) {
  function Image (width, height) {
    const element = document.createElement('img')
    if (arguments.length) element.width = Number(width) >>> 0
    if (arguments.length > 1) element.height = Number(height) >>> 0
    return element
  }
  Object.defineProperty(Image, 'prototype', { value: ShimImageElement.prototype, writable: false })
  return Image
}
function escapeText (value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute (value) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function camelToKebab (value) {
  return String(value).replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
}

function kebabToCamel (value) {
  return String(value).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function splitTopLevel (source, delimiter) {
  return splitCssTopLevel(source, delimiter)
}

function parseStyleText (value) {
  const declarations = Object.create(null)
  splitTopLevel(String(value || ''), ';').forEach(item => {
    const declaration = parseDeclaration(item)
    if (declaration) declarations[declaration.property] = declaration.value
  })
  return declarations
}

function styleText (declarations) {
  return Object.keys(declarations).filter(name => declarations[name] != null && (declarations[name] !== '' || name.startsWith('--'))).map(name => `${serializeIdentifier(name)}:${declarations[name]}`).join(';')
}

class ShimEvent {
  constructor (type, options = {}) {
    this.type = String(type || '')
    this.bubbles = options.bubbles !== false
    this.cancelable = options.cancelable !== false
    this.composed = Boolean(options.composed)
    this.detail = options.detail
    this.target = null
    this.currentTarget = null
    this.defaultPrevented = false
    this._stopped = false
    this.timeStamp = Date.now()
  }

  preventDefault () { if (this.cancelable) this.defaultPrevented = true }
  stopPropagation () { this._stopped = true }
  stopImmediatePropagation () { this._stopped = true; this._immediate = true }
}

class ShimCustomEvent extends ShimEvent {
  constructor (type, options = {}) { super(type, options); this.detail = options.detail }
}

class ShimNode {
  constructor (nodeType, ownerDocument) {
    this.nodeType = nodeType
    this.ownerDocument = ownerDocument || null
    this.parentNode = null
    this.childNodes = []
    this._listeners = Object.create(null)
    this._inlineHandlers = Object.create(null)
    this._nid = nextNodeId++
  }

  get firstChild () { return this.childNodes[0] || null }
  get parentElement () { return this.parentNode?.nodeType === 1 ? this.parentNode : null }
  get lastChild () { return this.childNodes[this.childNodes.length - 1] || null }
  get nextSibling () {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] || null
  }
  get previousSibling () {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index > 0 ? this.parentNode.childNodes[index - 1] : null
  }
  get textContent () { return this.childNodes.map(node => node.textContent).join('') }
  set textContent (value) {
    this.childNodes.slice().forEach(node => { node.parentNode = null })
    this.childNodes = []
    if (value != null && String(value)) this.appendChild(this.ownerDocument.createTextNode(String(value)))
    this._markDirty()
  }
  get innerText () { return this.textContent }
  set innerText (value) { this.textContent = value }

  _markDirty () { if (this.ownerDocument) this.ownerDocument._dirty = true }
  hasChildNodes () { return this.childNodes.length > 0 }
  contains (node) { let current = node; while (current) { if (current === this) return true; current = current.parentNode } return false }
  _adopt (node) {
    node.ownerDocument = this.ownerDocument || (this.nodeType === 9 ? this : null)
    node.childNodes.forEach(child => node._adopt(child))
    return node
  }
  appendChild (node) {
    if (!node) return node
    if (node.nodeType === 11) {
      node.childNodes.slice().forEach(child => this.appendChild(child))
      return node
    }
    if (node.parentNode) node.parentNode.removeChild(node)
    this.childNodes.push(this._adopt(node))
    node.parentNode = this
    this._markDirty()
    return node
  }
  insertBefore (node, reference) {
    if (!reference) return this.appendChild(node)
    const index = this.childNodes.indexOf(reference)
    if (index < 0) throw new Error('Reference node is not a child')
    if (node.nodeType === 11) {
      node.childNodes.slice().forEach(child => this.insertBefore(child, reference))
      return node
    }
    if (node.parentNode) node.parentNode.removeChild(node)
    this.childNodes.splice(index, 0, this._adopt(node))
    node.parentNode = this
    this._markDirty()
    return node
  }
  replaceChild (node, oldNode) { this.insertBefore(node, oldNode); this.removeChild(oldNode); return oldNode }
  removeChild (node) {
    const index = this.childNodes.indexOf(node)
    if (index < 0) throw new Error('Node is not a child')
    this.childNodes.splice(index, 1)
    node.parentNode = null
    this._markDirty()
    return node
  }
  remove () { if (this.parentNode) this.parentNode.removeChild(this) }
  append (...items) { items.forEach(item => this.appendChild(asNode(item, this.ownerDocument))) }
  replaceWith (...items) {
    const parent = this.parentNode
    if (!parent) return
    let next = this.nextSibling
    while (next && items.includes(next)) next = next.nextSibling
    const fragment = this.ownerDocument.createDocumentFragment()
    items.forEach(item => fragment.appendChild(asNode(item, this.ownerDocument)))
    if (this.parentNode === parent) parent.replaceChild(fragment, this)
    else parent.insertBefore(fragment, next)
  }
  setPointerCapture (id) { this.ownerDocument._pointerCaptures.set(Number(id), this) }
  releasePointerCapture (id) { if (this.hasPointerCapture(id)) this.ownerDocument._pointerCaptures.delete(Number(id)) }
  hasPointerCapture (id) { return this.ownerDocument._pointerCaptures.get(Number(id)) === this }
  replaceChildren (...items) { this.childNodes.slice().forEach(node => this.removeChild(node)); this.append(...items) }
  prepend (...items) { items.reverse().forEach(item => this.insertBefore(asNode(item, this.ownerDocument), this.firstChild)) }
  before (...items) { if (this.parentNode) items.forEach(item => this.parentNode.insertBefore(asNode(item, this.ownerDocument), this)) }
  after (...items) {
    if (!this.parentNode) return
    const reference = this.nextSibling
    items.forEach(item => this.parentNode.insertBefore(asNode(item, this.ownerDocument), reference))
  }
  cloneNode (deep = false) {
    const clone = this.nodeType === 3
      ? this.ownerDocument.createTextNode(this.data)
      : this.nodeType === 8
        ? this.ownerDocument.createComment(this.data)
        : this.nodeType === 11
          ? this.ownerDocument.createDocumentFragment()
          : this.ownerDocument.createElement(this.localName)
    if (this.nodeType === 1) Object.keys(this._attrs).forEach(name => clone.setAttribute(this._attrCase[name] || name, this._attrs[name]))
    if (deep) this.childNodes.forEach(child => clone.appendChild(child.cloneNode(true)))
    return clone
  }
  addEventListener (type, listener) {
    if (typeof listener !== 'function') return
    const key = String(type)
    if (!(this._listeners[key] || (this._listeners[key] = [])).includes(listener)) this._listeners[key].push(listener)
    this._markDirty()
  }
  removeEventListener (type, listener) {
    const list = this._listeners[String(type)]
    if (!list) return
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
    this._markDirty()
  }
  dispatchEvent (event) {
    if (!(event instanceof ShimEvent)) event = new ShimEvent(event && event.type || event, event || {})
    if (!event.target) event.target = this
    let node = this
    while (node) {
      event.currentTarget = node
      const property = node[`on${event.type}`]
      if (typeof property === 'function' && property.call(node, event) === false) event.preventDefault()
      const inline = node._inlineHandlers[event.type]
      if (!event._immediate && typeof inline === 'function' && inline.call(node, event) === false) event.preventDefault()
      const listeners = (node._listeners[event.type] || []).slice()
      for (const listener of listeners) {
        listener.call(node, event)
        if (event._immediate) break
      }
      if (!event.bubbles || event._stopped) break
      node = node.parentNode
    }
    return !event.defaultPrevented
  }
}

class ShimText extends ShimNode {
  constructor (data, ownerDocument) { super(3, ownerDocument); this.data = String(data || '') }
  get nodeName () { return '#text' }
  get textContent () { return this.data }
  set textContent (value) { const next = String(value == null ? '' : value); if (next !== this.data) { this.data = next; this._markDirty() } }
  get outerHTML () { return escapeText(this.data) }
}

class ShimComment extends ShimNode {
  constructor (data, ownerDocument) { super(8, ownerDocument); this.data = String(data || '') }
  get nodeName () { return '#comment' }
  get textContent () { return '' }
  set textContent (_) {}
  get outerHTML () { return `<!--${this.data.replace(/-->/g, '--&gt;')}-->` }
}

class ShimFragment extends ShimNode {
  constructor (ownerDocument) { super(11, ownerDocument) }
  get nodeName () { return '#document-fragment' }
  querySelector (selector) { return querySelectorAllFrom(this, selector)[0] || null }
  querySelectorAll (selector) { return querySelectorAllFrom(this, selector) }
  get innerHTML () { return this.childNodes.map(serializeNode).join('') }
}

function createStyleProxy (element) {
  const api = {
    setProperty (name, value, priority) {
      const key = propertyKey(name)
      const next = `${String(value)}${priority ? ` !${priority}` : ''}`
      if (element._style[key] === next) return
      element._style[key] = next
      element._syncStyleAttribute()
    },
    getPropertyValue: name => element._style[propertyKey(name)] || '',
    removeProperty (name) {
      const key = propertyKey(name)
      const previous = element._style[key] || ''
      if (Object.prototype.hasOwnProperty.call(element._style, key)) {
        delete element._style[key]
        element._syncStyleAttribute()
      }
      return previous
    },
    get cssText () { return styleText(element._style) },
    set cssText (value) {
      const next = parseStyleText(value)
      if (styleText(next) === styleText(element._style)) return
      element._style = next
      element._syncStyleAttribute()
    }
  }
  return new Proxy(api, {
    get (target, name) {
      if (name in target) return target[name]
      return element._style[String(name).startsWith('--') ? name : camelToKebab(name)] || ''
    },
    set (target, name, value) {
      if (name === 'cssText') { target.cssText = value; return true }
      target.setProperty(String(name).startsWith('--') ? name : camelToKebab(name), value)
      return true
    },
    deleteProperty (target, name) { target.removeProperty(String(name).startsWith('--') ? name : camelToKebab(name)); return true }
  })
}

function createDatasetProxy (element) {
  return new Proxy({}, {
    get: (_, name) => {
      const value = element.getAttribute(`data-${camelToKebab(name)}`)
      return value == null ? undefined : value
    },
    set: (_, name, value) => { element.setAttribute(`data-${camelToKebab(name)}`, value); return true },
    deleteProperty: (_, name) => { element.removeAttribute(`data-${camelToKebab(name)}`); return true },
    ownKeys: () => Object.keys(element._attrs).filter(name => name.startsWith('data-')).map(name => kebabToCamel(name.slice(5))),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
  })
}

function createClassList (element) {
  const values = () => String(element.className || '').split(/[\t\n\f\r ]+/).filter(Boolean)
  const write = list => { element.className = Array.from(new Set(list)).join(' ') }
  return {
    add: (...tokens) => write(values().concat(tokens.map(String))),
    remove: (...tokens) => { const remove = new Set(tokens.map(String)); write(values().filter(token => !remove.has(token))) },
    toggle: (token, force) => {
      const list = values(); const exists = list.includes(String(token)); const shouldAdd = force == null ? !exists : Boolean(force)
      if (shouldAdd && !exists) list.push(String(token))
      if (!shouldAdd && exists) list.splice(list.indexOf(String(token)), 1)
      write(list); return shouldAdd
    },
    contains: token => values().includes(String(token)),
    replace: (oldToken, newToken) => { const list = values(); const index = list.indexOf(String(oldToken)); if (index < 0) return false; list[index] = String(newToken); write(list); return true },
    toString: () => element.className,
    get length () { return values().length },
    item: index => values()[index] || null
  }
}

class ShimElement extends ShimNode {
  constructor (name, ownerDocument) {
    super(1, ownerDocument)
    this.localName = this.ownerDocument && this.ownerDocument._xmlMode ? String(name || 'div') : String(name || 'div').toLowerCase()
    this.tagName = this.ownerDocument._xmlMode ? this.localName : this.localName.toUpperCase()
    this.nodeName = this.tagName
    this._attrs = Object.create(null)
    this._attrCase = Object.create(null)
    this._style = Object.create(null)
    this.style = createStyleProxy(this)
    this.dataset = createDatasetProxy(this)
    this.classList = createClassList(this)
  }

  get children () { return this.childNodes.filter(node => node.nodeType === 1) }
  get firstElementChild () { return this.children[0] || null }
  get lastElementChild () { const children = this.children; return children[children.length - 1] || null }
  get nextElementSibling () { let node = this.nextSibling; while (node && node.nodeType !== 1) node = node.nextSibling; return node }
  get previousElementSibling () { let node = this.previousSibling; while (node && node.nodeType !== 1) node = node.previousSibling; return node }
  get attributes () { return Object.keys(this._attrs).map(name => ({ name: this._attrCase[name] || name, value: this._attrs[name] })) }
  get id () { return this.getAttribute('id') || '' }
  set id (value) { this.setAttribute('id', value) }
  get className () { return this.getAttribute('class') || '' }
  set className (value) { this.setAttribute('class', value) }
  get value () {
    if (this.localName === 'input' && /^(text|search|tel|password)$/i.test(this.type)) {
      return String(this._value != null ? this._value : this.getAttribute('value') || '').replace(/[\r\n]/g, '')
    }
    if (this.localName === 'textarea') return this._value != null ? this._value : this.textContent
    if (this.localName === 'select') {
      const selected = this.querySelectorAll('option').find(option => option.selected) || this.querySelector('option')
      return this._value != null ? this._value : selected ? (selected.getAttribute('value') == null ? selected.textContent : selected.getAttribute('value')) : ''
    }
    if (this._value != null) return this._value
    const attributeValue = this.getAttribute('value')
    if (attributeValue != null) return attributeValue
    return this.localName === 'input' && /^(?:checkbox|radio)$/.test(this.type) ? 'on' : ''
  }
  set value (value) {
    let next = String(value == null ? '' : value)
    if (this.localName === 'input' && /^(text|search|tel|password)$/i.test(this.type)) next = next.replace(/[\r\n]/g, '')
    if (this._value === next && this.localName !== 'select') return
    this._value = next
    if (this.localName === 'select') {
      let selected = false
      this.querySelectorAll('option').forEach(option => {
        const optionValue = option.getAttribute('value') == null ? option.textContent : option.getAttribute('value')
        option._selected = !selected && optionValue === next
        if (option._selected) selected = true
      })
    }
    this._markDirty()
  }
  get checked () { return this._checked != null ? this._checked : this.hasAttribute('checked') }
  set checked (value) {
    const next = Boolean(value)
    if (this._checked === next) return
    this._checked = next
    if (next && this.localName === 'input' && this.type === 'radio' && this.name) {
      const scope = this.form || this.ownerDocument
      if (scope) scope.querySelectorAll('input[type="radio"]').filter(radio => radio !== this && radio.name === this.name).forEach(radio => {
        if (radio._checked !== false) { radio._checked = false; radio._markDirty() }
      })
    }
    this._markDirty()
  }
  get selected () { return this._selected != null ? this._selected : this.hasAttribute('selected') }
  set selected (value) { const next = Boolean(value); if (this._selected !== next) { this._selected = next; this._markDirty() } }
  get selectedIndex () {
    if (this.localName !== 'select') return -1
    const options = this.querySelectorAll('option')
    const selected = options.findIndex(option => option.selected)
    if (selected >= 0) return selected
    if (this._value != null) return -1
    return options.length ? 0 : -1
  }
  get options () { return this.localName === 'select' ? this.querySelectorAll('option') : undefined }
  get text () { return this.localName === 'option' ? this.textContent : undefined }
  set text (value) { if (this.localName === 'option') this.textContent = value }
  get content () {
    if (this.localName !== 'template') return undefined
    const fragment = this.ownerDocument.createDocumentFragment()
    this.childNodes.forEach(child => fragment.appendChild(child.cloneNode(true)))
    return fragment
  }
  set selectedIndex (value) {
    if (this.localName !== 'select') return
    const index = Number(value)
    const options = this.querySelectorAll('option')
    options.forEach((option, optionIndex) => { option._selected = optionIndex === index })
    const selected = options[index]
    this._value = selected ? (selected.getAttribute('value') == null ? selected.textContent : selected.getAttribute('value')) : ''
    this._markDirty()
  }
  get disabled () { return this.hasAttribute('disabled') }
  set disabled (value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled') }
  get hidden () { return this.hasAttribute('hidden') }
  set hidden (value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden') }
  get open () { return this.hasAttribute('open') }
  set open (value) { value ? this.setAttribute('open', '') : this.removeAttribute('open') }
  get required () { return this.hasAttribute('required') }
  set required (value) { value ? this.setAttribute('required', '') : this.removeAttribute('required') }
  get multiple () { return this.hasAttribute('multiple') }
  set multiple (value) { value ? this.setAttribute('multiple', '') : this.removeAttribute('multiple') }
  get readOnly () { return this.hasAttribute('readonly') }
  set readOnly (value) { value ? this.setAttribute('readonly', '') : this.removeAttribute('readonly') }
  get contentEditable () { return this.getAttribute('contenteditable') == null ? 'inherit' : this.getAttribute('contenteditable') }
  set contentEditable (value) { this.setAttribute('contenteditable', value) }
  get isContentEditable () {
    let node = this
    while (node && node.nodeType === 1) {
      const value = node.getAttribute('contenteditable')
      if (value != null) return !/^(?:false|inherit)$/i.test(value)
      node = node.parentNode
    }
    return false
  }
  get name () { return this.getAttribute('name') || '' }
  set name (value) { this.setAttribute('name', value) }
  get type () { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : 'text') }
  set type (value) { this.setAttribute('type', value) }
  get src () { return this.getAttribute('src') || '' }
  set src (value) { this.setAttribute('src', value) }
  get naturalWidth () { const image = runtimeImages.get(this)?.image; return image && (image.naturalWidth || image.width) || 0 }
  get naturalHeight () { const image = runtimeImages.get(this)?.image; return image && (image.naturalHeight || image.height) || 0 }
  get href () { return this.getAttribute('href') || '' }
  set href (value) { this.setAttribute('href', value) }
  get form () { return this.closest('form') }
  get files () { return this.localName === 'input' && this.type === 'file' ? (this._files || []) : undefined }
  get elements () {
    if (this.localName !== 'form') return undefined
    const list = this.querySelectorAll('input,select,textarea,button')
    list.namedItem = name => list.find(item => item.name === name || item.id === name) || null
    list.forEach(item => { const key = item.name || item.id; if (key && !(key in list)) list[key] = item })
    return list
  }
  get innerHTML () { return this.childNodes.map(serializeNode).join('') }
  set innerHTML (value) {
    this.childNodes.forEach(node => { node.parentNode = null })
    this.childNodes = []
    const source = String(value == null ? '' : value).replace(/\r\n?/g, '\n')
    if (RAW_TEXT_TAGS.has(this.localName) || RCDATA_TAGS.has(this.localName)) {
      this.appendChild(this.ownerDocument.createTextNode(RCDATA_TAGS.has(this.localName) ? decodeEntities(source) : source))
    } else parseFragment(source, this.ownerDocument).childNodes.slice().forEach(node => this.appendChild(node))
    this._markDirty()
  }
  get outerHTML () { return serializeNode(this) }
  set outerHTML (value) {
    if (!this.parentNode) return
    const reference = this.nextSibling
    const parent = this.parentNode
    parent.removeChild(this)
    parseFragment(String(value || ''), this.ownerDocument).childNodes.slice().forEach(node => parent.insertBefore(node, reference))
  }
  get offsetWidth () {
    const own = parseFloat(this.ownerDocument?.defaultView?.getComputedStyle?.(this)?.width || this.style.width)
    return Number.isFinite(own) ? own : this._layoutRect?.width ?? this.ownerDocument?._viewportWidth ?? 0
  }
  get offsetTop () {
    if (this.ownerDocument) this.ownerDocument._lastLayoutElement = this
    return Number.isFinite(this._layoutDocumentTop) ? this._layoutDocumentTop : 0
  }
  get offsetLeft () {
    if (this.ownerDocument) this.ownerDocument._lastLayoutElement = this
    return Number.isFinite(this._layoutDocumentLeft) ? this._layoutDocumentLeft : 0
  }
  get offsetHeight () {
    const style = this.ownerDocument?.defaultView?.getComputedStyle?.(this)
    const text = style?.height || this.style.height
    const value = /^(?:[\d.]+)d?vh$/.test(text) ? parseFloat(text) * this.ownerDocument._viewportHeight / 100 : /^(?:[\d.]+)d?vw$/.test(text) ? parseFloat(text) * this.ownerDocument._viewportWidth / 100 : /^(?:[\d.]+)(?:px)?$/.test(text) ? parseFloat(text) : NaN
    return Number.isFinite(value) ? value : this._layoutRect?.height ?? 0
  }
  get clientWidth () { return this.offsetWidth }
  get clientHeight () { return this.offsetHeight }
  get scrollWidth () { return this.offsetWidth }
  get scrollHeight () { return this.offsetHeight }
  get width () { return Number(this.getAttribute('width') || 300) }
  set width (value) {
    this.setAttribute('width', Number(value) || 0)
  }
  get height () { return Number(this.getAttribute('height') || 150) }
  set height (value) {
    this.setAttribute('height', Number(value) || 0)
  }
  _attributeKey (name) { return this.ownerDocument._xmlMode ? String(name) : String(name).toLowerCase() }
  getAttribute (name) { const key = this._attributeKey(name); return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null }
  getAttributeNames () { return Object.keys(this._attrs) }
  hasAttribute (name) { return Object.prototype.hasOwnProperty.call(this._attrs, this._attributeKey(name)) }
  hasAttributes () { return Object.keys(this._attrs).length > 0 }
  setAttribute (name, value) {
    const key = this._attributeKey(name); const next = value === true ? '' : String(value == null ? '' : value)
    const resizeCanvas = this.localName === 'canvas' && (key === 'width' || key === 'height')
    if (!resizeCanvas && this._attrs[key] === next && this._attrCase[key] === String(name)) return
    const previous = this._attrs[key], previousCase = this._attrCase[key], hadAttribute = this.hasAttribute(key)
    this._attrs[key] = next; this._attrCase[key] = String(name)
    if (key === 'style') this._style = parseStyleText(next)
    if (resizeCanvas) {
      try { resetCanvasDimension(this, key) } catch (error) {
        if (hadAttribute) { this._attrs[key] = previous; this._attrCase[key] = previousCase }
        else { delete this._attrs[key]; delete this._attrCase[key] }
        throw error
      }
    }
    if (key === 'src' && runtimeImages.has(this)) loadRuntimeImage(this, next)
    this._markDirty()
  }
  removeAttribute (name) {
    const key = this._attributeKey(name)
    if (!this.hasAttribute(key)) return
    const previous = this._attrs[key], previousCase = this._attrCase[key]
    delete this._attrs[key]; delete this._attrCase[key]
    if (this.localName === 'canvas' && (key === 'width' || key === 'height')) {
      try { resetCanvasDimension(this, key) } catch (error) {
        this._attrs[key] = previous; this._attrCase[key] = previousCase
        throw error
      }
    }
    if (key === 'src' && runtimeImages.has(this)) cancelImage(this)
    if (key === 'style') this._style = Object.create(null)
    this._markDirty()
  }
  toggleAttribute (name, force) { const present = this.hasAttribute(name); const next = force == null ? !present : Boolean(force); if (next) this.setAttribute(name, ''); else this.removeAttribute(name); return next }
  _syncStyleAttribute () {
    const next = styleText(this._style)
    if (next) { this._attrs.style = next; this._attrCase.style = 'style' } else { delete this._attrs.style; delete this._attrCase.style }
    this._markDirty()
  }
  querySelector (selector) { return querySelectorAllFrom(this, selector)[0] || null }
  querySelectorAll (selector) { return querySelectorAllFrom(this, selector) }
  matches (selector) { return splitTopLevel(String(selector || ''), ',').some(item => matchSelector(this, item)) }
  closest (selector) { let node = this; while (node && node.nodeType === 1) { if (node.matches(selector)) return node; node = node.parentNode } return null }
  insertAdjacentHTML (position, html) {
    const fragment = parseFragment(String(html || ''), this.ownerDocument)
    const nodes = fragment.childNodes.slice()
    if (position === 'beforebegin') nodes.forEach(node => this.parentNode && this.parentNode.insertBefore(node, this))
    else if (position === 'afterbegin') nodes.reverse().forEach(node => this.insertBefore(node, this.firstChild))
    else if (position === 'beforeend') nodes.forEach(node => this.appendChild(node))
    else if (position === 'afterend') { const reference = this.nextSibling; nodes.forEach(node => this.parentNode && this.parentNode.insertBefore(node, reference)) }
    else throw new Error(`Unknown position ${position}`)
  }
  insertAdjacentText (position, value) { return this.insertAdjacentElement(position, this.ownerDocument.createTextNode(String(value == null ? '' : value))) }
  insertAdjacentElement (position, element) {
    const where = String(position || '').toLowerCase()
    if (where === 'beforebegin') return this.parentNode ? this.parentNode.insertBefore(element, this) : null
    if (where === 'afterbegin') return this.insertBefore(element, this.firstChild)
    if (where === 'beforeend') return this.appendChild(element)
    if (where === 'afterend') return this.parentNode ? this.parentNode.insertBefore(element, this.nextSibling) : null
    throw new Error(`Unknown position ${position}`)
  }
  getBoundingClientRect () {
    if (!this._layoutRect) return { x: 0, y: 0, top: 0, left: 0, right: this.offsetWidth, bottom: this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight }
    const rect = { ...this._layoutRect }, view = this.ownerDocument && this.ownerDocument.defaultView
    if (Number.isFinite(this._layoutDocumentTop)) { rect.y = rect.top = this._layoutDocumentTop - Number(view && view.scrollY || 0); rect.bottom = rect.top + rect.height }
    if (Number.isFinite(this._layoutDocumentLeft)) { rect.x = rect.left = this._layoutDocumentLeft - Number(view && view.scrollX || 0); rect.right = rect.left + rect.width }
    return rect
  }
  scrollIntoView () {}
  focus () {}
  blur () {}
  getContext (type, attributes) {
    if (this.localName !== 'canvas') return null
    if (this.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
    if (!this._canvasContexts) this._canvasContexts = Object.create(null)
    const name = String(type || '').toLowerCase()
    if (!this._canvasContexts[name]) this._canvasContexts[name] = name === '2d' ? createCanvas2dContext(this) : /^(?:webgl|experimental-webgl|webgl2)$/.test(name) ? createWebGlContext(this, name, attributes) : null
    return this._canvasContexts[name]
  }
  toDataURL (type = 'image/png', quality) {
    if (this.localName !== 'canvas') return ''
    if (this.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
    const canvas = real2dCanvases.get(this)
    if (!canvas) throw new Error('当前运行环境不支持 Canvas 图片导出')
    if (!canvas.width || !canvas.height) return 'data:,'
    const output = typeof canvas.toDataURL === 'function' ? canvas.toDataURL(type, quality)
      : 'data:image/png;base64,' + require('./html-script-runtime').bytesToBase64(require('../canvas-png').encodeCanvasPng(canvas))
    if (!/^data:image\/[^,]+,.+/.test(output)) throw new Error('Canvas 未生成有效图片')
    return output
  }
  click () { dispatchDomClick(this) }
  reset () {
    if (this.localName !== 'form') return
    if (!this.dispatchEvent(new ShimEvent('reset'))) return
    resetForm(this)
  }
  requestSubmit (submitter) {
    if (this.localName !== 'form') return
    if (submitter) dispatchDomClick(submitter)
    else this.dispatchEvent(new ShimEvent('submit'))
  }
  submit () { if (this.localName === 'form') this.dispatchEvent(new ShimEvent('submit')) }
  show () { if (this.localName === 'dialog') this.setAttribute('open', '') }
  showModal () { this.show() }
  close (returnValue = '') { if (this.localName === 'dialog') { this.returnValue = String(returnValue); this.removeAttribute('open'); this.dispatchEvent(new ShimEvent('close', { bubbles: false })) } }
}

class ShimImageElement extends ShimElement {
  constructor (document) {
    super('img', document)
    runtimeImages.set(this, { revision: 0, status: 'empty', image: null, pendingImage: null, pixels: 0, waiters: [], timeout: null })
    imageDocument(document).states.add(this)
  }
  get namespaceURI () { return 'http://www.w3.org/1999/xhtml' }
  get complete () { return runtimeImages.get(this).status !== 'pending' }
  get currentSrc () { return runtimeImages.get(this).status === 'loaded' ? this.src : '' }
  get width () { return this.hasAttribute('width') ? Number(this.getAttribute('width')) || 0 : this.naturalWidth }
  set width (value) { this.setAttribute('width', Number(value) >>> 0) }
  get height () { return this.hasAttribute('height') ? Number(this.getAttribute('height')) || 0 : this.naturalHeight }
  set height (value) { this.setAttribute('height', Number(value) >>> 0) }
  decode () {
    const state = runtimeImages.get(this)
    return new Promise((resolve, reject) => {
      if (this.ownerDocument._runtimeDisposed || state.status === 'failed' || state.status === 'empty') reject(imageEncodingError())
      else if (state.status === 'loaded') resolve()
      else if (state.waiters.length >= 128) reject(imageEncodingError())
      else state.waiters.push({ resolve, reject })
    })
  }
}

class ShimDocument extends ShimNode {
  constructor (options = {}) {
    super(9, null)
    this.ownerDocument = this
    this.contentType = options.contentType === 'application/xhtml+xml' ? 'application/xhtml+xml' : 'text/html'
    this._xmlMode = this.contentType === 'application/xhtml+xml'
    this._pointerCaptures = new Map()
    this._viewportWidth = Number(options.viewportWidth || 375)
    this._viewportHeight = Number(options.viewportHeight || 667)
    if (typeof options.createOffscreenCanvas === 'function') offscreenCanvasFactories.set(this, options.createOffscreenCanvas)
    Object.assign(imageDocument(this), { resolveSource: options.resolveImageSource, onError: options.onImageError, timeoutMs: options.imageDecodeTimeout })
    // 构建初始树时不调度渲染；解析完成后再接入 runtime 的脏标回调。
    this._onDirty = null
    this._dirtyValue = false
    this._styleRevision = 0
    Object.defineProperty(this, '_dirty', {
      get: () => this._dirtyValue,
      set: value => {
        const next = Boolean(value); const rising = next && !this._dirtyValue
        if (next) this._styleRevision++
        this._dirtyValue = next
        if (rising && typeof this._onDirty === 'function') this._onDirty()
      }
    })
    this.readyState = 'loading'
    this.documentElement = this.createElement('html')
    this.head = this.createElement('head')
    this.body = this.createElement('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.childNodes = [this.documentElement]
    this.documentElement.parentNode = this
    this._title = ''
    this._location = options.location || createLocation()
    Object.defineProperty(this, 'title', { get: () => this._title, set: value => { const next = String(value || ''); if (next !== this._title) { this._title = next; if (typeof options.onTitle === 'function') options.onTitle(next) } } })
    Object.defineProperty(this, 'cookie', { get: () => '', set: () => {} })
    this._dirty = false
  }

  get nodeName () { return '#document' }
  get forms () {
    const list = this.querySelectorAll('form')
    list.namedItem = name => list.find(form => form.name === name || form.id === name) || null
    list.forEach(form => { const key = form.name || form.id; if (key && !(key in list)) list[key] = form })
    return list
  }
  createElement (name) {
    if ((this._xmlMode ? String(name) : String(name).toLowerCase()) === 'img') return new ShimImageElement(this)
    const element = new ShimElement(name, this)
    if (element.localName !== 'form') return element
    return new Proxy(element, {
      get (target, key, receiver) {
        if (key === 'then') return undefined
        if (typeof key === 'string') {
          const named = target.elements.namedItem(key)
          if (named) return named
        }
        if (key in target) return Reflect.get(target, key, receiver)
        return undefined
      }
    })
  }
  createElementNS (_, name) { return this.createElement(name) }
  createTextNode (value) { return new ShimText(value, this) }
  createComment (value) { return new ShimComment(value, this) }
  createDocumentFragment () { return new ShimFragment(this) }
  createEvent (type) {
    const event = /custom/i.test(type) ? new ShimCustomEvent('') : new ShimEvent('')
    event.initEvent = function (name, bubbles, cancelable) { this.type = String(name); this.bubbles = Boolean(bubbles); this.cancelable = Boolean(cancelable) }
    event.initCustomEvent = function (name, bubbles, cancelable, detail) { this.initEvent(name, bubbles, cancelable); this.detail = detail }
    return event
  }
  getElementById (id) { return this.querySelector(`#${cssEscape(String(id))}`) }
  getElementsByName (name) { return this.querySelectorAll(`[name="${String(name).replace(/"/g, '\\"')}"]`) }
  getElementsByTagName (name) { return this.querySelectorAll(name) }
  querySelector (selector) { return querySelectorAllFrom(this, selector)[0] || null }
  querySelectorAll (selector) { return querySelectorAllFrom(this, selector) }
}

function normalizeCanvasArgument (value) {
  if (value && value.__canvasGradientId) return { __canvasGradient: value.__canvasGradientId }
  if (value instanceof ShimElement) {
    const source = value.src || ''
    return { __canvasImage: /^(?:data:image\/|wxfile:|file:|\/)/i.test(source) ? source : '' }
  }
  if (ArrayBuffer.isView(value)) return { __canvasTypedArray: value.constructor && value.constructor.name || 'Uint8Array', data: Array.from(value) }
  if (value instanceof ArrayBuffer) return { __canvasArrayBuffer: Array.from(new Uint8Array(value)) }
  if (Array.isArray(value)) return value.map(normalizeCanvasArgument)
  if (value && typeof value === 'object') {
    const output = {}
    ;['data', 'height', 'width'].forEach(key => { if (value[key] != null) output[key] = normalizeCanvasArgument(value[key]) })
    return output
  }
  return value
}

function appendCanvasOp (element, name, args) {
  if (!element._canvasState) element._canvasState = { ops: [], rev: 0 }
  if (!element.ownerDocument._directCanvasFrames || !real2dCanvases.has(element)) element._canvasState.ops.push({ name, args })
  element._canvasState.rev++
  element._markDirty()
}
function recordCanvasOp (element, name, args) {
  // Native frames already contain the pixels. Avoid serializing large RGBA
  // arrays and commands which appendCanvasOp would immediately discard.
  if (element.ownerDocument._directCanvasFrames && real2dCanvases.has(element)) { markCanvasRevision(element); return }
  appendCanvasOp(element, name, Array.from(args || []).map(normalizeCanvasArgument))
}

function resolveCanvasSource (source, document) {
  if (source.ownerDocument._runtimeDisposed || document._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
  if (source.ownerDocument !== document) throw new Error('暂不支持跨文件 Canvas 图片源')
  const pixels = canvasPixels(source.width, source.height)
  if (!pixels) { const error = new Error('Canvas 图片源的宽高不能为零'); error.name = 'InvalidStateError'; throw error }
  if (realWebGlCanvases.has(source)) throw new Error('暂不支持 WebGL 画布作为 Canvas 图片源')
  // Blank canvases with no prior getContext() are valid transparent sources.
  if (!real2dCanvases.has(source)) ShimElement.prototype.getContext.call(source, '2d')
  const canvas = real2dCanvases.get(source)
  if (!canvas) throw new Error('当前环境无法获取 Canvas 图片源的真实像素')
  return canvas
}

function snapshotCanvasSource (source, document) {
  const canvas = resolveCanvasSource(source, document)
  const pixels = canvasPixels(source.width, source.height)
  let resources = canvasSnapshotDocuments.get(document)
  if (!resources) canvasSnapshotDocuments.set(document, resources = { latest: new WeakMap(), count: 0, pixels: 0, bytes: 0 })
  const revision = source._canvasState ? source._canvasState.rev : 0
  const previous = resources.latest.get(source)
  if (previous && previous.revision === revision && previous.width === source.width && previous.height === source.height) return previous.data
  if (resources.count >= 128 || resources.pixels + pixels > 32 * 1024 * 1024) throw new Error('Canvas 图片源快照数量或累计像素超过安全上限')
  // Account before encoding; repeated failed native encodes must also be bounded.
  resources.count++; resources.pixels += pixels
  const data = typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png')
    : 'data:image/png;base64,' + require('./html-script-runtime').bytesToBase64(require('../canvas-png').encodeCanvasPng(canvas))
  if (typeof data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Canvas 图片源未生成有效 PNG')
  if (data.length > 16 * 1024 * 1024 || resources.bytes + data.length > 32 * 1024 * 1024) throw new Error('Canvas 图片源快照数据超过安全上限')
  resources.bytes += data.length
  resources.latest.set(source, { revision, width: source.width, height: source.height, data })
  return data
}

function resetCanvasDimension (element, key) {
  if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
  const native = real2dCanvases.get(element) || realWebGlCanvases.get(element)?.canvas
  if (native) {
    const next = canvasPixels(element.width, element.height)
    const delta = next - (nativeCanvasAllocations.get(native) || 0)
    // Reserve growth before native allocation. Release shrinkage only after the
    // native setter succeeds; failure leaves both the bitmap and quota intact.
    if (delta > 0) reserveNativePixels(element.ownerDocument, delta)
    try { native[key] = element[key] } catch (error) {
      if (delta > 0) reserveNativePixels(element.ownerDocument, -delta)
      throw error
    }
    if (delta < 0) reserveNativePixels(element.ownerDocument, delta)
    nativeCanvasAllocations.set(native, next)
  }
  const reset = canvasContextResetters.get(element)
  if (reset) { reset(); recordCanvasOp(element, 'resetCanvas', [element.width, element.height]) }
}

function markCanvasRevision (element) {
  if (!element._canvasState) element._canvasState = { ops: [], rev: 0 }
  element._canvasState.rev++
  element._markDirty()
}

function createCanvasGradient (element, kind, args) {
  const id = nextCanvasResourceId++
  const stops = []
  const gradient = { kind, args: Array.from(args), stops, __canvasGradientId: id, addColorStop (offset, color) { stops.push([Number(offset), String(color)]); recordCanvasOp(element, 'gradientColorStop', [id, offset, color]) } }
  recordCanvasOp(element, 'createGradient', [id, kind, ...args])
  return gradient
}

function createCanvas2dContext (element) {
  const state = Object.create(null)
  const savedStates = []
  const reset = () => {
    Object.keys(state).forEach(key => { delete state[key] }); savedStates.length = 0
    Object.assign(state, { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'inherit', shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'low', filter: 'none', fontKerning: 'auto', fontStretch: 'normal', fontVariantCaps: 'normal', letterSpacing: '0px', wordSpacing: '0px', textRendering: 'auto' })
  }
  reset(); canvasContextResetters.set(element, reset)
  let native = null, nativeError = null
  const factory = offscreenCanvasFactories.get(element.ownerDocument)
  // Script readback is synchronous: a WXML drawing surface cannot provide its
  // pixels across the asynchronous view bridge. Keep a bounded native backing
  // for attached canvases too; never substitute an invented transparent image.
  if (factory) {
    let canvas, reserved = 0
    try {
      const pixels = canvasPixels(element.width, element.height)
      reserveNativePixels(element.ownerDocument, pixels)
      reserved = pixels
      canvas = factory({ type: '2d', width: element.width, height: element.height })
      native = canvas && canvas.getContext('2d')
      if (!native) throw new Error('当前环境未提供 Canvas 2D 像素缓冲')
      real2dCanvases.set(element, canvas)
      nativeCanvasAllocations.set(canvas, pixels)
      if (!nativeCanvasDocuments.has(element.ownerDocument)) nativeCanvasDocuments.set(element.ownerDocument, new Set())
      nativeCanvasDocuments.get(element.ownerDocument).add(canvas)
    } catch (error) {
      if (reserved) reserveNativePixels(element.ownerDocument, -reserved)
      nativeError = error; native = null
      if (canvas) { try { canvas.width = 0; canvas.height = 0 } catch (_) {} }
    }
  }
  if (nativeError && element.ownerDocument._directCanvasFrames) throw nativeError
  const methods = ['arc', 'arcTo', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'drawImage', 'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'putImageData', 'quadraticCurveTo', 'rect', 'resetTransform', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'strokeText', 'transform', 'translate']
  const api = {
    canvas: element,
    reset: () => {
      if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
      canvasPixels(element.width, element.height)
      // Clear the real bitmap, path, clip and stack before updating the mirror.
      // Older hosts lack reset(); a same-width assignment performs the full
      // reset without changing dimensions or charging a new allocation budget.
      if (native) {
        if (typeof native.reset === 'function') native.reset()
        else {
          const canvas = real2dCanvases.get(element)
          canvas.width = canvas.width
        }
      }
      reset()
      recordCanvasOp(element, 'resetCanvas', [element.width, element.height])
    },
    measureText: text => ({ width: native ? native.measureText(String(text || '')).width : String(text || '').length * 8 }),
    createImageData: (width, height) => {
      if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
      if (width && typeof width === 'object' && height === undefined) { height = width.height; width = width.width }
      const size = imageDataExtent(width, height)
      reserveImageData(element.ownerDocument, size.pixels)
      pixelWorkObservers.get(element.ownerDocument)?.(size.pixels)
      return { width: size.width, height: size.height, data: new Uint8ClampedArray(size.pixels * 4) }
    },
    getImageData: (x, y, width, height) => {
      if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
      const size = imageDataExtent(width, height), sx = size.integer(x), sy = size.integer(y)
      if (!native || typeof native.getImageData !== 'function') throw nativeError || new Error('当前环境无法读取真实 Canvas 像素')
      reserveImageData(element.ownerDocument, size.pixels)
      const image = native.getImageData(sx, sy, size.w, size.h)
      if (!image || image.width !== size.width || image.height !== size.height || !ArrayBuffer.isView(image.data) || image.data.BYTES_PER_ELEMENT !== 1 || image.data.length !== size.pixels * 4) throw new Error('Canvas 原生像素数据不完整')
      pixelWorkObservers.get(element.ownerDocument)?.(size.pixels)
      return { width: image.width, height: image.height, data: image.data }
    },
    createLinearGradient: (...args) => gradient('linear', args),
    createRadialGradient: (...args) => gradient('radial', args),
    roundRect: (...args) => require('./canvas-round-rect').roundRect(api, ...args),
    createPattern: (source, repetition = 'repeat') => {
      if (!native || !element.ownerDocument._directCanvasFrames) return null
      if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
      const image = source instanceof ShimElement && source.localName === 'canvas'
        ? resolveCanvasSource(source, element.ownerDocument) : runtimeImages.get(source)?.image
      if (!image) return null
      const pattern = native.createPattern(image, repetition)
      if (!pattern) return null
      const wrapper = Object.freeze(Object.create(null))
      nativeCanvasValues.set(wrapper, pattern)
      return wrapper
    },
    isPointInPath: () => false,
    isPointInStroke: () => false
  }
  function gradient (kind, args) {
    const wrapped = createCanvasGradient(element, kind, args)
    if (native) {
      const value = native[kind === 'linear' ? 'createLinearGradient' : 'createRadialGradient'](...args)
      nativeCanvasValues.set(wrapped, value)
      const record = wrapped.addColorStop
      wrapped.addColorStop = (offset, color) => { record(offset, color); value.addColorStop(offset, color) }
    }
    return wrapped
  }
  const nativeValue = value => value && typeof value === 'object' ? (runtimeImages.get(value)?.image || real2dCanvases.get(value) || nativeCanvasValues.get(value) || value) : value
  methods.forEach(name => { api[name] = (...args) => {
    if (element.ownerDocument._runtimeDisposed) throw new Error('Canvas 所属文件已关闭')
    if (name === 'drawImage' && args[0] instanceof ShimElement && args[0].localName === 'canvas') {
      if (![3, 5, 9].includes(args.length)) throw new TypeError('drawImage 参数数量无效')
      if (native && element.ownerDocument._directCanvasFrames) {
        const source = resolveCanvasSource(args[0], element.ownerDocument)
        native.drawImage(source, ...args.slice(1).map(nativeValue))
        markCanvasRevision(element)
        return
      }
      // Capture BEFORE the native call (including self-copy), then record only
      // after native drawing succeeds. Future source mutations cannot change it.
      const data = snapshotCanvasSource(args[0], element.ownerDocument)
      if (native) native.drawImage(...args.map(nativeValue))
      appendCanvasOp(element, name, [{ __canvasImage: data }, ...args.slice(1).map(normalizeCanvasArgument)])
      return
    }
    if (name === 'save') savedStates.push({ ...state })
    if (name === 'restore' && savedStates.length) {
      const previous = savedStates.pop()
      Object.keys(state).forEach(key => { delete state[key] })
      Object.assign(state, previous)
    }
    recordCanvasOp(element, name, args)
    if (native && typeof native[name] === 'function') {
      const actual = args.map(nativeValue)
      if (name === 'putImageData' && actual[0]?.data) {
        const source = actual[0], image = native.createImageData(source.width, source.height)
        image.data.set(source.data); actual[0] = image
      }
      native[name](...actual)
    }
  } })
  return new Proxy(api, {
    get (target, name) { return name in target ? target[name] : state[name] },
    set (_, name, value) { if (state[name] !== value) { state[name] = value; recordCanvasOp(element, `set:${String(name)}`, [value]); if (native && name in native) native[name] = nativeValue(value) } return true }
  })
}

function createRealWebGlContext (element, type, attributes) {
  const factory = element.ownerDocument && offscreenCanvasFactories.get(element.ownerDocument)
  if (!factory) return null
  let reserved = 0
  try {
    const pixels = canvasPixels(element.width, element.height)
    reserveNativePixels(element.ownerDocument, pixels)
    reserved = pixels
    const canvas = factory({ type: type === 'webgl2' ? 'webgl2' : 'webgl', width: element.width, height: element.height })
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('Canvas unavailable')
    if (canvas.width !== element.width) canvas.width = element.width
    if (canvas.height !== element.height) canvas.height = element.height
    // The WXML surface copies this backing asynchronously, after the author frame.
    // Preserve pixels until that copy instead of letting WebGL clear the buffer.
    const contextAttributes = element.ownerDocument._directCanvasFrames ? { ...attributes, preserveDrawingBuffer: true } : attributes
    const gl = canvas.getContext(type === 'experimental-webgl' ? 'webgl' : type, contextAttributes)
    if (!gl) throw new Error('WebGL unavailable')
    nativeCanvasAllocations.set(canvas, reserved)
    const resources = new WeakMap(), wrappers = new WeakMap()
    const unwrap = value => value && typeof value === 'object'
      ? resources.get(value) || runtimeImages.get(value)?.image || real2dCanvases.get(value) || value : value
    const wrapResource = value => {
      if (!value || typeof value !== 'object') return value
      if (wrappers.has(value)) return wrappers.get(value)
      const wrapper = Object.freeze(Object.create(null))
      resources.set(wrapper, value); wrappers.set(value, wrapper)
      return wrapper
    }
    const queryResult = value => {
      if (!value || typeof value !== 'object') return value
      if (ArrayBuffer.isView(value)) return value
      if (Array.isArray(value)) return value.map(queryResult)
      if (/^WebGL(?:Buffer|Framebuffer|Program|Query|Renderbuffer|Sampler|Shader|Sync|Texture|TransformFeedback|UniformLocation|VertexArrayObject)$/.test(value.constructor?.name || '')) return wrapResource(value)
      const result = Object.create(null)
      for (const key of [...Object.keys(value), 'rangeMin', 'rangeMax', 'precision', 'name', 'size', 'type']) {
        if (['string', 'number', 'boolean'].includes(typeof value[key])) result[key] = value[key]
      }
      return result
    }
    const bridge = target => {
      const methods = Object.create(null)
      return new Proxy(Object.create(null), {
        get (_, name) {
          if (name === '__htmlReaderRealWebGl') return true
          if (name === 'canvas') return element
          if (['constructor', '__proto__', 'prototype'].includes(name)) return undefined
          const value = target[name]
          if (typeof value !== 'function') return queryResult(value)
          if (!methods[name]) methods[name] = (...args) => {
            const result = value.apply(target, args.map(unwrap))
            if (!/^(?:check|get|is|read)/i.test(String(name))) markCanvasRevision(element)
            if (name === 'getExtension') return result ? bridge(result) : null
            if (/^create/.test(name) || name === 'getUniformLocation') return wrapResource(result)
            return queryResult(result)
          }
          return methods[name]
        }
      })
    }
    const context = bridge(gl)
    realWebGlCanvases.set(element, { canvas, gl })
    let allocated = nativeCanvasDocuments.get(element.ownerDocument)
    if (!allocated) nativeCanvasDocuments.set(element.ownerDocument, allocated = new Set())
    allocated.add(canvas)
    element._captureWebGlPixels = () => {
      const width = Math.max(1, element.width)
      const height = Math.max(1, element.height)
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return { width, height, data: Array.from(pixels) }
    }
    return context
  } catch (_) {
    if (reserved) reserveNativePixels(element.ownerDocument, -reserved)
    return null
  }
}

function createWebGlContext (element, type, attributes) {
  // Returning a recording-only object defeats the author's Canvas fallback.
  return createRealWebGlContext(element, type, attributes)
}

function nativeFrameForElement (element) {
  const canvas = nativeCanvasForElement(element)
  if (!canvas) return null
  const backing = realWebGlCanvases.get(element)
  return { canvas, readPixels: backing ? data => {
    const gl = backing.gl
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  } : null }
}

function nativeCanvasForElement (element) {
  if (!element || element.ownerDocument._runtimeDisposed) return null
  return real2dCanvases.get(element) || realWebGlCanvases.get(element)?.canvas || null
}

function canvasStateForElement (element) {
  const state = element && element._canvasState ? element._canvasState : { ops: [], rev: 0 }
  if (element?.ownerDocument._directCanvasFrames && nativeCanvasForElement(element)) return { ops: [], rev: state.rev, width: element.width, height: element.height, native: true }
  let webgl = null
  if (element && typeof element._captureWebGlPixels === 'function') {
    try { webgl = element._captureWebGlPixels() } catch (_) {}
  }
  return { ops: state.ops.slice(), rev: state.rev, width: element.width, height: element.height, webgl }
}

function asNode (value, document) { return value instanceof ShimNode ? value : document.createTextNode(String(value)) }

function parseAttributes (source, element) {
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match
  while ((match = matcher.exec(source))) element.setAttribute(match[1], decodeEntities(match[2] != null ? match[2] : match[3] != null ? match[3] : match[4] != null ? match[4] : '', true))
}

function findTagEnd (source, start) {
  let quote = ''
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function closeElementInScope (stack, names, boundaries) {
  for (let index = stack.length - 1; index > 0; index--) {
    const name = stack[index].localName
    if (names.has(name)) { stack.length = index; return }
    if (boundaries.has(name)) return
  }
}

function closeImplicitElements (stack, openingName) {
  const name = String(openingName || '').toLowerCase()
  if (name === 'li' || name === 'dt' || name === 'dd') {
    closeElementInScope(stack, IMPLICIT_CLOSE_ON_OPEN[name], LIST_ITEM_BOUNDARIES)
    closeElementInScope(stack, new Set(['p']), BUTTON_SCOPE_BOUNDARIES)
    return
  }
  if (name === 'optgroup' && stack[stack.length - 1].localName === 'option') stack.pop()
  let closeNames = IMPLICIT_CLOSE_ON_OPEN[name]
  if (P_CLOSING_TAGS.has(name)) closeNames = new Set([...(closeNames || []), 'p'])
  if (!closeNames || !closeNames.size) return
  for (let index = stack.length - 1; index > 0; index--) {
    const localName = stack[index].localName
    if (closeNames.has(localName)) { stack.length = index; return }
    if ((name === 'option' || name === 'optgroup') && localName === 'select') return
    // A row or row group in an inner table cannot implicitly close one in
    // the outer table. Stop at the nearest table even for these start tags.
    if (['html', 'body', 'table', 'template'].includes(localName)) return
  }
}

function parseFragment (html, document) {
  const source = String(html || '').replace(/\r\n?/g, '\n')
  const fragment = document.createDocumentFragment()
  const stack = [fragment]
  let cursor = 0
  while (cursor < source.length) {
    const parent = stack[stack.length - 1]
    if (parent.localName && (RAW_TEXT_TAGS.has(parent.localName) || RCDATA_TAGS.has(parent.localName))) {
      const closingPattern = new RegExp(`<\\/\\s*${parent.localName}\\b`, 'ig')
      closingPattern.lastIndex = cursor
      const closing = closingPattern.exec(source)
      const stop = closing ? closing.index : source.length
      const value = source.slice(cursor, stop)
      if (value) parent.appendChild(document.createTextNode(RCDATA_TAGS.has(parent.localName) ? decodeEntities(value) : value))
      if (!closing) break
      const closingEnd = findTagEnd(source, closing.index)
      stack.pop()
      cursor = closingEnd < 0 ? source.length : closingEnd + 1
      continue
    }
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      const stop = end < 0 ? source.length : end
      parent.appendChild(document.createComment(source.slice(cursor + 4, stop)))
      cursor = end < 0 ? source.length : end + 3
      continue
    }
    if (source[cursor] !== '<') {
      const end = source.indexOf('<', cursor)
      const stop = end < 0 ? source.length : end
      parent.appendChild(document.createTextNode(decodeEntities(source.slice(cursor, stop))))
      cursor = stop
      continue
    }
    if (!/^<\/?[a-zA-Z]/.test(source.slice(cursor))) {
      const declarationEnd = /^<[/!?]/.test(source.slice(cursor)) ? findTagEnd(source, cursor + 1) : -1
      if (declarationEnd >= 0) cursor = declarationEnd + 1
      else { parent.appendChild(document.createTextNode('<')); cursor++ }
      continue
    }
    const tokenEnd = findTagEnd(source, cursor + 1)
    if (tokenEnd < 0) {
      parent.appendChild(document.createTextNode(decodeEntities(source.slice(cursor))))
      break
    }
    const token = source.slice(cursor, tokenEnd + 1)
    cursor = tokenEnd + 1
    if (/^<\//.test(token)) {
      const name = (token.match(/^<\/\s*([^\s>]+)/) || [])[1]
      if (!name) continue
      if (TABLE_END_TAGS.has(name.toLowerCase())) {
        closeElementInScope(stack, new Set([name.toLowerCase()]), TABLE_SCOPE_BOUNDARIES)
        continue
      }
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].localName === name.toLowerCase()) { stack.length = index; break }
      }
    } else {
      const opening = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/)
      if (!opening) continue
      const openingName = opening[1].toLowerCase()
      closeImplicitElements(stack, openingName)
      let targetParent = stack[stack.length - 1]
      if (openingName === 'tr' && targetParent.localName === 'table') {
        const tbody = document.createElement('tbody')
        targetParent.appendChild(tbody)
        stack.push(tbody)
        targetParent = tbody
      }
      const element = document.createElement(opening[1])
      parseAttributes(opening[2], element)
      targetParent.appendChild(element)
      // 普通 HTML 中非 void 元素末尾的 `/` 不具备自闭合语义；进入 SVG
      // 命名空间后必须遵守 XML 自闭合，否则连续的 stop/path/circle 会被错误嵌套。
      const inSvg = element.localName === 'svg' || stack.some(ancestor => ancestor.localName === 'svg')
      const svgSelfClosing = inSvg && /\/\s*>$/.test(token)
      if (!VOID_TAGS.has(element.localName) && !svgSelfClosing) stack.push(element)
    }
  }
  return fragment
}

function findElementSection (source, name) {
  return findElementSections(source, name)[0] || null
}

function markupTokenAt (source, start) {
  if (source[start] !== '<' || source.startsWith('<!--', start)) return null
  const closing = source.startsWith('</', start)
  const match = source.slice(start).match(closing
    ? /^<\/\s*([a-zA-Z][^\s/>]*)/
    : /^<([a-zA-Z][^\s/>]*)/)
  if (!match) return null
  const end = findTagEnd(source, start + match[0].length)
  if (end < 0) return null
  return {
    start,
    end,
    nameEnd: start + match[0].length,
    name: match[1].toLowerCase(),
    closing,
    selfClosing: !closing && /\/\s*>$/.test(source.slice(start, end + 1))
  }
}

function rawTextClosingToken (source, start, name) {
  const pattern = new RegExp(`<\\/\\s*${name}\\b`, 'ig')
  pattern.lastIndex = start
  let match
  while ((match = pattern.exec(source))) {
    const token = markupTokenAt(source, match.index)
    if (token && token.closing && token.name === name) return token
    pattern.lastIndex = match.index + 2
  }
  return null
}

function matchingElementClosingToken (source, start, name) {
  let cursor = start
  let depth = 1
  while (cursor < source.length) {
    const next = source.indexOf('<', cursor)
    if (next < 0) break
    if (source.startsWith('<!--', next)) {
      const commentEnd = source.indexOf('-->', next + 4)
      cursor = commentEnd < 0 ? source.length : commentEnd + 3
      continue
    }
    const token = markupTokenAt(source, next)
    if (!token) { cursor = next + 1; continue }
    if (!token.closing && (RAW_TEXT_TAGS.has(token.name) || RCDATA_TAGS.has(token.name))) {
      const rawClosing = rawTextClosingToken(source, token.end + 1, token.name)
      cursor = rawClosing ? rawClosing.end + 1 : source.length
      continue
    }
    if (token.name === name) {
      if (token.closing && --depth === 0) return token
      if (!token.closing && !token.selfClosing && !VOID_TAGS.has(token.name)) depth++
    }
    cursor = token.end + 1
  }
  return null
}

function findElementSections (source, name) {
  const target = String(name || '').toLowerCase()
  const sections = []
  let cursor = 0
  while (cursor < source.length) {
    const next = source.indexOf('<', cursor)
    if (next < 0) break
    if (source.startsWith('<!--', next)) {
      const commentEnd = source.indexOf('-->', next + 4)
      cursor = commentEnd < 0 ? source.length : commentEnd + 3
      continue
    }
    const opening = markupTokenAt(source, next)
    if (!opening) { cursor = next + 1; continue }
    if (opening.closing) { cursor = opening.end + 1; continue }
    if (RAW_TEXT_TAGS.has(opening.name) || RCDATA_TAGS.has(opening.name)) {
      const closing = rawTextClosingToken(source, opening.end + 1, opening.name)
      if (opening.name === target) {
        sections.push({
          attrs: source.slice(opening.nameEnd, opening.end),
          content: source.slice(opening.end + 1, closing ? closing.start : source.length),
          start: opening.start,
          end: closing ? closing.end + 1 : source.length
        })
      }
      cursor = closing ? closing.end + 1 : source.length
      continue
    }
    if (opening.name !== target) { cursor = opening.end + 1; continue }
    const closing = matchingElementClosingToken(source, opening.end + 1, target)
    sections.push({
      attrs: source.slice(opening.nameEnd, opening.end),
      content: source.slice(opening.end + 1, closing ? closing.start : source.length),
      start: opening.start,
      end: closing ? closing.end + 1 : source.length
    })
    cursor = sections[sections.length - 1].end
  }
  return sections
}

function stripElementSections (source, names) {
  const ranges = names.flatMap(name => findElementSections(source, name)).sort((left, right) => left.start - right.start)
  if (!ranges.length) return source
  let output = ''
  let cursor = 0
  ranges.forEach(range => {
    if (range.start < cursor) return
    output += source.slice(cursor, range.start)
    cursor = range.end
  })
  return output + source.slice(cursor)
}

function parseHtmlDocument (html, options = {}) {
  if (options.contentType === 'application/xhtml+xml') return require('../xhtml-document').parseXhtmlDocument(html, options)
  const source = String(html || '').replace(/\r\n?/g, '\n')
  const scripts = []
  findElementSections(source, 'script').forEach(({ attrs, content }) => {
    const type = (((attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find(value => value != null) || '').split(';')[0]).trim().toLowerCase()
    if (!/\bsrc\s*=/i.test(attrs) && (!type || type === 'module' || /^(?:text|application)\/(?:java|ecma)script$/.test(type))) scripts.push(content)
  })
  const headSection = findElementSection(source, 'head')
  const titleSection = findElementSection(headSection ? headSection.content : source, 'title')
  const htmlSection = findElementSection(source, 'html')
  const bodySection = findElementSection(source, 'body')
  const title = decodeEntities(titleSection ? titleSection.content : '').replace(/[ \t\r\n\f]+/g, ' ').replace(/^ | $/g, '')
  const documentContent = htmlSection ? htmlSection.content : source
  let bodyHtml = bodySection ? bodySection.content : stripElementSections(documentContent, ['head']).replace(/<!doctype[^>]*>/gi, '')
  bodyHtml = stripElementSections(bodyHtml, ['script'])
  const document = new ShimDocument(options)
  if (htmlSection) parseAttributes(htmlSection.attrs, document.documentElement)
  if (bodySection) parseAttributes(bodySection.attrs, document.body)
  if (headSection) parseFragment(stripElementSections(headSection.content, ['script']), document).childNodes.slice().forEach(node => document.head.appendChild(node))
  // An explicit body can still have preceding/trailing style tags. Retain
  // those nodes too; otherwise switching to live sheets loses existing CSS.
  const outsideStyles = bodySection ? findElementSections(source, 'style').filter(section =>
    !(section.start >= bodySection.start && section.end <= bodySection.end) &&
    !(headSection && section.start >= headSection.start && section.end <= headSection.end)) : []
  const appendStyle = (section, parent) => { const node = document.createElement('style'); parseAttributes(section.attrs, node); node.textContent = section.content; parent.appendChild(node) }
  outsideStyles.filter(section => section.start < bodySection.start).forEach(section => appendStyle(section, document.head))
  parseFragment(bodyHtml, document).childNodes.slice().forEach(node => document.body.appendChild(node))
  outsideStyles.filter(section => section.start >= bodySection.end).forEach(section => appendStyle(section, document.body))
  // A leading title without explicit head/body still belongs to the implicit
  // head. Leave titles after body content alone; this is not a full tree builder.
  if (!headSection && !bodySection) {
    for (const child of document.body.childNodes.slice()) {
      if (child.nodeType === 8 || child.nodeType === 3 && /^[\t\n\f\r ]*$/.test(child.data)) continue
      if (child.nodeType === 1 && ['title', 'meta', 'link', 'base', 'style'].includes(child.localName)) document.head.appendChild(child)
      else break
    }
  }
  document._title = title
  document.readyState = 'interactive'
  document._dirty = false
  document._onDirty = options.onDirty || null
  return { document, get styles () { return document.querySelectorAll('style').filter(node => !node.disabled && (!node.getAttribute('type') || node.getAttribute('type').toLowerCase() === 'text/css')).map(node => node.getAttribute('media') ? `@media ${node.getAttribute('media')}{${node.textContent}}` : node.textContent) }, scripts, title }
}

function serializeAttributes (element, includeRuntime = true) {
  const attrs = []
  Object.keys(element._attrs).forEach(name => {
    if (!includeRuntime && name.startsWith('data-hr-')) return
    const value = element._attrs[name]
    attrs.push(value === '' ? (element._attrCase[name] || name) : `${element._attrCase[name] || name}="${escapeAttribute(value)}"`)
  })
  if (includeRuntime && element._nid) attrs.push(`data-hr-nid="${element._nid}"`)
  if (includeRuntime && hasInteractiveListeners(element)) attrs.push('data-hr-touch="1"')
  if (element.localName === 'input' && element._value != null) attrs.push(`value="${escapeAttribute(element._value)}"`)
  if (element.localName === 'input' && element._checked === true && !element.hasAttribute('checked')) attrs.push('checked')
  return attrs.length ? ` ${attrs.join(' ')}` : ''
}

function serializeNode (node, options = {}) {
  if (node.nodeType === 3 || node.nodeType === 8) return node.outerHTML
  if (node.nodeType === 9 || node.nodeType === 11) return node.childNodes.map(child => serializeNode(child, options)).join('')
  const attrs = serializeAttributes(node, options.includeRuntime !== false)
  if (VOID_TAGS.has(node.localName)) return `<${node.localName}${attrs}>`
  let content = node.childNodes.map(child => serializeNode(child, options)).join('')
  if (node.localName === 'textarea' && node._value != null) content = escapeText(node._value)
  return `<${node.localName}${attrs}>${content}</${node.localName}>`
}

function serializeBodyAttributes (document) { return serializeAttributes(document.body, false).trim() }

function descendants (root) {
  const output = []
  const visit = node => node.childNodes.forEach(child => { if (child.nodeType === 1) output.push(child); visit(child) })
  visit(root)
  return output
}

function querySelectorAllFrom (root, selector) {
  const selectors = splitTopLevel(String(selector || ''), ',')
  if (!selectors.length) return []
  return descendants(root).filter(node => selectors.some(item => matchSelector(node, item)))
}

function tokenizeSelector (selector) {
  const tokens = []
  let buffer = ''
  let quote = ''
  let square = 0
  let round = 0
  let pendingSpace = false
  const push = () => { if (buffer) { tokens.push(buffer); buffer = '' } }
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (quote) { buffer += char; if (char === '\\') buffer += selector[++index] || ''; else if (char === quote) quote = ''; continue }
    if (char === '\\') {
      if (pendingSpace) { push(); if (tokens.length && !['>', '+', '~', ' '].includes(tokens[tokens.length - 1])) tokens.push(' '); pendingSpace = false }
      const escape = consumeCssEscape(selector, index)
      if (!escape.valid) return []
      buffer += selector.slice(index, escape.end); index = escape.end - 1; continue
    }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue }
    if (char === '[') square++
    else if (char === ']') square--
    else if (char === '(') round++
    else if (char === ')') round--
    if (!square && !round && /[\t\n ]/.test(char)) { if (buffer) pendingSpace = true; continue }
    if (!square && !round && ['>', '+', '~'].includes(char)) { push(); tokens.push(char); pendingSpace = false; continue }
    if (pendingSpace) { push(); if (tokens.length && !['>', '+', '~', ' '].includes(tokens[tokens.length - 1])) tokens.push(' '); pendingSpace = false }
    buffer += char
  }
  push()
  return tokens
}

// 只缓存选择器语法，不缓存匹配结果；class、属性、伪类和节点关系仍逐次读取。
// 同一条规则会被每个节点重复匹配。限制条数和总字符数，避免连续打开文件累积内存。
const selectorTokenCache = new Map()
let selectorTokenChars = 0
function selectorTokens (selector) {
  const source = String(selector || '')
  if (selectorTokenCache.has(source)) return selectorTokenCache.get(source)
  const tokens = tokenizeSelector(preprocessCss(source))
  if (source.length <= 4096) {
    while (selectorTokenCache.size >= 512 || selectorTokenChars + source.length > 65536) {
      const oldest = selectorTokenCache.keys().next().value
      selectorTokenChars -= oldest.length
      selectorTokenCache.delete(oldest)
    }
    selectorTokenCache.set(source, tokens)
    selectorTokenChars += source.length
  }
  return tokens
}

function matchSelector (element, selector) {
  const tokens = selectorTokens(selector)
  if (!tokens.length || tokens.length % 2 === 0) return false
  function matchAt (node, index) {
    if (!node || node.nodeType !== 1 || !matchCompound(node, tokens[index])) return false
    if (index === 0) return true
    const combinator = tokens[index - 1]
    if (combinator === '>') return matchAt(node.parentNode, index - 2)
    if (combinator === '+') return matchAt(node.previousElementSibling, index - 2)
    if (combinator === '~') { let sibling = node.previousElementSibling; while (sibling) { if (matchAt(sibling, index - 2)) return true; sibling = sibling.previousElementSibling } return false }
    let parent = node.parentNode
    while (parent && parent.nodeType === 1) { if (matchAt(parent, index - 2)) return true; parent = parent.parentNode }
    return false
  }
  return matchAt(element, tokens.length - 1)
}

function consumeCssIdentifier (source, prefix) {
  if (!source.startsWith(prefix)) return null
  const name = consumeCssName(source, prefix.length)
  return name.value ? { value: name.value, length: name.end } : null
}

function matchCompound (element, compound) {
  let rest = String(compound || '')
  const first = rest.codePointAt(0)
  const tag = rest[0] === '*' ? { value: '*', end: 1 } : /[a-zA-Z_-]/.test(rest[0] || '') || first >= 0x80 || rest[0] === '\\' ? consumeCssName(rest) : null
  if (tag && tag.value) { if (tag.value !== '*' && element.localName !== (element.ownerDocument._xmlMode ? tag.value : tag.value.toLowerCase())) return false; rest = rest.slice(tag.end) }
  else if (!/^[.#[:]/.test(rest)) return false
  while (rest) {
    let match
    const id = consumeCssIdentifier(rest, '#')
    const className = consumeCssIdentifier(rest, '.')
    if (id) { if (element.id !== id.value) return false; match = [rest.slice(0, id.length)] }
    else if (className) { if (!element.classList.contains(className.value)) return false; match = [rest.slice(0, className.length)] }
    else if ((match = rest.match(/^\[\s*([^\s~|^$*!=\]]+)\s*(?:(\^=|\$=|\*=|~=|\|=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/))) {
      const actual = element.getAttribute(match[1]); const expected = match[3] != null ? match[3] : match[4] != null ? match[4] : match[5]
      if (actual == null) return false
      if (match[2] === '=' && actual !== expected) return false
      if (match[2] === '^=' && !actual.startsWith(expected)) return false
      if (match[2] === '$=' && !actual.endsWith(expected)) return false
      if (match[2] === '*=' && !actual.includes(expected)) return false
      if (match[2] === '~=' && !actual.split(/\s+/).includes(expected)) return false
      if (match[2] === '|=' && actual !== expected && !actual.startsWith(`${expected}-`)) return false
    } else if ((match = rest.match(/^:root\b/))) {
      if (!element.ownerDocument || element.ownerDocument.documentElement !== element) return false
    } else if ((match = rest.match(/^:empty\b/))) {
      if (element.childNodes.some(node => node.nodeType === 1 || node.nodeType === 3)) return false
    } else if ((match = rest.match(/^:(first-child|last-child|only-child)\b/))) {
      const siblings = element.parentNode ? element.parentNode.children : [element]
      if (match[1] === 'first-child' && siblings[0] !== element) return false
      if (match[1] === 'last-child' && siblings[siblings.length - 1] !== element) return false
      if (match[1] === 'only-child' && siblings.length !== 1) return false
    } else if ((match = rest.match(/^:(first-of-type|last-of-type|only-of-type)\b/))) {
      const siblings = (element.parentNode ? element.parentNode.children : [element]).filter(sibling => sibling.localName === element.localName)
      if (match[1] === 'first-of-type' && siblings[0] !== element) return false
      if (match[1] === 'last-of-type' && siblings[siblings.length - 1] !== element) return false
      if (match[1] === 'only-of-type' && siblings.length !== 1) return false
    } else if ((match = rest.match(/^:nth-child\(\s*([^)]*)\)/))) {
      const siblings = element.parentNode ? element.parentNode.children : [element]
      if (!nthMatches(siblings.indexOf(element) + 1, match[1])) return false
    } else if ((match = rest.match(/^:nth-last-child\(\s*([^)]*)\)/))) {
      const siblings = element.parentNode ? element.parentNode.children : [element]
      if (!nthMatches(siblings.length - siblings.indexOf(element), match[1])) return false
    } else if ((match = rest.match(/^:nth-of-type\(\s*([^)]*)\)/))) {
      const siblings = (element.parentNode ? element.parentNode.children : [element]).filter(sibling => sibling.localName === element.localName)
      if (!nthMatches(siblings.indexOf(element) + 1, match[1])) return false
    } else if ((match = rest.match(/^:nth-last-of-type\(\s*([^)]*)\)/))) {
      const siblings = (element.parentNode ? element.parentNode.children : [element]).filter(sibling => sibling.localName === element.localName)
      if (!nthMatches(siblings.length - siblings.indexOf(element), match[1])) return false
    } else if ((match = rest.match(/^:(checked|disabled|enabled|required|optional|read-only|read-write)\b/))) {
      const state = match[1]
      const formControl = supportsDisabled(element)
      const checkable = element.localName === 'input' && /^(?:checkbox|radio)$/.test(element.type) || element.localName === 'option'
      const editable = element.isContentEditable || /^(?:input|textarea)$/.test(element.localName) && !element.readOnly && !disabledControl(element)
      if (state === 'checked' && !(checkable && (element.checked || element.selected))) return false
      if (state === 'disabled' && !(formControl && actuallyDisabled(element))) return false
      if (state === 'enabled' && !(formControl && !actuallyDisabled(element))) return false
      if (state === 'required' && !(formControl && element.required)) return false
      if (state === 'optional' && !(formControl && !element.required)) return false
      if (state === 'read-only' && editable) return false
      if (state === 'read-write' && !editable) return false
    } else if ((match = rest.match(/^:not\(([^()]*)\)/))) { if (matchCompound(element, match[1].trim())) return false }
    else return false
    rest = rest.slice(match[0].length)
  }
  return true
}

function nthMatches (index, expression) {
  const value = String(expression || '').replace(/\s+/g, '').toLowerCase()
  if (value === 'odd') return index % 2 === 1
  if (value === 'even') return index % 2 === 0
  if (/^[+-]?\d+$/.test(value)) return index === Number(value)
  const match = value.match(/^([+-]?\d*)n([+-]\d+)?$/)
  if (!match) return false
  const a = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number(match[1])
  const b = Number(match[2] || 0)
  return a === 0 ? index === b : (index - b) / a >= 0 && Number.isInteger((index - b) / a)
}

function hasInteractiveListeners (element) {
  return ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'].some(type => typeof element[`on${type}`] === 'function' || element._listeners[type] && element._listeners[type].length)
}

function hasClickListeners (element) {
  if (!element) return false
  return typeof element.onclick === 'function' ||
    typeof element._inlineHandlers.click === 'function' ||
    Boolean(element._listeners.click && element._listeners.click.length)
}

function dispatchDomClick (element, hostAction) {
  if (!element || disabledClick(element)) return false
  const proceed = element.dispatchEvent(new ShimEvent('click'))
  if (!proceed) return false
  if (element.isContentEditable && typeof hostAction === 'function') {
    const editable = element.closest('[contenteditable]') || element
    hostAction({ type: 'edit', nid: editable._nid, value: editable.textContent })
    return true
  }
  if (element.localName === 'summary' && element.parentNode && element.parentNode.localName === 'details') {
    element.parentNode.toggleAttribute('open')
    element.parentNode.dispatchEvent(new ShimEvent('toggle', { bubbles: false }))
  }
  if (element.localName === 'label') {
    const target = element.getAttribute('for') ? element.ownerDocument.getElementById(element.getAttribute('for')) : element.querySelector('input,select,textarea,button')
    if (target) dispatchDomClick(target, hostAction)
  }
  if (element.localName === 'input' && /^(checkbox|radio)$/.test(element.type)) {
    if (element.type === 'radio') {
      const scope = element.form || element.ownerDocument
      const name = element.name
      if (name && scope) scope.querySelectorAll('input[type="radio"]').filter(radio => radio.name === name).forEach(radio => { if (radio !== element) radio.checked = false })
      element.checked = true
    } else element.checked = !element.checked
    element.dispatchEvent(new ShimEvent('change'))
  }
  if (element.localName === 'a' && element.getAttribute('href') && typeof hostAction === 'function') {
    const href = element.getAttribute('href')
    hostAction(href[0] === '#' ? { type: 'anchor', value: href.slice(1) } : { type: 'link', value: href })
  }
  if ((element.localName === 'button' || element.localName === 'input') && element.form) {
    if (element.type === 'reset') {
      const resetProceed = element.form.dispatchEvent(new ShimEvent('reset'))
      if (resetProceed) resetForm(element.form)
    } else if (element.type === 'submit') {
      const submitProceed = element.form.dispatchEvent(new ShimEvent('submit'))
      if (submitProceed && String(element.form.getAttribute('method') || '').toLowerCase() === 'dialog') {
        const dialog = element.form.closest('dialog')
        if (dialog) dialog.close(element.value)
      }
    }
  }
  return true
}

function resetForm (form) {
  form.querySelectorAll('input,select,textarea,option').forEach(control => {
    control._value = undefined
    control._checked = undefined
    control._selected = undefined
  })
  form._markDirty()
}

function createLocation () {
  return {
    href: 'https://local.invalid/#/',
    origin: 'https://local.invalid',
    protocol: 'https:',
    host: 'local.invalid',
    hostname: 'local.invalid',
    port: '',
    pathname: '/',
    search: '',
    hash: '#/',
    assign (value) { this.href = String(value || this.href) },
    replace (value) { this.href = String(value || this.href) },
    reload () {},
    toString () { return this.href }
  }
}

function cssEscape (value) { return String(value).replace(/[^\w-]/g, char => `\\${char.codePointAt(0).toString(16)} `) }

module.exports = {
  observePixelWork,
  ShimImageElement,
  imageConstructor,
  disposeRuntimeImages,
  disposeRuntimeCanvases,
  ShimComment,
  ShimCustomEvent,
  ShimDocument,
  ShimElement,
  ShimEvent,
  ShimFragment,
  ShimNode,
  ShimText,
  canvasStateForElement,
  nativeCanvasForElement,
  nativeFrameForElement,
  createLocation,
  cssEscape,
  dispatchDomClick,
  hasClickListeners,
  hasInteractiveListeners,
  matchSelector,
  nthMatches,
  parseFragment,
  parseHtmlDocument,
  serializeBodyAttributes,
  serializeNode,
  splitTopLevel,
  styleText
}
