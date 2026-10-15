'use strict'
const { toUint8 } = require('./kernel').textDecoder
const { utf8Encode } = require('./kernel').textCodec
const READ_CHUNK_BYTES = 256 * 1024

// Large single callbacks can fail inside DevTools' binary response converter,
// before the application receives success/fail. Bounded reads also avoid large
// intermediate bridge copies. Join bytes before decoding so CJK boundaries stay intact.
function readHtmlFileBytes (fs, options) {
  const { filePath, maxBytes, success, fail } = options
  const label = options.label || 'HTML'
  const isCurrent = options.isCurrent || (() => true)
  const reject = error => { if (isCurrent()) fail({ errMsg: error.errMsg || error.message || String(error) }) }
  const hasStat = typeof fs.stat === 'function'
  const normalize = result => {
    if (!options.allowTextResult || typeof result.data !== 'string') return result
    // Older host adapters returned decoded strings. Bound their UTF-8 size
    // before allocating a replacement buffer; native binary reads stay exact.
    let length = 0
    for (const char of result.data) {
      const code = char.codePointAt(0)
      length += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4
      if (length > maxBytes) throw new Error(`${label} 文件长度超过读取安全上限`)
    }
    return { ...result, data: utf8Encode(result.data), decodedText: result.data }
  }
  const changed = () => new Error(`${label} 文件读取长度不一致，文件可能已改变或未下载完整`)
  const finish = (result, size) => {
    if (!isCurrent()) return
    if (!hasStat) { success(result); return }
    // A file can grow or shrink while its chunks cross the native bridge.
    // Recheck before exposing content; equal-length concurrent edits are not a snapshot.
    fs.stat({ path: filePath, success: current => {
      if (!isCurrent()) return
      if (Number(current.stats && current.stats.size) !== size) { reject(changed()); return }
      success(result)
    }, fail: reject })
  }
  const start = size => {
    if (!isCurrent()) return
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) { reject(new Error(`${label} 文件长度超过读取安全上限`)); return }
    if (size <= READ_CHUNK_BYTES) {
      fs.readFile({ filePath, success: result => {
        if (!isCurrent()) return
        try {
          result = normalize(result)
          const length = toUint8(result.data).byteLength
          if (length > maxBytes) throw new Error(`${label} 文件长度超过读取安全上限`)
          // Without stat, zero is the legacy "unknown size" hint, not proof of EOF.
          if ((hasStat || size > 0) && length !== size) throw changed()
          finish(result, length)
        } catch (error) { reject(error) }
      }, fail: reject })
      return
    }
    let bytes
    try { bytes = new Uint8Array(size) } catch (error) { reject(error); return }
    let position = 0
    const next = () => {
      if (!isCurrent()) return
      const length = Math.min(READ_CHUNK_BYTES, size - position)
      fs.readFile({ filePath, position, length,
        success: result => {
          if (!isCurrent()) return
          try {
            result = normalize(result)
            const chunk = toUint8(result.data)
            if (chunk.byteLength !== length) throw changed()
            bytes.set(chunk, position)
            position += length
            if (position === size) finish({ data: bytes.buffer }, size)
            else setTimeout(next, 0)
          } catch (error) { reject(error) }
        }, fail: reject
      })
    }
    next()
  }
  const size = Number(options.size || 0)
  // Chat-material metadata is only a hint. Trust the local file, never allocate
  // or truncate according to stale metadata (native reads may pad beyond EOF).
  if (hasStat) {
    fs.stat({ path: filePath, success: result => start(Number(result.stats && result.stats.size)), fail: reject })
  } else start(size)
}

module.exports = { readHtmlFileBytes, READ_CHUNK_BYTES }
