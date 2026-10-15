'use strict'

const { readStepRecords, stepReferences } = require('./step-records')

// 用户可见的抬头、摘要、元数据标签经宿主皮肤 skin/copy.js 的 message() 决定措辞；这里只给默认文案。
const skinCopy = require('../../skin/copy')
const { extensionOf, formatBytes } = require('./design-file')
const { mimeTypeOf } = require('../../shared/file-types')
const { decodeBig5, decodeCp949, decodeGb18030, decodeShiftJis, decodeUtf8: decodeUtf8Strict } = require('./text-decoder')
const { readRarHeaders } = require('./rar-headers')
const { rtfToText, rtfToHtml } = require('./rtf-reader')
const { decodeDxfText, decodeDxfValue } = require('./dxf-text')
const { parseMText, renderMText } = require('./dxf-mtext')
const { inflateZlibBounded, inflateRawZipBounded } = require('./bounded-zlib')
const encodeJpeg = require('./vendor/jpeg-encoder')
const { cp437High: CP437_HIGH } = require('./vendor/legacy-cjk-data')
const { annotateArchiveMembers, crc32, safeArchivePath, visibleArchiveName } = require('./archive-members')

const ZIP_LEGACY_ENCODINGS = [
  { value: 'auto', label: skinCopy.message('inspector.module.label.4afad8', {}, '自动') },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'cp437', label: 'CP437' },
  { value: 'gb18030', label: 'GBK' },
  { value: 'shift_jis', label: skinCopy.message('inspector.module.label.365a6f', {}, '日文 Shift_JIS') },
  { value: 'cp949', label: skinCopy.message('inspector.module.label.9eb808', {}, '韩文 CP949 / EUC-KR') },
  { value: 'big5', label: skinCopy.message('inspector.module.label.848ff3', {}, '繁体 Big5') }
]

const DWG_VERSIONS = {
  AC1009: 'AutoCAD R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000/2002',
  AC1018: 'AutoCAD 2004/2005/2006',
  AC1021: 'AutoCAD 2007/2008/2009',
  AC1024: 'AutoCAD 2010/2011/2012',
  AC1027: 'AutoCAD 2013–2017',
  AC1032: 'AutoCAD 2018–2026'
}

function toUint8 (input) {
  if (!input) return new Uint8Array(0)
  if (input instanceof Uint8Array) return input
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input)
  if (input.buffer && Number.isFinite(input.byteLength)) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength)
  throw new TypeError('需要 ArrayBuffer 或 Uint8Array')
}

function ascii (bytes, start = 0, length = bytes.length - start) {
  let output = ''
  const end = Math.min(bytes.length, start + length)
  for (let index = start; index < end; index++) output += String.fromCharCode(bytes[index])
  return output
}

function decodeUtf8 (input) {
  const bytes = toUint8(input)
  let output = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]
    if (first < 0x80) { output += String.fromCharCode(first); continue }
    let code = 0xfffd
    if ((first & 0xe0) === 0xc0 && index < bytes.length) {
      code = ((first & 0x1f) << 6) | (bytes[index++] & 0x3f)
    } else if ((first & 0xf0) === 0xe0 && index + 1 < bytes.length) {
      code = ((first & 0x0f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f)
    } else if ((first & 0xf8) === 0xf0 && index + 2 < bytes.length) {
      code = ((first & 0x07) << 18) | ((bytes[index++] & 0x3f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f)
    }
    if (code > 0xffff) {
      code -= 0x10000
      output += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
    } else output += String.fromCharCode(code)
  }
  return output
}

function readUint16LE (bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32LE (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function readBigUint64LE (bytes, offset) {
  const low = readUint32LE(bytes, offset)
  const high = readUint32LE(bytes, offset + 4)
  return high * 0x100000000 + low
}

function hexHead (bytes, length = 16) {
  return Array.from(bytes.slice(0, length)).map(value => value.toString(16).padStart(2, '0')).join(' ').toUpperCase()
}

function fnv1a32 (bytes) {
  let hash = 0x811c9dc5
  for (const value of bytes) {
    hash ^= value
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function findSequence (bytes, needle, start = 0) {
  outer: for (let index = start; index <= bytes.length - needle.length; index++) {
    for (let offset = 0; offset < needle.length; offset++) if (bytes[index + offset] !== needle[offset]) continue outer
    return index
  }
  return -1
}

function extractEmbeddedPreview (input) {
  const bytes = toUint8(input)
  const pngStart = findSequence(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (pngStart >= 0) {
    const pngEnd = findSequence(bytes, [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], pngStart + 8)
    if (pngEnd > pngStart && pngEnd + 8 - pngStart <= 10 * 1024 * 1024) return { extension: 'png', bytes: bytes.slice(pngStart, pngEnd + 8) }
  }
  const jpegStart = findSequence(bytes, [0xff, 0xd8, 0xff])
  if (jpegStart >= 0) {
    let jpegEnd = -1
    for (let index = jpegStart + 3; index + 1 < bytes.length; index++) if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) jpegEnd = index + 2
    if (jpegEnd > jpegStart && jpegEnd - jpegStart <= 10 * 1024 * 1024) return { extension: 'jpg', bytes: bytes.slice(jpegStart, jpegEnd) }
  }
  return null
}


function findZipEocd (bytes) {
  const lower = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= lower; offset--) {
    if (readUint32LE(bytes, offset) === 0x06054b50) return offset
  }
  return -1
}

function readZipDirectoryDescriptor (input, absoluteStart = 0) {
  const bytes = toUint8(input)
  const eocd = findZipEocd(bytes)
  if (eocd < 0) throw new Error('没有找到 ZIP 中央目录，文件可能不完整')
  if (readUint16LE(bytes, eocd + 4) || readUint16LE(bytes, eocd + 6)) throw new Error('暂不支持分卷 ZIP')
  const count = readUint16LE(bytes, eocd + 10)
  const centralSize = readUint32LE(bytes, eocd + 12)
  const offset = readUint32LE(bytes, eocd + 16)
  if (count !== 0xffff && centralSize !== 0xffffffff && offset !== 0xffffffff) return { count, centralSize, offset, zip64: false }
  const locator = eocd - 20
  if (locator < 0 || readUint32LE(bytes, locator) !== 0x07064b50) throw new Error('ZIP64 定位器缺失，文件可能不完整')
  return {
    zip64: true,
    zip64RecordOffset: readSafeUint64LE(bytes, locator + 8, 'ZIP64 目录记录位置'),
    eocdOffset: absoluteStart + eocd
  }
}

function readZip64DirectoryDescriptor (input) {
  const bytes = toUint8(input)
  if (bytes.length < 56 || readUint32LE(bytes, 0) !== 0x06064b50) throw new Error('ZIP64 目录记录缺失')
  if (readUint32LE(bytes, 16) || readUint32LE(bytes, 20)) throw new Error('暂不支持分卷 ZIP64')
  return {
    count: readSafeUint64LE(bytes, 32, 'ZIP64 目录项数量'),
    centralSize: readSafeUint64LE(bytes, 40, 'ZIP64 中央目录大小'),
    offset: readSafeUint64LE(bytes, 48, 'ZIP64 中央目录位置'),
    zip64: true
  }
}

function readSafeUint64LE (bytes, offset, label = 'ZIP64 数值') {
  if (offset < 0 || offset + 8 > bytes.length) throw new Error(`${label}不完整`)
  const value = readBigUint64LE(bytes, offset)
  if (!Number.isSafeInteger(value)) throw new Error(`${label}超过小程序可安全处理的范围`)
  return value
}

function extraFields (bytes) {
  const fields = Object.create(null)
  let offset = 0
  for (; offset + 4 <= bytes.length;) {
    const id = readUint16LE(bytes, offset)
    const length = readUint16LE(bytes, offset + 2)
    offset += 4
    if (offset + length > bytes.length) return { $: 1 }
    fields[id] = id in fields ? null : bytes.slice(offset, offset + length)
    offset += length
  }
  if (offset !== bytes.length) fields.$ = 1
  return fields
}

function decodeCp437 (bytes) {
  let value = ''
  for (const byte of bytes) value += byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] || '�')
  return value
}

function validZipUnicodePath (nameBytes, extraBytes) {
  const fields = extraFields(extraBytes)
  const unicodePath = fields.$ ? null : fields[0x7075]
  if (!unicodePath || unicodePath.length <= 5 || unicodePath[0] !== 1) return null
  if (readUint32LE(unicodePath, 1) !== crc32(nameBytes)) return null
  const decoded = decodeUtf8Strict(unicodePath.slice(5))
  return !decoded.errors && decoded.text ? decoded.text : null
}

function decodeZipName (nameBytes, extraBytes, flags, options = {}) {
  const utf8 = decodeUtf8Strict(nameBytes)
  // General purpose bit 11 makes the primary name authoritative UTF-8. A
  // stale 0x7075 field must not overwrite it after another ZIP tool renames
  // the entry without refreshing the extra field.
  if (flags & 0x0800) {
    if (utf8.errors) {
      const error = new Error('ZIP 文件名声明为 UTF-8，但字节编码无效，无法可靠显示目录')
      error.code = 'ZIP_INVALID_UTF8_NAME'
      throw error
    }
    return utf8.text
  }

  const unicodePath = validZipUnicodePath(nameBytes, extraBytes)
  if (unicodePath) return unicodePath
  const legacyEncoding = options.legacyEncoding
  // UTF-8 validity alone does not identify an unflagged name's encoding.
  // Explicit choices must take effect even when the same bytes are valid UTF-8.
  if (legacyEncoding === 'cp437') return decodeCp437(nameBytes)
  if (legacyEncoding === 'utf-8') {
    if (utf8.errors) throw new Error('该 ZIP 包含非 UTF-8 文件名，请选择自动或原始编码')
    return utf8.text
  }
  if (legacyEncoding === 'gb18030') return decodeGb18030(nameBytes).text
  if (legacyEncoding === 'shift_jis') return decodeShiftJis(nameBytes).text
  if (legacyEncoding === 'cp949') return decodeCp949(nameBytes).text
  if (legacyEncoding === 'big5') return decodeBig5(nameBytes).text
  if (!utf8.errors) return utf8.text
  return decodeCp437(nameBytes)
}

function zipNameNeedsLegacyEncodingChoice (nameBytes, extraBytes, flags) {
  if (flags & 0x0800) return false
  if (validZipUnicodePath(nameBytes, extraBytes)) return false
  return nameBytes.some(byte => byte >= 0x80)
}

function isZipMetadataPath (name) {
  const normalized = String(name || '').replace(/\\/g, '/')
  const basename = normalized.split('/').pop() || ''
  return normalized.startsWith('__MACOSX/') || basename === '.DS_Store' || basename.startsWith('._')
}

function buildArchiveTree (entries) {
  const folders = Object.create(null)
  const files = []
  const pathOf = entry => (entry && entry.pathSeparator === 'slash' ? String(entry.name || '') : String(entry.name || '').replace(/\\/g, '/')).replace(/\/+/g, '/').replace(/\/$/, '')
  for (const source of annotateArchiveMembers(entries || [], pathOf)) {
    const safe = safeArchivePath(source.name)
    const canonical = pathOf(source)
    if (!canonical) continue
    const parts = safe ? canonical.split('/').filter(Boolean) : [canonical]
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const path = parts.slice(0, depth + 1).join('/')
      if (!folders[path]) folders[path] = { id: `folder:${path}`, name: `${path}/`, pathSeparator: source.pathSeparator, detail: '文件夹', isDirectory: true, canOpen: false }
    }
    if (source.isDirectory) folders[canonical] = { ...source, name: `${canonical}/` }
    else files.push({ ...source, canOpen: source.canOpen && safe, detail: (source.detail || '') + (safe ? '' : ' · 路径不安全') })
  }
  return [...Object.values(folders), ...files].sort((first, second) => {
    const a = pathOf(first).split('/'); const b = pathOf(second).split('/')
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const lowerA = a[index].toLowerCase(); const lowerB = b[index].toLowerCase()
      if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1
      // Case-distinct directories are separate groups. Compare each segment
      // before its descendants so their children cannot interleave.
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
      const dirA = index < a.length - 1 || first.isDirectory
      const dirB = index < b.length - 1 || second.isDirectory
      // A file can share a directory's name; place it before that subtree.
      if (Boolean(dirA) !== Boolean(dirB)) return dirA ? 1 : -1
    }
    return a.length - b.length
  }).map(entry => {
    const parts = pathOf(entry).split('/')
    const unsafe = !entry.isDirectory && !safeArchivePath(entry.name)
    return {
      ...entry,
      displayName: `${visibleArchiveName(unsafe ? pathOf(entry) : parts[parts.length - 1])}${entry.isDirectory ? '/' : ''}${entry.duplicateCount > 1 ? `（同名 ${entry.duplicateIndex + 1}/${entry.duplicateCount}）` : ''}`,
      depth: unsafe ? 0 : Math.max(0, parts.length - 1),
      indentRpx: unsafe ? 0 : Math.min(180, Math.max(0, parts.length - 1) * 28)
    }
  })
}

function zip64EntryValues (fields, values) {
  const field = fields[0x0001]
  if (!field) {
    if (field === null || Object.values(values).includes(0xffffffff)) throw new Error('ZIP64 扩展字段无效')
    return values
  }
  let cursor = 0
  const read = label => {
    const value = readSafeUint64LE(field, cursor, label)
    cursor += 8
    return value
  }
  return {
    size: values.size === 0xffffffff ? read('ZIP64 文件大小') : values.size,
    compressed: values.compressed === 0xffffffff ? read('ZIP64 压缩大小') : values.compressed,
    localHeaderOffset: values.localHeaderOffset === 0xffffffff ? read('ZIP64 本地头位置') : values.localHeaderOffset
  }
}

function inspectZipCentral (input, descriptor, options = {}) {
  const bytes = toUint8(input)
  const count = Number(descriptor.count || 0)
  const centralSize = Number(descriptor.centralSize || bytes.length)
  const entries = []
  const identityEntries = []
  let totalSize = 0
  let packedSize = 0
  let ignored = 0
  let ambiguousNames = 0
  let cursor = 0
  for (let index = 0; index < count && cursor + 46 <= bytes.length; index++) {
    if (readUint32LE(bytes, cursor) !== 0x02014b50) throw new Error(`ZIP 中央目录第 ${index + 1} 项损坏`)
    const flags = readUint16LE(bytes, cursor + 8)
    const method = readUint16LE(bytes, cursor + 10)
    const madeByHost = readUint16LE(bytes, cursor + 4) >>> 8
    const unixMode = readUint32LE(bytes, cursor + 38) >>> 16
    const crc = readUint32LE(bytes, cursor + 16)
    const nameLength = readUint16LE(bytes, cursor + 28)
    const extraLength = readUint16LE(bytes, cursor + 30)
    const commentLength = readUint16LE(bytes, cursor + 32)
    const nameStart = cursor + 46
    const extraStart = nameStart + nameLength
    const recordEnd = extraStart + extraLength + commentLength
    if (recordEnd > bytes.length) throw new Error(`ZIP 中央目录第 ${index + 1} 项不完整`)
    const nameBytes = bytes.slice(nameStart, nameStart + nameLength)
    const extraBytes = bytes.slice(extraStart, extraStart + extraLength)
    const values = zip64EntryValues(extraFields(extraBytes), {
      compressed: readUint32LE(bytes, cursor + 20),
      size: readUint32LE(bytes, cursor + 24),
      localHeaderOffset: readUint32LE(bytes, cursor + 42)
    })
    if (zipNameNeedsLegacyEncodingChoice(nameBytes, extraBytes, flags)) ambiguousNames++
    const name = decodeZipName(nameBytes, extraBytes, flags, options).replace(/\\/g, '/')
    const linked = madeByHost === 3 && (unixMode & 0xf000) === 0xa000
    const directory = !linked && name.endsWith('/')
    const encrypted = Boolean(flags & 1)
    totalSize += values.size
    packedSize += values.compressed
    const hidden = isZipMetadataPath(name)
    const entry = {
      id: index,
      archiveType: 'zip',
      name,
      detail: linked ? '符号链接 · 点开后在包内解析目标' : `${directory ? '文件夹' : formatBytes(values.size)} · ${method === 0 ? '未压缩' : method === 8 ? 'Deflate' : `方法 ${method}`}${encrypted ? ' · 已加密' : ''}`,
      isDirectory: directory,
      isLink: linked,
      canOpen: (linked || !directory) && !encrypted && (method === 0 || method === 8) && safeArchivePath(name),
      flags,
      method,
      crc,
      compressedSize: values.compressed,
      uncompressedSize: values.size,
      localHeaderOffset: values.localHeaderOffset,
      // Private raw-name and central-order identity.
      zipRawName: ascii(nameBytes),
      zipCentralOffset: descriptor.offset,
      zipCentralIndex: index,
      zipHidden: hidden
    }
    identityEntries.push(entry)
    if (hidden) ignored++
    else entries.push(entry)
    cursor = recordEnd
  }
  if (entries.length + ignored !== count) throw new Error(`ZIP 中央目录不完整：声明 ${count} 项，实际读取 ${entries.length + ignored} 项`)
  const treeEntries = buildArchiveTree(entries)
  const legacyEncoding = ZIP_LEGACY_ENCODINGS.some(item => item.value === options.legacyEncoding) ? options.legacyEncoding : 'auto'
  const encodingLabel = (ZIP_LEGACY_ENCODINGS.find(item => item.value === legacyEncoding) || ZIP_LEGACY_ENCODINGS[0]).label
  const encodingDescription = legacyEncoding === 'auto' ? '自动（UTF-8 / CP437）' : legacyEncoding === 'cp437' ? 'ZIP 标准 CP437' : encodingLabel
  return {
    archiveType: 'zip',
    title: skinCopy.message('inspector.inspectZipCentral.title.73e445', {}, 'ZIP 压缩包'),
    summary: skinCopy.message('inspector.inspectZipCentral.summary.bfb257', { value: descriptor.recovered ? '已核对全部内容并恢复遗漏数据描述符的目录位置；原文件未修改。' : '', count: entries.length, value2: ignored ? `，已隐藏 ${ignored} 个 macOS 系统项` : '', value3: ambiguousNames ? `。有 ${ambiguousNames} 个文件名没有编码标记，当前：${encodingDescription}，显示不正确时可在下方选择原始编码；已有 Unicode 标记的名称不受影响` : '' }, `${descriptor.recovered ? '已核对全部内容并恢复遗漏数据描述符的目录位置；原文件未修改。' : ''}已读取 ${entries.length} 个有效目录项并整理为目录树；支持的文件可直接点开${ignored ? `，已隐藏 ${ignored} 个 macOS 系统项` : ''}${ambiguousNames ? `。有 ${ambiguousNames} 个文件名没有编码标记，当前：${encodingDescription}，显示不正确时可在下方选择原始编码；已有 Unicode 标记的名称不受影响` : ''}。`),
    filenameEncoding: ambiguousNames ? legacyEncoding : '',
    filenameEncodingLabel: ambiguousNames ? encodingDescription : '',
    filenameEncodingOptions: ambiguousNames ? ZIP_LEGACY_ENCODINGS.map(item => ({ ...item, active: item.value === legacyEncoding })) : [],
    ambiguousFilenameCount: ambiguousNames,
    metadata: [
      { label: skinCopy.message('inspector.inspectZipCentral.label.25cf77', {}, '目录项'), value: String(entries.length) },
      ...(ambiguousNames ? [{ label: skinCopy.message('inspector.inspectZipCentral.label.ae2b1f', {}, '文件名显示'), value: legacyEncoding === 'auto' ? encodingDescription : `${encodingDescription}（手动）` }] : []),
      { label: skinCopy.message('inspector.inspectZipCentral.label.0de92f', {}, '原始大小'), value: formatBytes(totalSize) },
      { label: skinCopy.message('inspector.inspectZipCentral.label.f9831d', {}, '压缩大小'), value: formatBytes(packedSize) },
      { label: skinCopy.message('inspector.inspectZipCentral.label.072da0', {}, '中央目录'), value: formatBytes(centralSize) }
    ],
    entries: treeEntries,
    // Private identity includes hidden rows for native-index verification.
    zipIdentityEntries: identityEntries
  }
}

