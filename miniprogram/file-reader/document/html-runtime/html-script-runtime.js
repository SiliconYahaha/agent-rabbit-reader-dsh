'use strict'

const { disabledControl, disabledOption } = require('./form-disabled-state')
const Sval = require('./vendor/sval')
const { svgHitTest } = require('../svg-hit-test')
const { parseImageScript } = require('../image-script-budget')
const { substituteTrustedThree } = require('./trusted-three')
const { createReactCompatRuntime } = require('./react-compat-runtime')
const { mediaQueryMatches } = require('../media-query')
const {
  ShimComment,
  ShimCustomEvent,
  ShimDocument,
  ShimElement,
  ShimImageElement,
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
  imageConstructor,
  disposeRuntimeImages,
  disposeRuntimeCanvases,
  parseHtmlDocument,
  serializeBodyAttributes,
  serializeNode
} = require('./html-dom-shim')

const DEFAULT_MAX_TIMER_FIRES = 240
const DEFAULT_MAX_EXECUTION_STEPS = 50000
const DEFAULT_MAX_SCRIPT_LENGTH = 2 * 1024 * 1024
const RECONCILE_SKIPS = 12

const FUNCTION_NODE_TYPES = new Set(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'])
const LOOP_NODE_TYPES = new Set(['DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement'])

function instrumentExecutionGuards (ast, consumeStep) {
  const guard = () => ({
    type: 'ExpressionStatement',
    expression: { type: 'CallExpression', callee: { type: 'Literal', value: consumeStep, raw: 'null' }, arguments: [], optional: false }
  })
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      ;(node.params || []).forEach(visit)
      if (node.body && node.body.type === 'BlockStatement') {
        node.body.body.forEach(visit)
        node.body.body.unshift(guard())
      } else if (node.body) {
        const expression = node.body
        visit(expression)
        node.body = { type: 'BlockStatement', body: [guard(), { type: 'ReturnStatement', argument: expression }] }
        node.expression = false
      }
      return
    }
    if (LOOP_NODE_TYPES.has(node.type)) {
      Object.keys(node).forEach(key => { if (key !== 'body') visit(node[key]) })
      const body = node.body
      visit(body)
      if (body && body.type === 'BlockStatement') body.body.unshift(guard())
      else node.body = { type: 'BlockStatement', body: [guard(), body].filter(Boolean) }
      return
    }
    Object.keys(node).forEach(key => {
      if (!['loc', 'start', 'end', 'raw'].includes(key)) visit(node[key])
    })
  }
  visit(ast)
  return ast
}

function memberName (node) {
  if (!node || node.type !== 'MemberExpression') return ''
  if (!node.computed && node.property && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property && node.property.type === 'Literal') return String(node.property.value)
  return ''
}

function transformReactRootCalls (ast) {
  let transformed = 0
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.type === 'CallExpression' && memberName(node.callee) === 'render') {
      const createRootCall = node.callee.object
      const createRootMember = createRootCall && createRootCall.type === 'CallExpression' ? createRootCall.callee : null
      if (memberName(createRootMember) === 'createRoot' && createRootCall.arguments && createRootCall.arguments.length && node.arguments && node.arguments.length) {
        const element = node.arguments[0]
        const strictMode = element && element.type === 'CallExpression' && element.arguments && element.arguments[0]
        const reactObject = strictMode && strictMode.type === 'MemberExpression' && memberName(strictMode) === 'StrictMode' ? strictMode.object : null
        node.callee = { type: 'Identifier', name: '__htmlReaderRenderReactRoot' }
        node.arguments = [createRootCall.arguments[0], element, reactObject && reactObject.type === 'Identifier' ? reactObject : { type: 'Literal', value: null, raw: 'null' }]
        transformed++
      }
    }
    Object.keys(node).forEach(key => {
      if (!['loc', 'start', 'end', 'raw'].includes(key)) visit(node[key])
    })
  }
  visit(ast)
  return transformed
}

const { atobSafe, btoaSafe, bytesToBase64, utf8Decode, utf8Encode } = require('../kernel').textCodec

class MemoryStorage {
  constructor () { this._values = Object.create(null) }
  get length () { return Object.keys(this._values).length }
  key (index) { return Object.keys(this._values)[index] || null }
  getItem (key) { const name = String(key); return Object.prototype.hasOwnProperty.call(this._values, name) ? this._values[name] : null }
  setItem (key, value) { this._values[String(key)] = String(value) }
  removeItem (key) { delete this._values[String(key)] }
  clear () { this._values = Object.create(null) }
}

class ShimURLSearchParams {
  constructor (input = '') {
    this._pairs = []
    if (typeof input === 'string') String(input).replace(/^\?/, '').split('&').filter(Boolean).forEach(part => {
      const index = part.indexOf('=')
      this.append(decodeURIComponent((index < 0 ? part : part.slice(0, index)).replace(/\+/g, ' ')), decodeURIComponent((index < 0 ? '' : part.slice(index + 1)).replace(/\+/g, ' ')))
    })
    else if (input && typeof input[Symbol.iterator] === 'function') for (const pair of input) this.append(pair[0], pair[1])
    else if (input) Object.keys(input).forEach(key => this.append(key, input[key]))
  }
  append (name, value) { this._pairs.push([String(name), String(value)]) }
  delete (name) { this._pairs = this._pairs.filter(pair => pair[0] !== String(name)) }
  get (name) { const pair = this._pairs.find(pair => pair[0] === String(name)); return pair ? pair[1] : null }
  getAll (name) { return this._pairs.filter(pair => pair[0] === String(name)).map(pair => pair[1]) }
  has (name) { return this._pairs.some(pair => pair[0] === String(name)) }
  set (name, value) { this.delete(name); this.append(name, value) }
  sort () { this._pairs.sort((left, right) => left[0].localeCompare(right[0])) }
  forEach (callback, thisArg) { this._pairs.forEach(pair => callback.call(thisArg, pair[1], pair[0], this)) }
  entries () { return this._pairs[Symbol.iterator]() }
  keys () { return this._pairs.map(pair => pair[0])[Symbol.iterator]() }
  values () { return this._pairs.map(pair => pair[1])[Symbol.iterator]() }
  [Symbol.iterator] () { return this.entries() }
  toString () { return this._pairs.map(pair => `${encodeURIComponent(pair[0]).replace(/%20/g, '+')}=${encodeURIComponent(pair[1]).replace(/%20/g, '+')}`).join('&') }
}

