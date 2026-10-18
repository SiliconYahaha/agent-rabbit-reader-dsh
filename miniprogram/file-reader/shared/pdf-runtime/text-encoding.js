'use strict'
// PDF.js needs UTF-8 and BOM-tagged UTF-16 in hosts without Encoding APIs.
// Keep this local to the PDF runtime: do not replace application globals.
class PDFTextDecoder {
  constructor (label = 'utf-8', options = {}) {
    const encoding = String(label).trim().toLowerCase()
    this.encoding = ({ utf8: 'utf-8', 'utf-8': 'utf-8', 'utf-16': 'utf-16le', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be' })[encoding]
    if (!this.encoding) throw new RangeError('Unsupported text encoding: ' + label)
    this.fatal = !!options.fatal
    this.ignoreBOM = !!options.ignoreBOM
    this._reset()
  }
  _reset () { this._pending = []; this._bomSeen = false; this._streaming = false }
  decode (input = new Uint8Array(), options = {}) {
    if (!this._streaming) this._reset()
    const source = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input)
    const bytes = this._pending.concat(Array.from(source)); this._pending = []
    this._streaming = !!options.stream
    const chars = []
    const emit = code => {
      if (!this._bomSeen) { this._bomSeen = true; if (code === 0xfeff && !this.ignoreBOM) return }
      chars.push(String.fromCodePoint(code))
    }
    const invalid = () => { if (this.fatal) { this._reset(); throw new TypeError('Invalid encoded text') } emit(0xfffd) }
    let i = 0
    while (i < bytes.length) {
      const start = i
      if (this.encoding !== 'utf-8') {
        if (i + 1 >= bytes.length) { if (this._streaming) this._pending = bytes.slice(i); else invalid(); break }
        const unit = at => this.encoding === 'utf-16le' ? bytes[at] | bytes[at + 1] << 8 : bytes[at] << 8 | bytes[at + 1]
        const high = unit(i); i += 2
        if (high >= 0xd800 && high <= 0xdbff) {
          if (i + 1 >= bytes.length) { if (this._streaming) { this._pending = bytes.slice(start); break } invalid(); break }
          const low = unit(i)
          if (low < 0xdc00 || low > 0xdfff) { invalid(); continue }
          i += 2; emit(0x10000 + ((high - 0xd800) << 10) + low - 0xdc00)
        } else if (high >= 0xdc00 && high <= 0xdfff) invalid()
        else emit(high)
        continue
      }
      const first = bytes[i++]
      if (first < 0x80) { emit(first); continue }
      let needed, code, lower = 0x80, upper = 0xbf
      if (first >= 0xc2 && first <= 0xdf) { needed = 1; code = first & 31 }
      else if (first >= 0xe0 && first <= 0xef) { needed = 2; code = first & 15; if (first === 0xe0) lower = 0xa0; if (first === 0xed) upper = 0x9f }
      else if (first >= 0xf0 && first <= 0xf4) { needed = 3; code = first & 7; if (first === 0xf0) lower = 0x90; if (first === 0xf4) upper = 0x8f }
      else { invalid(); continue }
      let complete = true
      for (let n = 0; n < needed; n++) {
        if (i === bytes.length) { if (this._streaming) this._pending = bytes.slice(start); else invalid(); complete = false; break }
        const next = bytes[i]
        if (next < lower || next > upper) { invalid(); complete = false; break }
        i++; code = (code << 6) | (next & 63); lower = 0x80; upper = 0xbf
      }
      if (complete) emit(code)
    }
    return chars.join('')
  }
}
class PDFTextEncoder {
  get encoding () { return 'utf-8' }
  encode (input = '') {
    const output = []
    for (const char of String(input)) {
      let code = char.codePointAt(0)
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
      if (code < 0x80) output.push(code)
      else if (code < 0x800) output.push(0xc0 | code >> 6, 0x80 | code & 63)
      else if (code < 0x10000) output.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63)
      else output.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63)
    }
    return new Uint8Array(output)
  }
  encodeInto (input, destination) {
    let read = 0, written = 0
    for (const char of String(input)) {
      const bytes = this.encode(char)
      if (written + bytes.length > destination.length) break
      destination.set(bytes, written); written += bytes.length; read += char.length
    }
    return { read, written }
  }
}
module.exports = { TextDecoder: PDFTextDecoder, TextEncoder: PDFTextEncoder }