// Recovery is deliberately narrower than a signature scan: the only permitted
// discrepancy is descriptor bytes inserted without updating the central flags
// and offsets. Every local record must match the next central record, and all
// content must pass bounded decompression and CRC before any directory is shown.
const MAX_ZIP_RECOVERY_BYTES = 8 * 1024 * 1024
const MAX_ZIP_RECOVERY_OUTPUT = 20 * 1024 * 1024

function recoverZipDirectory (input) {
  const bytes = toUint8(input)
  const fail = detail => { throw new Error(`ZIP 目录无法安全恢复：${detail}`) }
  if (bytes.length > MAX_ZIP_RECOVERY_BYTES) fail('超过 8 MB 恢复上限')
  const descriptor = readZipDirectoryDescriptor(bytes)
  if (descriptor.zip64 || !descriptor.count || descriptor.count > 500) fail('仅恢复至多 500 项的普通 ZIP')
  const eocd = findZipEocd(bytes)
  if (eocd + 22 + readUint16LE(bytes, eocd + 20) !== bytes.length || readUint16LE(bytes, eocd + 8) !== descriptor.count) fail('结束记录不一致')
  const centralStart = eocd - descriptor.centralSize
  if (centralStart <= 0 || descriptor.offset >= centralStart) fail('不是遗漏数据描述符造成的偏移')
  // Buffer.slice aliases input in Node; always own the repaired directory.
  const central = new Uint8Array(bytes.subarray(centralStart, eocd))
  const rows = []
  let cursor = 0, local = 0, omitted = 0, totalOutput = 0
  const write32 = (at, value) => { for (let n = 0; n < 4; n++) central[at + n] = value >>> (8 * n) & 255 }
  for (let index = 0; index < descriptor.count; index++) {
    if (cursor + 46 > central.length || readUint32LE(central, cursor) !== 0x02014b50) fail('中央目录记录不完整')
    const flags = readUint16LE(central, cursor + 8), method = readUint16LE(central, cursor + 10)
    const crc = readUint32LE(central, cursor + 16), compressedSize = readUint32LE(central, cursor + 20), uncompressedSize = readUint32LE(central, cursor + 24)
    const nameLength = readUint16LE(central, cursor + 28), extraLength = readUint16LE(central, cursor + 30)
    const recordEnd = cursor + 46 + nameLength + extraLength + readUint16LE(central, cursor + 32)
    if (!nameLength || recordEnd > central.length || readUint16LE(central, cursor + 34) !== 0) fail('目录名称、长度或分卷信息不一致')
    if ((flags & ~0x080e) || (method !== 0 && method !== 8)) fail('加密或压缩方法不在恢复范围')
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || extraFields(central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength))[1]) fail('ZIP64 不在恢复范围')
    totalOutput += uncompressedSize
    if (totalOutput > MAX_ZIP_RECOVERY_OUTPUT) fail('总正文超过 20 MB 恢复上限')
    if (readUint32LE(central, cursor + 42) !== local - omitted) fail('本地头偏移存在其他歧义')
    if (local + 30 > centralStart || readUint32LE(bytes, local) !== 0x04034b50) fail('顺序本地头不完整')
    const localFlags = readUint16LE(bytes, local + 6)
    if (localFlags !== flags && localFlags !== (flags | 8)) fail('本地头与目录标记不同')
    if (readUint16LE(bytes, local + 8) !== method || readUint16LE(bytes, local + 26) !== nameLength) fail('本地头方法或名称不同')
    const start = local + 30 + nameLength + readUint16LE(bytes, local + 28)
    const end = start + compressedSize
    if (end > centralStart) fail('正文范围不完整')
    for (let n = 0; n < nameLength; n++) if (central[cursor + 46 + n] !== bytes[local + 30 + n]) fail('本地头与目录名称不同')
    for (const [at, expected] of [[14, crc], [18, compressedSize], [22, uncompressedSize]]) {
      const value = readUint32LE(bytes, local + at)
      if (value !== expected && !((localFlags & 8) && value === 0)) fail('本地头与目录校验信息不同')
    }
    let descriptorLength = 0
    if (localFlags & 8) {
      const candidates = [0, 4].filter(prefix => end + prefix + 12 <= centralStart &&
        (!prefix || readUint32LE(bytes, end) === 0x08074b50) &&
        readUint32LE(bytes, end + prefix) === crc && readUint32LE(bytes, end + prefix + 4) === compressedSize &&
        readUint32LE(bytes, end + prefix + 8) === uncompressedSize)
      if (candidates.length !== 1) fail('数据描述符缺失、损坏或有歧义')
      descriptorLength = candidates[0] + 12
      if (!(flags & 8)) omitted += descriptorLength
    }
    rows.push({ start, end, entry: { flags: localFlags, method, crc, compressedSize, uncompressedSize } })
    write32(cursor + 42, local)
    central[cursor + 8] = localFlags & 255
    central[cursor + 9] = localFlags >>> 8
    local = end + descriptorLength
    cursor = recordEnd
  }
  if (cursor !== central.length || local !== centralStart || !omitted || descriptor.offset !== centralStart - omitted) fail('目录边界或累计偏移不一致')
  // Budget and structural checks for ALL rows precede any decompression.
  for (const row of rows) extractZipEntryPayload(bytes.subarray(row.start, row.end), row.entry, { maxSize: MAX_ZIP_RECOVERY_OUTPUT })
  return { central, descriptor: { ...descriptor, offset: centralStart, recovered: true } }
}

function inspectZip (input) {
  const bytes = toUint8(input)
  let descriptor = readZipDirectoryDescriptor(bytes, 0)
  if (descriptor.zip64) descriptor = readZip64DirectoryDescriptor(bytes.slice(descriptor.zip64RecordOffset, descriptor.zip64RecordOffset + 56))
  const end = descriptor.offset + descriptor.centralSize
  if (descriptor.offset < 0 || end > bytes.length) throw new Error('ZIP 中央目录范围无效')
  try {
    return inspectZipCentral(bytes.slice(descriptor.offset, end), descriptor)
  } catch (error) {
    if (descriptor.zip64 || error.code === 'ZIP_INVALID_UTF8_NAME') throw error
    const recovered = recoverZipDirectory(bytes)
    return inspectZipCentral(recovered.central, recovered.descriptor)
  }
}

function extractZipEntry (input, entry, options = {}) {
  const bytes = toUint8(input)
  if (!entry || entry.isDirectory) throw new Error('请选择压缩包中的文件')
  if (entry.flags & 1) throw new Error('该文件已加密，无法在小程序内解压')
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`暂不支持 ZIP 压缩方法 ${entry.method}`)
  const maxSize = Number(options.maxSize || 20 * 1024 * 1024)
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  const offset = entry.localHeaderOffset
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 30 > bytes.length || readUint32LE(bytes, offset) !== 0x04034b50) throw new Error('包内文件的本地头位置无效')
  const headerLength = zipLocalHeaderLength(bytes.subarray(offset, offset + 30), entry)
  const start = zipEntryDataOffset(bytes.subarray(offset, offset + headerLength), entry)
  const end = start + entry.compressedSize
  if (start < 0 || end > bytes.length) throw new Error('包内文件数据不完整')
  const packed = bytes.slice(start, end)
  return extractZipEntryPayload(packed, entry, options)
}

function zipLocalHeaderLength (input, entry) {
  const bytes = toUint8(input)
  if (bytes.length < 30 || readUint32LE(bytes, 0) !== 0x04034b50) throw new Error('包内文件的本地头位置无效')
  if (!entry || !Number.isSafeInteger(entry.localHeaderOffset) || entry.localHeaderOffset < 0) throw new Error('包内文件的本地头位置无效')
  if (typeof entry.zipRawName !== 'string' || entry.zipRawName.length > 0xffff) throw new Error('缺少 ZIP 目录原始文件名，请重新打开压缩包')
  if (readUint16LE(bytes, 26) !== entry.zipRawName.length) throw new Error('ZIP 本地头与目录文件名长度不一致')
  if (readUint16LE(bytes, 8) !== entry.method) throw new Error('ZIP 本地头与目录压缩方法不一致')
  if (readUint16LE(bytes, 6) !== entry.flags) throw new Error('ZIP 本地头与目录标记不一致')
  return 30 + readUint16LE(bytes, 26) + readUint16LE(bytes, 28)
}

function zipEntryDataOffset (input, entry) {
  const bytes = toUint8(input)
  const headerLength = zipLocalHeaderLength(bytes, entry)
  if (bytes.length < headerLength) throw new Error('ZIP 本地头的文件名或扩展字段不完整')
  for (let n = 0; n < entry.zipRawName.length; n++) {
    if (bytes[30 + n] !== entry.zipRawName.charCodeAt(n)) throw new Error('ZIP 本地头与目录文件名不一致')
  }
  // With bit3 the authoritative CRC/sizes are in the directory/descriptor;
  // local zero/ZIP64 placeholders are not content checksums or actual lengths.
  if (!(entry.flags & 8)) {
    if (readUint32LE(bytes, 14) !== entry.crc) throw new Error('ZIP 本地头与目录 CRC 不一致')
    const values = zip64EntryValues(extraFields(bytes.subarray(30 + entry.zipRawName.length, headerLength)), {
      compressed: readUint32LE(bytes, 18), size: readUint32LE(bytes, 22), localHeaderOffset: 0
    })
    if (values.compressed !== entry.compressedSize || values.size !== entry.uncompressedSize) throw new Error('ZIP 本地头与目录大小不一致')
  }
  const start = entry.localHeaderOffset + headerLength
  if (Number.isSafeInteger(entry.zipCentralOffset) && start + entry.compressedSize > entry.zipCentralOffset) throw new Error('ZIP 包内文件数据范围与中央目录重叠')
  return start
}

function extractZipEntryPayload (input, entry, options = {}) {
  const packed = toUint8(input)
  if (!entry || entry.isDirectory) throw new Error('请选择压缩包中的文件')
  if (entry.flags & 1) throw new Error('该文件已加密，无法在小程序内解压')
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`暂不支持 ZIP 压缩方法 ${entry.method}`)
  const maxSize = options.maxSize == null ? 20 * 1024 * 1024 : Number(options.maxSize)
  if (!Number.isSafeInteger(maxSize) || maxSize < 0) throw new Error('ZIP 解压上限无效')
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) throw new Error('ZIP 包内文件长度无效')
  if (!Number.isInteger(entry.crc) || entry.crc < 0 || entry.crc > 0xffffffff) throw new Error('ZIP 包内文件 CRC 校验值无效')
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  if (packed.length !== entry.compressedSize) throw new Error('包内文件压缩数据不完整')
  if (entry.method === 0 && packed.length !== entry.uncompressedSize) throw new Error('ZIP 未压缩文件大小不匹配')
  // Some writers omit file data entirely for zero-byte members (APPNOTE 4.3.8).
  const empty = packed.length === 0 && entry.uncompressedSize === 0
  const unpacked = entry.method === 0 || empty ? packed.slice() : inflateRawZipBounded(packed, entry.uncompressedSize, maxSize)
  if (unpacked.length !== entry.uncompressedSize) throw new Error(`解压大小不匹配：应为 ${entry.uncompressedSize} B，实际 ${unpacked.length} B`)
  if (crc32(unpacked) !== entry.crc) throw new Error('包内文件 CRC 校验失败，压缩包可能损坏')
  return unpacked
}

function inspectRarVersion (bytes, version) {
  const entries = []
  for (const block of readRarHeaders(bytes)) {
    const file = block.file
    if (!file) continue
    const name = decodeUtf8(bytes.subarray(file.nameStart, file.nameStart + file.nameSize)).split('\0')[0]
    const directory = file.directory || name.endsWith('/')
    const stored = file.method === (version === 4 ? 0x30 : 0)
    entries.push({
      id: entries.length,
      archiveType: version === 4 ? 'rar4' : 'rar5',
      name: name || `文件 ${entries.length + 1}`,
      detail: `${directory ? '文件夹' : formatBytes(file.unpacked)} · ${stored ? '未压缩' : 'RAR 压缩'}${file.encrypted ? ' · 已加密' : ''}${file.split ? ' · 分卷文件' : ''}${file.isLink ? ' · 链接需解压内核' : ''}`,
      isDirectory: directory,
      canOpen: !directory && !file.encrypted && !file.split && !file.isLink && !file.unknownSize && stored && block.dataSize === file.unpacked,
      flags: file.fileFlags,
      method: file.method,
      crc: file.crc,
      compressedSize: block.dataSize,
      uncompressedSize: file.unpacked,
      dataOffset: block.end
    })
  }
  return {
    archiveType: version === 4 ? 'rar4' : 'rar5',
    title: version === 4 ? skinCopy.message('inspector.inspectRar4.title.2f9e0a', {}, 'RAR 4.x 压缩包') : skinCopy.message('inspector.inspectRar5.title.beab98', {}, 'RAR 5.x 压缩包'),
    summary: entries.length ? `已校验并读取 ${entries.length} 个文件头；备用读取仅支持完整的未压缩普通文件。` : '已确认 RAR 文件结构；当前文件未暴露可读文件名，可能已加密。',
    metadata: [{ label: '目录项', value: String(entries.length) }, { label: '格式', value: version === 4 ? 'RAR 4.x' : 'RAR 5.x' }],
    entries
  }
}

function inspectRar (bytes) {
  if (ascii(bytes, 0, 7) === 'Rar!\x1a\x07\x00') return inspectRarVersion(bytes, 4)
  if (ascii(bytes, 0, 8) === 'Rar!\x1a\x07\x01\x00') return inspectRarVersion(bytes, 5)
  throw new Error('RAR 文件头不正确')
}

function inspect7z (bytes) {
  if (hexHead(bytes, 6) !== '37 7A BC AF 27 1C') throw new Error('7z 文件头不正确')
  const major = bytes[6]
  const minor = bytes[7]
  const nextHeaderOffset = bytes.length >= 20 ? readBigUint64LE(bytes, 12) : 0
  const nextHeaderSize = bytes.length >= 28 ? readBigUint64LE(bytes, 20) : 0
  return {
    title: skinCopy.message('inspector.inspect7z.title.2e8c5d', {}, '7z 压缩包'),
    summary: skinCopy.message('inspector.inspect7z.summary.895a41', {}, '已校验 7z 签名和起始头；7z 目录本身可能经过压缩或加密，因此不在小程序内展开文件内容。'),
    metadata: [
      { label: skinCopy.message('inspector.inspect7z.label.989d1a', {}, '版本'), value: `${major}.${minor}` },
      { label: skinCopy.message('inspector.inspect7z.label.d38d6d', {}, '目录偏移'), value: String(nextHeaderOffset) },
      { label: skinCopy.message('inspector.inspect7z.label.109778', {}, '目录大小'), value: formatBytes(nextHeaderSize) }
    ],
    entries: []
  }
}

function extractArchiveEntry (input, entry, options = {}) {
  if (entry && entry.archiveType === 'zip') return extractZipEntry(input, entry, options)
  if (!entry || !['rar4', 'rar5'].includes(entry.archiveType)) throw new Error('当前目录项没有可用的本机解压器')
  const bytes = toUint8(input)
  if (!entry.canOpen) throw new Error('该 RAR 文件使用了压缩或加密，当前版本只能打开未压缩内容')
  const maxSize = options.maxSize == null ? 20 * 1024 * 1024 : Number(options.maxSize)
  if (!Number.isSafeInteger(maxSize) || maxSize < 0) throw new Error('RAR 解压上限无效')
  if (![entry.uncompressedSize, entry.compressedSize].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('RAR 包内文件长度无效')
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  const start = Number(entry.dataOffset)
  const end = start + Number(entry.compressedSize)
  if (!Number.isSafeInteger(start) || start < 0 || end > bytes.length) throw new Error('RAR 包内文件数据不完整')
  const output = bytes.slice(start, end)
  if (output.length !== entry.uncompressedSize) throw new Error('RAR 包内文件大小不匹配')
  if (!(entry.archiveType === 'rar5' && entry.crc === null) && crc32(output) !== entry.crc) throw new Error('RAR 包内文件 CRC 校验失败，压缩包可能损坏')
  return output
}

function pairsFromDxf (text) {
  const lines = text.split(/\r\n|\r|\n/)
  const pairs = []
  let recordType = ''
  for (let index = 0; index < lines.length; index += 2) {
    if (index === lines.length - 1 && lines[index] === '') break
    if (index + 1 >= lines.length) throw new Error('DXF 组码与数值不完整')
    const rawCode = lines[index].trim()
    if (!/^[+-]?\d+$/.test(rawCode) || !Number.isSafeInteger(Number(rawCode))) throw new Error('DXF 组码无效')
    const code = String(Number(rawCode))
    const rawValue = lines[index + 1]
    const value = ['TEXT', 'MTEXT'].includes(recordType) && ['1', '3'].includes(code) ? rawValue : rawValue.trim()
    if (code === '0') recordType = decodeDxfValue(code, value)
    // MTEXT strings are chunks of one logical value. Do not decode half an
    // escape here, or decode a newly produced backslash recursively later.
    pairs.push([code, recordType === 'MTEXT' && (code === '1' || code === '3') ? value : decodeDxfValue(code, value)])
    if (code === '0' && recordType === 'EOF') break
  }
  return pairs
}

function dxfRecords (pairs) {
  const records = []
  let current = null
  for (const pair of pairs) {
    if (pair[0] === '0') {
      if (current) records.push(current)
      current = { type: pair[1], pairs: [] }
    } else if (current) current.pairs.push(pair)
  }
  if (current) records.push(current)
  return records
}

function dxfValues (record, code) {
  return (record && record.pairs || []).filter(pair => pair[0] === String(code)).map(pair => pair[1])
}

function dxfValue (record, code, fallback = '') {
  const values = dxfValues(record, code)
  return values.length ? values[0] : fallback
}

function dxfNumber (record, code, fallback = 0) {
  const value = Number(dxfValue(record, code, fallback))
  return Number.isFinite(value) ? value : fallback
}

function parseDxfDrawing (pairs) {
  const records = dxfRecords(pairs)
  const blocks = Object.create(null)
  const entities = []
  const hasSections = records.some(record => record.type === 'SECTION')
  let section = ''
  let block = null
  for (const record of records) {
    if (record.type === 'SECTION') { section = dxfValue(record, 2).toUpperCase(); continue }
    if (record.type === 'ENDSEC') { section = ''; continue }
    if (record.type === 'BLOCK') {
      const name = dxfValue(record, 2) || dxfValue(record, 3)
      block = { name, base: { x: dxfNumber(record, 10), y: dxfNumber(record, 20) }, entities: [] }
      if (name) blocks[name] = block
      continue
    }
    if (record.type === 'ENDBLK') { block = null; continue }
    if (block) { block.entities.push(record); continue }
    if ((!hasSections || section === 'ENTITIES') && !['EOF', 'SEQEND'].includes(record.type)) entities.push(record)
  }
  return { blocks, entities }
}

function affineMultiply (first, second) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5]
  ]
}

function affinePoint (matrix, point) {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }
}

function insertMatrix (record, block, column = 0, row = 0) {
  const angle = dxfNumber(record, 50) * Math.PI / 180
  const sx = dxfNumber(record, 41, 1) || 1
  const sy = dxfNumber(record, 42, 1) || 1
  const cos = Math.cos(angle); const sin = Math.sin(angle)
  // MINSERT spacing is measured between insert points in the rotated OCS.
  // Scale the block geometry/base point, then offset each unscaled grid cell.
  const localX = column * dxfNumber(record, 44) - sx * Number(block.base.x || 0)
  const localY = row * dxfNumber(record, 45) - sy * Number(block.base.y || 0)
  return affineMultiply(
    [1, 0, 0, 1, dxfNumber(record, 10), dxfNumber(record, 20)],
    affineMultiply([cos, sin, -sin, cos, 0, 0], [sx, 0, 0, sy, localX, localY])
  )
}

function pairedDxfPoints (pairs, xCode = '10', yCode = '20') {
  const points = []
  let current = null
  for (const [code, value] of pairs || []) {
    if (code === xCode) {
      current = { x: Number(value), y: 0 }
      points.push(current)
    } else if (code === yCode && current) current.y = Number(value)
  }
  return points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
}

