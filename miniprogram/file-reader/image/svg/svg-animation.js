'use strict'

const { classifyPathValue, interpolatePath, serializePath } = require('./svg-path-morph')

// 动画时间线：SMIL（animate / animateTransform / set）与 CSS 动画（animation + @keyframes）。
// sample(t) 给出每个元素在 t 秒时的覆盖值：属性、样式、以及附加/替换的 transform 函数列表。
// 光栅化器不关心动画来源，只消费这些覆盖。

const { parseColor, parseLength, parseTransformList, colorToCss } = require('./svg-style')

// --- 时间与缓动 ---

function parseClock (value) {
  const text = String(value == null ? '' : value).trim().toLowerCase()
  if (!text || text === 'indefinite') return NaN
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/)
  if (clock) return (Number(clock[1] || 0) * 3600) + Number(clock[2]) * 60 + Number(clock[3])
  const unit = text.match(/^(-?\d*\.?\d+)(ms|s|min|h)?$/)
  if (!unit) return NaN
  const number = parseFloat(unit[1])
  switch (unit[2]) {
    case 'ms': return number / 1000
    case 'min': return number * 60
    case 'h': return number * 3600
    default: return number
  }
}

function cubicBezier (x1, y1, x2, y2) {
  const sampleX = t => ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t
  const sampleY = t => ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t
  return x => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lower = 0; let upper = 1; let t = x
    for (let i = 0; i < 24; i++) {
      const current = sampleX(t)
      if (Math.abs(current - x) < 1e-5) break
      if (current < x) lower = t; else upper = t
      t = (lower + upper) / 2
    }
    return sampleY(t)
  }
}

const NAMED_EASING = {
  linear: t => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1)
}

function parseEasing (value, fallback = NAMED_EASING.ease) {
  const text = String(value || 'ease').trim().toLowerCase()
  if (NAMED_EASING[text]) return NAMED_EASING[text]
  const bezier = text.match(/^cubic-bezier\(([^)]*)\)$/)
  if (bezier) {
    const numbers = bezier[1].split(',').map(Number)
    if (numbers.length === 4 && numbers.every(Number.isFinite) && numbers[0] >= 0 && numbers[0] <= 1 && numbers[2] >= 0 && numbers[2] <= 1) return cubicBezier(numbers[0], numbers[1], numbers[2], numbers[3])
  }
  const stepText = text === 'step-start' ? 'steps(1,start)' : text === 'step-end' ? 'steps(1,end)' : text
  const steps = stepText.match(/^steps\(\s*(\+?\d+)\s*(?:,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)$/)
  if (steps) {
    const count = Number(steps[1]), position = steps[2] || 'end'
    const jumps = count + (position === 'jump-both' ? 1 : position === 'jump-none' ? -1 : 0)
    if (Number.isFinite(count) && count > 0 && jumps > 0) {
      // CSS Easing 1: discontinuities use the top of the step, except when
      // sampling the before side of a delayed/reversed animation boundary.
      return (t, before = false) => {
        let step = Math.floor(t * count)
        if (position === 'start' || position === 'jump-start' || position === 'jump-both') step++
        if (before && Number.isInteger(t * count)) step--
        if (t >= 0) step = Math.max(0, step)
        if (t <= 1) step = Math.min(jumps, step)
        return step / jumps
      }
    }
  }
  return fallback
}

// --- 值的插值 ---

function classifyValue (text) {
  const value = String(text == null ? '' : text).trim()
  if (!value) return { kind: 'string', value }
  if (parseColor(value)) return { kind: 'color', value: parseColor(value) }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|pt|em|%|deg|rad|turn)?$/i.test(value)) {
    const unit = (value.match(/[a-z%]+$/i) || [''])[0]
    return { kind: 'number', value: parseFloat(value), unit }
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[\s,]+-?(?:\d+\.?\d*|\.\d+))+$/.test(value)) {
    return { kind: 'list', value: value.split(/[\s,]+/).map(Number) }
  }
  if (/^[a-zA-Z]+\s*\(/.test(value) && /\)\s*$/.test(value)) return { kind: 'transform', value: parseTransformList(value) }
  return { kind: 'string', value }
}

