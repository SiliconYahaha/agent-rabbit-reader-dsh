'use strict'

// Only app-owned copies are removed. Original chat files are never touched.
const KEY = 'rabbit-recent-session-v1'
const TTL = 20 * 60 * 1000
const MAX_BYTES = 50 * 1024 * 1024
let generation = 0
const api = () => typeof wx === 'undefined' ? null : wx
const root = host => host && host.env && host.env.USER_DATA_PATH ? host.env.USER_DATA_PATH + '/rabbit-recent-v1' : ''
function removeCopies (host, record) {
  const base = root(host)
  if (!base || !record || !Array.isArray(record.files)) return
  const fs = host.getFileSystemManager()
  for (const file of record.files) if (typeof file.path === 'string' && file.path.startsWith(base + '/') && !file.path.slice(base.length + 1).includes('/')) {
    try { fs.unlink({ filePath: file.path, fail () {} }) } catch (_) {}
  }
}
function read (host = api(), now = Date.now()) {
  if (!host || typeof host.getStorageSync !== 'function') return null
  try {
    const record = host.getStorageSync(KEY)
    if (!record || record.version !== 1 || !Array.isArray(record.files)) return null
    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      host.removeStorageSync(KEY);removeCopies(host, record);return null
    }
    if (!record.files.length || record.files.length > 10) return null
    return record
  } catch (_) { return null }
}
function prune (host = api(), now = Date.now()) {
  const base = root(host)
  if (!base || typeof host.getFileSystemManager !== 'function') return
  let fs
  try { fs = host.getFileSystemManager() } catch (_) { return }
  if (typeof fs.readdir !== 'function') return
  try { fs.readdir({ dirPath: base, success: result => {
    for (const name of result.files || []) {
      const match = /^(\d+)-\d+-\d+\.[a-z0-9]{1,10}$/i.exec(name)
      if (match && now - Number(match[1]) >= TTL) { try { fs.unlink({ filePath: base + '/' + name, fail () {} }) } catch (_) {} }
    }
  }, fail () {} }) } catch (_) {}
}
function clear (host = api()) {
  generation++
  if (!host || typeof host.getStorageSync !== 'function') return
  try { const old = host.getStorageSync(KEY);host.removeStorageSync(KEY);removeCopies(host, old) } catch (_) {}
}
function call (fs, name, options) { return new Promise((resolve, reject) => { try { fs[name]({ ...options, success: resolve, fail: reject }) } catch (error) { reject(error) } }) }
async function save (app, files, host = api(), now = Date.now()) {
  if (!host || !root(host) || typeof host.setStorageSync !== 'function') return false
  const token = ++generation, fs = host.getFileSystemManager(), copies = [], queue = files
  const prefix = now + '-' + token
  let bytes = 0
  try {
    try { await call(fs, 'mkdir', { dirPath: root(host), recursive: true }) } catch (_) {}
    for (let index = 0; index < files.length && index < 10; index++) {
      if (token !== generation) throw new Error('superseded')
      const file = files[index]
      const inline = typeof file.inlineHtml === 'string'
      const source = file.path || ''
      const stat = inline ? null : await call(fs, 'stat', { path: source })
      const size = inline ? file.inlineHtml.length * 3 : Number(stat.stats && stat.stats.size)
      if (!Number.isFinite(size) || size < 0 || bytes + size > MAX_BYTES) throw new Error('cache limit')
      bytes += size
      const suffix = inline ? 'html' : ((file.name || '').match(/\.([a-z0-9]{1,10})$/i) || [,'bin'])[1]
      const path = root(host) + '/' + prefix + '-' + index + '.' + suffix
      copies.push({ name: file.name, path, size, type: inline ? 'text/html' : file.type || '' })
      if (inline) await call(fs, 'writeFile', { filePath: path, data: file.inlineHtml, encoding: 'utf8' })
      else await call(fs, 'copyFile', { srcPath: source, destPath: path })
    }
    if (token !== generation || app.globalData.fileQueue !== queue) throw new Error('superseded')
    const old = read(host, now)
    const record = { version: 1, id: prefix, expiresAt: now + TTL, files: copies, index: app.globalData.fileQueueIndex || 0, scroll: app.globalData.fileQueueScroll || {} }
    host.setStorageSync(KEY, record)
    app.globalData.recentSessionId = prefix
    removeCopies(host, old)
    return true
  } catch (_) { removeCopies(host, { files: copies });return false }
}
function checkpoint (app, host = api()) {
  const record = read(host)
  if (!record || !app || !app.globalData || record.id !== app.globalData.recentSessionId) return
  record.index = app.globalData.fileQueueIndex
  record.scroll = app.globalData.fileQueueScroll || {}
  // Fixed expiry: reading progress cannot keep private documents forever.
  try { host.setStorageSync(KEY, record) } catch (_) {}
}
async function restore (app, host = api()) {
  const record = read(host)
  if (!record) return false
  const token = generation, fs = host.getFileSystemManager()
  try {
    for (const file of record.files) {
      if (!file.path.startsWith(root(host) + '/') || file.path.slice(root(host).length + 1).includes('/')) throw new Error('invalid path')
      await call(fs, 'access', { path: file.path })
    }
    if (token !== generation || !read(host) || read(host).id !== record.id) return false
    Object.assign(app.globalData, { fileQueue: record.files, fileQueueIndex: Math.max(0, Math.min(record.files.length - 1, Number(record.index) || 0)), fileQueueScroll: record.scroll || {}, recentSessionId: record.id })
    return true
  } catch (_) { if (token === generation) clear(host);return false }
}
module.exports = { KEY, TTL, MAX_BYTES, read, clear, save, restore, checkpoint, prune }