function sampledEllipse (record, matrix, startAngle = 0, endAngle = Math.PI * 2) {
  const center = { x: dxfNumber(record, 10), y: dxfNumber(record, 20) }
  const majorVector = { x: dxfNumber(record, 11), y: dxfNumber(record, 21) }
  let major = Math.hypot(majorVector.x, majorVector.y)
  let rotation = Math.atan2(majorVector.y, majorVector.x)
  let minor = major * Math.max(0.001, Math.abs(dxfNumber(record, 40, 1)))
  if (record.type === 'CIRCLE' || record.type === 'ARC') {
    major = minor = Math.abs(dxfNumber(record, 40))
    rotation = 0
  }
  const span = Math.max(0.001, endAngle - startAngle)
  const segments = Math.max(8, Math.ceil(48 * Math.min(1, span / (Math.PI * 2))))
  const points = []
  for (let index = 0; index <= segments; index++) {
    const angle = startAngle + span * index / segments
    const x = center.x + major * Math.cos(angle) * Math.cos(rotation) - minor * Math.sin(angle) * Math.sin(rotation)
    const y = center.y + major * Math.cos(angle) * Math.sin(rotation) + minor * Math.sin(angle) * Math.cos(rotation)
    points.push(affinePoint(matrix, { x, y }))
  }
  return points
}

function normalizeDxfSweep (start, end, counterclockwise = true) {
  const full = Math.PI * 2
  if (counterclockwise) {
    while (end <= start) end += full
  } else {
    while (end >= start) end -= full
  }
  const span = end - start
  if (Math.abs(span) > full) end = start + Math.sign(span || 1) * full
  return [start, end]
}

function sampledDxfArc (center, majorVector, ratio, start, end, counterclockwise, matrix) {
  const sweep = normalizeDxfSweep(start, end, counterclockwise)
  const span = sweep[1] - sweep[0]
  const major = Math.hypot(majorVector.x, majorVector.y)
  if (!Number.isFinite(major) || major <= 0) return []
  const minor = major * Math.max(0.001, Math.abs(Number(ratio) || 1))
  const rotation = Math.atan2(majorVector.y, majorVector.x)
  const segments = Math.max(6, Math.min(96, Math.ceil(48 * Math.abs(span) / (Math.PI * 2))))
  const points = []
  for (let index = 0; index <= segments; index++) {
    const angle = sweep[0] + span * index / segments
    const point = {
      x: center.x + major * Math.cos(angle) * Math.cos(rotation) - minor * Math.sin(angle) * Math.sin(rotation),
      y: center.y + major * Math.cos(angle) * Math.sin(rotation) + minor * Math.sin(angle) * Math.cos(rotation)
    }
    points.push(affinePoint(matrix, point))
  }
  return points
}

function validDxfKnots (knots, controlCount, degree) {
  if (knots.length < controlCount + degree + 1) return false
  for (let index = 0; index < knots.length; index++) {
    if (!Number.isFinite(knots[index]) || (index && knots[index] < knots[index - 1])) return false
  }
  return knots[degree] < knots[controlCount]
}

function evaluateDxfSpline (controlPoints, degree, knots, weights, parameter) {
  const lastControl = controlPoints.length - 1
  let span = lastControl
  if (parameter < knots[lastControl + 1]) {
    let low = degree
    let high = lastControl + 1
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (parameter < knots[middle]) high = middle
      else low = middle
    }
    span = low
  }
  const values = []
  for (let index = 0; index <= degree; index++) {
    const source = span - degree + index
    const weight = Number(weights[source] == null ? 1 : weights[source])
    if (!controlPoints[source] || !Number.isFinite(weight) || weight <= 0) return null
    values.push({ x: controlPoints[source].x * weight, y: controlPoints[source].y * weight, w: weight })
  }
  for (let level = 1; level <= degree; level++) {
    for (let index = degree; index >= level; index--) {
      const knotIndex = span - degree + index
      const denominator = knots[knotIndex + degree - level + 1] - knots[knotIndex]
      const alpha = denominator ? (parameter - knots[knotIndex]) / denominator : 0
      values[index] = {
        x: (1 - alpha) * values[index - 1].x + alpha * values[index].x,
        y: (1 - alpha) * values[index - 1].y + alpha * values[index].y,
        w: (1 - alpha) * values[index - 1].w + alpha * values[index].w
      }
    }
  }
  const result = values[degree]
  if (!result || !Number.isFinite(result.w) || Math.abs(result.w) < 1e-12) return null
  return { x: result.x / result.w, y: result.y / result.w }
}

function sampledDxfSpline (controlPoints, degree, knots, weights, matrix, fitPoints = []) {
  const controls = (controlPoints || []).slice(0, 1000)
  const fits = (fitPoints || []).slice(0, 1000)
  const safeDegree = Math.max(1, Math.min(10, Math.floor(Number(degree) || 3)))
  if (controls.length <= safeDegree || !validDxfKnots(knots, controls.length, safeDegree)) {
    return fits.length >= 2 ? fits.map(point => affinePoint(matrix, point)) : []
  }
  const start = knots[safeDegree]
  const end = knots[controls.length]
  const sampleCount = Math.max(24, Math.min(160, controls.length * 8))
  const sampled = []
  for (let index = 0; index <= sampleCount; index++) {
    const parameter = index === sampleCount ? end : start + (end - start) * index / sampleCount
    const point = evaluateDxfSpline(controls, safeDegree, knots, weights, parameter)
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) sampled.push(affinePoint(matrix, point))
  }
  return sampled
}

function dxfPolylineVertices (pairs) {
  const vertices = []
  let current = null
  for (const [code, raw] of pairs || []) {
    const value = Number(raw)
    if (code === '10') {
      current = { x: value, y: 0, bulge: 0 }
      vertices.push(current)
    } else if (code === '20' && current) current.y = value
    else if (code === '42' && current) current.bulge = Number.isFinite(value) ? value : 0
  }
  return vertices.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
}

function sampledBulgeSegment (start, end, bulge, matrix) {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return [affinePoint(matrix, start), affinePoint(matrix, end)]
  const dx = end.x - start.x; const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (!Number.isFinite(chord) || chord < 1e-9) return [affinePoint(matrix, start)]
  const theta = 4 * Math.atan(bulge)
  const offset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center = { x: (start.x + end.x) / 2 - dy * offset / chord, y: (start.y + end.y) / 2 + dx * offset / chord }
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const segments = Math.max(4, Math.min(64, Math.ceil(32 * Math.abs(theta) / (Math.PI * 2))))
  const points = []
  for (let index = 0; index <= segments; index++) {
    const angle = startAngle + theta * index / segments
    points.push(affinePoint(matrix, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }))
  }
  return points
}

function sampledDxfPolyline (pairs, matrix, closed) {
  const vertices = dxfPolylineVertices(pairs)
  if (vertices.length < 2) return { points: [], bulges: 0 }
  const edgeCount = closed ? vertices.length : vertices.length - 1
  const points = []
  let bulges = 0
  for (let index = 0; index < edgeCount; index++) {
    const start = vertices[index]
    const end = vertices[(index + 1) % vertices.length]
    const sampled = sampledBulgeSegment(start, end, start.bulge, matrix)
    if (Math.abs(start.bulge) >= 1e-9) bulges++
    points.push(...sampled.slice(points.length ? 1 : 0))
  }
  return { points, bulges }
}

function appendDxfEdgePoints (target, source) {
  if (!source || !source.length) return
  if (!target.length) { target.push(...source); return }
  const last = target[target.length - 1]
  const first = source[0]
  const startsAtLast = Math.hypot(last.x - first.x, last.y - first.y) < 1e-7
  target.push(...source.slice(startsAtLast ? 1 : 0))
}

function hatchBoundaries (record, matrix) {
  const boundaries = []
  let curvedEdges = 0
  let bulgeSegments = 0
  const pairs = record.pairs || []
  const stopCodes = new Set(['75', '76', '77', '78', '98', '450'])
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index][0] !== '92') continue
    const flag = Number(pairs[index][1]) || 0
    let end = index + 1
    while (end < pairs.length && pairs[end][0] !== '92' && !stopCodes.has(pairs[end][0])) end++
    const boundaryPairs = pairs.slice(index + 1, end)
    if (flag & 2) {
      const sampled = sampledDxfPolyline(boundaryPairs, matrix, Boolean(Number((boundaryPairs.find(pair => pair[0] === '73') || [])[1])))
      const points = sampled.points
      bulgeSegments += sampled.bulges
      if (points.length >= 3) boundaries.push(points)
    } else {
      const points = []
      for (let cursor = 0; cursor < boundaryPairs.length; cursor++) {
        if (boundaryPairs[cursor][0] !== '72') continue
        const edgeType = Number(boundaryPairs[cursor][1])
        let edgeEnd = cursor + 1
        while (edgeEnd < boundaryPairs.length && boundaryPairs[edgeEnd][0] !== '72') edgeEnd++
        const edge = { type: 'HATCH_EDGE', pairs: boundaryPairs.slice(cursor + 1, edgeEnd) }
        let sampled = []
        if (edgeType === 1) {
          const start = { x: dxfNumber(edge, 10), y: dxfNumber(edge, 20) }
          const finish = { x: dxfNumber(edge, 11), y: dxfNumber(edge, 21) }
          sampled = [affinePoint(matrix, start), affinePoint(matrix, finish)]
        } else if (edgeType === 2) {
          curvedEdges++
          const center = { x: dxfNumber(edge, 10), y: dxfNumber(edge, 20) }
          const radius = Math.abs(dxfNumber(edge, 40))
          sampled = sampledDxfArc(center, { x: radius, y: 0 }, 1, dxfNumber(edge, 50) * Math.PI / 180, dxfNumber(edge, 51) * Math.PI / 180, Boolean(dxfNumber(edge, 73)), matrix)
        } else if (edgeType === 3) {
          curvedEdges++
          const center = { x: dxfNumber(edge, 10), y: dxfNumber(edge, 20) }
          const major = { x: dxfNumber(edge, 11), y: dxfNumber(edge, 21) }
          sampled = sampledDxfArc(center, major, dxfNumber(edge, 40, 1), dxfNumber(edge, 50) * Math.PI / 180, dxfNumber(edge, 51) * Math.PI / 180, Boolean(dxfNumber(edge, 73)), matrix)
        } else if (edgeType === 4) {
          curvedEdges++
          sampled = sampledDxfSpline(pairedDxfPoints(edge.pairs), dxfNumber(edge, 94, 3), dxfValues(edge, 40).map(Number), dxfValues(edge, 42).map(Number), matrix, pairedDxfPoints(edge.pairs, '11', '21'))
        }
        appendDxfEdgePoints(points, sampled)
        cursor = edgeEnd - 1
      }
      if (points.length >= 3) boundaries.push(points)
    }
    index = end - 1
  }
  return { boundaries, curvedEdges, bulgeSegments }
}

function dimensionPrimitives (record, matrix) {
  const first = { x: dxfNumber(record, 13, dxfNumber(record, 10)), y: dxfNumber(record, 23, dxfNumber(record, 20)) }
  const second = { x: dxfNumber(record, 14, dxfNumber(record, 11)), y: dxfNumber(record, 24, dxfNumber(record, 21)) }
  if (![first.x, first.y, second.x, second.y].every(Number.isFinite)) return []
  const a = affinePoint(matrix, first); const b = affinePoint(matrix, second)
  const midpoint = affinePoint(matrix, { x: dxfNumber(record, 11, (first.x + second.x) / 2), y: dxfNumber(record, 21, (first.y + second.y) / 2) })
  const override = dxfValue(record, 1)
  const measured = Math.hypot(b.x - a.x, b.y - a.y)
  const label = override && override !== '<>' ? override : String(Number(measured.toFixed(3)))
  return [
    { kind: 'path', points: [a, b], dimension: true },
    { kind: 'text', point: midpoint, label, dimension: true }
  ]
}

function flattenDxfEntities (drawing) {
  const primitives = []
  const stats = { blockInserts: 0, hatchBoundaries: 0, curvedHatchEdges: 0, dimensions: 0, splines: 0, bulgeSegments: 0, truncated: false }
  // SVG 通过 setData 进入视图层；限制预览图元数量，避免复杂 CAD 让数据包失控。
  const limit = 1200
  // Count both records and expanded cells: empty/unsupported nested blocks
  // can consume exponential work without ever reaching the primitive cap.
  let remainingWork = 24000
  const activeBlocks = new Set()
  const spendWork = () => {
    if (stats.truncated) return false
    if (remainingWork-- <= 0) { stats.truncated = true; return false }
    return true
  }
  const append = primitive => {
    if (primitives.length >= limit) { stats.truncated = true; return false }
    primitives.push(primitive)
    return true
  }
  const walk = (records, parent = [1, 0, 0, 1, 0, 0], depth = 0, sourceBlock = '') => {
    if (depth > 64) throw new Error('DXF 块嵌套超过 64 层，无法安全展开预览')
    if (stats.truncated) return
    for (const record of records) {
      if (!spendWork()) return
      if (record.type === 'INSERT') {
        const block = drawing.blocks[dxfValue(record, 2)]
        if (!block || !block.entities.length) continue
        if (activeBlocks.has(block)) throw new Error('DXF 块引用存在循环，无法展开预览')
        // Coincident array cells represent one insertion location, as in native
        // MINSERT expansion. Avoid repeated antialiased overdraw at zero spacing.
        const columns = dxfNumber(record, 44) === 0 ? 1 : Math.max(1, Math.floor(dxfNumber(record, 70, 1)))
        const rows = dxfNumber(record, 45) === 0 ? 1 : Math.max(1, Math.floor(dxfNumber(record, 71, 1)))
        activeBlocks.add(block)
        try {
          for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
            if (!spendWork()) return
            stats.blockInserts++
            walk(block.entities, affineMultiply(parent, insertMatrix(record, block, column, row)), depth + 1, block.name)
          }
        } finally { activeBlocks.delete(block) }
        continue
      }
      if (record.type === 'LINE') {
        append({ kind: 'path', points: [affinePoint(parent, { x: dxfNumber(record, 10), y: dxfNumber(record, 20) }), affinePoint(parent, { x: dxfNumber(record, 11), y: dxfNumber(record, 21) })], sourceBlock })
      } else if (record.type === 'LWPOLYLINE') {
        const closed = Boolean(dxfNumber(record, 70) & 1)
        const sampled = sampledDxfPolyline(record.pairs, parent, closed)
        stats.bulgeSegments += sampled.bulges
        if (sampled.points.length > 1) append({ kind: 'path', points: sampled.points, closed, bulge: sampled.bulges > 0, sourceBlock })
      } else if (record.type === 'CIRCLE') {
        append({ kind: 'path', points: sampledEllipse(record, parent), closed: true, sourceBlock })
      } else if (record.type === 'ARC') {
        let start = dxfNumber(record, 50) * Math.PI / 180; let end = dxfNumber(record, 51) * Math.PI / 180
        while (end <= start) end += Math.PI * 2
        append({ kind: 'path', points: sampledEllipse(record, parent, start, end), sourceBlock })
      } else if (record.type === 'ELLIPSE') {
        const start = dxfNumber(record, 41, 0)
        let end = dxfNumber(record, 42, Math.PI * 2)
        while (end <= start) end += Math.PI * 2
        const closed = Math.abs(end - start - Math.PI * 2) < 1e-6
        append({ kind: 'path', points: sampledEllipse(record, parent, start, end), closed, sourceBlock })
      } else if (record.type === 'SPLINE') {
        const points = sampledDxfSpline(pairedDxfPoints(record.pairs), dxfNumber(record, 71, 3), dxfValues(record, 40).map(Number), dxfValues(record, 41).map(Number), parent, pairedDxfPoints(record.pairs, '11', '21'))
        if (points.length > 1) {
          stats.splines++
          append({ kind: 'path', points, closed: Boolean(dxfNumber(record, 70) & 1), spline: true, sourceBlock })
        }
      } else if (record.type === 'TEXT' || record.type === 'MTEXT') {
        const rawLabel = dxfValues(record, 3).concat(dxfValues(record, 1)).join('') || ''
        const size = Math.max(1, dxfNumber(record, 40, 2.5))
        const mtext = record.type === 'MTEXT' ? parseMText(rawLabel, size) : null
        append({ kind: 'text', point: affinePoint(parent, { x: dxfNumber(record, 10), y: dxfNumber(record, 20) }), label: rawLabel, mtext, size, sourceBlock })
      } else if (record.type === 'HATCH') {
        const hatch = hatchBoundaries(record, parent)
        stats.hatchBoundaries += hatch.boundaries.length
        stats.curvedHatchEdges += hatch.curvedEdges
        stats.bulgeSegments += hatch.bulgeSegments
        for (const points of hatch.boundaries) append({ kind: 'path', points, closed: true, hatch: true, sourceBlock })
      } else if (record.type === 'DIMENSION') {
        const values = dimensionPrimitives(record, parent)
        if (values.length) stats.dimensions++
        for (const primitive of values) append({ ...primitive, sourceBlock })
      }
    }
  }
  walk(drawing.entities)
  return { primitives, stats }
}

function dxfPoint3 (record, xCode = 10, yCode = 20, zCode = 30) {
  return [dxfNumber(record, xCode), dxfNumber(record, yCode), dxfNumber(record, zCode)]
}

