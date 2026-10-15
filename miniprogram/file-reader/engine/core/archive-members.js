'use strict'

function visibleArchiveName (name) {
  return String(name).replace(/[\u0000-\u001f\u007f-\u009f]/g, value => `⟦U+${value.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`)
}

// Display names never replace source-order member identity.
function annotateArchiveMembers (entries, nameOf) {
  const counts = Object.create(null)
  const seen = Object.create(null)
  const key = nameOf || (entry => entry.name)
  for (const entry of entries) {
    const name = key(entry)
    if (!entry.isDirectory) counts[name] = (counts[name] || 0) + 1
  }
  return entries.map((entry, index) => {
    if (entry.isDirectory) return { ...entry }
    const name = key(entry)
    const duplicateIndex = seen[name] || 0
    seen[name] = duplicateIndex + 1
    const duplicateCount = counts[name]
    return {
      ...entry,
      memberIndex: Number.isInteger(entry.memberIndex) ? entry.memberIndex : index,
      duplicateIndex,
      duplicateCount,
      displayName: `${visibleArchiveName(entry.name)}${duplicateCount > 1 ? `（同名 ${duplicateIndex + 1}/${duplicateCount}）` : ''}`
    }
  })
}

function safeArchivePath (value) { const path = String(value || '').replace(/\\/g, '/'); return !!path && !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.includes('\0') && !path.split('/').includes('..') }

function crc32 (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function verifyArchiveMember (output, entry, maxSize) {
  if (output.length > maxSize) throw new Error('解压后的文件超过打开上限')
  if (Number.isFinite(entry.uncompressedSize) && output.length !== entry.uncompressedSize) throw new Error(`包内文件大小不匹配：应为 ${entry.uncompressedSize} B，实际 ${output.length} B`)
  const expected = typeof entry.crc === 'number' ? entry.crc >>> 0 : /^[0-9a-f]{8}$/i.test(entry.crc || '') ? parseInt(entry.crc, 16) : null
  if (expected !== null && crc32(output) !== expected) throw new Error('包内文件 CRC 校验失败，内容与所选成员不一致')
}

module.exports = { annotateArchiveMembers, crc32, safeArchivePath, verifyArchiveMember, visibleArchiveName }
