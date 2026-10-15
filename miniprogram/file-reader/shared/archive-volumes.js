'use strict'

function normalizeName (value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop()
}

function archiveVolumeDescriptor (value) {
  const name = normalizeName(value)
  let match = name.match(/^(.*\.(7z|zip|rar))\.(\d{3,})$/i)
  if (match) {
    const order = Number(match[3])
    return {
      family: 'numeric-split',
      format: match[2].toLowerCase(),
      groupKey: `numeric:${match[1].toLowerCase()}`,
      mainName: `${match[1]}.${'1'.padStart(match[3].length, '0')}`,
      name,
      order,
      explicitPart: true
    }
  }

  match = name.match(/^(.*)\.z(\d{2,})$/i)
  if (match) {
    return {
      family: 'zip-split', format: 'zip', groupKey: `zip:${match[1].toLowerCase()}`,
      mainName: `${match[1]}.zip`, name, order: Number(match[2]), explicitPart: true
    }
  }
  match = name.match(/^(.*)\.zip$/i)
  if (match) {
    return {
      family: 'zip-split', format: 'zip', groupKey: `zip:${match[1].toLowerCase()}`,
      mainName: name, name, order: Number.MAX_SAFE_INTEGER, explicitPart: false
    }
  }

  match = name.match(/^(.*)\.part(\d+)\.rar$/i)
  if (match) {
    return {
      family: 'rar-part', format: 'rar', groupKey: `rar-part:${match[1].toLowerCase()}`,
      mainName: `${match[1]}.part1.rar`, name, order: Number(match[2]), explicitPart: true
    }
  }
  match = name.match(/^(.*)\.r(\d{2,})$/i)
  if (match) {
    return {
      family: 'rar-old', format: 'rar', groupKey: `rar-old:${match[1].toLowerCase()}`,
      mainName: `${match[1]}.rar`, name, order: Number(match[2]) + 1, explicitPart: true
    }
  }
  match = name.match(/^(.*)\.rar$/i)
  if (match) {
    return {
      family: 'rar-old', format: 'rar', groupKey: `rar-old:${match[1].toLowerCase()}`,
      mainName: name, name, order: 0, explicitPart: false
    }
  }
  return null
}

function expectedOrders (family, parts) {
  const finite = parts.map(part => part.descriptor.order).filter(Number.isFinite)
  if (!finite.length) return []
  if (family === 'zip-split') {
    const numbered = finite.filter(order => order !== Number.MAX_SAFE_INTEGER)
    const max = numbered.length ? Math.max(...numbered) : 0
    return Array.from({ length: max }, (_, index) => index + 1)
  }
  const start = family === 'rar-old' ? 0 : 1
  const max = Math.max(...finite)
  return Array.from({ length: Math.max(0, max - start + 1) }, (_, index) => start + index)
}

function collectArchiveVolumeSet (files, selectedFile) {
  const selected = archiveVolumeDescriptor(selectedFile && selectedFile.name)
  if (!selected) return null
  const candidates = (files || []).map(file => ({ file, descriptor: archiveVolumeDescriptor(file && file.name) }))
    .filter(item => item.descriptor && item.descriptor.groupKey === selected.groupKey && item.descriptor.family === selected.family)
  if (!candidates.some(item => item.descriptor.explicitPart)) return null

  const parts = candidates.sort((left, right) => left.descriptor.order - right.descriptor.order)
  const orders = new Set(parts.map(part => part.descriptor.order))
  const missingOrders = expectedOrders(selected.family, parts).filter(order => !orders.has(order))
  if (selected.family === 'zip-split' && !parts.some(part => !part.descriptor.explicitPart)) missingOrders.push('zip')
  if (selected.family === 'rar-old' && !parts.some(part => !part.descriptor.explicitPart)) missingOrders.push('rar')

  const missingNames = missingOrders.map(order => {
    if (order === 'zip') return selected.mainName
    if (order === 'rar') return selected.mainName
    if (selected.family === 'numeric-split') {
      const width = selected.name.match(/\.(\d+)$/)[1].length
      return `${selected.mainName.replace(/\.\d+$/, '')}.${String(order).padStart(width, '0')}`
    }
    if (selected.family === 'zip-split') return selected.mainName.replace(/\.zip$/i, `.z${String(order).padStart(2, '0')}`)
    if (selected.family === 'rar-part') return selected.mainName.replace(/\.part1\.rar$/i, `.part${order}.rar`)
    return selected.mainName.replace(/\.rar$/i, `.r${String(order - 1).padStart(2, '0')}`)
  })

  return {
    family: selected.family,
    format: selected.format,
    groupKey: selected.groupKey,
    mainName: selected.mainName,
    files: parts.map(part => ({ ...part.file, volumeName: part.descriptor.name, volumeOrder: part.descriptor.order })),
    missingNames,
    totalSize: parts.reduce((sum, part) => sum + Number(part.file && part.file.size || 0), 0)
  }
}

function isArchiveVolumeName (value) {
  const descriptor = archiveVolumeDescriptor(value)
  return Boolean(descriptor && descriptor.explicitPart)
}

module.exports = { archiveVolumeDescriptor, collectArchiveVolumeSet, isArchiveVolumeName }