function createDxf3dModel (drawing) {
  const points = []
  const edges = []
  const faces = []
  const pointMap = new Map()
  const edgeSet = new Set()
  const limits = { points: 12000, edges: 24000, faces: 12000 }
  let has3d = false
  let truncated = false
  const addPoint = point => {
    if (!point || point.length < 3 || point.some(value => !Number.isFinite(value))) return -1
    const key = point.map(value => Number(value).toFixed(7)).join(',')
    if (pointMap.has(key)) return pointMap.get(key)
    if (points.length >= limits.points) { truncated = true; return -1 }
    const index = points.length
    points.push(point.map(Number))
    pointMap.set(key, index)
    return index
  }
  const addEdge = (first, second) => {
    if (first < 0 || second < 0 || first === second) return
    const key = first < second ? `${first}:${second}` : `${second}:${first}`
    if (edgeSet.has(key)) return
    if (edges.length >= limits.edges) { truncated = true; return }
    edgeSet.add(key)
    edges.push([first, second])
  }
  const addFace = indices => {
    const unique = Array.from(new Set(indices.filter(index => index >= 0)))
    if (unique.length < 3) return
    if (faces.length >= limits.faces) { truncated = true; return }
    for (let index = 1; index + 1 < unique.length; index++) {
      if (faces.length >= limits.faces) { truncated = true; break }
      faces.push([unique[0], unique[index], unique[index + 1]])
    }
  }
  const addPath = (source, closed = false) => {
    const indices = source.map(addPoint).filter(index => index >= 0)
    for (let index = 1; index < indices.length; index++) addEdge(indices[index - 1], indices[index])
    if (closed && indices.length > 2) addEdge(indices[indices.length - 1], indices[0])
    return indices
  }
  const records = drawing.entities || []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.type === 'LINE') {
      const start = dxfPoint3(record)
      const finish = dxfPoint3(record, 11, 21, 31)
      if (start[2] || finish[2]) has3d = true
      addPath([start, finish])
    } else if (record.type === '3DFACE' || record.type === 'SOLID' || record.type === 'TRACE') {
      const vertices = [0, 1, 2].map(vertex => dxfPoint3(record, 10 + vertex, 20 + vertex, 30 + vertex))
      const fourthDefined = dxfValues(record, 13).length || dxfValues(record, 23).length || dxfValues(record, 33).length
      vertices.push(fourthDefined ? dxfPoint3(record, 13, 23, 33) : vertices[2].slice())
      while (vertices.length > 3 && vertices[vertices.length - 1].every((value, axis) => Math.abs(value - vertices[vertices.length - 2][axis]) < 1e-9)) vertices.pop()
      const indices = vertices.map(addPoint).filter(pointIndex => pointIndex >= 0)
      const invisibleEdges = record.type === '3DFACE' ? dxfNumber(record, 70) : 0
      for (let edge = 0; edge < indices.length; edge++) {
        if (!(invisibleEdges & (1 << edge))) addEdge(indices[edge], indices[(edge + 1) % indices.length])
      }
      addFace(indices)
      has3d = true
    } else if (record.type === 'LWPOLYLINE') {
      const elevation = dxfNumber(record, 38)
      const vertices = dxfPolylineVertices(record.pairs).map(point => [point.x, point.y, elevation])
      if (elevation) has3d = true
      addPath(vertices, Boolean(dxfNumber(record, 70) & 1))
    } else if (record.type === 'POLYLINE') {
      const vertices = []
      let cursor = index + 1
      while (cursor < records.length && records[cursor].type === 'VERTEX') vertices.push(records[cursor++])
      index = cursor - 1
      const flags = dxfNumber(record, 70)
      if (flags & 64) {
        const coordinateRecords = vertices.filter(vertex => dxfNumber(vertex, 70) & 64)
        const coordinateIndices = coordinateRecords.map(vertex => addPoint(dxfPoint3(vertex)))
        const faceRecords = vertices.filter(vertex => (dxfNumber(vertex, 70) & 128) && !(dxfNumber(vertex, 70) & 64))
        for (const faceRecord of faceRecords) {
          const signed = [71, 72, 73, 74].map(code => Math.trunc(dxfNumber(faceRecord, code))).filter(Boolean)
          const face = signed.map(value => coordinateIndices[Math.abs(value) - 1]).filter(value => value != null && value >= 0)
          addFace(face)
          for (let edge = 0; edge < signed.length; edge++) {
            if (signed[edge] < 0) continue
            const first = coordinateIndices[Math.abs(signed[edge]) - 1]
            const second = coordinateIndices[Math.abs(signed[(edge + 1) % signed.length]) - 1]
            addEdge(first, second)
          }
        }
        has3d = true
      } else if (flags & 16) {
        const meshPoints = vertices.map(vertex => dxfPoint3(vertex))
        const meshIndices = meshPoints.map(addPoint)
        const rows = Math.max(0, Math.trunc(dxfNumber(record, 71)))
        const columns = Math.max(0, Math.trunc(dxfNumber(record, 72)))
        if (rows * columns && meshIndices.length >= rows * columns) {
          for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
            const current = row * columns + column
            const nextRow = row + 1 < rows ? row + 1 : (flags & 1) ? 0 : -1
            const nextColumn = column + 1 < columns ? column + 1 : (flags & 32) ? 0 : -1
            if (nextColumn >= 0) addEdge(meshIndices[current], meshIndices[row * columns + nextColumn])
            if (nextRow >= 0) addEdge(meshIndices[current], meshIndices[nextRow * columns + column])
            if (nextRow >= 0 && nextColumn >= 0) addFace([meshIndices[current], meshIndices[row * columns + nextColumn], meshIndices[nextRow * columns + nextColumn], meshIndices[nextRow * columns + column]])
          }
        }
        has3d = true
      } else {
        const path = vertices.map(vertex => dxfPoint3(vertex))
        if ((flags & 8) || path.some(point => point[2])) has3d = true
        addPath(path, Boolean(flags & 1))
      }
    }
  }
  if (!has3d || !points.length || (!edges.length && !faces.length)) return null
  return { kind: 'engineering-wireframe', points, edges, faces, truncated }
}

function inspectDxf (bytes) {
  const text = decodeDxfText(bytes)
  const pairs = pairsFromDxf(text)
  const entityCounts = Object.create(null)
  const known = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'INSERT', 'HATCH', 'DIMENSION', 'POINT', '3DFACE', 'SOLID', 'TRACE'])
  let acadVersion = ''
  let units = ''
  for (let index = 0; index < pairs.length; index++) {
    const [code, value] = pairs[index]
    if (code === '0' && known.has(value)) entityCounts[value] = (entityCounts[value] || 0) + 1
    if (value === '$ACADVER' && pairs[index + 1]) acadVersion = pairs[index + 1][1]
    if (value === '$INSUNITS' && pairs[index + 1]) units = pairs[index + 1][1]
  }
  const entries = Object.keys(entityCounts).sort().map(name => ({ name, detail: `${entityCounts[name]} 个实体` }))
  const drawing = parseDxfDrawing(pairs)
  const preview = createDxfPreview(drawing)
  const interactiveModel = createDxf3dModel(drawing)
  return {
    title: skinCopy.message('inspector.inspectDxf.title.d448ec', {}, 'DXF 工程图'),
    summary: skinCopy.message('inspector.inspectDxf.summary.1faf27', { detail: entries.reduce((sum, item) => sum + Number(item.detail.split(' ')[0]), 0), value: interactiveModel ? ' 已把三维线、3DFACE、3D 多段线、网格或多面网格还原为可旋转几何。' : '' }, `已读取图元结构，共识别 ${entries.reduce((sum, item) => sum + Number(item.detail.split(' ')[0]), 0)} 个常见实体。${interactiveModel ? ' 已把三维线、3DFACE、3D 多段线、网格或多面网格还原为可旋转几何。' : ''}`),
    metadata: [
      { label: skinCopy.message('inspector.inspectDxf.label.6b4c4a', {}, 'AutoCAD 版本'), value: acadVersion || '未声明' },
      { label: skinCopy.message('inspector.inspectDxf.label.c5a275', {}, '插入单位代码'), value: units || '未声明' },
      { label: skinCopy.message('inspector.inspectDxf.label.102b09', {}, '实体类型'), value: String(entries.length) },
      { label: skinCopy.message('inspector.inspectDxf.label.3a290e', {}, '块定义/展开引用'), value: `${Object.keys(drawing.blocks).length} / ${preview.stats.blockInserts}` },
      { label: skinCopy.message('inspector.inspectDxf.label.7cc4fa', {}, '填充边界/尺寸'), value: `${preview.stats.hatchBoundaries} / ${preview.stats.dimensions}` },
      { label: skinCopy.message('inspector.inspectDxf.label.8fa019', {}, '样条/多段线弧'), value: `${preview.stats.splines} / ${preview.stats.bulgeSegments}` },
      { label: skinCopy.message('inspector.inspectDxf.label.d4cc9d', {}, 'HATCH 曲线边'), value: String(preview.stats.curvedHatchEdges) },
      { label: skinCopy.message('inspector.inspectDxf.label.1dea48', {}, '预览图元'), value: `${preview.primitives}${preview.stats.truncated ? '（已截断）' : ''}` },
      ...(preview.mtext ? [{ label: skinCopy.message('inspector.inspectDxf.label.31f644', {}, '多行文字'), value: skinCopy.message('inspector.inspectDxf.value.bb684d', {}, '基础格式预览；原始字体、精确字距和自动换行尚未完整还原') }] : []),
      ...(preview.mtextWarnings.length ? [{ label: skinCopy.message('inspector.inspectDxf.label.eac9a9', {}, '文字提示'), value: skinCopy.message('inspector.inspectDxf.value.861ba0', {}, '部分格式指令未完整还原，请对照原图核查') }] : []),
      ...(interactiveModel ? [{ label: skinCopy.message('inspector.inspectDxf.label.93806a', {}, '三维点/边/面'), value: `${interactiveModel.points.length} / ${interactiveModel.edges.length} / ${interactiveModel.faces.length}${interactiveModel.truncated ? '（已截断）' : ''}` }] : [])
    ],
    entries,
    previewSvg: preview.svg,
    interactiveModel
  }
}

function createDxfPreview (drawing) {
  const flattened = flattenDxfEntities(drawing)
  const finite = flattened.primitives.flatMap(primitive => primitive.kind === 'text' ? [primitive.point] : primitive.points || []).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!finite.length) return { svg: '', primitives: 0, stats: flattened.stats, mtext: false, mtextWarnings: [] }
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  const include = point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('DXF 文字或坐标范围过大，无法生成预览')
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }
  for (const point of finite) include(point)
  // Freeze the existing display size before including label bounds. Feeding
  // the expanded viewport back into the minimum font size grows long labels
  // again and can never produce a viewport that contains them.
  const geometrySpan = Math.max(maxX - minX, maxY - minY)
  const referenceExtent = geometrySpan + Math.max(geometrySpan, 1) * 0.12
  if (!Number.isFinite(referenceExtent)) throw new Error('DXF 坐标范围过大，无法生成预览')
  const textSize = primitive => primitive.dimension ? Math.max(referenceExtent / 35, 1) : Math.max(Number(primitive.size || 2.5), referenceExtent / 120)
  for (const primitive of flattened.primitives) {
    if (primitive.kind !== 'text') continue
    const size = textSize(primitive)
    if (primitive.mtext) {
      primitive.mtextView = renderMText(primitive.mtext, size, primitive.point.x, -primitive.point.y)
      for (const b of primitive.mtextView.bounds) {
        include({ x: b.x, y: -b.y })
        include({ x: b.x + b.width, y: -b.y - b.height })
      }
      continue
    }
    let count = 0
    for (const _ of String(primitive.label || '')) count++
    // The preview does not load CAD fonts. Reserve conservative em bounds for
    // its ordinary Unicode fallback face; never shorten or scale the text.
    include({ x: primitive.point.x - size * 0.5, y: primitive.point.y - size * 0.5 })
    include({ x: primitive.point.x + Math.max(1, count) * size * 1.5, y: primitive.point.y + size * 1.5 })
  }
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.06
  minX -= pad; maxX += pad; minY -= pad; maxY += pad
  const extent = Math.max(maxX - minX, maxY - minY)
  const escapeXml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const number = value => Number(Number(value).toFixed(4))
  const body = flattened.primitives.map(primitive => {
    const blockAttribute = primitive.sourceBlock ? ` data-dxf-block="${escapeXml(primitive.sourceBlock)}"` : ''
    if (primitive.kind === 'text') {
      if (primitive.mtextView) return `<g data-dxf-mtext="true"${blockAttribute}>${primitive.mtextView.svg}</g>`
      const size = textSize(primitive)
      return `<text x="${number(primitive.point.x)}" y="${number(-primitive.point.y)}" font-size="${number(size)}" fill="#171715" stroke="none"${primitive.dimension ? ' data-dxf-dimension="text"' : ''}${blockAttribute}>${escapeXml(primitive.label)}</text>`
    }
    const path = (primitive.points || []).map((point, index) => `${index ? 'L' : 'M'} ${number(point.x)} ${number(-point.y)}`).join(' ')
    const close = primitive.closed ? ' Z' : ''
    const hatch = primitive.hatch ? ' data-dxf-hatch="boundary" fill="rgba(185,230,59,.28)"' : ' fill="none"'
    const dimension = primitive.dimension ? ' data-dxf-dimension="line" marker-start="url(#dxf-arrow)" marker-end="url(#dxf-arrow)"' : ''
    const spline = primitive.spline ? ' data-dxf-spline="curve"' : ''
    const bulge = primitive.bulge ? ' data-dxf-bulge="arc"' : ''
    return `<path d="${path}${close}"${hatch}${dimension}${spline}${bulge}${blockAttribute}/>`
  }).join('')
  if (!body) return { svg: '', primitives: 0, stats: flattened.stats, mtext: false, mtextWarnings: [] }
  const strokeWidth = Math.max(extent / 500, 0.05)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(minX)} ${number(-maxY)} ${number(Math.max(1, maxX - minX))} ${number(Math.max(1, maxY - minY))}"><defs><marker id="dxf-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ff5b43"/></marker></defs><rect x="${number(minX)}" y="${number(-maxY)}" width="${number(Math.max(1, maxX - minX))}" height="${number(Math.max(1, maxY - minY))}" fill="#fffdf8"/><g stroke="#171715" stroke-width="${number(strokeWidth)}" vector-effect="non-scaling-stroke">${body}</g></svg>`
  return { svg, primitives: flattened.primitives.length, stats: flattened.stats, mtext: flattened.primitives.some(p => p.mtext), mtextWarnings: [...new Set(flattened.primitives.flatMap(p => p.mtext ? p.mtext.warnings : []))] }
}

function inspectStep (bytes) {
  const parsed = readStepRecords(decodeUtf8(bytes))
  const schema = (parsed.header.FILE_SCHEMA || '').trim().replace(/^\((.*)\)$/, '$1')
  const nameArg = splitStepArguments(parsed.header.FILE_NAME || '')[0]
  const name = nameArg && /^'.*'$/.test(nameArg) ? nameArg.slice(1, -1).replace(/''/g, "'") : ''
  const counts = Object.create(null)
  for (const record of parsed.records) counts[record.type] = (counts[record.type] || 0) + 1
  for (const record of parsed.complexRecords) {
    for (const component of record.components) counts[component.type] = (counts[component.type] || 0) + 1
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([entryName, count]) => ({ name: entryName, detail: `${count} 个实体` }))
  const preview = createStepPreview(parsed)
  const hasBSplineSurface = Boolean(counts.B_SPLINE_SURFACE || counts.B_SPLINE_SURFACE_WITH_KNOTS)
  return {
    title: skinCopy.message('inspector.inspectStep.title.2065b0', {}, 'STEP 三维交换文件'),
    summary: skinCopy.message('inspector.inspectStep.summary.69f22a', { count: Object.values(counts).reduce((sum, count) => sum + count, 0) }, `已解析 STEP 头信息和 ${Object.values(counts).reduce((sum, count) => sum + count, 0)} 个实体记录。`),
    entries,
    previewSvg: preview.svg,
    interactiveModel: preview.model,
    metadata: [{ label: skinCopy.message('inspector.inspectStep.label.1275f6', {}, '文件名'), value: name || '未声明' }, { label: skinCopy.message('inspector.inspectStep.label.ed0eea', {}, '模式'), value: schema.replace(/'/g, '') || '未声明' }, { label: skinCopy.message('inspector.inspectStep.label.102b09', {}, '实体类型'), value: String(Object.keys(counts).length) }, { label: skinCopy.message('inspector.inspectStep.label.5efc13', {}, '线框点/边'), value: `${preview.points} / ${preview.edges}${preview.edgesTruncated ? '（已截断）' : ''}` }, { label: skinCopy.message('inspector.inspectStep.label.7c7d89', {}, '可见面片'), value: `${preview.faces}${preview.facesTruncated ? '（已截断）' : ''}` }, ...(preview.instances ? [{ label: skinCopy.message('inspector.inspectStep.label.c5823f', {}, '装配实例'), value: String(preview.instances) }] : []), ...(preview.relationshipInstances ? [{ label: skinCopy.message('inspector.inspectStep.label.052061', {}, '关系型装配'), value: String(preview.relationshipInstances) }] : []), ...(hasBSplineSurface ? [{ label: skinCopy.message('inspector.inspectStep.label.84a5b0', {}, '自由曲面'), value: '完整参数域近似网格（复杂裁切待完善）' }] : [])]
  }
}

function splitStepArguments (body) {
  const values = []
  let start = 0
  let depth = 0
  let inString = false
  for (let index = 0; index < body.length; index++) {
    const char = body[index]
    if (char === "'") {
      if (inString && body[index + 1] === "'") { index++; continue }
      inString = !inString
    } else if (!inString && char === '(') depth++
    else if (!inString && char === ')') depth--
    else if (!inString && !depth && char === ',') {
      values.push(body.slice(start, index).trim())
      start = index + 1
    }
  }
  values.push(body.slice(start).trim())
  return values
}

function stepReferenceGrid (value) {
  const source = String(value || '')
  const rows = []
  let depth = 0
  let rowStart = -1
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '(') {
      depth++
      if (depth === 2) rowStart = index + 1
    } else if (source[index] === ')') {
      if (depth === 2 && rowStart >= 0) rows.push(stepReferences(source.slice(rowStart, index)))
      depth--
      if (depth < 0) return []
    }
  }
  if (depth || rows.length < 2 || rows.some(row => row.length < 2 || row.length !== rows[0].length)) return []
  return rows
}

function stepNumberGrid (value) {
  const source = String(value || '')
  const rows = []
  let depth = 0
  let rowStart = -1
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '(') {
      depth++
      if (depth === 2) rowStart = index + 1
    } else if (source[index] === ')') {
      if (depth === 2 && rowStart >= 0) rows.push(source.slice(rowStart, index).split(',').map(value => Number(value.trim())))
      depth--
      if (depth < 0) return []
    }
  }
  if (depth || rows.length < 2 || rows.some(row => row.length < 2 || row.length !== rows[0].length || row.some(value => !Number.isFinite(value) || value <= 0))) return []
  return rows
}

function stepNumberList (value) {
  const source = String(value || '').trim().replace(/^\(/, '').replace(/\)$/, '')
  if (!source) return []
  return source.split(',').map(value => Number(value.trim()))
}

function expandStepKnots (multiplicities, knots, controlCount, degree) {
  if (multiplicities.length !== knots.length || !Number.isInteger(degree) || degree < 1 || degree > 8 || controlCount < degree + 1 || controlCount > 80) return null
  const expanded = []
  for (let index = 0; index < knots.length; index++) {
    const count = multiplicities[index]
    if (!Number.isInteger(count) || count < 1 || count > degree + 1 || !Number.isFinite(knots[index]) || (index && knots[index] < knots[index - 1])) return null
    for (let copy = 0; copy < count; copy++) expanded.push(knots[index])
  }
  if (expanded.length !== controlCount + degree + 1) return null
  // Affine knot normalization preserves the surface while avoiding translated
  // sampling cancellation, subnormal basis arithmetic and range overflow.
  const first = expanded[0]; const last = expanded[expanded.length - 1]
  if (!(last > first)) return null
  const span = last - first
  const magnitude = Math.max(Math.abs(first), Math.abs(last))
  const scaledFirst = first / magnitude
  const scaledSpan = last / magnitude - scaledFirst
  const values = Number.isFinite(span)
    ? expanded.map(value => (value - first) / span)
    : expanded.map(value => (value / magnitude - scaledFirst) / scaledSpan)
  // Do not silently erase distinct knots if their normalized separation cannot
  // be represented by the current numeric backend.
  if (values.some((value, index) => !Number.isFinite(value) || (index && expanded[index] > expanded[index - 1] && value <= values[index - 1]))) return null
  const start = values[degree]
  const end = values[controlCount]
  return end > start ? { values, start, end } : null
}

function stepBasisValues (degree, knots, count, parameter) {
  let basis = Array(count).fill(0)
  const domainEnd = knots[count]
  for (let index = 0; index < count; index++) {
    if ((parameter >= knots[index] && parameter < knots[index + 1]) || (parameter === domainEnd && index === count - 1)) basis[index] = 1
  }
  for (let order = 1; order <= degree; order++) {
    const next = Array(count).fill(0)
    for (let index = 0; index < count; index++) {
      const leftDenominator = knots[index + order] - knots[index]
      const rightDenominator = knots[index + order + 1] - knots[index + 1]
      const left = leftDenominator ? (parameter - knots[index]) * basis[index] / leftDenominator : 0
      const right = rightDenominator && index + 1 < count ? (knots[index + order + 1] - parameter) * basis[index + 1] / rightDenominator : 0
      next[index] = left + right
    }
    basis = next
  }
  return basis
}