function lerp (a, b, t) { return a + (b - a) * t }

function interpolate (from, to, t) {
  if (t <= 0) return from
  if (t >= 1) return to
  if (from.kind === 'path' && to.kind === 'path') return interpolatePath(from, to, t)
  if (from.kind === 'number' && to.kind === 'number') return { kind: 'number', value: lerp(from.value, to.value, t), unit: to.unit || from.unit }
  if (from.kind === 'color' && to.kind === 'color') {
    return { kind: 'color', value: [0, 1, 2, 3].map(index => index < 3 ? Math.round(lerp(from.value[index], to.value[index], t)) : lerp(from.value[index], to.value[index], t)) }
  }
  if (from.kind === 'list' && to.kind === 'list' && from.value.length === to.value.length) {
    return { kind: 'list', value: from.value.map((number, index) => lerp(number, to.value[index], t)) }
  }
  if (from.kind === 'transform' && to.kind === 'transform') return { kind: 'transform', value: interpolateTransforms(from.value, to.value, t) }
  return t < 0.5 ? from : to
}

// 函数名序列一致时逐参数插值；否则退化为 50% 切换（浏览器会转矩阵插值，这里先不做）
function interpolateTransforms (from, to, t) {
  if (from.length === to.length && from.every((fn, index) => fn.name === to[index].name && fn.args.length === to[index].args.length)) {
    return from.map((fn, index) => ({ name: fn.name, args: fn.args.map((arg, argIndex) => lerp(arg, to[index].args[argIndex], t)) }))
  }
  if (!from.length) return to.map(fn => ({ name: fn.name, args: fn.args.map(arg => lerp(neutralArg(fn.name), arg, t)) }))
  if (!to.length) return from.map(fn => ({ name: fn.name, args: fn.args.map(arg => lerp(arg, neutralArg(fn.name), t)) }))
  return t < 0.5 ? from : to
}

function neutralArg (name) {
  return /^scale/.test(name) ? 1 : 0
}

function valueToString (classified) {
  switch (classified.kind) {
    case 'path': return serializePath(classified.value)
    // Keep interpolation precision: rounding an em/rem value here magnifies
    // the error when its font-relative unit is resolved later.
    case 'number': return `${classified.value}${classified.unit || ''}`
    case 'color': return colorToCss(classified.value)
    case 'list': return classified.value.join(' ')
    case 'transform': return classified.value.map(fn => `${fn.name}(${fn.args.join(' ')})`).join(' ')
    default: return classified.value
  }
}

// --- SMIL ---

const SMIL_TAGS = new Set(['animate', 'animateTransform', 'set'])

