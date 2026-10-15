'use strict'

const sevenzip = require('./sevenzip-runtime')
const MAX_LINK_BYTES = 4096

function packagePath (value, parent = '') {
  const name = String(value)
  if (/^[a-z][a-z\d+.-]*:/i.test(name) || name.startsWith('/') || /[\0-\x1f\x7f]/.test(name)) throw new Error('TAR 链接路径不安全')
  const parts = parent ? parent.split('/') : []
  for (const part of name.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('TAR 链接指向归档之外')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

function linkTarget (entry) {
  const target = String(entry.linkTarget == null ? '' : entry.linkTarget)
  let bytes = 0
  for (const char of target) {
    const code = char.codePointAt(0)
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('TAR 链接目标编码无效')
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes > MAX_LINK_BYTES) throw new Error('TAR 链接目标超过长度上限')
  }
  if (!bytes) throw new Error('TAR 链接目标为空')
  return target
}

function resolveTarLink (entries, requested) {
  const selected = entries.find(e => e.memberIndex === requested.memberIndex && e.name === requested.name)
  if (!selected) throw new Error('TAR 成员已变化，请重新打开归档')
  const byPath = new Map(), directories = new Map([['', -1]]), active = new Set()
  let expansions = 0
  for (const entry of entries) {
    if (!Number.isInteger(entry.memberIndex)) continue
    let path
    try { path = packagePath(entry.name) } catch (_) { continue }
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path).push(entry)
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      directories.set(parent, Math.min(directories.get(parent) ?? Infinity, entry.memberIndex))
    }
  }
  function directory (path) {
    return { entry: { name: path || '.', isDirectory: true, pathSeparator: 'slash' }, path }
  }
  function lookup (path, before) {
    const matches = (byPath.get(path) || []).filter(e => e.memberIndex < before)
    if (before !== Infinity && matches.length) {
      return { entry: matches.reduce((latest, e) => e.memberIndex > latest.memberIndex ? e : latest), path }
    }
    if (matches.length > 1) throw new Error('TAR 链接目标存在多个同名条目，无法确定内容')
    if (matches.length) return { entry: matches[0], path }
    if (directories.get(path) < before) return directory(path)
    throw new Error('TAR 链接目标在归档中不存在')
  }
  function follow (entry, location, before = Infinity) {
    if (!entry.isLink) {
      if (entry.unsupportedType) throw new Error('TAR 链接目标是不可阅读的特殊系统条目')
      return { entry, path: location }
    }
    const key = entry.memberIndex + ':' + location
    if (active.has(key)) throw new Error('TAR 链接形成循环')
    if (++expansions > 16) throw new Error('TAR 链接层数超过安全上限')
    active.add(key)
    try {
      const target = linkTarget(entry)
      if (entry.linkType === 4) {
        // Hard links retain the preceding member's inode even when its name is
        // reused later. A symbolic inode's text resolves at the alias location.
        let previous
        try { previous = walk(target, '', entry.memberIndex, true).entry } catch (error) {
          if (/不存在/.test(error.message)) throw new Error('TAR 硬链接没有可用的先前成员')
          throw error
        }
        if (previous.isDirectory) throw new Error('TAR 硬链接目标不能是目录')
        return follow(previous, location, before)
      }
      if (entry.linkType !== 1) throw new Error('TAR 链接类型暂不支持')
      const parent = location.split('/').slice(0, -1).join('/')
      return walk(target, parent, before)
    } finally { active.delete(key) }
  }
  function walk (target, parent, before = Infinity, retainFinalLink = false) {
    // Validate syntax without lexical normalization: each directory (including
    // a symlink) must be traversed before a following dot or parent component.
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/') || /[\0-\x1f\x7f]/.test(target)) throw new Error('TAR 链接路径不安全')
    const parts = target.split('/').filter(Boolean)
    if (target.endsWith('/')) parts.push('.')
    let current = directory(parent)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!current.entry.isDirectory) throw new Error('TAR 链接路径经过普通文件')
      if (part === '.') continue
      if (part === '..') {
        if (!current.path) throw new Error('TAR 链接指向归档之外')
        current = directory(current.path.split('/').slice(0, -1).join('/'))
        continue
      }
      const path = current.path ? current.path + '/' + part : part
      const found = lookup(path, before)
      current = retainFinalLink && i === parts.length - 1 ? found : follow(found.entry, path, before)
    }
    return current
  }
  const result = follow(selected, packagePath(selected.name))
  if (!result.entry.isDirectory) return { entry: result.entry }
  const children = []
  for (const [name, items] of byPath) if (name !== result.path && (!result.path || name.startsWith(result.path + '/'))) children.push(...items)
  return { entry: directory(result.path).entry, entries: children }
}

async function inspectTarArchive (bytes, options = {}) {
  if (bytes && bytes.byteLength > 80 * 1024 * 1024) throw new Error('TAR 文件超过 80 MB，未载入解压内核')
  const result = await sevenzip.inspect7zArchive(bytes, { ...options, archiveType: 'tar-engine', archiveExtension: '.tar' })
  result.summary = `已读取 ${result.entries.length} 个 TAR 成员，可点开普通文件及包内链接。`
  result.metadata = result.metadata.filter(row => row.label !== '压缩方式' && row.label !== '固实压缩')
  result.metadata.splice(1, 0, { label: '归档格式', value: 'TAR（未压缩）' })
  return result
}

function extractTarEntry (bytes, entry, options = {}) {
  return sevenzip.extract7zEntry(bytes, entry, { ...options, archiveExtension: '.tar' })
}

module.exports = { inspectTarArchive, extractTarEntry, resolveTarLink }