function createStepBSplineMesh (surface, points, key) {
  const controlRows = surface.controlPoints
  const rowCount = controlRows.length
  const columnCount = rowCount ? controlRows[0].length : 0
  if (!rowCount || !columnCount || controlRows.some(row => row.length !== columnCount || row.some(id => !points[id]))) return null
  const rationalWeights = surface.weights
  if (rationalWeights && (rationalWeights.length !== rowCount || rationalWeights.some(row => row.length !== columnCount))) return null
  const uKnots = expandStepKnots(surface.uMultiplicities, surface.uKnots, rowCount, surface.uDegree)
  const vKnots = expandStepKnots(surface.vMultiplicities, surface.vKnots, columnCount, surface.vDegree)
  if (!uKnots || !vKnots) throw new Error('STEP 曲面节点参数无效或超出当前预览范围')
  const uSegments = Math.min(24, Math.max(8, rowCount * 4))
  const vSegments = Math.min(24, Math.max(8, columnCount * 4))
  const grid = []
  for (let uIndex = 0; uIndex <= uSegments; uIndex++) {
    const u = uIndex === uSegments ? uKnots.end : uKnots.start + (uKnots.end - uKnots.start) * uIndex / uSegments
    const uBasis = stepBasisValues(surface.uDegree, uKnots.values, rowCount, u)
    const row = []
    for (let vIndex = 0; vIndex <= vSegments; vIndex++) {
      const v = vIndex === vSegments ? vKnots.end : vKnots.start + (vKnots.end - vKnots.start) * vIndex / vSegments
      const vBasis = stepBasisValues(surface.vDegree, vKnots.values, columnCount, v)
      const point = [0, 0, 0]
      // Rational weights have no absolute scale. Normalize only active poles:
      // a global maximum can underflow all endpoint weights to zero.
      let activeWeightScale = 1
      if (rationalWeights) {
        activeWeightScale = 0
        for (let controlU = 0; controlU < rowCount; controlU++) {
          for (let controlV = 0; controlV < columnCount; controlV++) {
            if (uBasis[controlU] * vBasis[controlV] > 0) activeWeightScale = Math.max(activeWeightScale, rationalWeights[controlU][controlV])
          }
        }
        if (!(activeWeightScale > 0)) return null
      }
      let contribution = 0
      for (let controlU = 0; controlU < rowCount; controlU++) {
        for (let controlV = 0; controlV < columnCount; controlV++) {
          const basisWeight = uBasis[controlU] * vBasis[controlV]
          if (!basisWeight) continue
          const weight = basisWeight * (rationalWeights ? rationalWeights[controlU][controlV] / activeWeightScale : 1)
          const control = points[controlRows[controlU][controlV]]
          contribution += weight
          for (let axis = 0; axis < 3; axis++) point[axis] += control[axis] * weight
        }
      }
      if (!point.every(Number.isFinite) || !Number.isFinite(contribution) || contribution <= 0) return null
      if (rationalWeights) for (let axis = 0; axis < 3; axis++) point[axis] /= contribution
      else if (Math.abs(contribution - 1) > 1e-5) return null
      const id = `bspline-${key}-${uIndex}-${vIndex}`
      points[id] = point
      row.push(id)
    }
    grid.push(row)
  }
  const edges = []
  const faces = []
  for (let uIndex = 0; uIndex <= uSegments; uIndex++) {
    for (let vIndex = 0; vIndex <= vSegments; vIndex++) {
      if (uIndex < uSegments) edges.push([grid[uIndex][vIndex], grid[uIndex + 1][vIndex]])
      if (vIndex < vSegments) edges.push([grid[uIndex][vIndex], grid[uIndex][vIndex + 1]])
      if (uIndex < uSegments && vIndex < vSegments) {
        faces.push(
          [grid[uIndex][vIndex], grid[uIndex + 1][vIndex], grid[uIndex + 1][vIndex + 1]],
          [grid[uIndex][vIndex], grid[uIndex + 1][vIndex + 1], grid[uIndex][vIndex + 1]]
        )
      }
    }
  }
  return { edges, faces }
}

function triangulateStepPolygon (pointIds, points, pointIndex) {
  const clean = []
  for (const id of pointIds || []) {
    if (!points[id] || (clean.length && clean[clean.length - 1] === id)) continue
    clean.push(id)
  }
  if (clean.length > 2 && clean[0] === clean[clean.length - 1]) clean.pop()
  if (clean.length < 3 || clean.length > 500) return []
  const polygon = clean.map(id => points[id])
  const normal = [0, 0, 0]
  for (let index = 0; index < polygon.length; index++) {
    const first = polygon[index]
    const second = polygon[(index + 1) % polygon.length]
    normal[0] += (first[1] - second[1]) * (first[2] + second[2])
    normal[1] += (first[2] - second[2]) * (first[0] + second[0])
    normal[2] += (first[0] - second[0]) * (first[1] + second[1])
  }
  const normalLength = Math.hypot(...normal)
  if (!Number.isFinite(normalLength) || normalLength < 1e-10) return []
  const bounds = [0, 1, 2].map(axis => ({ min: Math.min(...polygon.map(point => point[axis])), max: Math.max(...polygon.map(point => point[axis])) }))
  const extent = Math.max(...bounds.map(bound => bound.max - bound.min), 1)
  const unit = normal.map(value => value / normalLength)
  const origin = polygon[0]
  if (polygon.some(point => Math.abs((point[0] - origin[0]) * unit[0] + (point[1] - origin[1]) * unit[1] + (point[2] - origin[2]) * unit[2]) > extent * 1e-5)) return []
  const dropAxis = Math.abs(unit[0]) > Math.abs(unit[1]) ? (Math.abs(unit[0]) > Math.abs(unit[2]) ? 0 : 2) : (Math.abs(unit[1]) > Math.abs(unit[2]) ? 1 : 2)
  const projected = polygon.map(point => dropAxis === 0 ? [point[1], point[2]] : dropAxis === 1 ? [point[0], point[2]] : [point[0], point[1]])
  let area = 0
  for (let index = 0; index < projected.length; index++) {
    const first = projected[index]
    const second = projected[(index + 1) % projected.length]
    area += first[0] * second[1] - second[0] * first[1]
  }
  if (Math.abs(area) < 1e-10) return []
  const orientation = Math.sign(area)
  const remaining = projected.map((_, index) => index)
  const triangles = []
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const inside = (point, a, b, c) => {
    const first = cross(a, b, point) * orientation
    const second = cross(b, c, point) * orientation
    const third = cross(c, a, point) * orientation
    return first >= -1e-10 && second >= -1e-10 && third >= -1e-10
  }
  let guard = 0
  while (remaining.length > 3 && guard++ < clean.length * clean.length) {
    let clipped = false
    for (let cursor = 0; cursor < remaining.length; cursor++) {
      const previous = remaining[(cursor + remaining.length - 1) % remaining.length]
      const current = remaining[cursor]
      const next = remaining[(cursor + 1) % remaining.length]
      if (cross(projected[previous], projected[current], projected[next]) * orientation <= 1e-10) continue
      if (remaining.some(candidate => candidate !== previous && candidate !== current && candidate !== next && inside(projected[candidate], projected[previous], projected[current], projected[next]))) continue
      triangles.push([pointIndex[clean[previous]], pointIndex[clean[current]], pointIndex[clean[next]]])
      remaining.splice(cursor, 1)
      clipped = true
      break
    }
    if (!clipped) return []
  }
  if (remaining.length === 3) triangles.push(remaining.map(index => pointIndex[clean[index]]))
  return triangles.filter(triangle => triangle.every(Number.isInteger))
}

function orderedStepEdgeLoop (edgeLoop, orientedEdges, edgeCurves, vertices) {
  const ordered = []
  for (const orientedId of edgeLoop || []) {
    const oriented = orientedEdges[orientedId]
    const edge = oriented && edgeCurves[oriented.edge]
    if (!edge) return []
    const pair = oriented.forward ? edge.slice() : edge.slice().reverse()
    if (!ordered.length) ordered.push(pair[0], pair[1])
    else if (ordered[ordered.length - 1] === pair[0]) ordered.push(pair[1])
    else if (ordered[ordered.length - 1] === pair[1]) ordered.push(pair[0])
    else return []
  }
  if (ordered.length > 2 && ordered[0] === ordered[ordered.length - 1]) ordered.pop()
  return ordered.map(vertex => vertices[vertex]).filter(Boolean)
}

function stepVectorLength (vector) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function normalizeStepVector (vector) {
  const length = stepVectorLength(vector)
  return length > 1e-12 ? vector.map(value => value / length) : null
}

function crossStepVectors (first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]
  ]
}

function createStepPlacementFrame (placement, points) {
  const origin = points[placement.origin]
  const axis = normalizeStepVector(placement.axis)
  if (!origin || !axis) return null
  let xAxis = normalizeStepVector(placement.reference || [1, 0, 0])
  if (!xAxis || Math.abs(xAxis[0] * axis[0] + xAxis[1] * axis[1] + xAxis[2] * axis[2]) > 0.999) {
    xAxis = normalizeStepVector(Math.abs(axis[2]) < 0.9 ? crossStepVectors([0, 0, 1], axis) : crossStepVectors([0, 1, 0], axis))
  } else {
    const projection = xAxis[0] * axis[0] + xAxis[1] * axis[1] + xAxis[2] * axis[2]
    xAxis = normalizeStepVector(xAxis.map((value, index) => value - projection * axis[index]))
  }
  if (!xAxis) return null
  const yAxis = normalizeStepVector(crossStepVectors(axis, xAxis))
  if (!yAxis) return null
  return { origin, axis, xAxis, yAxis }
}

function collectStepReferenceClosure (startId, recordReferences, limit = 30000) {
  const visited = new Set()
  const pending = [startId]
  while (pending.length && visited.size < limit) {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    visited.add(id)
    for (const reference of recordReferences[id] || []) if (!visited.has(reference)) pending.push(reference)
  }
  return visited
}

function createStepOperatorFrame (operator, points, directions) {
  const origin = points[operator.origin]
  if (!origin) return null
  const xAxis = normalizeStepVector(directions[operator.axis1] || [1, 0, 0])
  const suppliedY = normalizeStepVector(directions[operator.axis2] || [0, 1, 0])
  let zAxis = normalizeStepVector(directions[operator.axis3] || (xAxis && suppliedY ? crossStepVectors(xAxis, suppliedY) : [0, 0, 1]))
  if (!xAxis || !zAxis) return null
  const xProjection = xAxis[0] * zAxis[0] + xAxis[1] * zAxis[1] + xAxis[2] * zAxis[2]
  const orthogonalX = normalizeStepVector(xAxis.map((value, index) => value - xProjection * zAxis[index]))
  if (!orthogonalX) return null
  let yAxis = normalizeStepVector(crossStepVectors(zAxis, orthogonalX))
  if (!yAxis) return null
  if (suppliedY && suppliedY[0] * yAxis[0] + suppliedY[1] * yAxis[1] + suppliedY[2] * yAxis[2] < 0) {
    yAxis = yAxis.map(value => -value)
    zAxis = zAxis.map(value => -value)
  }
  const scale = operator.scale == null || operator.scale === '$' ? 1 : Number(operator.scale)
  if (!Number.isFinite(scale) || Math.abs(scale) < 1e-12 || Math.abs(scale) > 1e6) return null
  return { origin, xAxis: orthogonalX, yAxis, axis: zAxis, scale }
}

function transformStepMappedPoint (point, sourceFrame, targetFrame) {
  const source = sourceFrame || { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], axis: [0, 0, 1] }
  const delta = point.map((value, index) => value - source.origin[index])
  const local = [source.xAxis, source.yAxis, source.axis].map(axis => delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2])
  return [0, 1, 2].map(index => targetFrame.origin[index] + targetFrame.scale * (
    targetFrame.xAxis[index] * local[0] + targetFrame.yAxis[index] * local[1] + targetFrame.axis[index] * local[2]
  ))
}

function stepBoundaryHeights (boundaryPointIds, points, frame) {
  const { origin, axis } = frame
  return boundaryPointIds.map(id => points[id]).filter(Boolean).map(point => (
    (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1] + (point[2] - origin[2]) * axis[2]
  )).filter(Number.isFinite)
}

function createStepRevolvedBandMesh (frame, heights, radii, points, key, segments = 32) {
  const { origin, axis, xAxis, yAxis } = frame
  if (heights.length !== radii.length || heights.length < 2 || radii.some(radius => !Number.isFinite(radius) || radius < 0)) return null
  const pointIds = heights.map(() => [])
  for (let ring = 0; ring < heights.length; ring++) {
    for (let index = 0; index < segments; index++) {
      const angle = Math.PI * 2 * index / segments
      const id = `${key}-${ring}-${index}`
      points[id] = [0, 1, 2].map(axisIndex => origin[axisIndex] + axis[axisIndex] * heights[ring] + radii[ring] * (xAxis[axisIndex] * Math.cos(angle) + yAxis[axisIndex] * Math.sin(angle)))
      pointIds[ring].push(id)
    }
  }
  const edges = []
  const faces = []
  for (let ring = 0; ring < pointIds.length - 1; ring++) {
    for (let index = 0; index < segments; index++) {
      const next = (index + 1) % segments
      if (!ring || radii[ring] > 1e-10) edges.push([pointIds[ring][index], pointIds[ring][next]])
      if (ring === pointIds.length - 2 && radii[ring + 1] > 1e-10) edges.push([pointIds[ring + 1][index], pointIds[ring + 1][next]])
      faces.push([pointIds[ring][index], pointIds[ring][next], pointIds[ring + 1][next]], [pointIds[ring][index], pointIds[ring + 1][next], pointIds[ring + 1][index]])
    }
  }
  return { edges, faces }
}

function createStepCylinderMesh (surface, placement, boundaryPointIds, points, key, segments = 32) {
  if (!Number.isFinite(surface.radius) || surface.radius <= 0) return null
  const frame = createStepPlacementFrame(placement, points)
  if (!frame) return null
  const heights = stepBoundaryHeights(boundaryPointIds, points, frame)
  if (heights.length < 2) return null
  const minHeight = Math.min(...heights)
  const maxHeight = Math.max(...heights)
  if (maxHeight - minHeight <= Math.max(surface.radius, 1) * 1e-7) return null
  return createStepRevolvedBandMesh(frame, [minHeight, maxHeight], [surface.radius, surface.radius], points, `cylinder-${key}`, segments)
}

function createStepConeMesh (surface, placement, boundaryPointIds, points, key, segments = 32) {
  if (!Number.isFinite(surface.radius) || surface.radius < 0 || !Number.isFinite(surface.angle) || Math.abs(surface.angle) >= Math.PI / 2) return null
  const frame = createStepPlacementFrame(placement, points)
  if (!frame) return null
  const heights = stepBoundaryHeights(boundaryPointIds, points, frame)
  if (heights.length < 2) return null
  const minHeight = Math.min(...heights)
  const maxHeight = Math.max(...heights)
  if (maxHeight - minHeight <= Math.max(surface.radius, 1) * 1e-7) return null
  const radii = [minHeight, maxHeight].map(height => surface.radius + height * Math.tan(surface.angle))
  if (radii.some(radius => radius < 0)) return null
  return createStepRevolvedBandMesh(frame, [minHeight, maxHeight], radii, points, `cone-${key}`, segments)
}

function createStepSphereMesh (surface, placement, boundaryPointIds, points, key, longitudeSegments = 32, latitudeSegments = 12) {
  if (!Number.isFinite(surface.radius) || surface.radius <= 0) return null
  const frame = createStepPlacementFrame(placement, points)
  if (!frame) return null
  const boundaryHeights = stepBoundaryHeights(boundaryPointIds, points, frame)
  if (boundaryHeights.length < 2) return null
  const minHeight = Math.max(-surface.radius, Math.min(...boundaryHeights))
  const maxHeight = Math.min(surface.radius, Math.max(...boundaryHeights))
  if (maxHeight - minHeight <= surface.radius * 1e-7) return null
  const heights = []
  const radii = []
  const minLatitude = Math.asin(minHeight / surface.radius)
  const maxLatitude = Math.asin(maxHeight / surface.radius)
  for (let index = 0; index <= latitudeSegments; index++) {
    const latitude = minLatitude + (maxLatitude - minLatitude) * index / latitudeSegments
    heights.push(surface.radius * Math.sin(latitude))
    radii.push(Math.max(0, surface.radius * Math.cos(latitude)))
  }
  return createStepRevolvedBandMesh(frame, heights, radii, points, `sphere-${key}`, longitudeSegments)
}

function createStepTorusMesh (surface, placement, boundaryPointIds, points, key, longitudeSegments = 32, tubeSegments = 12) {
  if (!Number.isFinite(surface.majorRadius) || surface.majorRadius <= 0 || !Number.isFinite(surface.minorRadius) || surface.minorRadius <= 0 || surface.majorRadius <= surface.minorRadius) return null
  const frame = createStepPlacementFrame(placement, points)
  if (!frame) return null
  const { origin, axis, xAxis, yAxis } = frame
  const angles = []
  for (const pointId of boundaryPointIds) {
    const point = points[pointId]
    if (!point) continue
    const delta = point.map((value, index) => value - origin[index])
    const height = delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]
    const x = delta[0] * xAxis[0] + delta[1] * xAxis[1] + delta[2] * xAxis[2]
    const y = delta[0] * yAxis[0] + delta[1] * yAxis[1] + delta[2] * yAxis[2]
    const radial = Math.hypot(x, y)
    if (Math.abs(Math.hypot(radial - surface.majorRadius, height) - surface.minorRadius) > Math.max(surface.minorRadius, 1) * 1e-5) continue
    const angle = Math.atan2(height, radial - surface.majorRadius)
    if (!angles.some(value => Math.abs(Math.atan2(Math.sin(value - angle), Math.cos(value - angle))) < 1e-6)) angles.push(angle)
  }
  if (angles.length !== 2) return null
  const deltaAngle = Math.atan2(Math.sin(angles[1] - angles[0]), Math.cos(angles[1] - angles[0]))
  if (Math.abs(deltaAngle) < 1e-6) return null
  const heights = []
  const radii = []
  for (let index = 0; index <= tubeSegments; index++) {
    const angle = angles[0] + deltaAngle * index / tubeSegments
    heights.push(surface.minorRadius * Math.sin(angle))
    radii.push(surface.majorRadius + surface.minorRadius * Math.cos(angle))
  }
  return createStepRevolvedBandMesh(frame, heights, radii, points, `torus-${key}`, longitudeSegments)
}

function stepPlacementAxis (placementId, axisPlacements, directions) {
  const placement = axisPlacements[placementId]
  return placement ? normalizeStepVector(directions[placement.axisRef] || [0, 0, 1]) : null
}

function stepCirclesParallelToSurface (circleIds, circles, surfacePlacement, axisPlacements, directions) {
  const surfaceAxis = stepPlacementAxis(surfacePlacement, axisPlacements, directions)
  if (!surfaceAxis) return 0
  let count = 0
  for (const circleId of circleIds) {
    const circle = circles[circleId]
    const circleAxis = circle && stepPlacementAxis(circle.placement, axisPlacements, directions)
    if (circleAxis && Math.abs(circleAxis[0] * surfaceAxis[0] + circleAxis[1] * surfaceAxis[1] + circleAxis[2] * surfaceAxis[2]) > 0.999999) count++
  }
  return count
}