function collectSmil (doc) {
  const animations = []
  for (const record of doc.elements) {
    const node = record.node
    if (!SMIL_TAGS.has(node.name)) continue
    const hrefTarget = node.attrs.href ? doc.byId[String(node.attrs.href).replace(/^#/, '')] : null
    const target = hrefTarget || record.parent
    if (!target) continue
    const wallclock = parseWallclock(node.attrs.begin)
    const begin = wallclock == null ? parseBeginList(node.attrs.begin) : 0
    if (begin == null) continue // 事件触发或 indefinite：永不开始
    const dur = parseClock(node.attrs.dur)
    const pathValues = node.attrs.attributeName === 'd' && node.attrs.values != null
      ? String(node.attrs.values).split(';').map(part => part.trim()) : null
    if (pathValues) {
      // A single trailing semicolon is allowed; empty interior values invalidate
      // the animation instead of silently changing its keyframe count/timing.
      if (pathValues[pathValues.length - 1] === '') pathValues.pop()
      if (!pathValues.length || pathValues.some(part => part === '')) continue
    }
    const values = pathValues || (node.attrs.values != null
      ? String(node.attrs.values).split(';').map(part => part.trim()).filter(part => part !== '')
      : [node.attrs.from, node.attrs.to, node.attrs.by])
    const isSet = node.name === 'set'
    const classify = node.attrs.attributeName === 'd' ? value => classifyPathValue(value) : classifyValue
    const animation = {
      kind: 'smil',
      target,
      attributeName: isSet ? node.attrs.attributeName : node.attrs.attributeName,
      transformType: node.name === 'animateTransform' ? (node.attrs.type || 'translate') : '',
      additive: node.attrs.additive === 'sum',
      begin,
      wallclock,
      dur: Number.isFinite(dur) && dur > 0 ? dur : (isSet ? Infinity : NaN),
      repeatCount: node.attrs.repeatCount === 'indefinite' ? Infinity : Number(node.attrs.repeatCount || 1),
      repeatDur: parseClock(node.attrs.repeatDur),
      freeze: node.attrs.fill === 'freeze' || isSet,
      calcMode: node.attrs.calcMode || 'linear',
      keyTimes: node.attrs.keyTimes ? String(node.attrs.keyTimes).split(';').map(Number) : null,
      keySplines: node.attrs.keySplines ? String(node.attrs.keySplines).split(';').map(part => part.trim().split(/[\s,]+/).map(Number)) : null,
      frames: []
    }
    if (isSet) {
      animation.frames = [classify(node.attrs.to)]
    } else if (node.attrs.values != null) {
      animation.frames = values.map(classify)
    } else {
      const from = node.attrs.from != null ? classify(node.attrs.from) : null
      const to = node.attrs.to != null ? classify(node.attrs.to) : null
      const by = node.attrs.by != null ? classify(node.attrs.by) : null
      if (from && to) animation.frames = [from, to]
      else if (from && by && from.kind === 'number' && by.kind === 'number') animation.frames = [from, { kind: 'number', value: from.value + by.value, unit: from.unit }]
      else if (from && by && from.kind === 'list' && by.kind === 'list') animation.frames = [from, { kind: 'list', value: from.value.map((n, i) => n + (by.value[i] || 0)) }]
      else if (to) animation.frames = [null, to] // from 取基线值，采样时补
      else if (by && by.kind === 'number') animation.frames = [null, by, 'by']
    }
    if (animation.frames.some(frame => frame && frame.kind === 'invalid-path')) continue
    if (animation.attributeName === 'd') animation.basePath = classifyPathValue(target.node.attrs.d, true)
    if (!animation.frames.length || !animation.attributeName || (!Number.isFinite(animation.dur) && !isSet)) continue
    if (!Number.isFinite(animation.repeatCount) && animation.repeatCount !== Infinity) animation.repeatCount = 1
    if (!isSet) {
      const total = Number.isFinite(animation.repeatDur) ? animation.repeatDur : animation.dur * animation.repeatCount
      animation.activeDuration = total
    } else animation.activeDuration = Infinity
    animations.push(animation)
  }
  return animations
}

// Bounded subset of SVG 1.1 wallclock timing: a complete ISO date/time with zone.
// Do not guess locale dates or execute script/event expressions.
function parseWallclock (value) {
  const match = /^wallclock\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))\)$/.exec(String(value || '').trim())
  if (!match) return null
  const time = Date.parse(match[1])
  return Number.isFinite(time) ? time : null
}

// begin 支持 "1s; 3s" 这类偏移列表，取最早一个；事件名/indefinite 返回 null
function parseBeginList (value) {
  if (value == null || String(value).trim() === '') return 0
  const offsets = String(value).split(';').map(part => parseClock(part)).filter(Number.isFinite)
  return offsets.length ? Math.min(...offsets) : null
}

