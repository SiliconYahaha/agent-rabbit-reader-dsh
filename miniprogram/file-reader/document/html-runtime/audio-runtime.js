'use strict'

// Local, bounded Web Audio adapter. Native contexts/nodes never enter the
// interpreter; wrappers expose only the documented audio operations.
const { atobSafe } = require('../kernel').textCodec
const { decodedAudioBytes } = require('./audio-size')
function createAudioRuntime (options = {}) {
  const states = new Set(), elements = new WeakMap(), nativeValues = new WeakMap()
  let disposed = false, hidden = false, allocated = 0
  const MAX_BYTES = 64 * 1024 * 1024
  function alive () { if (disposed) throw new Error('Audio document is closed') }
  function reserve (bytes) {
    alive()
    if (!Number.isSafeInteger(bytes) || bytes < 0 || allocated + bytes > MAX_BYTES) throw new RangeError('Audio buffer limit exceeded')
    allocated += bytes
  }
  function unwrap (value) { if (!nativeValues.has(value)) throw new TypeError('Foreign audio resource'); return nativeValues.get(value) }
  function parameter (native) {
    const out = Object.create(null)
    Object.defineProperty(out, 'value', { get: () => native.value, set: v => { alive(); native.value = Number(v) } })
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
      if (typeof native[method] === 'function') out[method] = (...args) => { alive(); native[method](...args.map(Number)); return out }
    }
    return out
  }
  function buffer (native) {
    const out = Object.create(null)
    for (const key of ['length', 'duration', 'sampleRate', 'numberOfChannels']) Object.defineProperty(out, key, { get: () => native[key] })
    out.getChannelData = index => { alive(); return native.getChannelData(Number(index)) }
    nativeValues.set(out, native)
    return out
  }
  function makeContext () {
    alive()
    if (states.size >= 4) throw new RangeError('Too many audio contexts')
    if (typeof options.createContext !== 'function') throw new Error('Web Audio is unavailable')
    const raw = options.createContext()
    if (!raw) throw new Error('Web Audio is unavailable')
    if (!options.isGesture?.()) { try { Promise.resolve(raw.suspend()).catch(() => {}) } catch (_) {} }
    const state = { raw, closed: false, nodes: new Set(), sources: new Set(), media: new Set(), resumeOnShow: false }
    states.add(state)
    const context = Object.create(null)
    const check = () => { alive(); if (state.closed) throw new Error('Audio context is closed') }
    function node (rawNode) {
      if (state.nodes.size >= 256) { try { rawNode.disconnect() } catch (_) {} ; throw new RangeError('Too many audio nodes') }
      state.nodes.add(rawNode)
      const out = Object.create(null)
      nativeValues.set(out, rawNode)
      out.connect = target => { check(); if (!state.nodes.has(rawNode) && state.nodes.size >= 256) throw new RangeError('Too many audio nodes'); rawNode.connect(unwrap(target)); state.nodes.add(rawNode); return target }
      out.disconnect = (...args) => { check(); rawNode.disconnect(...args.map(unwrap)); if (!args.length) state.nodes.delete(rawNode) }
      for (const key of ['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate']) if (rawNode[key] && typeof rawNode[key] === 'object') out[key] = parameter(rawNode[key])
      for (const key of ['type', 'loop', 'loopStart', 'loopEnd']) if (key in rawNode) Object.defineProperty(out, key, { get: () => rawNode[key], set: v => { check(); rawNode[key] = v } })
      if ('buffer' in rawNode) Object.defineProperty(out, 'buffer', { get: () => rawNode.buffer ? buffer(rawNode.buffer) : null, set: v => { check(); rawNode.buffer = v == null ? null : unwrap(v) } })
      if (typeof rawNode.start === 'function') {
        out.start = (...args) => { check(); if (state.sources.size >= 256) throw new RangeError('Too many audio sources'); rawNode.start(...args.map(Number)); state.sources.add(rawNode) }
        out.stop = (...args) => { check(); rawNode.stop(...args.map(Number)) }
        // Preserve the author's cleanup callback: games disconnect their gain
        // and filter graph here, not only the finished oscillator.
        let ended = null
        Object.defineProperty(out, 'onended', { get: () => ended, set: value => { ended = typeof value === 'function' ? value : null } })
        rawNode.onended = () => {
          state.nodes.delete(rawNode); state.sources.delete(rawNode); try { rawNode.disconnect() } catch (_) {}
          if (!disposed && !state.closed && ended) options.call?.(() => ended({ type: 'ended', target: out }))
        }
      }
      return out
    }
    context.destination = node(raw.destination)
    for (const key of ['currentTime', 'sampleRate', 'state']) Object.defineProperty(context, key, { get: () => state.closed && key === 'state' ? 'closed' : raw[key] })
    for (const method of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createAnalyser']) if (typeof raw[method] === 'function') context[method] = () => { check(); return node(raw[method]()) }
    context.createBuffer = (channels, length, rate) => {
      check(); channels = Number(channels); length = Number(length); rate = Number(rate)
      if (!Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isSafeInteger(length) || length < 1 || !Number.isFinite(rate) || rate < 8000 || rate > 96000) throw new RangeError('Invalid audio buffer')
      reserve(channels * length * 4)
      const value = raw.createBuffer(channels, length, rate)
      options.grantBufferWork?.(channels * length)
      return buffer(value)
    }
    context.resume = () => { check(); if (hidden || !options.isGesture?.()) return Promise.reject(new Error('Audio requires a user gesture')); return Promise.resolve(raw.resume()) }
    context.suspend = () => { check(); return Promise.resolve(raw.suspend()) }
    context.close = () => { closeState(state); return Promise.resolve() }
    context.createMediaElementSource = element => {
      check(); const media = elements.get(element)
      if (!media || media.attached) throw new TypeError('Invalid or already connected audio element')
      const output = raw.createGain(), wrapper = node(output)
      media.attached = true; media.context = state; media.output = output; state.media.add(media)
      media.load(); return wrapper
    }
    return { context, state }
  }
  function closeState (state) {
    if (state.closed) return
    state.closed = true
    for (const media of state.media) media.pause()
    for (const native of new Set([...state.nodes, ...state.sources])) { try { native.stop?.() } catch (_) {}; try { native.disconnect() } catch (_) {} }
    state.nodes.clear(); state.sources.clear()
    try { Promise.resolve(state.raw.close()).catch(() => {}) } catch (_) {}
    states.delete(state)
  }
  class Audio {
    constructor (source = '') {
      let src = '', decoded = null, pending = null, generation = 0, playing = false, voice = null, offset = 0, startedAt = 0, loop = false, volume = 1, muted = false
      const handlers = new Map(), attributes = Object.create(null), self = this
      const emit = type => { if (disposed) return; options.call?.(() => { const event = { type, target: self }; self['on' + type]?.(event); for (const fn of handlers.get(type) || []) fn(event) }) }
      const media = { attached: false, context: null, output: null, pause, load }
      elements.set(this, media)
      function stopVoice () { if (voice) { const previous = voice; voice = null; try { previous.stop() } catch (_) {}; try { previous.disconnect() } catch (_) {} } }
      function pause () { if (playing && media.context) offset += Math.max(0, media.context.raw.currentTime - startedAt); playing = false; stopVoice() }
      function start () {
        if (!playing || !decoded || hidden || disposed || media.context?.closed) return
        stopVoice()
        const raw = media.context.raw
        voice = raw.createBufferSource(); voice.buffer = decoded; voice.loop = loop; voice.connect(media.output)
        const current = voice
        voice.onended = () => { if (voice === current && !loop) { playing = false; offset = 0; voice = null; current.disconnect(); emit('ended') } }
        startedAt = raw.currentTime
        voice.start(0, decoded.duration ? offset % decoded.duration : 0)
        emit('play')
      }
      function load () {
        alive()
        if (!media.context || !src || decoded || pending) return pending || Promise.resolve()
        const revision = generation
        pending = Promise.resolve().then(() => {
          const match = src.match(/^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i)
          if (!match || match[1].length > 4 * 1024 * 1024) throw new Error('Only bounded embedded audio is supported')
          const binary = atobSafe(match[1].replace(/\s/g, '')), bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          // Inspect duration/channels and reserve resampled PCM before decoding.
          // Concurrent loads share the document-wide 64 MiB cap.
          const reservation = decodedAudioBytes(bytes, media.context.raw.sampleRate)
          if (reservation > 60 * 1024 * 1024) throw new RangeError('Decoded audio exceeds its PCM limit')
          reserve(reservation)
          return Promise.resolve(media.context.raw.decodeAudioData(bytes.buffer)).then(value => {
            const actual = value.length * value.numberOfChannels * 4
            if (actual > reservation) throw new RangeError('Decoded audio exceeds its PCM limit')
            allocated -= reservation - actual
            return value
          })
        }).then(value => {
          if (disposed || revision !== generation || media.context.closed) return
          decoded = value; emit('loadedmetadata'); emit('canplay'); start()
        }).catch(error => { if (!disposed && revision === generation) { self.error = { message: String(error.message || error) }; emit('error') }; throw error }).finally(() => { if (revision === generation) pending = null })
        pending.catch(() => {})
        return pending
      }
      Object.defineProperties(this, {
        src: { get: () => src, set: value => { alive(); pause(); src = String(value || ''); decoded = null; pending = null; generation++; offset = 0; load() } },
        paused: { get: () => !playing },
        readyState: { get: () => decoded ? 4 : 0 },
        duration: { get: () => decoded?.duration || NaN },
        currentTime: { get: () => offset + (playing && media.context ? media.context.raw.currentTime - startedAt : 0), set: value => { offset = Math.max(0, Number(value) || 0); if (playing) start() } },
        loop: { get: () => loop, set: value => { loop = Boolean(value); if (voice) voice.loop = loop } },
        volume: { get: () => volume, set: value => { volume = Math.max(0, Math.min(1, Number(value))); if (media.output) media.output.gain.value = muted ? 0 : volume } },
        muted: { get: () => muted, set: value => { muted = Boolean(value); if (media.output) media.output.gain.value = muted ? 0 : volume } }
      })
      this.play = () => {
        alive()
        if (hidden || !options.isGesture?.()) return Promise.reject(new Error('Audio requires a user gesture'))
        if (!media.context) { const { state } = makeContext(); media.context = state; media.output = state.raw.createGain(); media.output.connect(state.raw.destination); state.media.add(media) }
        media.output.gain.value = muted ? 0 : volume
        playing = true
        return Promise.resolve(media.context.raw.resume()).then(load).then(() => { if (playing && !voice) start() }).catch(error => { playing = false; throw error })
      }
      this.pause = pause; this.load = load
      this.addEventListener = (type, fn) => { if (typeof fn !== 'function') return; if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn) }
      this.removeEventListener = (type, fn) => handlers.get(type)?.delete(fn)
      this.setAttribute = (key, value) => { attributes[String(key)] = String(value); if (key === 'src') this.src = value; if (key === 'loop') this.loop = true }
      this.getAttribute = key => attributes[String(key)] ?? null
      if (source) this.src = source
    }
  }
  return {
    Audio,
    AudioContext: typeof options.createContext === 'function' ? function AudioContext () { return makeContext().context } : undefined,
    setVisible (visible) {
      hidden = !visible
      for (const state of states) {
        if (hidden) { state.resumeOnShow = state.raw.state === 'running'; try { Promise.resolve(state.raw.suspend()).catch(() => {}) } catch (_) {} }
        else if (state.resumeOnShow) { state.resumeOnShow = false; try { Promise.resolve(state.raw.resume()).catch(() => {}) } catch (_) {} }
      }
    },
    destroy () { disposed = true; for (const state of states) closeState(state) }
  }
}
module.exports = { createAudioRuntime }