function createStepPreview (parsed) {
  const points = Object.create(null)
  const vertices = Object.create(null)
  const edgeCurves = Object.create(null)
  const edgeGeometry = Object.create(null)
  const orientedEdges = Object.create(null)
  const edgeLoops = Object.create(null)
  const polyLoops = Object.create(null)
  const faceBounds = Object.create(null)
  const directions = Object.create(null)
  const axisPlacements = Object.create(null)
  const circles = Object.create(null)
  const cylindricalSurfaces = Object.create(null)
  const conicalSurfaces = Object.create(null)
  const sphericalSurfaces = Object.create(null)
  const toroidalSurfaces = Object.create(null)
  const bSplineSurfaces = Object.create(null)
  const representationMaps = Object.create(null)
  const mappedItems = Object.create(null)
  const cartesianTransforms = Object.create(null)
  const itemDefinedTransforms = Object.create(null)
  const contextRelationshipIds = new Set()
  const relationshipTransforms = []
  const topologicalFaces = []
  const { records, complexRecords } = parsed
  const recordReferences = Object.create(null)
  for (const record of records) recordReferences[record.id] = stepReferences(record.body)
  for (const record of complexRecords) recordReferences[record.id] = Array.from(new Set(record.components.flatMap(component => stepReferences(component.body))))
  const types = Object.create(null)
  let pointCount = 0
  for (const record of records) types[record.id] = record.type
  for (const record of complexRecords) {
    if (record.components.some(component => component.type === 'B_SPLINE_SURFACE')) types[record.id] = 'B_SPLINE_SURFACE_WITH_KNOTS'
  }
  for (const record of records) {
    const args = splitStepArguments(record.body)
    if (record.type === 'CARTESIAN_POINT' && pointCount < 5000) {
      const coordinates = String(args[1] || '').replace(/[()]/g, '').split(',').map(Number)
      const point = [coordinates[0], coordinates[1], coordinates[2] || 0]
      if (point.every(Number.isFinite)) { points[record.id] = point; pointCount++ }
    } else if (record.type === 'DIRECTION') {
      const coordinates = String(args[1] || '').replace(/[()]/g, '').split(',').map(Number)
      const direction = [coordinates[0], coordinates[1], coordinates[2] || 0]
      if (direction.every(Number.isFinite)) directions[record.id] = direction
    } else if (record.type === 'AXIS2_PLACEMENT_3D') {
      const refs = stepReferences(record.body)
      axisPlacements[record.id] = { origin: refs[0], axisRef: refs[1], referenceRef: refs[2] }
    } else if (record.type === 'CARTESIAN_TRANSFORMATION_OPERATOR_3D') {
      cartesianTransforms[record.id] = {
        axis1: stepReferences(args[1] || '')[0],
        axis2: stepReferences(args[2] || '')[0],
        origin: stepReferences(args[3] || '')[0],
        scale: args[4],
        axis3: stepReferences(args[5] || '')[0]
      }
    } else if (record.type === 'REPRESENTATION_MAP') {
      const refs = stepReferences(record.body)
      representationMaps[record.id] = { origin: refs[0], representation: refs[1] }
    } else if (record.type === 'MAPPED_ITEM') {
      const refs = stepReferences(record.body)
      mappedItems[record.id] = { source: refs[0], target: refs[1] }
    } else if (record.type === 'ITEM_DEFINED_TRANSFORMATION') {
      const refs = stepReferences(record.body)
      if (refs.length >= 2) itemDefinedTransforms[record.id] = { source: refs[refs.length - 2], target: refs[refs.length - 1] }
    } else if (record.type === 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') {
      const refs = stepReferences(record.body)
      if (refs[0]) contextRelationshipIds.add(refs[0])
    } else if (record.type === 'CIRCLE') {
      const refs = stepReferences(args[1] || '')
      circles[record.id] = { placement: refs[0], radius: Number(args[2]) }
    } else if (record.type === 'CYLINDRICAL_SURFACE') {
      const refs = stepReferences(args[1] || '')
      cylindricalSurfaces[record.id] = { placement: refs[0], radius: Number(args[2]) }
    } else if (record.type === 'CONICAL_SURFACE') {
      const refs = stepReferences(args[1] || '')
      conicalSurfaces[record.id] = { placement: refs[0], radius: Number(args[2]), angle: Number(args[3]) }
    } else if (record.type === 'SPHERICAL_SURFACE') {
      const refs = stepReferences(args[1] || '')
      sphericalSurfaces[record.id] = { placement: refs[0], radius: Number(args[2]) }
    } else if (record.type === 'TOROIDAL_SURFACE') {
      const refs = stepReferences(args[1] || '')
      toroidalSurfaces[record.id] = { placement: refs[0], majorRadius: Number(args[2]), minorRadius: Number(args[3]) }
    } else if (record.type === 'B_SPLINE_SURFACE_WITH_KNOTS') {
      const controlPoints = stepReferenceGrid(args[3])
      const uDegree = Number(args[1])
      const vDegree = Number(args[2])
      const uMultiplicities = stepNumberList(args[8])
      const vMultiplicities = stepNumberList(args[9])
      const uKnots = stepNumberList(args[10])
      const vKnots = stepNumberList(args[11])
      if (controlPoints.length) bSplineSurfaces[record.id] = { controlPoints, uDegree, vDegree, uMultiplicities, vMultiplicities, uKnots, vKnots }
    } else if (record.type === 'VERTEX_POINT') {
      vertices[record.id] = stepReferences(args[1] || record.body)[0]
    } else if (record.type === 'EDGE_CURVE') {
      const refs = stepReferences(record.body)
      if (refs.length >= 2) {
        edgeCurves[record.id] = refs.slice(0, 2)
        edgeGeometry[record.id] = refs[2]
      }
    } else if (record.type === 'ORIENTED_EDGE') {
      const refs = stepReferences(record.body)
      orientedEdges[record.id] = { edge: refs[refs.length - 1], forward: !/\.F\.\s*$/i.test(args[args.length - 1] || '') }
    } else if (record.type === 'EDGE_LOOP') {
      edgeLoops[record.id] = stepReferences(args[1] || record.body)
    } else if (record.type === 'POLY_LOOP') {
      polyLoops[record.id] = stepReferences(args[1] || record.body)
    } else if (record.type === 'FACE_OUTER_BOUND' || record.type === 'FACE_BOUND') {
      const refs = stepReferences(record.body)
      faceBounds[record.id] = { loop: refs[0], forward: !/\.F\.\s*$/i.test(args[args.length - 1] || ''), outer: record.type === 'FACE_OUTER_BOUND' }
    } else if (record.type === 'ADVANCED_FACE' || record.type === 'FACE_SURFACE') {
      const surface = stepReferences(args[2] || '')[0]
      topologicalFaces.push({ id: record.id, bounds: stepReferences(args[1] || ''), surface })
    } else if (record.type === 'FACE') {
      topologicalFaces.push({ id: record.id, bounds: stepReferences(args[1] || ''), surface: '' })
    }
  }
  for (const record of complexRecords) {
    const relationship = record.components.find(component => component.type === 'REPRESENTATION_RELATIONSHIP')
    const transformed = record.components.find(component => component.type === 'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION')
    const shapeRelationship = record.components.some(component => component.type === 'SHAPE_REPRESENTATION_RELATIONSHIP')
    if (relationship && transformed && shapeRelationship && contextRelationshipIds.has(record.id)) {
      const representationRefs = stepReferences(relationship.body)
      const transformationRefs = stepReferences(transformed.body)
      if (representationRefs.length >= 2 && transformationRefs[0]) {
        relationshipTransforms.push({
          id: record.id,
          sourceRepresentation: representationRefs[representationRefs.length - 2],
          targetRepresentation: representationRefs[representationRefs.length - 1],
          transformation: transformationRefs[0]
        })
      }
    }
    const base = record.components.find(component => component.type === 'B_SPLINE_SURFACE')
    const knots = record.components.find(component => component.type === 'B_SPLINE_SURFACE_WITH_KNOTS')
    if (!base || !knots) continue
    const baseArgs = splitStepArguments(base.body)
    const knotArgs = splitStepArguments(knots.body)
    const rational = record.components.find(component => component.type === 'RATIONAL_B_SPLINE_SURFACE')
    const controlPoints = stepReferenceGrid(baseArgs[2])
    const weights = rational ? stepNumberGrid(splitStepArguments(rational.body)[0]) : null
    if (rational && (!weights.length || weights.length !== controlPoints.length || weights.some((row, index) => row.length !== controlPoints[index].length))) {
      throw new Error('STEP 有理曲面权重无效或与控制点数量不一致')
    }
    if (controlPoints.length && (!rational || weights.length)) {
      bSplineSurfaces[record.id] = {
        controlPoints,
        weights,
        uDegree: Number(baseArgs[0]),
        vDegree: Number(baseArgs[1]),
        uMultiplicities: stepNumberList(knotArgs[0]),
        vMultiplicities: stepNumberList(knotArgs[1]),
        uKnots: stepNumberList(knotArgs[2]),
        vKnots: stepNumberList(knotArgs[3])
      }
    }
  }
  const generatedEdges = []
  const generatedFaces = []
  const generatedPointOwners = Object.create(null)
  for (let faceIndex = 0; faceIndex < topologicalFaces.length; faceIndex++) {
    const face = topologicalFaces[faceIndex]
    const surfaceType = cylindricalSurfaces[face.surface] ? 'cylinder' : conicalSurfaces[face.surface] ? 'cone' : sphericalSurfaces[face.surface] ? 'sphere' : toroidalSurfaces[face.surface] ? 'torus' : bSplineSurfaces[face.surface] ? 'bspline' : ''
    const surface = cylindricalSurfaces[face.surface] || conicalSurfaces[face.surface] || sphericalSurfaces[face.surface] || toroidalSurfaces[face.surface] || bSplineSurfaces[face.surface]
    if (!surface) continue
    const placementRecord = surfaceType === 'bspline' ? null : axisPlacements[surface.placement]
    if (surfaceType !== 'bspline' && !placementRecord) continue
    const placement = placementRecord ? { origin: placementRecord.origin, axis: directions[placementRecord.axisRef] || [0, 0, 1], reference: directions[placementRecord.referenceRef] || [1, 0, 0] } : null
    const explicitOuter = face.bounds.filter(boundId => faceBounds[boundId] && faceBounds[boundId].outer)
    const candidateBounds = explicitOuter.length ? explicitOuter : face.bounds.length === 1 ? face.bounds : []
    const boundaryPointIds = []
    const boundaryCircleIds = []
    let circularBoundaries = 0
    for (const boundId of candidateBounds) {
      const bound = faceBounds[boundId]
      if (bound && edgeLoops[bound.loop]) {
        boundaryPointIds.push(...orderedStepEdgeLoop(edgeLoops[bound.loop], orientedEdges, edgeCurves, vertices))
        for (const orientedId of edgeLoops[bound.loop]) {
          const oriented = orientedEdges[orientedId]
          if (oriented && types[edgeGeometry[oriented.edge]] === 'CIRCLE') {
            circularBoundaries++
            boundaryCircleIds.push(edgeGeometry[oriented.edge])
          }
        }
      }
    }
    let mesh = null
    if (surfaceType === 'bspline') mesh = createStepBSplineMesh(surface, points, `${face.surface}-${faceIndex}`)
    else if (circularBoundaries >= 2) {
      if (surfaceType === 'cylinder') mesh = createStepCylinderMesh(surface, placement, boundaryPointIds, points, `${face.surface}-${faceIndex}`)
      else if (surfaceType === 'cone') mesh = createStepConeMesh(surface, placement, boundaryPointIds, points, `${face.surface}-${faceIndex}`)
      else if (surfaceType === 'sphere') mesh = createStepSphereMesh(surface, placement, boundaryPointIds, points, `${face.surface}-${faceIndex}`)
      else if (surfaceType === 'torus' && stepCirclesParallelToSurface(boundaryCircleIds, circles, surface.placement, axisPlacements, directions) >= 2) mesh = createStepTorusMesh(surface, placement, boundaryPointIds, points, `${face.surface}-${faceIndex}`)
    }
    if (mesh) {
      generatedEdges.push(...mesh.edges)
      generatedFaces.push(...mesh.faces)
      for (const pointId of new Set([...mesh.edges.flat(), ...mesh.faces.flat()])) generatedPointOwners[pointId] = face.id
    }
  }
  const usedGeometryPointIds = new Set([
    ...Object.values(vertices),
    ...Object.values(polyLoops).flat(),
    ...Object.values(bSplineSurfaces).flatMap(surface => surface.controlPoints.flat()),
    ...Object.keys(generatedPointOwners)
  ].filter(Boolean))
  const mappedInstances = []
  const templatePointIds = new Set()
  let mappedPointCount = 0
  const geometryPointsForRepresentation = sourceRepresentation => {
    const closure = collectStepReferenceClosure(sourceRepresentation, recordReferences)
    return Array.from(usedGeometryPointIds).filter(id => points[id] && (closure.has(id) || closure.has(generatedPointOwners[id])))
  }
  const appendTransformedInstance = (instanceId, sourceRepresentation, transformPoint, kind) => {
    if (mappedInstances.length >= 200) return false
    if (typeof transformPoint !== 'function') return false
    const sourcePoints = geometryPointsForRepresentation(sourceRepresentation)
    if (!sourcePoints.length || mappedPointCount + sourcePoints.length > 10000) return false
    const pointMap = Object.create(null)
    const cloneIds = []
    let valid = true
    for (const id of sourcePoints) {
      const transformed = transformPoint(points[id])
      if (!transformed.every(Number.isFinite)) { valid = false; break }
      const cloneId = `mapped-${instanceId}-${id}`
      points[cloneId] = transformed
      pointMap[id] = cloneId
      cloneIds.push(cloneId)
    }
    if (valid) {
      for (const id of sourcePoints) templatePointIds.add(id)
      mappedPointCount += sourcePoints.length
      mappedInstances.push({ id: instanceId, points: pointMap, kind })
      return true
    } else {
      for (const id of cloneIds) delete points[id]
      return false
    }
  }
  for (const [mappedId, mapped] of Object.entries(mappedItems)) {
    if (mappedInstances.length >= 200) break
    const sourceMap = representationMaps[mapped.source]
    const targetFrame = createStepOperatorFrame(cartesianTransforms[mapped.target] || {}, points, directions)
    if (!sourceMap || !targetFrame) continue
    const sourcePlacement = axisPlacements[sourceMap.origin]
    const sourceFrame = sourcePlacement ? createStepPlacementFrame({
      origin: sourcePlacement.origin,
      axis: directions[sourcePlacement.axisRef] || [0, 0, 1],
      reference: directions[sourcePlacement.referenceRef] || [1, 0, 0]
    }, points) : null
    if (sourcePlacement && !sourceFrame) continue
    appendTransformedInstance(mappedId, sourceMap.representation, point => transformStepMappedPoint(point, sourceFrame, targetFrame), 'mapped-item')
  }
  const resolvedRelationships = []
  for (const relationship of relationshipTransforms) {
    const transformation = itemDefinedTransforms[relationship.transformation]
    const sourcePlacement = transformation && axisPlacements[transformation.source]
    const targetPlacement = transformation && axisPlacements[transformation.target]
    if (!sourcePlacement || !targetPlacement) continue
    const sourceFrame = createStepPlacementFrame({
      origin: sourcePlacement.origin,
      axis: directions[sourcePlacement.axisRef] || [0, 0, 1],
      reference: directions[sourcePlacement.referenceRef] || [1, 0, 0]
    }, points)
    const targetFrame = createStepPlacementFrame({
      origin: targetPlacement.origin,
      axis: directions[targetPlacement.axisRef] || [0, 0, 1],
      reference: directions[targetPlacement.referenceRef] || [1, 0, 0]
    }, points)
    if (!sourceFrame || !targetFrame) continue
    resolvedRelationships.push({ ...relationship, sourceFrame, targetFrame: { ...targetFrame, scale: 1 } })
  }
  const relationshipsFromRepresentation = Object.create(null)
  for (const relationship of resolvedRelationships) {
    if (!relationshipsFromRepresentation[relationship.sourceRepresentation]) relationshipsFromRepresentation[relationship.sourceRepresentation] = []
    relationshipsFromRepresentation[relationship.sourceRepresentation].push(relationship)
  }
  const finalRelationshipPaths = []
  const collectRelationshipPaths = (path, visited) => {
    if (path.length >= 16 || finalRelationshipPaths.length >= 200) { finalRelationshipPaths.push(path); return }
    const current = path[path.length - 1]
    const next = (relationshipsFromRepresentation[current.targetRepresentation] || []).filter(item => !visited.has(item.id))
    if (!next.length) { finalRelationshipPaths.push(path); return }
    for (const relationship of next) {
      const nextVisited = new Set(visited)
      nextVisited.add(relationship.id)
      collectRelationshipPaths([...path, relationship], nextVisited)
    }
  }
  for (const relationship of resolvedRelationships) {
    if (!geometryPointsForRepresentation(relationship.sourceRepresentation).length) continue
    collectRelationshipPaths([relationship], new Set([relationship.id]))
  }
  for (const path of finalRelationshipPaths) {
    if (mappedInstances.length >= 200) break
    const sourceRepresentation = path[0].sourceRepresentation
    appendTransformedInstance(`relationship-${path.map(item => item.id).join('-')}`, sourceRepresentation, point => path.reduce((transformed, relationship) => transformStepMappedPoint(transformed, relationship.sourceFrame, relationship.targetFrame), point), 'relationship')
  }
  const pointIds = Object.keys(points).filter(id => !templatePointIds.has(id) && (!mappedInstances.length || usedGeometryPointIds.has(id) || !/^\d+$/.test(id)))
  const list = pointIds.map(id => points[id])
  if (!list.length) return { svg: '', points: 0, edges: 0, faces: 0, instances: 0, relationshipInstances: 0, edgesTruncated: false, facesTruncated: false, model: null }
  const pointIndex = Object.create(null)
  pointIds.forEach((id, index) => { pointIndex[id] = index })
  const edgePointIds = []
  const edgeLimit = 10000
  let edgesTruncated = false
  const appendEdgeWithMappings = edge => {
    const isTemplate = edge.every(id => templatePointIds.has(id))
    if (!isTemplate && edgePointIds.length < edgeLimit) edgePointIds.push(edge)
    for (const instance of mappedInstances) {
      const mapped = edge.map(id => instance.points[id])
      if (mapped.every(Boolean) && edgePointIds.length < edgeLimit) edgePointIds.push(mapped)
      else if (mapped.every(Boolean)) edgesTruncated = true
    }
  }
  for (const edge of Object.values(edgeCurves)) {
    if (edgePointIds.length >= edgeLimit) { edgesTruncated = true; break }
    const first = vertices[edge[0]]
    const second = vertices[edge[1]]
    if (points[first] && points[second]) appendEdgeWithMappings([first, second])
  }
  for (const loop of Object.values(polyLoops)) {
    for (let index = 0; index < loop.length && edgePointIds.length < edgeLimit; index++) if (points[loop[index]] && points[loop[(index + 1) % loop.length]]) appendEdgeWithMappings([loop[index], loop[(index + 1) % loop.length]])
    if (edgePointIds.length >= edgeLimit) { edgesTruncated = true; break }
  }
  for (const edge of generatedEdges) {
    if (edgePointIds.length >= edgeLimit) { edgesTruncated = true; break }
    appendEdgeWithMappings(edge)
  }
  const uniqueEdges = []
  const edgeKeys = new Set()
  for (const edge of edgePointIds) {
    const key = [edge[0], edge[1]].sort().join(':')
    if (!edgeKeys.has(key)) { edgeKeys.add(key); uniqueEdges.push(edge) }
  }
  const modelEdges = uniqueEdges.map(edge => [pointIndex[edge[0]], pointIndex[edge[1]]]).filter(edge => edge.every(Number.isInteger))
  const faces = []
  const faceLimit = 5000
  let facesTruncated = false
  for (const face of generatedFaces) {
    if (faces.length >= faceLimit) { facesTruncated = true; break }
    const isTemplate = face.every(id => templatePointIds.has(id))
    if (!isTemplate) {
      const triangle = face.map(id => pointIndex[id])
      if (triangle.every(Number.isInteger)) faces.push(triangle)
    }
    for (const instance of mappedInstances) {
      const mapped = face.map(id => instance.points[id])
      if (!mapped.every(Boolean)) continue
      if (faces.length >= faceLimit) { facesTruncated = true; break }
      const triangle = mapped.map(id => pointIndex[id])
      if (triangle.every(Number.isInteger)) faces.push(triangle)
    }
  }
  const triangulatedLoops = new Set()
  const appendFace = (loopId, ids, forward = true) => {
    if (!ids || ids.length < 3 || triangulatedLoops.has(loopId)) return
    if (faces.length >= faceLimit) { facesTruncated = true; return }
    triangulatedLoops.add(loopId)
    const oriented = forward ? ids : ids.slice().reverse()
    const triangles = ids.every(id => templatePointIds.has(id)) ? [] : triangulateStepPolygon(oriented, points, pointIndex)
    for (const instance of mappedInstances) {
      const mapped = oriented.map(id => instance.points[id])
      if (mapped.every(Boolean)) triangles.push(...triangulateStepPolygon(mapped, points, pointIndex))
    }
    const remaining = faceLimit - faces.length
    if (triangles.length > remaining) facesTruncated = true
    faces.push(...triangles.slice(0, remaining))
  }
  // A curved face's polygon boundary is not an extra planar face. Retain
  // standalone boundary previews; owned bounds are interpreted by their face.
  const ownedBounds = new Set(topologicalFaces.flatMap(face => face.bounds))
  for (const [id, bound] of Object.entries(faceBounds)) if (!ownedBounds.has(id) && bound.outer && polyLoops[bound.loop]) appendFace(bound.loop, polyLoops[bound.loop], bound.forward)
  for (const face of topologicalFaces) {
    if (face.surface && types[face.surface] !== 'PLANE') continue
    const explicitOuter = face.bounds.filter(boundId => faceBounds[boundId] && faceBounds[boundId].outer)
    const candidateBounds = explicitOuter.length ? explicitOuter : face.bounds.length === 1 ? face.bounds : []
    for (const boundId of candidateBounds) {
      const bound = faceBounds[boundId]
      if (!bound) continue
      if (polyLoops[bound.loop]) appendFace(bound.loop, polyLoops[bound.loop], bound.forward)
      else if (types[face.surface] === 'PLANE' && edgeLoops[bound.loop]) appendFace(bound.loop, orderedStepEdgeLoop(edgeLoops[bound.loop], orientedEdges, edgeCurves, vertices), bound.forward)
    }
  }
  const edges = uniqueEdges.map(([first, second]) => [points[first], points[second]])
  const project = point => ({ x: point[0] - point[1] * 0.55, y: -(point[2] + (point[0] + point[1]) * 0.28) })
  const projected = list.map(project)
  let minX = Math.min(...projected.map(point => point.x)); let maxX = Math.max(...projected.map(point => point.x))
  let minY = Math.min(...projected.map(point => point.y)); let maxY = Math.max(...projected.map(point => point.y))
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.08
  minX -= pad; maxX += pad; minY -= pad; maxY += pad
  const strokeWidth = Math.max(maxX - minX, maxY - minY) / 500
  const edgeSvg = edges.map(([first, second]) => {
    const a = project(first); const b = project(second)
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`
  }).join('')
  const faceSvg = faces.slice(0, 5000).map(face => `<polygon points="${face.map(index => `${project(list[index]).x},${project(list[index]).y}`).join(' ')}"/>`).join('')
  const pointRadius = Math.max(strokeWidth * 1.8, Math.max(maxX - minX, maxY - minY) / 350)
  const pointSvg = projected.slice(0, 1500).map(point => `<circle cx="${point.x}" cy="${point.y}" r="${pointRadius}"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}"><rect x="${minX}" y="${minY}" width="${Math.max(1, maxX - minX)}" height="${Math.max(1, maxY - minY)}" fill="#fffdf8"/><g fill="rgba(185,230,59,.28)" stroke="none" data-step-faces="${faces.length}">${faceSvg}</g><g fill="none" stroke="#171715" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke">${edgeSvg}</g><g fill="#b9e63b" stroke="#171715" stroke-width="${strokeWidth}">${pointSvg}</g></svg>`
  return { svg, points: list.length, edges: edges.length, faces: faces.length, instances: mappedInstances.length, relationshipInstances: mappedInstances.filter(instance => instance.kind === 'relationship').length, edgesTruncated, facesTruncated, model: { kind: 'step-wireframe', points: list, edges: modelEdges, faces } }
}

function inspectDwg (bytes) {
  const signature = ascii(bytes, 0, 6)
  if (!/^AC10\d\d$/.test(signature)) throw new Error('DWG 文件头不正确')
  return {
    title: skinCopy.message('inspector.inspectDwg.title.a7ad90', {}, 'DWG 文件（图纸内容未支持）'),
    summary: skinCopy.message('inspector.inspectDwg.summary.edeac1', {}, '当前版本不能解码 DWG 图纸几何。这里只显示真实保存版本；文件本身带有 JPEG/PNG 缩略图时才会显示该缩略图。需要查看图纸时，请先在 CAD 软件中另存为 DXF，再用兔子阅读器打开。'),
    metadata: [
      { label: skinCopy.message('inspector.inspectDwg.label.d03d69', {}, 'DWG 标识'), value: signature },
      { label: skinCopy.message('inspector.inspectDwg.label.55558e', {}, '保存版本'), value: DWG_VERSIONS[signature] || '未知 AutoCAD 版本' },
      { label: skinCopy.message('inspector.inspectDwg.label.e6a73a', {}, '图纸内容'), value: '未支持（不是图纸预览）' },
      { label: skinCopy.message('inspector.inspectDwg.label.258220', {}, '可行操作'), value: '在 CAD 软件中另存为 DXF 后打开' }
    ],
    entries: []
  }
}

function cdrChunkLabel (id, listType = '') {
  const labels = {
    vrsn: '文档版本',
    DISP: '画布缩略图',
    sumi: '文档摘要',
    mcfg: '页面配置',
    loda: '形状与样式数据',
    font: '字体记录'
  }
  if (id === 'LIST') return listType === 'cmpr' ? '压缩图形数据' : listType === 'stlt' ? '文字样式表' : `${listType || '未命名'} 列表`
  return labels[id] || '未解析块'
}

function decodeCdrDisp (input) {
  const bytes = toUint8(input)
  if (bytes.length < 1068) throw new Error('CDR DISP 缩略图数据不完整')
  const width = readUint32LE(bytes, 8)
  const height = readUint32LE(bytes, 12)
  const pixels = width * height
  if (!width || !height || !Number.isSafeInteger(pixels) || pixels > 4_000_000) throw new Error('CDR DISP 缩略图尺寸超出本机保护范围')
  if (1068 + pixels > bytes.length) throw new Error('CDR DISP 缩略图像素数据不完整')
  const rgba = new Uint8Array(pixels * 4)
  const paletteOffset = 44
  const pixelOffset = 1068
  for (let y = 0; y < height; y++) {
    const sourceY = height - y - 1
    for (let x = 0; x < width; x++) {
      const paletteIndex = bytes[pixelOffset + sourceY * width + x]
      const palette = paletteOffset + paletteIndex * 4
      const target = (y * width + x) * 4
      rgba[target] = bytes[palette + 2]
      rgba[target + 1] = bytes[palette + 1]
      rgba[target + 2] = bytes[palette]
      rgba[target + 3] = 255
    }
  }
  const encoded = encodeJpeg({ data: rgba, width, height }, 84)
  return { extension: 'jpg', bytes: toUint8(encoded.data), width, height, source: 'DISP' }
}

function cdrVersionFromForm (form) {
  const marker = form && form.charCodeAt(3)
  if (marker === 0x20) return 300
  if (marker >= 0x31 && marker <= 0x39) return (marker - 0x30) * 100
  if (marker >= 0x41 && marker <= 0x5a) return (marker - 0x37) * 100
  return 0
}

function cdrReadSigned16 (bytes, offset) {
  const value = readUint16LE(bytes, offset)
  return value & 0x8000 ? value - 0x10000 : value
}

function cdrReadSigned32 (bytes, offset) {
  const value = readUint32LE(bytes, offset)
  return value > 0x7fffffff ? value - 0x100000000 : value
}

function cdrReadDoubleLE (bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) throw new Error('CDR 浮点数据超出块边界')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true)
}