function sampleSmil (animation, time, baseValue) {
  const local = time - animation.begin
  if (local < 0) return null
  let progress
  if (animation.frames.length === 1) {
    // <set>
    return animation.frames[0]
  }
  if (local >= animation.activeDuration) {
    if (!animation.freeze) return null
    progress = 1
  } else {
    progress = (local % animation.dur) / animation.dur
  }
  const frames = animation.frames.map(frame => (frame === null ? (baseValue || { kind: 'string', value: '' }) : frame))
  if (frames[2] === 'by') {
    const base = baseValue && baseValue.kind === 'number' ? baseValue : { kind: 'number', value: 0, unit: frames[1].unit }
    frames.splice(0, 3, base, { kind: 'number', value: base.value + frames[1].value, unit: base.unit })
  }
  const count = frames.length
  const keyTimes = animation.keyTimes && animation.keyTimes.length === count ? animation.keyTimes : frames.map((_, index) => index / (animation.calcMode === 'discrete' ? count : count - 1))
  if (animation.calcMode === 'discrete') {
    let index = 0
    for (let i = 0; i < count; i++) if (progress >= keyTimes[i]) index = i
    return frames[index]
  }
  let segment = 0
  while (segment < count - 2 && progress >= keyTimes[segment + 1]) segment++
  const span = keyTimes[segment + 1] - keyTimes[segment]
  let t = span > 0 ? (progress - keyTimes[segment]) / span : 1
  if (animation.calcMode === 'spline' && animation.keySplines && animation.keySplines[segment] && animation.keySplines[segment].length === 4) {
    const spline = animation.keySplines[segment]
    t = cubicBezier(spline[0], spline[1], spline[2], spline[3])(t)
  }
  return interpolate(frames[segment], frames[segment + 1], t)
}

// --- CSS 动画 ---

function parseTime (token) {
  const match = String(token).trim().match(/^(-?\d*\.?\d+)(ms|s)$/i)
  if (!match) return NaN
  return match[2].toLowerCase() === 'ms' ? parseFloat(match[1]) / 1000 : parseFloat(match[1])
}

const DIRECTIONS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse'])
const FILL_MODES = new Set(['none', 'forwards', 'backwards', 'both'])
const PLAY_STATES = new Set(['running', 'paused'])