class ShimURL {
  constructor (input, base) {
    const raw = String(input && typeof input === 'object' && input.href != null ? input.href : input || '')
    const baseValue = String(base && typeof base === 'object' && base.href != null ? base.href : base || 'https://local.invalid/')
    const baseOrigin = (baseValue.match(/^([a-z][\w+.-]*:\/\/[^/]+)/i) || [])[1] || ''
    const baseWithoutHash = baseValue.replace(/#.*$/, '')
    const baseWithoutSearch = baseWithoutHash.replace(/\?.*$/, '')
    const absolute = /^[a-z][\w+.-]*:/i.test(raw)
      ? raw
      : raw.startsWith('#')
        ? `${baseWithoutHash}${raw}`
        : raw.startsWith('?')
          ? `${baseWithoutSearch}${raw}`
      : raw.startsWith('/')
        ? `${baseOrigin}${raw}`
        : `${baseWithoutSearch.replace(/[^/]*$/, '')}${raw}`
    const match = absolute.match(/^([a-z][\w+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i)
    if (!match) throw new TypeError('Invalid URL')
    this.protocol = match[1]
    this.host = match[2] || ''
    this.hostname = this.host.split(':')[0]
    this.port = this.host.includes(':') ? this.host.slice(this.host.lastIndexOf(':') + 1) : ''
    this.pathname = match[3] || '/'
    this.search = match[4] || ''
    this.hash = match[5] || ''
    this.origin = this.host ? `${this.protocol}//${this.host}` : 'null'
    this.searchParams = new ShimURLSearchParams(this.search)
  }
  get href () { const search = this.searchParams.toString(); return `${this.origin === 'null' ? this.protocol : this.origin}${this.pathname}${search ? `?${search}` : ''}${this.hash}` }
  set href (value) { const next = new ShimURL(value); Object.assign(this, next) }
  toString () { return this.href }
  toJSON () { return this.href }
  static createObjectURL (blob) { return `data:${blob && blob.type || 'application/octet-stream'};base64,${bytesToBase64(blob && blob._bytes || [])}` }
  static revokeObjectURL () {}
}

class ShimBlob {
  constructor (parts = [], options = {}) {
    const bytes = []
    parts.forEach(part => {
      const value = part instanceof Uint8Array ? part : part && part._bytes ? part._bytes : utf8Encode(String(part == null ? '' : part))
      bytes.push(...value)
    })
    this._bytes = new Uint8Array(bytes)
    this.size = this._bytes.length
    this.type = String(options.type || '').toLowerCase()
  }
  text () { return Promise.resolve(utf8Decode(this._bytes)) }
  arrayBuffer () { return Promise.resolve(this._bytes.buffer.slice(this._bytes.byteOffset, this._bytes.byteOffset + this._bytes.byteLength)) }
  slice (start = 0, end = this.size, type = '') { return new ShimBlob([this._bytes.slice(start, end)], { type }) }
}

class ShimFile extends ShimBlob {
  constructor (parts, name, options = {}) { super(parts, options); this.name = String(name || ''); this.lastModified = Number(options.lastModified || Date.now()) }
}

function createFileReader (defer) {
  return class ShimFileReader {
    constructor () { this.result = null; this.error = null; this.readyState = 0 }
    _read (blob, convert) {
      this.readyState = 1
      defer(() => {
        try { this.result = convert(blob); this.readyState = 2; if (typeof this.onload === 'function') this.onload(new ShimEvent('load')); if (typeof this.onloadend === 'function') this.onloadend(new ShimEvent('loadend')) } catch (error) { this.error = error; this.readyState = 2; if (typeof this.onerror === 'function') this.onerror(new ShimEvent('error')); if (typeof this.onloadend === 'function') this.onloadend(new ShimEvent('loadend')) }
      }, 0)
    }
    readAsText (blob) { this._read(blob, value => utf8Decode(value._bytes)) }
    readAsArrayBuffer (blob) { this._read(blob, value => value._bytes.buffer.slice(value._bytes.byteOffset, value._bytes.byteOffset + value._bytes.byteLength)) }
    readAsDataURL (blob) { this._read(blob, value => `data:${value.type || 'application/octet-stream'};base64,${bytesToBase64(value._bytes)}`) }
    abort () { this.readyState = 2 }
  }
}

class ShimFormData {
  constructor (form) {
    this._pairs = []
    if (form && form.elements) form.elements.forEach(element => {
      if (!element.name || disabledControl(element) || /^(?:submit|button|reset)$/.test(element.type) || /^(?:checkbox|radio)$/.test(element.type) && !element.checked) return
      if (element.localName === 'select') {
        const options = element.options || []
        options.forEach((option, index) => {
          if (!(element.multiple ? option.selected : index === element.selectedIndex) || disabledOption(option)) return
          this.append(element.name, option.getAttribute('value') == null ? option.textContent : option.getAttribute('value'))
        })
      } else this.append(element.name, element.value)
    })
  }
  append (name, value) { this._pairs.push([String(name), value]) }
  set (name, value) { this.delete(name); this.append(name, value) }
  get (name) { const pair = this._pairs.find(pair => pair[0] === String(name)); return pair ? pair[1] : null }
  getAll (name) { return this._pairs.filter(pair => pair[0] === String(name)).map(pair => pair[1]) }
  has (name) { return this._pairs.some(pair => pair[0] === String(name)) }
  delete (name) { this._pairs = this._pairs.filter(pair => pair[0] !== String(name)) }
  entries () { return this._pairs[Symbol.iterator]() }
  keys () { return this._pairs.map(pair => pair[0])[Symbol.iterator]() }
  values () { return this._pairs.map(pair => pair[1])[Symbol.iterator]() }
  [Symbol.iterator] () { return this.entries() }
  forEach (callback, thisArg) { this._pairs.forEach(pair => callback.call(thisArg, pair[1], pair[0], this)) }
}

function createAbortController () {
  return class AbortController {
    constructor () { this.signal = { aborted: false, reason: undefined, addEventListener () {}, removeEventListener () {} } }
    abort (reason) { this.signal.aborted = true; this.signal.reason = reason }
  }
}

const BLOCKED_META_PROPERTIES = new Set(['constructor', '__proto__', 'prototype'])

function assertSafeMetaProperty (property) {
  if (BLOCKED_META_PROPERTIES.has(String(property))) throw new TypeError('HTML Reader blocked unsafe property access')
  return property
}

function createSafeObjectConstructor () {
  const prototypeViews = new WeakMap()
  function safePrototypeView (prototype) {
    if (prototype == null || typeof prototype !== 'object' && typeof prototype !== 'function') return null
    if (prototypeViews.has(prototype)) return prototypeViews.get(prototype)
    const view = Object.create(null)
    prototypeViews.set(prototype, view)
    let cursor = prototype
    while (cursor) {
      Reflect.ownKeys(cursor).forEach(property => {
        if (BLOCKED_META_PROPERTIES.has(String(property)) || Object.prototype.hasOwnProperty.call(view, property)) return
        const descriptor = Object.getOwnPropertyDescriptor(cursor, property)
        if (!descriptor) return
        const next = { ...descriptor, configurable: true }
        if (typeof next.value === 'function') next.value = function (...args) { return descriptor.value.apply(this, args) }
        if (typeof next.get === 'function') next.get = function () { return descriptor.get.call(this) }
        if (typeof next.set === 'function') next.set = function (value) { return descriptor.set.call(this, value) }
        try { Object.defineProperty(view, property, next) } catch (_) {}
      })
      cursor = Object.getPrototypeOf(cursor)
    }
    return view
  }
  function SandboxObject (value) { return value == null ? {} : Object(value) }
  const passthrough = [
    'assign', 'create', 'defineProperties', 'defineProperty', 'entries', 'freeze',
    'fromEntries', 'getOwnPropertyNames', 'getOwnPropertySymbols', 'hasOwn', 'is',
    'isExtensible', 'isFrozen', 'isSealed', 'keys', 'preventExtensions', 'seal', 'values'
  ]
  passthrough.forEach(name => {
    if (typeof Object[name] === 'function') SandboxObject[name] = (...args) => Object[name](...args)
  })
  SandboxObject.getOwnPropertyDescriptor = (target, property) => {
    assertSafeMetaProperty(property)
    return Object.getOwnPropertyDescriptor(target, property)
  }
  SandboxObject.getOwnPropertyDescriptors = target => {
    const descriptors = Object.getOwnPropertyDescriptors(target)
    BLOCKED_META_PROPERTIES.forEach(property => { delete descriptors[property] })
    return descriptors
  }
  SandboxObject.getPrototypeOf = target => safePrototypeView(Object.getPrototypeOf(target))
  SandboxObject.setPrototypeOf = () => { throw new TypeError('HTML Reader blocked prototype mutation') }
  return SandboxObject
}

function createSafeReflect () {
  return {
    defineProperty: (...args) => Reflect.defineProperty(...args),
    deleteProperty: (...args) => Reflect.deleteProperty(...args),
    get: (target, property, receiver) => Reflect.get(target, assertSafeMetaProperty(property), receiver),
    getOwnPropertyDescriptor: (target, property) => {
      assertSafeMetaProperty(property)
      return Reflect.getOwnPropertyDescriptor(target, property)
    },
    has: (target, property) => !BLOCKED_META_PROPERTIES.has(String(property)) && Reflect.has(target, property),
    isExtensible: (...args) => Reflect.isExtensible(...args),
    ownKeys: target => Reflect.ownKeys(target).filter(property => !BLOCKED_META_PROPERTIES.has(String(property))),
    preventExtensions: (...args) => Reflect.preventExtensions(...args),
    set: (target, property, value, receiver) => Reflect.set(target, assertSafeMetaProperty(property), value, receiver)
  }
}

function createIntlCompat (hostIntl) {
  const source = hostIntl && typeof hostIntl === 'object' ? hostIntl : {}
  const copy = name => typeof source[name] === 'function' ? source[name] : null
  class NumberFormatFallback {
    constructor (_locales, options = {}) { this.options = options || {} }
    format (input) {
      let value = Number(input)
      if (!Number.isFinite(value)) return String(value)
      if (this.options.style === 'percent') value *= 100
      const maximum = Number.isInteger(this.options.maximumFractionDigits) ? this.options.maximumFractionDigits : 3
      const minimum = Number.isInteger(this.options.minimumFractionDigits) ? this.options.minimumFractionDigits : 0
      let output = value.toFixed(Math.max(minimum, Math.min(20, maximum)))
      if (maximum > minimum && output.includes('.')) output = output.replace(/0+$/, '').replace(/\.$/, '')
      const parts = output.split('.')
      if (this.options.useGrouping !== false) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      output = parts.join('.')
      if (this.options.style === 'percent') output += '%'
      if (this.options.style === 'currency' && this.options.currency) output = `${this.options.currency} ${output}`
      return output
    }
    formatToParts (input) { return [{ type: 'literal', value: this.format(input) }] }
    resolvedOptions () { return { locale: 'zh-CN', numberingSystem: 'latn', style: this.options.style || 'decimal', ...this.options } }
    static supportedLocalesOf (locales) { return Array.isArray(locales) ? locales.slice() : locales == null ? [] : [locales] }
  }
  class DateTimeFormatFallback {
    constructor (_locales, options = {}) { this.options = options || {} }
    format (input = Date.now()) {
      const value = input instanceof Date ? input : new Date(input)
      if (Number.isNaN(value.getTime())) return 'Invalid Date'
      const pad = number => String(number).padStart(2, '0')
      const date = `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()}`
      const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
      const wantsDate = ['dateStyle', 'year', 'month', 'day', 'weekday'].some(key => this.options[key] != null)
      const wantsTime = ['timeStyle', 'hour', 'minute', 'second'].some(key => this.options[key] != null)
      return wantsTime && !wantsDate ? time : wantsDate && !wantsTime ? date : `${date} ${time}`
    }
    formatToParts (input) { return [{ type: 'literal', value: this.format(input) }] }
    resolvedOptions () { return { locale: 'zh-CN', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'local', ...this.options } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  class CollatorFallback {
    compare (left, right) { return String(left).localeCompare(String(right)) }
    resolvedOptions () { return { locale: 'zh-CN', usage: 'sort', sensitivity: 'variant' } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  class PluralRulesFallback {
    select (value) { return Number(value) === 1 ? 'one' : 'other' }
    selectRange (start, end) { return this.select(start) === this.select(end) ? this.select(end) : 'other' }
    resolvedOptions () { return { locale: 'zh-CN', type: 'cardinal', pluralCategories: ['one', 'other'] } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  class RelativeTimeFormatFallback {
    format (value, unit) { return `${Number(value)} ${String(unit || '')}`.trim() }
    formatToParts (value, unit) { return [{ type: 'literal', value: this.format(value, unit) }] }
    resolvedOptions () { return { locale: 'zh-CN', numeric: 'always', style: 'long' } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  class ListFormatFallback {
    format (values) { return Array.from(values || []).map(String).join('、') }
    formatToParts (values) { return [{ type: 'literal', value: this.format(values) }] }
    resolvedOptions () { return { locale: 'zh-CN', type: 'conjunction', style: 'long' } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  class DisplayNamesFallback {
    of (code) { return code == null ? undefined : String(code) }
    resolvedOptions () { return { locale: 'zh-CN', style: 'long', fallback: 'code' } }
    static supportedLocalesOf (locales) { return NumberFormatFallback.supportedLocalesOf(locales) }
  }
  const compat = {
    NumberFormat: copy('NumberFormat') || NumberFormatFallback,
    DateTimeFormat: copy('DateTimeFormat') || DateTimeFormatFallback,
    Collator: copy('Collator') || CollatorFallback,
    PluralRules: copy('PluralRules') || PluralRulesFallback,
    RelativeTimeFormat: copy('RelativeTimeFormat') || RelativeTimeFormatFallback,
    ListFormat: copy('ListFormat') || ListFormatFallback,
    DisplayNames: copy('DisplayNames') || DisplayNamesFallback,
    getCanonicalLocales: copy('getCanonicalLocales') || NumberFormatFallback.supportedLocalesOf
  }
  if (copy('Locale')) compat.Locale = copy('Locale')
  if (copy('Segmenter')) compat.Segmenter = copy('Segmenter')
  return compat
}

function createStandardGlobals (SandboxObject, SandboxReflect, disabledDynamicCode, sandboxEval, hostIntl) {
  const globals = {
    Object: SandboxObject,
    Function: disabledDynamicCode,
    Reflect: SandboxReflect,
    eval: sandboxEval,
    Array,
    ArrayBuffer,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    Uint8ClampedArray,
    DataView,
    Number,
    parseFloat,
    parseInt,
    Infinity,
    NaN,
    undefined,
    Boolean,
    String,
    Symbol,
    Date,
    Promise,
    RegExp,
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
    JSON,
    Math,
    Intl: createIntlCompat(hostIntl),
    Map,
    Set,
    WeakMap,
    WeakSet,
    Proxy,
    decodeURI,
    decodeURIComponent,
    encodeURI,
    encodeURIComponent,
    isFinite,
    isNaN
  }
  if (typeof BigInt === 'function') globals.BigInt = BigInt
  if (typeof BigInt64Array === 'function') globals.BigInt64Array = BigInt64Array
  if (typeof BigUint64Array === 'function') globals.BigUint64Array = BigUint64Array
  if (typeof AggregateError === 'function') globals.AggregateError = AggregateError
  return globals
}

function createRuntime (html, options = {}) {
  const hostSetTimeout = options.setTimeout || setTimeout
  const hostClearTimeout = options.clearTimeout || clearTimeout
  const hostSetInterval = options.setInterval || setInterval
  const hostClearInterval = options.clearInterval || clearInterval
  const activeTimers = new Set()
  const animationCallbacks = new Map()
  let animationId = 0, animationTimer = null, visible = true
  const errors = []
  const maxTimerFires = Number(options.maxTimerFires || DEFAULT_MAX_TIMER_FIRES)
  const maxExecutionSteps = Number(options.maxExecutionSteps || DEFAULT_MAX_EXECUTION_STEPS)
  const maxScriptLength = Number(options.maxScriptLength || DEFAULT_MAX_SCRIPT_LENGTH)
  let timerFires = 0
  let executionSteps = 0
  let trustedBootstrap = false, bootstrapSteps = 0, bootstrapDeadline = 0
  let bootstrapTurnReset = null
  let hostGestureDepth = 0
  let tapBudget = null
  let destroyed = false
  let flushScheduled = false
  let lastRenderKey = ''
  let lastCanvasKey = ''
  let skips = 0
  let interpreter = null
  let evalSequence = 0
  let evalDepth = 0
  let readComputedStyle = null

  const scheduleFlush = () => {
    if (destroyed || flushScheduled) return
    flushScheduled = true
    hostSetTimeout(() => { flushScheduled = false; flush() }, 0)
  }
  const parsed = parseHtmlDocument(html, {
    contentType: options.contentType,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    onTitle: options.onTitle,
    onDirty: scheduleFlush,
    location: options.location || createLocation(),
    createOffscreenCanvas: options.createOffscreenCanvas,
    resolveImageSource: options.resolveImageSource,
    imageDecodeTimeout: options.imageDecodeTimeout,
    onImageError: error => reportError(error, 'image:event')
  })
  const document = parsed.document
  document._directCanvasFrames = Boolean(options.directCanvasFrames)

  function reportError (error, phase = 'script') {
    const item = { phase, message: String(error && error.message || error), stack: String(error && error.stack || '') }
    errors.push(item)
    if (typeof options.onError === 'function') options.onError(item)
  }

  const reactCompat = createReactCompatRuntime({ document, scheduleFlush, setTimeout: hostSetTimeout, reportError })

  function safeCall (callback, args = [], phase = 'callback') {
    executionSteps = 0
    try { return callback(...args) } catch (error) { reportError(error, phase) }
  }

  function consumeExecutionStep () {
    if (destroyed) throw new Error('HTML Reader document is closed')
    if (tapBudget) {
      if (++tapBudget.steps > 2000000 || Date.now() > tapBudget.deadline) throw new Error('HTML Reader stopped a script that exceeded the interaction budget')
    } else if (trustedBootstrap) {
      if (!bootstrapDeadline) {
        bootstrapDeadline = Date.now() + 2000
        bootstrapTurnReset = hostSetTimeout(() => { bootstrapDeadline = 0; bootstrapTurnReset = null }, 0)
      }
      if (++bootstrapSteps > 2000000 || Date.now() > bootstrapDeadline) throw new Error('HTML Reader stopped a script that exceeded the initialization budget')
    } else if (++executionSteps > maxExecutionSteps) throw new Error('HTML Reader stopped a script that exceeded the execution budget')
  }

  function evaluateSandboxSource (source) {
    if (!interpreter) throw new Error('HTML Reader sandbox is not ready')
    const text = String(source == null ? '' : source)
    if (text.length > maxScriptLength) throw new Error('HTML Reader skipped dynamic code larger than the safety limit')
    if (evalDepth === 0) executionSteps = 0
    evalDepth++
    try {
      const ast = interpreter.parse(text)
      transformReactRootCalls(ast)
      const key = `__htmlReaderEval${++evalSequence}`
      const last = ast.body && ast.body[ast.body.length - 1]
      if (last && last.type === 'ExpressionStatement') {
        last.expression = {
          type: 'AssignmentExpression',
          operator: '=',
          left: { type: 'MemberExpression', computed: true, object: { type: 'Identifier', name: 'exports' }, property: { type: 'Literal', value: key, raw: JSON.stringify(key) } },
          right: last.expression
        }
      }
      instrumentExecutionGuards(ast, consumeExecutionStep)
      interpreter.run(ast)
      const result = interpreter.exports[key]
      delete interpreter.exports[key]
      return result
    } finally {
      evalDepth--
    }
  }

  function requestHostAction (action) {
    if (hostGestureDepth < 1 || typeof options.onHostAction !== 'function') return false
    options.onHostAction(action)
    return true
  }

  function budgetedTimeout (callback, delay, ...args) {
    const invoke = typeof callback === 'function' ? () => safeCall(callback, args, 'timer') : typeof callback === 'string' ? () => safeCall(() => evaluateSandboxSource(callback), [], 'timer:string') : null
    if (!invoke || timerFires >= maxTimerFires) return 0
    const id = hostSetTimeout(() => {
      activeTimers.delete(id)
      if (destroyed || timerFires++ >= maxTimerFires) return
      invoke()
      scheduleFlush()
    }, Math.max(0, Number(delay) || 0))
    activeTimers.add(id)
    return id
  }

  function budgetedInterval (callback, delay, ...args) {
    const invoke = typeof callback === 'function' ? () => safeCall(callback, args, 'interval') : typeof callback === 'string' ? () => safeCall(() => evaluateSandboxSource(callback), [], 'interval:string') : null
    if (!invoke || timerFires >= maxTimerFires) return 0
    const id = hostSetInterval(() => {
      if (destroyed || timerFires++ >= maxTimerFires) { budgetedClearInterval(id); return }
      invoke()
      scheduleFlush()
    }, Math.max(4, Number(delay) || 0))
    activeTimers.add(id)
    return id
  }

  function budgetedClearTimeout (id) { activeTimers.delete(id); hostClearTimeout(id) }
  function budgetedClearInterval (id) { activeTimers.delete(id); hostClearInterval(id) }

  function requestAnimationFrame (callback) {
    if (destroyed || typeof callback !== 'function' || animationCallbacks.size >= 64) return 0
    const id = ++animationId
    animationCallbacks.set(id, callback)
    scheduleAnimation()
    return id
  }
  function scheduleAnimation () {
    if (destroyed || !visible || animationTimer != null || !animationCallbacks.size) return
    animationTimer = hostSetTimeout(() => {
      animationTimer = null
      if (destroyed || !visible) return
      trustedBootstrap = false
      const callbacks = Array.from(animationCallbacks.entries())
      executionSteps = 0
      for (const [id, callback] of callbacks) {
        if (!animationCallbacks.delete(id)) continue
        try { callback(performance.now()) } catch (error) {
          reportError(error, 'animation'); animationCallbacks.clear(); hostClearTimeout(animationTimer); animationTimer = null; break
        }
      }
      scheduleFlush(); scheduleAnimation()
    }, 33)
  }
  function setVisible (value) {
    visible = Boolean(value)
    document.hidden = !visible; document.visibilityState = visible ? 'visible' : 'hidden'
    if (!visible) { hostClearTimeout(animationTimer); animationTimer = null; document._pointerCaptures.clear() }
    safeCall(() => document.dispatchEvent(new ShimEvent('visibilitychange', { bubbles: false })), [], 'visibilitychange')
    if (visible) scheduleAnimation()
  }

  const defer = budgetedTimeout
  const FileReader = createFileReader(defer)
  const AbortController = createAbortController()
  const localStorage = new MemoryStorage()
  const sessionStorage = new MemoryStorage()
  const location = document._location

  class XMLHttpRequest {
    constructor () { this.readyState = 0; this.status = 0; this.response = null; this.responseText = ''; this.responseURL = ''; this.timeout = 0; this.withCredentials = false }
    open (method, url) { this.method = method; this.responseURL = String(url || ''); this.readyState = 1; if (typeof this.onreadystatechange === 'function') this.onreadystatechange(new ShimEvent('readystatechange')) }
    setRequestHeader () {}
    getAllResponseHeaders () { return '' }
    getResponseHeader () { return null }
    send () { defer(() => { this.readyState = 4; if (typeof this.onreadystatechange === 'function') this.onreadystatechange(new ShimEvent('readystatechange')); if (typeof this.onerror === 'function') this.onerror(new ShimEvent('error')); if (typeof this.onloadend === 'function') this.onloadend(new ShimEvent('loadend')) }, 0) }
    abort () { this.readyState = 0 }
  }

  class WebSocket {
    constructor (url) { this.url = String(url || ''); this.readyState = 0; defer(() => { this.readyState = 3; if (typeof this.onerror === 'function') this.onerror(new ShimEvent('error')); if (typeof this.onclose === 'function') this.onclose({ code: 1006, reason: 'Network disabled', wasClean: false }) }, 0) }
    send () { throw new Error('WebSocket network is disabled') }
    close () { this.readyState = 3 }
    addEventListener (type, callback) { this[`on${type}`] = callback }
    removeEventListener (type, callback) { if (this[`on${type}`] === callback) this[`on${type}`] = null }
  }

  class DOMParser {
    parseFromString (source, type) {
      try { return parseHtmlDocument(source, { contentType: type, viewportWidth: document._viewportWidth, viewportHeight: document._viewportHeight }).document }
      catch (error) {
        if (type !== 'application/xhtml+xml') throw error
        const result = parseHtmlDocument('<parsererror></parsererror>').document
        const root = result.querySelector('parsererror'); root.textContent = error.message; root.remove()
        result.childNodes = []; result.appendChild(root); result.documentElement = root; result.head = null; result.body = null; result.contentType = type
        return result
      }
    }
  }

  class NoopObserver { constructor (callback) { this.callback = callback } observe () {} unobserve () {} disconnect () {} takeRecords () { return [] } }
  class IntersectionObserver extends NoopObserver {
    observe (target) { defer(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this), 0) }
  }

  const navigator = {
    userAgent: 'Mozilla/5.0 (WeChat HTML Reader; Mobile)', language: 'zh-CN', languages: ['zh-CN', 'zh'], platform: 'WeChat', maxTouchPoints: 5, onLine: false, hardwareConcurrency: 4,
    sendBeacon: () => false,
    share: () => Promise.reject(new Error('Share is unavailable in the reader sandbox')),
    clipboard: { writeText: value => requestHostAction({ type: 'clipboard', value: String(value) }) ? Promise.resolve() : Promise.reject(new Error('Clipboard access requires a user gesture')) }
  }
  const crypto = {
    getRandomValues (array) { for (let index = 0; index < array.length; index++) array[index] = Math.floor(Math.random() * 256); return array },
    randomUUID () { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => { const value = Math.floor(Math.random() * 16); return (char === 'x' ? value : value & 3 | 8).toString(16) }) }
  }
  const performance = { now: () => Date.now() }
  function applyLocation (value) {
    const next = new ShimURL(value, location.href)
    ;['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].forEach(property => { location[property] = next[property] })
  }
  location.assign = value => applyLocation(value)
  location.replace = value => applyLocation(value)
  const history = {
    length: 1,
    state: null,
    scrollRestoration: 'auto',
    back () {},
    forward () {},
    go () {},
    pushState (state, _title, url) { this.state = state; if (url != null) applyLocation(url); this.length += 1 },
    replaceState (state, _title, url) { this.state = state; if (url != null) applyLocation(url) }
  }
  const noop = () => {}
  const disabledDynamicCode = () => { throw new TypeError('Function code generation is disabled in HTML Reader') }
  const sandboxEval = source => evaluateSandboxSource(source)
  const SandboxObject = createSafeObjectConstructor()
  const SandboxReflect = createSafeReflect()
  const hostIntl = Object.prototype.hasOwnProperty.call(options, 'intl')
    ? options.intl
    : typeof Intl === 'undefined' ? null : Intl
  const hostConsole = options.console || console
  const sandboxConsole = {}
  ;['debug', 'error', 'info', 'log', 'table', 'warn'].forEach(method => {
    sandboxConsole[method] = (...args) => {
      try { if (hostConsole && typeof hostConsole[method] === 'function') hostConsole[method](...args) } catch (_) {}
    }
  })
  const window = {
    ...createStandardGlobals(SandboxObject, SandboxReflect, disabledDynamicCode, sandboxEval, hostIntl),
    document, navigator, location, history, localStorage, sessionStorage, console: sandboxConsole,
    innerWidth: document._viewportWidth, innerHeight: document._viewportHeight,
    scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
    devicePixelRatio: Number(options.devicePixelRatio || 1),
    setTimeout: budgetedTimeout, clearTimeout: budgetedClearTimeout, setInterval: budgetedInterval, clearInterval: budgetedClearInterval,
    requestAnimationFrame, cancelAnimationFrame: id => animationCallbacks.delete(id),
    requestIdleCallback: callback => budgetedTimeout(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 1), cancelIdleCallback: budgetedClearTimeout,
    queueMicrotask: callback => Promise.resolve().then(() => safeCall(callback, [], 'microtask')).then(scheduleFlush),
    performance, btoa: btoaSafe, atob: atobSafe, URL: ShimURL, URLSearchParams: ShimURLSearchParams,
    TextEncoder: class TextEncoder { encode (value) { return utf8Encode(value) } },
    TextDecoder: class TextDecoder { decode (value) { return utf8Decode(value) } },
    Blob: ShimBlob, File: ShimFile, FileReader, FormData: ShimFormData, AbortController,
    crypto, Event: ShimEvent, CustomEvent: ShimCustomEvent, DOMParser,
    EventTarget: ShimNode, Node: ShimNode, Element: ShimElement, HTMLElement: ShimElement, Document: ShimDocument, DocumentFragment: ShimFragment, Text: ShimText, Comment: ShimComment,
    CSS: { escape: cssEscape }, Image: imageConstructor(document), HTMLImageElement: ShimImageElement,
    getComputedStyle: (element, pseudo) => {
      // Load after runtime/renderer initialization, not across their CommonJS
      // bootstrap boundary. The shared cascade is used, not inline snapshots.
      if (!readComputedStyle) readComputedStyle = require('../css-computed-style').createComputedStyleReader(document, () => parsed.styles, options)
      return readComputedStyle(element, pseudo)
    },
    matchMedia: query => ({ media: String(query), matches: mediaQueryMatches(query, document._viewportWidth, { viewportHeight: document._viewportHeight, colorScheme: options.colorScheme, reducedMotion: options.reducedMotion, pointer: options.pointer, hover: options.hover }), onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true }),
    fetch: () => Promise.reject(new Error('Network disabled in HTML Reader')),
    XMLHttpRequest, WebSocket,
    MutationObserver: NoopObserver, ResizeObserver: NoopObserver, IntersectionObserver,
    structuredClone: value => JSON.parse(JSON.stringify(value)),
    alert: noop, confirm: () => false, prompt: () => null, open: noop, print: noop, focus: noop, blur: noop, close: noop,
    scrollTo: noop, scrollBy: noop, getSelection: () => null,
    addEventListener: (...args) => document.addEventListener(...args), removeEventListener: (...args) => document.removeEventListener(...args), dispatchEvent: event => document.dispatchEvent(event),
    __htmlReaderRenderReactRoot: (container, element, React) => reactCompat.renderRoot(container, element, React)
  }
  function scrollRequest (first, second, relative = false) {
    const object = first && typeof first === 'object' ? first : null
    const left = Number(object ? object.left : first)
    const top = Number(object ? object.top : second)
    const target = document._lastLayoutElement
    const currentLeft = Number(window.scrollX || 0)
    const currentTop = Number(window.scrollY || 0)
    const nextLeft = Number.isFinite(left) ? (relative ? currentLeft + left : left) : currentLeft
    const nextTop = Number.isFinite(top) ? Math.max(0, relative ? currentTop + top : top) : currentTop
    if (target && !Number.isFinite(target._layoutDocumentTop)) {
      requestHostAction({ type: 'scroll', nid: target._nid, offsetTop: Number.isFinite(top) ? top : 0, behavior: object && object.behavior || 'auto' })
    } else requestHostAction({ type: 'scroll-position', top: nextTop, left: nextLeft, behavior: object && object.behavior || 'auto' })
    document._lastLayoutElement = null
  }
  window.scrollTo = (first, second) => scrollRequest(first, second, false)
  window.scrollBy = (first, second) => scrollRequest(first, second, true)
  window.window = window
  window.self = window
  window.globalThis = window
  document.defaultView = window

  const globals = { ...window, __hostWindow: window }
  delete globals.window
  delete globals.self
  delete globals.globalThis
  interpreter = new Sval({ ecmaVer: 'latest', sourceType: 'script', sandBox: true })
  interpreter.import(globals)
  interpreter.run('Object.assign(window, __hostWindow); window.window = window; window.self = window; window.globalThis = window; window.__hostWindow = null; __hostWindow = null; exports.window = window')
  const sandboxWindow = interpreter.exports.window
  document.defaultView = sandboxWindow

  function installInlineEventHandlers () {
    const bindings = []
    document.querySelectorAll('*').forEach(node => {
      node.attributes.forEach(attribute => {
        const match = attribute.name.toLowerCase().match(/^on([a-z][\w-]*)$/)
        if (match && String(attribute.value || '').trim()) bindings.push({ node, type: match[1], source: String(attribute.value) })
      })
    })
    if (!bindings.length) return
    interpreter.import({ __htmlReaderInlineNodes: bindings.map(binding => binding.node) })
    bindings.forEach((binding, index) => {
      executionSteps = 0
      try {
        const source = `__htmlReaderInlineNodes[${index}]._inlineHandlers[${JSON.stringify(binding.type)}]=function(event){${binding.source}\n}`
        const ast = instrumentExecutionGuards(interpreter.parse(source), consumeExecutionStep)
        interpreter.run(ast)
      } catch (error) { reportError(error, `inline:${binding.type}`) }
    })
    try { interpreter.run('__htmlReaderInlineNodes=null') } catch (_) {}
  }

  function renderState () {
    const rootClass = document.documentElement.className
    const bodyAttrs = serializeBodyAttributes(document)
    const bodyHtml = document.body.childNodes.map(node => serializeNode(node)).join('')
    const canvases = document.querySelectorAll('canvas').map(element => ({ nid: element._nid, canvas: canvasStateForElement(element) }))
    const canvasKey = canvases.map(item => `${item.nid}:${item.canvas.rev}:${item.canvas.width}x${item.canvas.height}`).join('|')
    const styles = parsed.styles.slice()
    return { rootClass, bodyAttrs, bodyHtml, styles, canvases, canvasKey, key: `${rootClass}\u0000${bodyAttrs}\u0000${bodyHtml}\u0000${styles.join('\n')}` }
  }

  function flush (force = false) {
    if (destroyed) return null
    if (!force && !document._dirty && lastRenderKey && skips++ < RECONCILE_SKIPS) return null
    const state = renderState()
    document._dirty = false
    skips = 0
    const domChanged = force || state.key !== lastRenderKey
    const canvasChanged = force || state.canvasKey !== lastCanvasKey
    lastCanvasKey = state.canvasKey
    if (!domChanged) {
      if (canvasChanged && typeof options.onCanvas === 'function') options.onCanvas(state.canvases)
      return canvasChanged ? state : null
    }
    lastRenderKey = state.key
    if (typeof options.onRender === 'function') options.onRender(state)
    return state
  }

  let trustedThree
  function run () {
    installInlineEventHandlers()
    parsed.scripts.forEach((script, index) => {
      executionSteps = 0
      try {
        const ast = parseImageScript(interpreter, script, maxScriptLength, (ast, source) => {
          const recognized = substituteTrustedThree(ast, source, () => {
            if (!trustedThree) trustedThree = require('./vendor/three169')(sandboxWindow)
            return trustedThree
          })
          if (recognized && !options.maxExecutionSteps) trustedBootstrap = true
        })
        transformReactRootCalls(ast)
        instrumentExecutionGuards(ast, consumeExecutionStep)
        interpreter.run(ast)
      } catch (error) { reportError(error, `script:${index + 1}`) }
    })
    document.readyState = 'interactive'
    safeCall(() => document.dispatchEvent(new ShimEvent('DOMContentLoaded', { bubbles: false })), [], 'domcontentloaded')
    document.readyState = 'complete'
    safeCall(() => document.dispatchEvent(new ShimEvent('load', { bubbles: false })), [], 'load')
    if (typeof sandboxWindow.onload === 'function') safeCall(sandboxWindow.onload.bind(sandboxWindow), [new ShimEvent('load', { bubbles: false })], 'window.onload')
    document._dirty = true
    return flush(true)
  }

  function byNid (nid) { return [document.documentElement].concat(document.querySelectorAll('*')).find(node => String(node._nid) === String(nid)) || null }
  function pointTarget (nid, detail, rect) {
    const node = byNid(nid)
    if (!node || node.localName !== 'svg') return nid
    return svgHitTest(node, Number(detail.clientX), Number(detail.clientY), rect, n => sandboxWindow.getComputedStyle(n))._nid
  }
  function dispatchTap (nid) {
    timerFires = Math.max(0, timerFires - 24)
    executionSteps = 0
    const node = byNid(nid)
    if (!node) return false
    hostGestureDepth++
    const previousBudget = tapBudget
    if (trustedThree && !options.maxExecutionSteps && !tapBudget) tapBudget = { steps: 0, deadline: Date.now() + 2000 }
    try { return dispatchDomClick(node, requestHostAction) } catch (error) { reportError(error, 'event:tap'); return false } finally { tapBudget = previousBudget; hostGestureDepth--; scheduleFlush() }
  }
  function dispatchEvent (nid, type, detail) {
    executionSteps = 0
    const isHostGesture = /^(?:touch|pointer|mouse)/.test(String(type))
    if (isHostGesture) timerFires = Math.max(0, timerFires - 24)
    const node = (/^pointer/.test(type) && document._pointerCaptures.get(Number(detail?.pointerId))) || byNid(nid)
    if (!node) return false
    if (isHostGesture) hostGestureDepth++
    try {
      // Native resource completion must not reach page load listeners: doing
      // so reruns load-based apps whenever their rendered images finish.
      const resourceEvent = type === 'load' || type === 'error'
      const event = new ShimCustomEvent(type, { detail, bubbles: !resourceEvent, cancelable: !resourceEvent })
      if (detail && typeof detail === 'object') Object.assign(event, detail)
      return node.dispatchEvent(event)
    } catch (error) { reportError(error, `event:${type}`); return false } finally { if (/^pointer(?:up|cancel)$/.test(type)) document._pointerCaptures.delete(Number(detail?.pointerId)); if (isHostGesture) hostGestureDepth--; scheduleFlush() }
  }
  function syncViewportScroll (top, left = 0) {
    if (destroyed) return
    const nextTop = Math.max(0, Number(top) || 0), nextLeft = Math.max(0, Number(left) || 0)
    if (sandboxWindow.scrollY === nextTop && sandboxWindow.scrollX === nextLeft) return
    window.scrollX = window.pageXOffset = sandboxWindow.scrollX = sandboxWindow.pageXOffset = nextLeft
    window.scrollY = window.pageYOffset = sandboxWindow.scrollY = sandboxWindow.pageYOffset = nextTop
    safeCall(() => document.dispatchEvent(new ShimEvent('scroll', { bubbles: false })), [], 'viewport:scroll')
    document._lastLayoutElement = null
    scheduleFlush()
  }
  function syncInput (nid, patch = {}, eventType = 'input', includeClick = false) {
    executionSteps = 0
    const node = byNid(nid)
    if (!node || disabledControl(node)) return false
    try {
      if (node.localName === 'select' && Object.prototype.hasOwnProperty.call(patch, 'selectedIndex')) {
        const index = Number(patch.selectedIndex), option = node.options && node.options[index]
        if (!Number.isInteger(index) || !option || disabledOption(option)) return false
        node.selectedIndex = index
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'value')) node.value = patch.value
      if (Object.prototype.hasOwnProperty.call(patch, 'checked')) node.checked = patch.checked
      if (node.localName === 'input' && node.type === 'radio' && node.checked && node.name) {
        const scope = node.form || document
        scope.querySelectorAll('input[type="radio"]').filter(radio => radio !== node && radio.name === node.name).forEach(radio => { radio.checked = false })
      }
      if (includeClick) node.dispatchEvent(new ShimEvent('click'))
      node.dispatchEvent(new ShimEvent(eventType))
      return true
    } catch (error) { reportError(error, 'event:input'); return false } finally { scheduleFlush() }
  }
  function applyEditableText (nid, text) {
    executionSteps = 0
    const node = byNid(nid)
    if (!node || !node.isContentEditable) return false
    try {
      node.textContent = String(text == null ? '' : text)
      node.dispatchEvent(new ShimEvent('input'))
      return true
    } catch (error) { reportError(error, 'event:editable'); return false } finally { scheduleFlush() }
  }
  function destroy () { destroyed = true; hostClearTimeout(bootstrapTurnReset); hostClearTimeout(animationTimer); animationCallbacks.clear(); document._pointerCaptures.clear(); document._runtimeDisposed = true; disposeRuntimeImages(document); disposeRuntimeCanvases(document); activeTimers.forEach(id => { hostClearTimeout(id); hostClearInterval(id) }); activeTimers.clear() }

  return { nativeFrame: nid => nativeFrameForElement(byNid(nid)), nativeCanvas: nid => nativeCanvasForElement(byNid(nid)), document, window: sandboxWindow, interpreter, errors, run, flush, scheduleFlush, dispatchTap, dispatchEvent, syncViewportScroll, syncInput, applyEditableText, getNode: byNid, renderState, destroy, setVisible, pointTarget, constants: { DEFAULT_MAX_EXECUTION_STEPS, DEFAULT_MAX_SCRIPT_LENGTH, DEFAULT_MAX_TIMER_FIRES, RECONCILE_SKIPS } }
}

module.exports = {
  DEFAULT_MAX_EXECUTION_STEPS,
  DEFAULT_MAX_SCRIPT_LENGTH,
  DEFAULT_MAX_TIMER_FIRES,
  RECONCILE_SKIPS,
  ShimBlob,
  ShimFile,
  ShimFormData,
  ShimURL,
  ShimURLSearchParams,
  atobSafe,
  btoaSafe,
  bytesToBase64,
  createRuntime,
  instrumentExecutionGuards,
  transformReactRootCalls,
  utf8Decode,
  utf8Encode
}
