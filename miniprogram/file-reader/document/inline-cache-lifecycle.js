'use strict'

// This directory contains only disposable reader-generated presentation copies.
// Never scan USER_DATA_PATH itself: legacy root files have no ownership record.
const DIRECTORY = 'reader-inline-cache-v1'
const boot = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12) || '0'}`
const ownedName = /^(reader-inline-[a-z0-9]+-[a-z0-9]{1,12}-\d+-)\d+\.(?:png|jpg|gif|webp|avif)$/
const roots = new Map()
let sequence = 0
const call = (fs, method, args) => new Promise((resolve, reject) => fs[method]({ ...args, success: resolve, fail: reject }))

function createInlineCacheLease (fs, root) {
  // Write-only adapters are used by isolated pixel oracles. The actual WeChat
  // filesystem has these APIs; never silently fall back after an I/O failure.
  if (!['mkdir', 'readdir', 'unlink'].every(method => typeof fs[method] === 'function')) return null
  const directory = `${root}/${DIRECTORY}`
  let state = roots.get(directory)
  if (!state) { state = { active: new Set(), sweep: null, cursor: '' }; roots.set(directory, state) }
  const name = `reader-inline-${boot}-${++sequence}-`
  state.active.add(name) // Register before any asynchronous directory snapshot.
  let prepared = null
  async function sweep () {
    // mkdir can report EEXIST in some runtimes; readdir is the authoritative
    // accessibility check. Other errors still surface and may be retried.
    try { await call(fs, 'mkdir', { dirPath: directory, recursive: true }) } catch (_) {}
    const result = await call(fs, 'readdir', { dirPath: directory })
    if (!Array.isArray(result.files)) throw Error('图片缓存目录读取失败')
    // Rotate even past failed deletions: an undeletable first batch must not
    // hide reclaimable files forever. Only this dedicated directory is read.
    const files = result.files.filter(file => typeof file === 'string' && ownedName.test(file)).sort()
    const start = files.findIndex(file => file > state.cursor)
    const ordered = start < 0 ? files : files.slice(start).concat(files.slice(0, start))
    let attempted = 0
    for (const file of ordered) {
      const match = file.match(ownedName)
      if (!match || state.active.has(match[1])) continue
      state.cursor = file
      // No recursion, path separators, unknown files or active leases. unlink
      // rejects directories; no rmdir fallback, even for a matching basename.
      try { await call(fs, 'unlink', { filePath: `${directory}/${file}` }) } catch (_) {}
      if (++attempted >= 256) break // Bound one opening; later opens continue.
    }
  }
  return {
    prefix: `${directory}/${name}`,
    prepare () {
      if (!prepared) {
        if (!state.sweep) {
          const pending = sweep()
          state.sweep = pending
          pending.then(() => { if (state.sweep === pending) state.sweep = null }, () => { if (state.sweep === pending) state.sweep = null })
        }
        prepared = state.sweep.catch(error => { prepared = null; throw error })
      }
      return prepared
    },
    // A late write from an older preparation cannot invalidate a newer one.
    invalidate (preparation) { if (prepared === preparation) prepared = null },
    release () { state.active.delete(name) }
  }
}

module.exports = { createInlineCacheLease }