function cdrCoordinate (bytes, offset, version) {
  return version < 600 ? cdrReadSigned16(bytes, offset) / 1000 : cdrReadSigned32(bytes, offset) / 254000
}

function cdrColor (bytes, offset, version) {
  if (version < 500 || offset + 12 > bytes.length) return { color: '#72726d', next: offset }
  const model = readUint16LE(bytes, offset)
  const value = readUint32LE(bytes, offset + 8)
  const first = value & 0xff
  const second = (value >>> 8) & 0xff
  const third = (value >>> 16) & 0xff
  const fourth = (value >>> 24) & 0xff
  const hex = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  let red = third; let green = second; let blue = first
  if ([0x01, 0x02, 0x15].includes(model)) {
    const cyan = Math.min(1, first / 100); const magenta = Math.min(1, second / 100)
    const yellow = Math.min(1, third / 100); const black = Math.min(1, fourth / 100)
    red = 255 * (1 - Math.min(1, cyan + black))
    green = 255 * (1 - Math.min(1, magenta + black))
    blue = 255 * (1 - Math.min(1, yellow + black))
  } else if ([0x03, 0x11].includes(model)) {
    const cyan = first / 255; const magenta = second / 255; const yellow = third / 255; const black = fourth / 255
    red = 255 * (1 - Math.min(1, cyan + black))
    green = 255 * (1 - Math.min(1, magenta + black))
    blue = 255 * (1 - Math.min(1, yellow + black))
  } else if (model === 0x04) {
    red = 255 - first; green = 255 - second; blue = 255 - third
  }
  return { color: `#${hex(red)}${hex(green)}${hex(blue)}`, model, next: offset + 12 }
}

const MAX_CDR_GRAPHIC_BYTES = 32 * 1024 * 1024
const MAX_CDR_LENGTH_BYTES = 4 * 1024 * 1024

function decodeCdrCompressedList (bytes, start, end) {
  if (start + 28 > end) throw new Error('CDR LIST cmpr 头部不完整')
  const firstCompressed = readUint32LE(bytes, start + 4)
  const firstExpected = readUint32LE(bytes, start + 8)
  const secondCompressed = readUint32LE(bytes, start + 12)
  const secondExpected = readUint32LE(bytes, start + 16)
  if (firstExpected > MAX_CDR_GRAPHIC_BYTES || secondExpected > MAX_CDR_LENGTH_BYTES) throw new Error('CDR 压缩画布超过本机保护范围')
  if (secondExpected % 4) throw new Error('CDR 块长度表不是完整的四字节记录')
  if (ascii(bytes, start + 20, 4) !== 'CPng' || readUint16LE(bytes, start + 24) !== 1 || readUint16LE(bytes, start + 26) !== 4) throw new Error('CDR 第一段压缩标识不正确')
  if (firstCompressed < 8 || secondCompressed < 8) throw new Error('CDR 压缩段长度不正确')
  const firstStart = start + 28
  const firstEnd = firstStart + firstCompressed - 8
  const secondHeader = firstEnd
  const secondStart = secondHeader + 8
  const secondEnd = secondStart + secondCompressed - 8
  if (secondEnd > end || ascii(bytes, secondHeader, 4) !== 'CPng' || readUint16LE(bytes, secondHeader + 4) !== 1 || readUint16LE(bytes, secondHeader + 6) !== 4) throw new Error('CDR 第二段压缩标识不正确')
  if (secondEnd !== end) throw new Error('CDR 双压缩段结尾与 LIST 长度不一致')
  const stream = inflateZlibBounded(bytes.subarray(firstStart, firstEnd), firstExpected, MAX_CDR_GRAPHIC_BYTES)
  const lengthsBytes = inflateZlibBounded(bytes.subarray(secondStart, secondEnd), secondExpected, MAX_CDR_LENGTH_BYTES)
  if (stream.length !== firstExpected || lengthsBytes.length !== secondExpected || lengthsBytes.length % 4) throw new Error('CDR 压缩画布解压长度不一致')
  const lengths = []
  for (let offset = 0; offset < lengthsBytes.length; offset += 4) lengths.push(readUint32LE(lengthsBytes, offset))
  return { stream, lengths }
}

function parseCdrCompressedRecords (bytes, lengths) {
  const state = { records: 0 }
  function parse (start, end, depth = 0) {
    const nodes = []
    let cursor = start
    while (cursor < end) {
      // CDR streams may contain zero padding between records, including inside
      // lists. It is not an unknown record and must not hide following artwork.
      while (cursor < end && bytes[cursor] === 0) cursor++
      if (cursor === end) break
      if (cursor + 8 > end) throw new Error('CDR 压缩内部记录头不完整')
      if (state.records >= 2500) throw new Error('CDR 压缩内部记录数量超过本机保护范围')
      const id = ascii(bytes, cursor, 4)
      const field = readUint32LE(bytes, cursor + 4)
      if (!/^[\x20-\x7e]{4}$/.test(id)) throw new Error('CDR 压缩内部记录标识无效')
      // Like native libcdr, an in-range field indexes the table; a larger one
      // is a literal byte length. Bounds still apply to the resolved length.
      const size = field < lengths.length ? lengths[field] : field
      const dataStart = cursor + 8
      const dataEnd = dataStart + size
      if (dataEnd > end || dataEnd > bytes.length) throw new Error('CDR 压缩内部记录长度超过所属列表范围')
      if (id === 'LIST' && size < 4) throw new Error('CDR 压缩内部列表缺少类型标识')
      const listType = id === 'LIST' ? ascii(bytes, dataStart, 4) : ''
      const node = { id, listType, size, dataStart, dataEnd, depth, children: [] }
      state.records++
      if (id === 'LIST' && listType !== 'stlt' && size > 4) {
        if (depth >= 12) throw new Error('CDR 压缩内部列表层数超过本机保护范围')
        node.children = parse(dataStart + 4, dataEnd, depth + 1)
      }
      nodes.push(node)
      cursor = dataEnd
    }
    return nodes
  }
  return { nodes: parse(0, bytes.length), count: state.records }
}

function cdrVisitRecords (nodes, visitor) {
  for (const node of nodes) {
    visitor(node)
    if (node.children && node.children.length) cdrVisitRecords(node.children, visitor)
  }
}

function cdrStyleTables (bytes, nodes, version) {
  const fills = new Map(); const lines = new Map()
  cdrVisitRecords(nodes, node => {
    if (node.id === 'fild' && node.size >= 8) {
      const id = readUint32LE(bytes, node.dataStart)
      const type = readUint16LE(bytes, node.dataStart + 4)
      if (type === 0) fills.set(id, { type: 'none', color: 'none' })
      else if (type === 1 && node.size >= 20) fills.set(id, { type: 'solid', color: cdrColor(bytes, node.dataStart + 8, version).color })
      else if (type === 2 && node.size >= 56 && version >= 600 && version < 1300) {
        const gradientType = bytes[node.dataStart + 8]
        const stopCount = readUint32LE(bytes, node.dataStart + 52) & 0xffff
        const stops = []
        let cursor = node.dataStart + 56
        for (let index = 0; index < stopCount && index < 32 && cursor + 16 <= node.dataEnd; index++) {
          const parsed = cdrColor(bytes, cursor, version)
          stops.push({ color: parsed.color, offset: Math.max(0, Math.min(100, readUint32LE(bytes, cursor + 12) & 0xffff)) })
          cursor += 16
        }
        fills.set(id, stops.length ? { type: 'gradient', gradientType, stops } : { type: 'none', color: 'none' })
      }
    } else if (node.id === 'outl' && node.size >= 88 && version >= 600 && version < 1300) {
      const id = readUint32LE(bytes, node.dataStart)
      const type = readUint16LE(bytes, node.dataStart + 4)
      const width = Math.abs(cdrCoordinate(bytes, node.dataStart + 12, version))
      const color = cdrColor(bytes, node.dataStart + 76, version).color
      const caps = readUint16LE(bytes, node.dataStart + 6)
      const join = readUint16LE(bytes, node.dataStart + 8)
      const stretch = readUint16LE(bytes, node.dataStart + 16) / 100
      const dashes = []
      if (node.size >= 106) {
        const count = readUint16LE(bytes, node.dataStart + 104)
        if (count > 128) throw new Error('CDR 虚线分段超过本机预览上限')
        if (106 + count * 2 > node.size) throw new Error('CDR 虚线分段数据不完整')
        for (let index = 0; index < count; index++) dashes.push(readUint16LE(bytes, node.dataStart + 106 + index * 2))
      }
      lines.set(id, { type, width, color, caps, join, stretch, dashes })
    }
  })
  return { fills, lines }
}

function cdrLodaArguments (bytes, node, version) {
  if (version < 600 || node.size < 20) return null
  const start = node.dataStart
  const chunkLength = readUint32LE(bytes, start)
  const count = readUint32LE(bytes, start + 4)
  const offsetsStart = readUint32LE(bytes, start + 8)
  const typesStart = readUint32LE(bytes, start + 12)
  const chunkType = readUint32LE(bytes, start + 16)
  if (!count || count > 128 || offsetsStart + count * 4 > node.size || typesStart + count * 4 > node.size || chunkLength > node.size) return null
  const offsets = []; const types = []
  for (let index = 0; index < count; index++) offsets.push(readUint32LE(bytes, start + offsetsStart + index * 4))
  for (let index = 0; index < count; index++) types.unshift(readUint32LE(bytes, start + typesStart + index * 4))
  const args = []
  for (let index = 0; index < count; index++) if (offsets[index] < node.size) args.push({ type: types[index], offset: start + offsets[index] })
  return { chunkType, args }
}

function cdrPathCommands (points, types) {
  const commands = []; const controls = []
  for (let index = 0; index < points.length; index++) {
    const type = types[index] || 0
    const closed = Boolean(type & 0x08)
    if (!(type & 0x40) && !(type & 0x80)) {
      controls.length = 0
      commands.push({ kind: 'M', points: [points[index]] })
    } else if ((type & 0x40) && !(type & 0x80)) {
      controls.length = 0
      commands.push({ kind: 'L', points: [points[index]] })
    } else if (!(type & 0x40) && (type & 0x80)) {
      commands.push(controls.length >= 2 ? { kind: 'C', points: [controls[0], controls[1], points[index]] } : { kind: 'L', points: [points[index]] })
      controls.length = 0
    } else controls.push(points[index])
    if (closed) commands.push({ kind: 'Z', points: [] })
  }
  return commands
}

function cdrReadPointPath (bytes, offset, end, version, pathKind) {
  let count; let cursor
  if (pathKind === 'path') {
    if (offset + 24 > end) return []
    count = readUint16LE(bytes, offset + 4) + readUint16LE(bytes, offset + 6)
    cursor = offset + 24
  } else {
    if (offset + 4 > end) return []
    count = readUint16LE(bytes, offset)
    cursor = offset + 4
  }
  const coordinateSize = version < 600 ? 2 : 4
  const bytesNeeded = count * (coordinateSize * 2 + 1)
  if (!count || count > 10000 || cursor + bytesNeeded > end) return []
  const points = []
  for (let index = 0; index < count; index++) {
    points.push([cdrCoordinate(bytes, cursor, version), cdrCoordinate(bytes, cursor + coordinateSize, version)])
    cursor += coordinateSize * 2
  }
  return cdrPathCommands(points, Array.from(bytes.slice(cursor, cursor + count)))
}

function cdrReadRectangle (bytes, offset, end, version) {
  const step = version < 600 ? 2 : 4
  if (offset + step * (version < 900 ? 3 : 6) > end) return []
  const width = cdrCoordinate(bytes, offset, version); const height = cdrCoordinate(bytes, offset + step, version)
  const radii = []
  let cursor = offset + step * 2
  const first = Math.max(0, cdrCoordinate(bytes, cursor, version)); cursor += step
  radii.push(first)
  for (let index = 0; index < 3; index++) radii.push(version < 900 ? first : Math.max(0, cdrCoordinate(bytes, cursor + index * step, version)))
  const radius = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Math.max(...radii, 0))
  if (!radius) return [{ kind: 'M', points: [[0, 0]] }, { kind: 'L', points: [[0, height]] }, { kind: 'L', points: [[width, height]] }, { kind: 'L', points: [[width, 0]] }, { kind: 'Z', points: [] }]
  const k = 0.5522847498
  return [
    { kind: 'M', points: [[radius, 0]] }, { kind: 'L', points: [[width - radius, 0]] },
    { kind: 'C', points: [[width - radius + radius * k, 0], [width, radius - radius * k], [width, radius]] },
    { kind: 'L', points: [[width, height - radius]] }, { kind: 'C', points: [[width, height - radius + radius * k], [width - radius + radius * k, height], [width - radius, height]] },
    { kind: 'L', points: [[radius, height]] }, { kind: 'C', points: [[radius - radius * k, height], [0, height - radius + radius * k], [0, height - radius]] },
    { kind: 'L', points: [[0, radius]] }, { kind: 'C', points: [[0, radius - radius * k], [radius - radius * k, 0], [radius, 0]] }, { kind: 'Z', points: [] }
  ]
}

function cdrReadEllipse (bytes, offset, end, version) {
  const step = version < 600 ? 2 : 4
  if (offset + step * 5 > end) return []
  const width = cdrCoordinate(bytes, offset, version); const height = cdrCoordinate(bytes, offset + step, version)
  const first = version < 600 ? cdrReadSigned16(bytes, offset + step * 2) / 1800 * Math.PI : cdrReadSigned32(bytes, offset + step * 2) / 180000000 * Math.PI
  let second = version < 600 ? cdrReadSigned16(bytes, offset + step * 3) / 1800 * Math.PI : cdrReadSigned32(bytes, offset + step * 3) / 180000000 * Math.PI
  const pie = version < 600 ? readUint16LE(bytes, offset + step * 4) : readUint32LE(bytes, offset + step * 4)
  if (Math.abs(second - first) < 1e-8) second = first + Math.PI * 2
  while (second < first) second += Math.PI * 2
  const segments = Math.max(8, Math.min(96, Math.ceil((second - first) / (Math.PI / 24))))
  const cx = width / 2; const cy = height / 2; const rx = Math.abs(cx); const ry = Math.abs(cy)
  const points = []
  for (let index = 0; index <= segments; index++) {
    const angle = first + (second - first) * index / segments
    points.push([cx + rx * Math.cos(angle), cy - ry * Math.sin(angle)])
  }
  const commands = [{ kind: 'M', points: [points[0]] }].concat(points.slice(1).map(point => ({ kind: 'L', points: [point] })))
  if (pie) commands.push({ kind: 'L', points: [[cx, cy]] })
  if (pie || second - first >= Math.PI * 2 - 1e-6) commands.push({ kind: 'Z', points: [] })
  return commands
}

