'use strict'

const { annotateArchiveMembers, safeArchivePath } = require('./kernel').archiveMembers

function normalizedCrc (value) {
  if (typeof value === 'number' && Number.isFinite(value)) return (value >>> 0).toString(16).padStart(8, '0')
  const text = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{8}$/.test(text) ? text : ''
}

function identityFailure (index, detail) {
  throw new Error(`ZIP 兼容内核第 ${index + 1} 项与中央目录不一致：${detail}`)
}

function verifyIdentity (nativeEntry, centralEntry, index) {
  if (!centralEntry || centralEntry.zipCentralIndex !== index) identityFailure(index, '成员序号缺失')
  if (Boolean(nativeEntry.isDirectory) !== Boolean(centralEntry.isDirectory)) identityFailure(index, '文件类型不同')
  if (Number(nativeEntry.uncompressedSize) !== Number(centralEntry.uncompressedSize)) identityFailure(index, '原始大小不同')
  if (Number(nativeEntry.compressedSize) !== Number(centralEntry.compressedSize)) identityFailure(index, '压缩大小不同')
  const nativeCrc = normalizedCrc(nativeEntry.crc)
  const centralCrc = normalizedCrc(centralEntry.crc)
  if (nativeCrc && nativeCrc !== centralCrc) identityFailure(index, 'CRC 不同')
}

function mergeZipEngineInspection (engineInspection, zipInspection) {
  if (!engineInspection || engineInspection.archiveType !== 'zip-engine') throw new Error('不是 ZIP 兼容内核目录')
  const nativeEntries = Array.isArray(engineInspection.entries) ? engineInspection.entries : []
  const centralEntries = zipInspection && Array.isArray(zipInspection.zipIdentityEntries) ? zipInspection.zipIdentityEntries : []
  if (nativeEntries.length !== centralEntries.length) throw new Error(`ZIP 兼容内核目录项数量不一致：中央目录 ${centralEntries.length} 项，兼容内核 ${nativeEntries.length} 项`)

  const mergedIdentityEntries = nativeEntries.map(nativeEntry => {
    const index = Number(nativeEntry.memberIndex)
    if (!Number.isInteger(index) || index < 0 || index >= centralEntries.length) throw new Error('ZIP 兼容内核返回了无效成员序号')
    const centralEntry = centralEntries[index]
    verifyIdentity(nativeEntry, centralEntry, index)
    const nativeName = String(nativeEntry.name || '')
    const visibleName = String(centralEntry.name || '')
    return {
      ...nativeEntry,
      name: visibleName,
      nativeName,
      nativeDuplicateIndex: nativeEntry.duplicateIndex,
      nativeDuplicateCount: nativeEntry.duplicateCount,
      zipCentralIndex: index,
      zipHidden: Boolean(centralEntry.zipHidden),
      isLink: Boolean(centralEntry.isLink),
      ...(centralEntry.isLink ? {
        crc: centralEntry.crc,
        detail: `符号链接 · 点开后在包内解析目标${nativeEntry.encrypted ? ' · 已加密' : ''}${/不支持/.test(nativeEntry.detail || '') ? ' · 当前内核不支持此方法' : ''}`
      } : {}),
      canOpen: Boolean(nativeEntry.canOpen) && safeArchivePath(visibleName) && safeArchivePath(nativeName)
    }
  })
  const merged = mergedIdentityEntries.filter(entry => !entry.zipHidden)

  const filenameMetadata = (zipInspection.metadata || []).filter(item => item && item.label === '文件名显示')
  const metadata = (engineInspection.metadata || []).filter(item => item && item.label !== '文件名显示')
  const encodingDescription = zipInspection.filenameEncodingLabel ? `；文件名按${zipInspection.filenameEncodingLabel}显示` : ''
  return {
    ...engineInspection,
    summary: `已由本机 7-Zip 兼容内核读取 ${merged.length} 个有效目录项并核对中央目录身份${encodingDescription}；支持的文件可直接点开。`,
    metadata: metadata.slice(0, 1).concat(filenameMetadata, metadata.slice(1)),
    filenameEncoding: zipInspection.filenameEncoding || '',
    filenameEncodingLabel: zipInspection.filenameEncodingLabel || '',
    filenameEncodingOptions: zipInspection.filenameEncodingOptions || [],
    ambiguousFilenameCount: Number(zipInspection.ambiguousFilenameCount || 0),
    entries: annotateArchiveMembers(merged),
    // Keep every native/central identity pair for safe link resolution. The
    // caller stores this in logic memory and never sends it through setData.
    zipIdentityEntries: annotateArchiveMembers(mergedIdentityEntries)
  }
}

module.exports = { mergeZipEngineInspection, safeArchivePath }
