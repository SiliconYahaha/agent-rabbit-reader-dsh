'use strict'

const { decodeText, toUint8 } = require('./kernel').textDecoder
const { MAX_LINK_BYTES, packagePath } = require('./rar-links')

function canonicalEntries (entries) {
  const list = []
  const byPath = new Map()
  for (const entry of entries || []) {
    if (!entry || entry.zipHidden || !Number.isInteger(entry.zipCentralIndex)) continue
    let path
    try { path = packagePath(entry.name) } catch (_) { continue }
    list.push({ entry, path })
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path).push(entry)
  }
  return { list, byPath }
}

function decodeLinkTarget (input) {
  const bytes = toUint8(input)
  if (!bytes.length || bytes.length > MAX_LINK_BYTES) throw new Error('ZIP 链接目标为空或超过长度上限')
  const decoded = decodeText(bytes, { encoding: 'utf-8' })
  if (decoded.errors || decoded.text.includes('\0')) throw new Error('ZIP 链接目标不是可靠的 UTF-8 包内路径')
  return decoded.text
}

async function resolveZipLink (entries, requested, readEntry) {
  if (!requested) throw new Error('请选择 ZIP 中的文件')
  if (typeof readEntry !== 'function') throw new Error('ZIP 链接读取器不可用')
  const canonical = canonicalEntries(entries)
  let selected = (entries || []).find(entry => entry.zipCentralIndex === requested.zipCentralIndex && entry.name === requested.name)
  if (!selected) throw new Error('ZIP 链接成员已变化，请重新打开压缩包')
  let selectedPath = packagePath(selected.name)
  const visited = new Set()

  async function destination (linked, suffix = '') {
    const identity = `${linked.zipCentralIndex}:${linked.name}`
    if (visited.has(identity)) throw new Error('ZIP 链接形成循环，无法打开')
    if (visited.size >= 16) throw new Error('ZIP 链接层数超过安全上限')
    visited.add(identity)
    const target = decodeLinkTarget(await readEntry(linked, MAX_LINK_BYTES))
    const linkPath = packagePath(linked.name)
    const parent = linkPath.split('/').slice(0, -1).join('/')
    const targetPath = packagePath(target, parent)
    return suffix ? packagePath(suffix, targetPath) : targetPath
  }

  while (selectedPath) {
    const matches = canonical.byPath.get(selectedPath) || []
    if (matches.length > 1) throw new Error('ZIP 链接目标存在多个同名条目，不能确定正确内容')
    if (matches.length === 1) {
      selected = matches[0]
      if (!selected.isLink) break
      selectedPath = await destination(selected)
      continue
    }
    const parts = selectedPath.split('/')
    let intermediate = null
    for (let length = parts.length - 1; length > 0; length--) {
      const prefixMatches = canonical.byPath.get(parts.slice(0, length).join('/')) || []
      if (prefixMatches.length > 1) throw new Error('ZIP 链接路径中存在多个同名条目，不能确定正确内容')
      if (prefixMatches.length === 1 && prefixMatches[0].isLink) {
        intermediate = { entry: prefixMatches[0], suffix: parts.slice(length).join('/') }
        break
      }
    }
    if (intermediate) {
      selectedPath = await destination(intermediate.entry, intermediate.suffix)
      continue
    }
    const children = canonical.list.filter(candidate => candidate.path.startsWith(`${selectedPath}/`)).map(candidate => candidate.entry)
    if (!children.length) throw new Error('ZIP 链接目标在包内不存在')
    return { entry: { name: selectedPath, isDirectory: true }, entries: children }
  }
  return { entry: selected }
}

module.exports = { decodeLinkTarget, resolveZipLink }
