'use strict'

const { decodeText, toUint8 } = require('./kernel').textDecoder
const { MAX_LINK_BYTES } = require('./rar-links')

// Unix 7z names use only slash as a separator. A literal backslash must never
// redirect a link to a different file with a similar displayed name.
function packagePath (value, parent = '') {
  const name = String(value)
  if (/^[a-z][a-z\d+.-]*:/i.test(name) || name.startsWith('/') || /[\0-\x1f\x7f]/.test(name)) throw new Error('7z 链接路径不安全')
  const parts = parent ? parent.split('/') : []
  for (const part of name.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('7z 链接指向压缩包之外')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

function decodeLinkTarget (input) {
  const bytes = toUint8(input)
  if (!bytes.length || bytes.length > MAX_LINK_BYTES) throw new Error('7z 链接目标为空或超过长度上限')
  const decoded = decodeText(bytes, { encoding: 'utf-8' })
  if (decoded.errors || decoded.text.includes('\0')) throw new Error('7z 链接目标不是可靠的 UTF-8 包内路径')
  return decoded.text
}

async function resolveSevenZipLink (entries, requested, readEntry) {
  const selected = entries.find(item => item.memberIndex === requested.memberIndex && item.name === requested.name)
  if (!selected) throw new Error('7z 链接成员已变化，请重新打开压缩包')
  const byPath = new Map()
  for (const item of entries) {
    if (!Number.isInteger(item.memberIndex)) continue // tree-only folder rows
    let path
    try { path = packagePath(item.name) } catch (_) { continue }
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path).push(item)
  }
  const visited = new Set()
  async function destination (linked, suffix = '') {
    if (visited.has(linked.memberIndex)) throw new Error('7z 链接形成循环，无法打开')
    if (visited.size >= 16) throw new Error('7z 链接层数超过安全上限')
    visited.add(linked.memberIndex)
    if ((linked.linkType || 1) !== 1 || !linked.linkTargetInData) throw new Error('7z 链接类型暂不支持')
    const target = decodeLinkTarget(await readEntry(linked, MAX_LINK_BYTES))
    const parent = packagePath(linked.name).split('/').slice(0, -1).join('/')
    const path = packagePath(target, parent)
    return suffix ? packagePath(suffix, path) : path
  }
  // The user's first selection has an exact native index, even for duplicate
  // names. Subsequent target paths must be unambiguous.
  let path = selected.isLink ? await destination(selected) : packagePath(selected.name)
  for (;;) {
    const parts = path.split('/')
    let redirected = false
    for (let length = 1; length < parts.length; length++) {
      const prefix = parts.slice(0, length).join('/')
      const candidates = byPath.get(prefix) || []
      if (candidates.length > 1) throw new Error('7z 链接路径中存在多个同名条目')
      if (candidates.length && candidates[0].isLink) {
        path = await destination(candidates[0], parts.slice(length).join('/'))
        redirected = true
        break
      }
      if (candidates.length && !candidates[0].isDirectory) throw new Error('7z 链接路径经过普通文件')
    }
    if (redirected) continue
    const matches = byPath.get(path) || []
    if (matches.length > 1) throw new Error('7z 链接目标存在多个同名条目，不能确定正确内容')
    if (matches.length && matches[0].isLink) { path = await destination(matches[0]); continue }
    if (matches.length && !matches[0].isDirectory) return { entry: matches[0] }
    const children = []
    for (const [name, items] of byPath) if (name !== path && (!path || name.startsWith(`${path}/`))) children.push(...items)
    if (!children.length && !matches.length && path) throw new Error('7z 链接目标在包内不存在')
    return { entry: { name: path || '.', isDirectory: true, pathSeparator: 'slash' }, entries: children }
  }
}

module.exports = { resolveSevenZipLink }
