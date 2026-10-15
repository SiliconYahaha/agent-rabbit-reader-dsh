'use strict'

// Materialize presentation resources only. Never rewrite source code, DOM
// identity, visible text, input values or serialized JSON by substring matching.
// SVG is deliberately excluded; its existing sanitizer must still run.
const IMAGE_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i
const MIN_INLINE_BYTES = 8 * 1024
const { createInlineCacheLease } = require('./inline-cache-lifecycle')
let sequence = 0
function hasLargeInlineImage (source) {
  const pattern = /data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/= \t\n\r\f]+/gi
  let match
  while ((match = pattern.exec(String(source)))) if (match[0].length > MIN_INLINE_BYTES) return true
  return false
}

function createInlineImageStore (fs, root) {
  const lease = createInlineCacheLease(fs, root)
  const prefix = lease ? lease.prefix : `${root}/reader-inline-${Date.now()}-${++sequence}-`
  const entries = new Map(), owned = new Set()
  const removals = new Map(), failedPaths = new Set()
  let disposed = false, bytes = 0, nextFile = 0, closing = null
  const remove = filePath => {
    if (!owned.has(filePath) || typeof fs.unlink !== 'function') return Promise.resolve()
    if (removals.has(filePath)) return removals.get(filePath)
    const pending = new Promise(resolve => {
      try { fs.unlink({ filePath, success: () => { owned.delete(filePath); failedPaths.delete(filePath); resolve() }, fail: () => resolve() }) } catch (_) { resolve() }
    })
    removals.set(filePath, pending)
    pending.then(() => { if (removals.get(filePath) === pending) removals.delete(filePath) })
    return pending
  }
  async function resource (source, force = false) {
    if (disposed) throw new Error('文件已关闭')
    const value = String(source), comma = value.indexOf(',')
    const normalized = value.slice(0, comma + 1) + value.slice(comma + 1).replace(/[ \t\n\r\f]/g, '')
    const urls = (force || value.length > MIN_INLINE_BYTES) && IMAGE_PREFIX.test(value) ? [normalized] : []
    for (const url of new Set(urls)) {
      if (disposed) throw new Error('文件已关闭')
      if (entries.has(url)) { await entries.get(url).ready; continue }
      // Retry settled failed partial-file removals, not healthy/pending writes.
      // Do not wait on an old in-flight unlink: unique paths protect its later
      // callback. Rotate a bounded batch so one persistent failure cannot starve.
      const cleanup = []
      for (const filePath of Array.from(failedPaths).slice(0, 256)) {
        failedPaths.delete(filePath); failedPaths.add(filePath)
        if (!removals.has(filePath)) cleanup.push(remove(filePath))
      }
      if (cleanup.length) await Promise.all(cleanup)
      if (disposed) throw new Error('文件已关闭')
      let preparation
      if (lease) {
        try { preparation = lease.prepare(); await preparation } catch (error) {
          const failure = new Error(`内嵌图片缓存准备失败：${error && (error.errMsg || error.message) || '本机目录不可用'}`)
          failure.code = 'INLINE_IMAGE_WRITE_FAILED'
          throw failure
        }
        if (disposed) throw new Error('文件已关闭')
      }
      if (entries.has(url)) { await entries.get(url).ready; continue }
      const comma = url.indexOf(',')
      let data = url.slice(comma + 1)
      if (data.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(data) || data.includes('=') && data.length % 4 !== 0) throw new Error('内嵌图片数据不完整')
      data = data.padEnd(Math.ceil(data.length / 4) * 4, '=')
      const size = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
      if (entries.size >= 128 || bytes + size > 32 * 1024 * 1024) throw new Error('内嵌图片缓存超过安全上限')
      bytes += size
      const ext = url.slice(11, url.indexOf(';')).toLowerCase().replace('jpeg', 'jpg')
      // A failed entry can be retried while its asynchronous unlink is pending.
      // Never reuse its path, or that old callback could delete a newer image.
      const filePath = `${prefix}${nextFile++}.${ext}`
      owned.add(filePath)
      const entry = { filePath, ready: null }
      entries.set(url, entry)
      entry.ready = new Promise((resolve, reject) => fs.writeFile({ filePath, data, encoding: 'base64',
        success: () => { if (disposed) { remove(filePath); reject(new Error('文件已关闭')) } else resolve() },
        fail: reject
      })).catch(error => {
        // Share one failure with current callers, but do not poison future
        // requests or keep charging a write that never became a usable file.
        if (entries.get(url) === entry) { entries.delete(url); bytes -= size }
        if (lease) lease.invalidate(preparation)
        // Keep ownership on deletion failure so dispose/re-entry can retry it.
        // Retry paths stay unique while this asynchronous removal is pending.
        failedPaths.add(filePath); remove(filePath)
        if (disposed) throw new Error('文件已关闭')
        const failure = new Error(`内嵌图片保存失败：${error && (error.errMsg || error.message) || '本机空间不足'}`)
        failure.code = 'INLINE_IMAGE_WRITE_FAILED'
        throw failure
      })
      await entry.ready
    }
    if (disposed) throw new Error('文件已关闭')
    return entries.get(normalized)?.filePath || source
  }
  async function css (source) {
    // Skip comments and strings: content:"url(data:...)" is text, not a URL.
    source = String(source || '')
    let output = '', cursor = 0, i = 0
    while (i < source.length) {
      if (source.slice(i, i + 2) === '/*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue }
      const quote = source[i]
      if (quote === '"' || quote === "'") { i++; while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === quote) break } continue }
      const start = /[uU]/.test(source[i]) && !/[\w-]/.test(source[i - 1] || '') && source.slice(i).match(/^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/i)
      if (start) {
        const value = start[1] ?? start[2] ?? start[3], rewritten = await resource(value)
        if (rewritten !== value) { output += source.slice(cursor, i) + `url("${rewritten}")`; cursor = i + start[0].length }
        i += start[0].length
      } else i++
    }
    return output + source.slice(cursor)
  }
  async function rewriteView (rendered) {
    const visit = async nodes => {
      for (const node of nodes || []) {
        if (node.type === 'text') continue
        if (node.name === 'img' && node.attrs?.src) node.attrs.src = await resource(node.attrs.src)
        if (node.attrs?.style) node.attrs.style = await css(node.attrs.style)
        await visit(node.children)
      }
    }
    await visit(rendered.nodes)
    if (rendered.wrapperStyle) rendered.wrapperStyle = await css(rendered.wrapperStyle)
    return rendered
  }
  function hasViewResources (rendered) {
    const visit = nodes => (nodes || []).some(node => node.type !== 'text' &&
      (node.name === 'img' && hasLargeInlineImage(node.attrs?.src) || hasLargeInlineImage(node.attrs?.style) || visit(node.children)))
    return hasLargeInlineImage(rendered.wrapperStyle) || visit(rendered.nodes)
  }
  async function rewriteStaticHtml (source) {
    // Only called on sanitized fallback HTML, never on the executable document.
    const { ShimDocument, parseFragment, serializeNode } = require('./html-runtime/html-dom-shim')
    const fragment = parseFragment(source, new ShimDocument())
    const visit = async node => {
      if (node.nodeType === 1) {
        if (node.localName === 'img' && node.getAttribute('src')) node.setAttribute('src', await resource(node.getAttribute('src')))
        if (node.getAttribute('style')) node.setAttribute('style', await css(node.getAttribute('style')))
        if (node.localName === 'style') { node.textContent = await css(node.textContent); return }
      }
      for (const child of node.childNodes || []) await visit(child)
    }
    await visit(fragment)
    return serializeNode(fragment, { includeRuntime: false })
  }
  return {
    resource, css, rewriteView, hasViewResources, rewriteStaticHtml,
    get size () { return entries.size },
    get bytes () { return bytes },
    dispose () {
      if (closing) return closing
      disposed = true
      // A closing lease remains protected while writes/unlinks are in flight.
      // Re-entry can retry failed unlinks only after this lease is inactive.
      const pending = Array.from(entries.values(), entry => entry.ready.catch(() => {}))
      closing = Promise.all(pending).then(() => Promise.all(Array.from(owned, remove))).then(() => { if (lease) lease.release() })
      entries.clear()
      bytes = 0
      return closing
    }
  }
}

module.exports = { createInlineImageStore, hasLargeInlineImage }