function cdrTransformsForOwner (bytes, owner, version) {
  const transforms = []
  function visit (nodes) {
    for (const node of nodes) {
      if (node !== owner && node.id === 'LIST' && ['obj ', 'grp '].includes(node.listType)) continue
      if (node.id === 'trfd' && version >= 600 && node.size >= 16) {
        const start = node.dataStart
        const count = readUint32LE(bytes, start + 4)
        const offsetsStart = readUint32LE(bytes, start + 8)
        if (count <= 32 && offsetsStart + count * 4 <= node.size) {
          for (let index = 0; index < count; index++) {
            const local = readUint32LE(bytes, start + offsetsStart + index * 4)
            const offset = start + local
            if (local + 56 <= node.size && readUint16LE(bytes, offset) === 0x08) {
              transforms.push([
                cdrReadDoubleLE(bytes, offset + 8), cdrReadDoubleLE(bytes, offset + 16), cdrReadDoubleLE(bytes, offset + 24) / 254000,
                cdrReadDoubleLE(bytes, offset + 32), cdrReadDoubleLE(bytes, offset + 40), cdrReadDoubleLE(bytes, offset + 48) / 254000
              ])
            }
          }
        }
      }
      if (node.children && node.children.length) visit(node.children)
    }
  }
  visit(owner.children || [])
  return transforms
}

function cdrVectorPreview (bytes, nodes, version) {
  if (version < 600) return { svg: '', shapes: 0, paths: 0, points: 0, unsupported: 0 }
  const styles = cdrStyleTables(bytes, nodes, version)
  const shapes = []; let unsupported = 0; let pointCount = 0
  function visit (records, owner = null) {
    for (const node of records) {
      const nextOwner = node.id === 'LIST' && node.listType === 'obj ' ? node : owner
      if (node.id === 'loda') {
        const parsed = cdrLodaArguments(bytes, node, version)
        if (parsed) {
          const geometry = parsed.args.find(arg => arg.type === 0x1e)
          const fillArg = parsed.args.find(arg => arg.type === 0x14)
          const lineArg = parsed.args.find(arg => arg.type === 0x0a)
          let commands = []
          if (geometry) {
            if (parsed.chunkType === 0x01) commands = cdrReadRectangle(bytes, geometry.offset, node.dataEnd, version)
            else if (parsed.chunkType === 0x02) commands = cdrReadEllipse(bytes, geometry.offset, node.dataEnd, version)
            else if (parsed.chunkType === 0x03 || parsed.chunkType === 0x14) commands = cdrReadPointPath(bytes, geometry.offset, node.dataEnd, version, 'line')
            else if (parsed.chunkType === 0x25) commands = cdrReadPointPath(bytes, geometry.offset, node.dataEnd, version, 'path')
            else unsupported++
          }
          if (commands.length) {
            const fillId = fillArg && fillArg.offset + 4 <= node.dataEnd ? readUint32LE(bytes, fillArg.offset) : 0
            const lineId = lineArg && lineArg.offset + 4 <= node.dataEnd ? readUint32LE(bytes, lineArg.offset) : 0
            shapes.push({ commands, fill: styles.fills.get(fillId), line: styles.lines.get(lineId), transforms: nextOwner ? cdrTransformsForOwner(bytes, nextOwner, version) : [] })
          }
        }
      }
      if (node.children && node.children.length) visit(node.children, nextOwner)
    }
  }
  visit(nodes)
  if (!shapes.length) return { svg: '', shapes: 0, paths: 0, points: 0, unsupported }
  const projected = []
  function transformPoint (point, transforms) {
    let x = point[0]; let y = point[1]
    for (const matrix of transforms) {
      const nextX = matrix[0] * x + matrix[1] * y + matrix[2]
      y = matrix[3] * x + matrix[4] * y + matrix[5]
      x = nextX
    }
    return [x, -y]
  }
  const rendered = shapes.slice().reverse().map((shape, shapeIndex) => {
    let path = ''
    for (const command of shape.commands) {
      if (command.kind === 'Z') { path += 'Z'; continue }
      const points = command.points.map(point => transformPoint(point, shape.transforms))
      projected.push(...points); pointCount += points.length
      path += `${command.kind}${points.map(point => `${cdrSvgNumber(point[0])} ${cdrSvgNumber(point[1])}`).join(' ')}`
    }
    return { path, fill: shape.fill, stroke: cdrStrokeProperties(shape.line), shapeIndex }
  }).filter(shape => shape.path)
  if (!projected.length) return { svg: '', shapes: 0, paths: 0, points: 0, unsupported }
  let minX = Math.min(...projected.map(point => point[0])); let maxX = Math.max(...projected.map(point => point[0]))
  let minY = Math.min(...projected.map(point => point[1])); let maxY = Math.max(...projected.map(point => point[1]))
  const span = Math.max(maxX - minX, maxY - minY, 0.1)
  // Include visible outlines in fit bounds. SVG's default miter limit is four;
  // allowing two stroke widths avoids clipping its sharp joins and square caps.
  const maxStroke = Math.max(0, ...rendered.map(shape => shape.stroke.width))
  const pad = span * 0.06 + maxStroke * 2
  minX -= pad; maxX += pad; minY -= pad; maxY += pad
  const definitions = []; const paths = []
  for (const shape of rendered) {
    let fill = 'none'
    if (shape.fill && shape.fill.type === 'solid') fill = shape.fill.color
    else if (shape.fill && shape.fill.type === 'gradient' && shape.fill.stops.length) {
      const id = `cdr-gradient-${shape.shapeIndex}`
      definitions.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${shape.fill.stops.map(stop => `<stop offset="${stop.offset}%" stop-color="${stop.color}"/>`).join('')}</linearGradient>`)
      fill = `url(#${id})`
    }
    const line = shape.stroke
    const dash = line.dashes.length ? ` stroke-dasharray="${line.dashes.map(cdrSvgMeasure).join(' ')}"` : ''
    paths.push(`<path d="${shape.path}" fill="${fill}" fill-rule="evenodd" stroke="${line.color}" stroke-width="${cdrSvgMeasure(line.width)}" stroke-linecap="${line.caps}" stroke-linejoin="${line.join}"${dash}/>`)
  }
  const width = Math.max(0.1, maxX - minX); const height = Math.max(0.1, maxY - minY)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cdrSvgNumber(minX)} ${cdrSvgNumber(minY)} ${cdrSvgNumber(width)} ${cdrSvgNumber(height)}" preserveAspectRatio="xMidYMid meet" data-cdr-vectors="${rendered.length}"><rect x="${cdrSvgNumber(minX)}" y="${cdrSvgNumber(minY)}" width="${cdrSvgNumber(width)}" height="${cdrSvgNumber(height)}" fill="#fffdf8"/><defs>${definitions.join('')}</defs>${paths.join('')}</svg>`
  return { svg, shapes: rendered.length, paths: rendered.length, points: pointCount, unsupported }
}

function cdrSvgNumber (value) {
  return String(Math.round(value * 100000) / 100000)
}

function cdrSvgMeasure (value) {
  // Five decimal places erase valid 1/254000-inch hairlines. Preserve relative
  // precision without introducing an arbitrary minimum visual line width.
  return String(Number(value.toPrecision(12)))
}

function cdrStrokeProperties (line) {
  const hidden = !line || (line.type & 1)
  const styled = !hidden && (line.type & 6)
  const width = styled ? line.width * line.stretch : 0
  return {
    color: hidden ? 'none' : styled ? line.color : '#000000',
    width,
    caps: line && line.caps === 1 ? 'round' : line && line.caps === 2 ? 'square' : 'butt',
    join: line && line.join === 1 ? 'round' : line && line.join === 2 ? 'bevel' : 'miter',
    dashes: styled && (line.type & 4) && line.dashes.some(value => value > 0)
      ? line.dashes.map(value => value * width) : []
  }
}

function inspectCdrCompressedCanvas (bytes, ranges, version) {
  // Multiple cmpr lists remain live until drawing. Bound the document total,
  // not just each list, and reject before any output allocation is performed.
  let expectedGraphics = 0; let expectedLengths = 0
  for (const range of ranges || []) {
    if (range.start + 28 > range.end) throw new Error('CDR LIST cmpr 头部不完整')
    expectedGraphics += readUint32LE(bytes, range.start + 8)
    expectedLengths += readUint32LE(bytes, range.start + 16)
    if (expectedGraphics > MAX_CDR_GRAPHIC_BYTES || expectedLengths > MAX_CDR_LENGTH_BYTES) throw new Error('CDR 多压缩列表合计超过本机解压上限')
  }
  let records = 0; let compressedBytes = 0; const allNodes = []
  for (const range of ranges || []) {
    const decoded = decodeCdrCompressedList(bytes, range.start, range.end)
    compressedBytes += decoded.stream.length
    const parsed = parseCdrCompressedRecords(decoded.stream, decoded.lengths)
    records += parsed.count
    allNodes.push({ bytes: decoded.stream, nodes: parsed.nodes })
  }
  let best = { svg: '', shapes: 0, paths: 0, points: 0, unsupported: 0 }
  for (const item of allNodes) {
    const preview = cdrVectorPreview(item.bytes, item.nodes, version)
    if (preview.shapes > best.shapes) best = preview
  }
  return { ...best, records, compressedBytes }
}

function parseCdrRiffChunks (bytes, start, end, depth = 0, entries = [], state = {}) {
  let cursor = start
  while (cursor + 8 <= end && entries.length < 500) {
    const id = ascii(bytes, cursor, 4)
    const size = readUint32LE(bytes, cursor + 4)
    const dataStart = cursor + 8
    const dataEnd = dataStart + size
    if (!/^[\x20-\x7e]{4}$/.test(id) || dataEnd > end || dataEnd > bytes.length) break
    const listType = id === 'LIST' && size >= 4 ? ascii(bytes, dataStart, 4) : ''
    const label = cdrChunkLabel(id, listType)
    entries.push({
      name: id === 'LIST' ? `LIST ${listType || '????'}` : id,
      displayName: `${id === 'LIST' ? `LIST ${listType || '????'}` : id} · ${label}`,
      detail: `${formatBytes(size)}${id === 'LIST' && listType === 'cmpr' ? ' · zlib 压缩' : ''}`,
      depth,
      indentRpx: depth * 24,
      canOpen: false
    })
    state.chunkCount = (state.chunkCount || 0) + 1
    if (id === 'vrsn' && size >= 2) state.version = readUint16LE(bytes, dataStart)
    if (id === 'DISP' && !state.preview) {
      try { state.preview = decodeCdrDisp(bytes.slice(dataStart, dataEnd)) } catch (error) { state.previewError = error.message || String(error) }
    }
    if (id === 'LIST' && listType === 'cmpr') {
      state.compressedLists = (state.compressedLists || 0) + 1
      if (!state.compressedRanges) state.compressedRanges = []
      state.compressedRanges.push({ start: dataStart, end: dataEnd })
    }
    if (id === 'LIST' && listType && !['cmpr', 'stlt'].includes(listType) && dataStart + 4 < dataEnd && depth < 6) {
      parseCdrRiffChunks(bytes, dataStart + 4, dataEnd, depth + 1, entries, state)
    }
    cursor = dataEnd + (size & 1)
  }
  return { entries, state }
}

function inspectCdrZip (bytes) {
  const archive = inspectZip(bytes)
  let preview = null
  const imageCandidates = archive.entries
    .filter(entry => entry.canOpen && /(?:^|\/)(?:thumbnail|preview|previews?)[^/]*\.(?:png|jpe?g)$/i.test(entry.name))
    .sort((a, b) => a.uncompressedSize - b.uncompressedSize)
  for (const entry of imageCandidates) {
    if (entry.uncompressedSize > 10 * 1024 * 1024) continue
    try {
      preview = extractEmbeddedPreview(extractZipEntry(bytes, entry, { maxSize: 10 * 1024 * 1024 }))
      if (preview) break
    } catch (_) {}
  }
  const contentFiles = archive.entries.filter(entry => !entry.isDirectory).length
  return {
    ...archive,
    title: skinCopy.message('inspector.inspectCdrZip.title.c5edcf', {}, 'CorelDRAW 文档包'),
    summary: skinCopy.message('inspector.inspectCdrZip.summary.f66cd3', { value: contentFiles }, `已解开现代 CorelDRAW ZIP 容器并列出 ${contentFiles} 个内部文件；支持的预览图、PDF、XML 和其他条目可直接点开。`),
    metadata: [{ label: skinCopy.message('inspector.inspectCdrZip.label.d179a3', {}, '容器'), value: 'ZIP 文档包' }, { label: skinCopy.message('inspector.inspectCdrZip.label.916ba8', {}, '内部文件'), value: String(contentFiles) }].concat(archive.metadata || []),
    preview
  }
}

function inspectCdr (bytes) {
  if (readUint32LE(bytes, 0) === 0x04034b50) return inspectCdrZip(bytes)
  if (ascii(bytes, 0, 4) !== 'RIFF') throw new Error('CDR 文件缺少 RIFF 文件头')
  const form = ascii(bytes, 8, 4)
  const isCorelDraw = /^CDR/i.test(form)
  const isCorelRave = form === 'CARA'
  if (!isCorelDraw && !isCorelRave) throw new Error('RIFF 文件不是可识别的 CorelDRAW / Corel R.A.V.E. 文档')
  const declared = readUint32LE(bytes, 4) + 8
  const parsed = parseCdrRiffChunks(bytes, 12, Math.min(bytes.length, declared))
  const preview = parsed.state.preview || extractEmbeddedPreview(bytes)
  const version = parsed.state.version || cdrVersionFromForm(form)
  let vector = null
  if (parsed.state.compressedRanges && parsed.state.compressedRanges.length) {
    try { vector = inspectCdrCompressedCanvas(bytes, parsed.state.compressedRanges, version) } catch (error) { parsed.state.vectorError = error.message || String(error) }
  }
  const hasVector = Boolean(vector && vector.svg && vector.shapes)
  return {
    title: isCorelRave ? 'Corel R.A.V.E. / CDR 文件' : 'CorelDRAW 文件',
    summary: hasVector
      ? `已在本机解开 LIST cmpr，并从 loda / trfd 记录还原 ${vector.shapes} 个基础矢量对象；${preview ? '文件内缩略图仅作为回退，不再代替正文画布。' : '即使文件没有 DISP 缩略图，也会显示真实矢量内容。'}`
      : preview
        ? parsed.state.vectorError
          ? `矢量正文未能还原：${parsed.state.vectorError}。当前仅显示独立内嵌缩略图（${preview.source === 'DISP' ? 'DISP 画布缩略图' : 'JPEG/PNG 预览'}），不代表完整正文。`
          : `已解析 CorelDRAW RIFF 块目录并还原文件内的 ${preview.source === 'DISP' ? 'DISP 画布缩略图' : 'JPEG/PNG 预览'}。`
        : `已解析 CorelDRAW RIFF 块目录，但没有得到可显示的基础矢量或缩略图${parsed.state.vectorError ? `：${parsed.state.vectorError}` : '。'}。`,
    metadata: [
      { label: skinCopy.message('inspector.inspectCdr.label.8760b0', {}, '容器标识'), value: form },
      ...(isCorelRave ? [{ label: skinCopy.message('inspector.inspectCdr.label.21bc3f', {}, '文档类型'), value: 'Corel R.A.V.E. 动画（.cdr）' }] : []),
      { label: skinCopy.message('inspector.inspectCdr.label.38af4d', {}, '文档版本'), value: version ? String(version) : '未声明' },
      { label: skinCopy.message('inspector.inspectCdr.label.452c01', {}, 'RIFF 块'), value: String(parsed.state.chunkCount || 0) },
      { label: skinCopy.message('inspector.inspectCdr.label.d8ade2', {}, '压缩数据列表'), value: String(parsed.state.compressedLists || 0) },
      ...(vector ? [
        { label: skinCopy.message('inspector.inspectCdr.label.e57bd8', {}, '压缩内部记录'), value: String(vector.records || 0) },
        { label: skinCopy.message('inspector.inspectCdr.label.e34569', {}, '基础矢量对象'), value: String(vector.shapes || 0) },
        { label: skinCopy.message('inspector.inspectCdr.label.762b56', {}, '矢量控制点'), value: String(vector.points || 0) },
        ...(vector.unsupported ? [{ label: skinCopy.message('inspector.inspectCdr.label.4608b4', {}, '未还原对象'), value: String(vector.unsupported) }] : [])
      ] : []),
      { label: skinCopy.message('inspector.inspectCdr.label.0ec001', {}, '声明大小'), value: formatBytes(declared) },
      ...(preview && preview.width ? [{ label: skinCopy.message('inspector.inspectCdr.label.3e7af5', {}, '画布预览'), value: `${preview.width} × ${preview.height} px` }] : [])
    ],
    entries: parsed.entries,
    preview,
    previewSvg: hasVector ? vector.svg : ''
  }
}

function inspectBinary (bytes, file = {}) {
  return {
    title: skinCopy.message('inspector.inspectBinary.title.d130dc', {}, '二进制文件信息'),
    summary: skinCopy.message('inspector.inspectBinary.summary.44afdf', {}, '已在本机读取文件头并生成校验值，可用于确认文件完整性和真实类型。'),
    metadata: [
      { label: skinCopy.message('inspector.inspectBinary.label.0dd3e5', {}, 'MIME 类型'), value: file.type || '未提供' },
      { label: skinCopy.message('inspector.inspectBinary.label.2ad8b0', {}, '文件大小'), value: formatBytes(file.size || bytes.length) },
      { label: skinCopy.message('inspector.inspectBinary.label.7bf0e3', {}, '文件头'), value: hexHead(bytes) || '空文件' },
      { label: 'FNV-1a', value: fnv1a32(bytes) }
    ],
    entries: []
  }
}

function inspectFileBytes (input, file = {}) {
  const bytes = toUint8(input)
  const extension = extensionOf(file.name)
  const type = mimeTypeOf(file)
  let result
  if (extension === 'zip' || type === 'application/zip') result = inspectZip(bytes)
  else if (extension === 'rar' || type === 'application/vnd.rar') result = inspectRar(bytes)
  else if (extension === '7z' || type === 'application/x-7z-compressed') result = inspect7z(bytes)
  else if (extension === 'dxf' || type === 'application/dxf') result = inspectDxf(bytes)
  else if (extension === 'stp' || extension === 'step' || type === 'application/step') result = inspectStep(bytes)
  else if (extension === 'dwg' || type === 'application/acad') result = inspectDwg(bytes)
  else if (extension === 'cdr' || type === 'application/x-cdr') result = inspectCdr(bytes)
  else result = inspectBinary(bytes, file)
  const preview = result.preview || (['dwg', 'cdr'].includes(extension) || ['application/acad', 'application/x-cdr'].includes(type) ? extractEmbeddedPreview(bytes) : null)
  return {
    ...result,
    preview,
    metadata: [{ label: skinCopy.message('inspector.inspectFileBytes.label.49deaf', {}, '文件'), value: file.name || '未命名文件' }, { label: skinCopy.message('inspector.inspectFileBytes.label.fad68f', {}, '实际读取'), value: formatBytes(bytes.length) }].concat(result.metadata || [])
  }
}

module.exports = {
  buildArchiveTree,
  decodeUtf8,
  extractArchiveEntry,
  extractZipEntry,
  extractZipEntryPayload,
  extractEmbeddedPreview,
  fnv1a32,
  inspectFileBytes,
  inspectZip,
  inspectZipCentral,
  MAX_ZIP_RECOVERY_BYTES,
  recoverZipDirectory,
  readZip64DirectoryDescriptor,
  readZipDirectoryDescriptor,
  rtfToText,
  rtfToHtml,
  toUint8,
  zipLocalHeaderLength,
  zipEntryDataOffset
}