function splitCommaList (value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of String(value || '')) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = '' } else current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseAnimationShorthand (value) {
  const entry = { name: '', duration: 0, delay: 0, easing: 'ease', iterations: 1, direction: 'normal', fill: 'none', playState: 'running' }
  let timesSeen = 0
  for (const token of splitCommaListTokens(value)) {
    const lower = token.toLowerCase()
    if (/^-?\d*\.?\d+(ms|s)$/i.test(token)) {
      if (timesSeen === 0) entry.duration = parseTime(token)
      else if (timesSeen === 1) entry.delay = parseTime(token)
      timesSeen++
    } else if (lower === 'infinite') entry.iterations = Infinity
    else if (/^\d*\.?\d+$/.test(lower)) entry.iterations = parseFloat(lower)
    else if (DIRECTIONS.has(lower)) entry.direction = lower
    else if (FILL_MODES.has(lower)) entry.fill = lower
    else if (PLAY_STATES.has(lower)) entry.playState = lower
    else if (NAMED_EASING[lower] || /^(cubic-bezier|steps)\(/.test(lower) || lower === 'step-start' || lower === 'step-end') entry.easing = lower
    else if (lower !== 'none' && !entry.name) entry.name = token
  }
  return entry
}

// 按空白拆 token，但括号内的空白与逗号保留
function splitCommaListTokens (value) {
  const tokens = []
  let depth = 0
  let current = ''
  for (const char of String(value || '')) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (/\s/.test(char) && depth === 0) { if (current) tokens.push(current); current = '' } else current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function cssAnimationsOf (style, keyframes) {
  const entries = []
  if (style.animation) for (const part of splitCommaList(style.animation)) entries.push(parseAnimationShorthand(part))
  const applyLonghand = (property, assign) => {
    if (style[property] == null) return
    const parts = splitCommaList(style[property])
    if (!entries.length) parts.forEach(() => entries.push(parseAnimationShorthand('')))
    entries.forEach((entry, index) => assign(entry, parts[index % parts.length]))
  }
  applyLonghand('animation-name', (entry, value) => { entry.name = value === 'none' ? '' : value })
  applyLonghand('animation-duration', (entry, value) => { const time = parseTime(value); if (Number.isFinite(time)) entry.duration = time })
  applyLonghand('animation-delay', (entry, value) => { const time = parseTime(value); if (Number.isFinite(time)) entry.delay = time })
  applyLonghand('animation-timing-function', (entry, value) => { entry.easing = value })
  applyLonghand('animation-iteration-count', (entry, value) => { entry.iterations = value.toLowerCase() === 'infinite' ? Infinity : parseFloat(value) })
  applyLonghand('animation-direction', (entry, value) => { if (DIRECTIONS.has(value.toLowerCase())) entry.direction = value.toLowerCase() })
  applyLonghand('animation-fill-mode', (entry, value) => { if (FILL_MODES.has(value.toLowerCase())) entry.fill = value.toLowerCase() })
  applyLonghand('animation-play-state', (entry, value) => { if (PLAY_STATES.has(value.toLowerCase())) entry.playState = value.toLowerCase() })
  return entries.filter(entry => entry.name && keyframes[entry.name] && entry.duration > 0).map(entry => ({
    ...entry,
    ease: parseEasing(entry.easing),
    frames: keyframes[entry.name],
    properties: uniqueProperties(keyframes[entry.name])
  }))
}

function uniqueProperties (frames) {
  const set = new Set()
  for (const frame of frames) for (const key of Object.keys(frame.declarations)) {
    // Timing metadata belongs to the interval, not to the painted style.
    if (!/^animation(?:-|$)/.test(key)) set.add(key)
  }
  return [...set]
}

function cssIterationProgress (entry, time) {
  const local = time - entry.delay
  if (local < 0) {
    if (entry.fill === 'backwards' || entry.fill === 'both') return directedProgress(entry, 0, 0, 'before')
    return null
  }
  const iteration = Math.floor(local / entry.duration)
  if (Number.isFinite(entry.iterations) && local >= entry.duration * entry.iterations) {
    if (entry.fill !== 'forwards' && entry.fill !== 'both') return null
    const lastIteration = Math.max(0, Math.ceil(entry.iterations) - 1)
    const tail = entry.iterations - lastIteration
    return directedProgress(entry, lastIteration, Math.min(1, tail), 'after')
  }
  return directedProgress(entry, iteration, (local % entry.duration) / entry.duration)
}

function directedProgress (entry, iteration, progress, phase = 'active') {
  let reversed = entry.direction === 'reverse'
  if (entry.direction === 'alternate') reversed = iteration % 2 === 1
  if (entry.direction === 'alternate-reverse') reversed = iteration % 2 === 0
  return {
    progress: reversed ? 1 - progress : progress,
    before: phase === 'before' && !reversed || phase === 'after' && reversed
  }
}

function sampleCss (entry, timing, baseValueFor) {
  const { progress, before } = timing
  const result = {}
  for (const property of entry.properties) {
    const frames = entry.frames.filter(frame => frame.declarations[property] != null)
    if (!frames.length) continue
    const firstOffset = frames[0].offset
    const lastOffset = frames[frames.length - 1].offset
    const sequence = frames.slice()
    if (firstOffset > 0) sequence.unshift({ offset: 0, declarations: { [property]: null } })
    if (lastOffset < 1) sequence.push({ offset: 1, declarations: { [property]: null } })
    let segment = 0
    while (segment < sequence.length - 2 && progress >= sequence[segment + 1].offset) segment++
    const from = sequence[segment]; const to = sequence[segment + 1]
    const span = to.offset - from.offset
    const t = span > 0 ? Math.max(0, Math.min(1, (progress - from.offset) / span)) : 1
    // CSS animation timing functions apply separately to each property-specific
    // keyframe interval. Applying easing before interval selection moves the
    // authored keyframe times and can hide a shape when it should be visible.
    const ease = from.declarations['animation-timing-function'] != null
      ? parseEasing(from.declarations['animation-timing-function'], entry.ease) : entry.ease
    const classify = frame => (frame.declarations[property] == null ? baseValueFor(property) : classifyValue(frame.declarations[property]))
    result[property] = interpolate(classify(from), classify(to), ease(t, before))
  }
  return result
}

// --- 时间线 ---

function createTimeline (doc) {
  const smil = collectSmil(doc)
  const css = []
  for (const record of doc.elements) {
    const entries = cssAnimationsOf(record.style, doc.sheet.keyframes)
    for (const entry of entries) css.push({ kind: 'css', target: record, entry })
  }
  const hasAnimation = smil.length > 0 || css.length > 0
  let loopDuration = 0
  for (const animation of smil) {
    if (animation.activeDuration === Infinity) loopDuration = Math.max(loopDuration, animation.dur === Infinity ? 0 : animation.begin + animation.dur)
    else loopDuration = Math.max(loopDuration, animation.begin + animation.activeDuration)
  }
  for (const item of css) {
    const total = Number.isFinite(item.entry.iterations) ? item.entry.delay + item.entry.duration * item.entry.iterations : item.entry.delay + item.entry.duration
    loopDuration = Math.max(loopDuration, total)
  }

  function sample (time, wallclockNow = Date.now()) {
    const overrides = new Map()
    const overrideFor = record => {
      let entry = overrides.get(record)
      if (!entry) { entry = { attrs: {}, style: {}, transformReplace: null, transformAppend: [] }; overrides.set(record, entry) }
      return entry
    }
    for (const animation of smil) {
      const record = animation.target
      const baseValue = animation.transformType
        ? null
        : animation.attributeName === 'd' ? animation.basePath : classifyValue(record.node.attrs[animation.attributeName] != null ? record.node.attrs[animation.attributeName] : record.style[animation.attributeName])
      const value = sampleSmil(animation, animation.wallclock == null ? time : (wallclockNow - animation.wallclock) / 1000, baseValue)
      if (!value) continue
      const entry = overrideFor(record)
      if (animation.transformType) {
        const args = value.kind === 'list' ? value.value : value.kind === 'number' ? [value.value] : []
        if (!args.length) continue
        const fn = { name: animation.transformType, args }
        if (animation.additive) entry.transformAppend.push(fn)
        else entry.transformReplace = [fn]
      } else if (animation.attributeName in record.style && !(animation.attributeName in record.node.attrs)) {
        entry.style[animation.attributeName] = valueToString(value)
      } else {
        entry.attrs[animation.attributeName] = valueToString(value)
        entry.style[animation.attributeName] = valueToString(value)
      }
    }
    for (const item of css) {
      const progress = cssIterationProgress(item.entry, time)
      if (progress == null) continue
      const record = item.target
      const baseValueFor = property => {
        if (property === 'transform') return { kind: 'transform', value: record.style.transform ? parseTransformList(record.style.transform) : record.transform }
        const base = record.style[property] != null ? record.style[property] : record.node.attrs[property]
        return classifyValue(base == null ? defaultFor(property) : base)
      }
      const sampled = sampleCss(item.entry, progress, baseValueFor)
      const entry = overrideFor(record)
      for (const property of Object.keys(sampled)) {
        if (property === 'transform') entry.transformReplace = sampled[property].kind === 'transform' ? sampled[property].value : parseTransformList(valueToString(sampled[property]))
        else entry.style[property] = valueToString(sampled[property])
      }
    }
    return overrides
  }

  return { hasAnimation, hasWallclock: smil.some(animation => animation.wallclock != null), loopDuration, smilCount: smil.length, cssCount: css.length, sample }
}

function defaultFor (property) {
  switch (property) {
    case 'opacity': case 'fill-opacity': case 'stroke-opacity': return '1'
    case 'fill': return '#000000'
    case 'stroke': return 'none'
    case 'stroke-width': return '1'
    case 'stroke-dashoffset': return '0'
    default: return ''
  }
}

// 只看文本就能判断是否含动画，内核不用加载本分包
function looksAnimated (source) {
  return /<(?:animate|animateTransform|animateMotion|set)\b|@(?:-webkit-)?keyframes\b|\banimation(?:-name)?\s*:/i.test(String(source || ''))
}

module.exports = { classifyValue, createTimeline, cubicBezier, interpolate, looksAnimated, parseAnimationShorthand, parseClock, parseEasing, valueToString }
