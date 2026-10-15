'use strict'

// 7z 内核（Emscripten 生成的 7zz.js + 7zz.wasm.br + 原生目录回调）留在 file-reader/sevenzip 分包里，
// 这里只是引擎侧的封装：解析、成员选择、链接解析都在引擎分包内完成，
// 内核本身通过 subpackage-loader 按需加载，主包与引擎分包都不背这 600 多 KB。
const { annotateArchiveMembers, verifyArchiveMember } = require('./kernel').archiveMembers
const { inspectZipCentral } = require('./kernel').fileInspector
const { MAX_LINK_BYTES, linkText, packagePath } = require('./rar-links')
const { mergeZipEngineInspection } = require('./zip-engine-bridge')
const { resolveSevenZipLink } = require('./sevenzip-links')
const { resolveZipLink } = require('./zip-links')
const subpackage = require('./kernel').subpackageLoader

const { modulePath } = require('./kernel').moduleRoot

const SEVEN_ZIP_WASM_FILE = 'sevenzip/runtime/7zz.wasm.br'
const DEFAULT_TIMEOUT_MS = 20000
const MAX_SOLID_DECODE_BYTES = 80 * 1024 * 1024
let enginePromise = null
let createNativeListing = null
let outputSink = null
let memberSelectionInput = null
let operationId = 0
let lastWxInstantiationError = ''
let crc32Table = null

function toUint8 (input) {
  if (input instanceof Uint8Array) return input
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('7z 解压需要 ArrayBuffer 或 Uint8Array')
}

function exactArrayBuffer (input) {
  const bytes = toUint8(input)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function cleanOutput (value) {
  // Path values may end in spaces. Console cleanup must not rename members.
  return String(value == null ? '' : value).replace(/[\b\r]/g, '')
}

function captureOutput (value) {
  if (outputSink) outputSink.stdout.push(cleanOutput(value))
}

function captureError (value) {
  if (outputSink) outputSink.stderr.push(cleanOutput(value))
}

function formatBytes (value) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function wxInstantiateWasm (imports, receiveInstance) {
  lastWxInstantiationError = ''
  try {
    Promise.resolve(WXWebAssembly.instantiate(modulePath(SEVEN_ZIP_WASM_FILE), imports))
      .then(result => receiveInstance(result.instance || result, result.module))
      .catch(error => { lastWxInstantiationError = error && (error.stack || error.errMsg || error.message) || String(error) })
  } catch (error) {
    lastWxInstantiationError = error && (error.stack || error.errMsg || error.message) || String(error)
  }
}

function withTimeout (promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('7z 解压内核启动超时')), timeoutMs)
  })
  return Promise.race([promise, timeout]).then(value => {
    clearTimeout(timer)
    return value
  }, error => {
    clearTimeout(timer)
    throw error
  })
}

async function createEngine (options = {}) {
  const moduleOptions = {
    print: captureOutput,
    printErr: captureError,
    rabbitOnListing: (phase, count) => { if (outputSink && outputSink.listing) outputSink.listing.boundary(phase, count) },
    rabbitOnEntry: (index, name, directory) => { if (outputSink && outputSink.listing) outputSink.listing.entry(index, name, directory) },
    rabbitOnField: (index, key, value) => { if (outputSink && outputSink.listing) outputSink.listing.field(index, key, value) },
    rabbitShouldExtract: index => !outputSink || !outputSink.binary || index === outputSink.binary.index,
    rabbitWriteBytes: bytes => {
      const sink = outputSink && outputSink.binary
      if (!sink) return 0
      if (bytes.length > sink.limit - sink.length) {
        sink.overflow = true
        return -1
      }
      sink.chunks.push(new Uint8Array(bytes))
      sink.length += bytes.length
      return 1
    },
    stdin: () => memberSelectionInput && memberSelectionInput.position < memberSelectionInput.answers.length
      ? memberSelectionInput.answers.charCodeAt(memberSelectionInput.position++) : null
  }
  if (options.wasmBinary) moduleOptions.wasmBinary = exactArrayBuffer(options.wasmBinary)
  else if (typeof WXWebAssembly === 'object' && WXWebAssembly && typeof WXWebAssembly.instantiate === 'function') moduleOptions.instantiateWasm = wxInstantiateWasm
  else throw new Error('当前运行环境没有可用的 7z WebAssembly 内核')
  const [SevenZip, nativeListing] = await Promise.all([
    subpackage.load('../../sevenzip/runtime/7zz.js', ' 7z '),
    subpackage.load('../../sevenzip/runtime/native-listing.js', ' 7z ')
  ])
  createNativeListing = nativeListing.createNativeListing
  try {
    const engine = await withTimeout(SevenZip(moduleOptions), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
    if (typeof engine._rabbit_reader_listing_version !== 'function' || engine._rabbit_reader_listing_version() !== 3) throw new Error('7z 原生目录内核版本不匹配，请更新阅读器')
    return engine
  } catch (error) {
    if (/启动超时/.test(error && error.message) && lastWxInstantiationError) throw new Error(`7z 解压内核启动失败：${lastWxInstantiationError}`)
    throw error
  }
}

function getEngine (options = {}) {
  if (!enginePromise) enginePromise = createEngine(options).catch(error => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

function invoke (engine, args, listing = null, context = {}) {
  const streams = { stdout: [], stderr: [], listing, binary: context.binary }
  outputSink = streams
  let code
  let thrown
  try {
    code = engine.callMain(args.slice())
  } catch (error) {
    thrown = error
  } finally {
    outputSink = null
  }
  // Blank lines delimit entries in `7z l -slt`; removing them merges all
  // Path/Size/Method fields and silently keeps only the final archive member.
  const output = streams.stdout.join('\n')
  const exitCode = Number(code)
  // Member names and comments are untrusted data, not status messages. Only
  // the actual command result/exception decides whether an operation failed.
  if (thrown != null || !Number.isInteger(exitCode) || exitCode !== 0) {
    // Even a missing-password listing can leave native stdin at EOF. A later
    // overwrite selection must not inherit that failed command's stdio state.
    enginePromise = null
    if (context.binary && context.binary.overflow) throw new Error(context.binary.limitMessage || '7z 链接数据超过长度上限')
    const passwordProvided = args.some(argument => /^-p.+/.test(argument))
    const passwordPrompt = streams.stdout.some(line => /^Enter password(?: \(will not be echoed\))?:\s*$/i.test(line))
    const diagnostics = streams.stderr.filter(line => line.trim()).slice(-6).join('；')
    const passwordVerified = Boolean(context.passwordVerified && passwordProvided)
    const packedDataFailure = passwordVerified && context.operation === 'extract' && /CRC Failed|Data Error|Unexpected end of (?:data|archive)/i.test(diagnostics)
    const failure = passwordPrompt
      ? 'password-required'
      : packedDataFailure
        ? 'data-corrupt'
        : passwordVerified ? 'command-failed' : passwordProvided ? 'password-or-corrupt' : 'command-failed'
    const message = passwordPrompt
      ? '压缩包需要密码'
      : packedDataFailure
        ? '压缩包文件数据校验失败，文件可能已损坏'
        : passwordVerified
          ? '压缩包文件解压失败；目录密码已经验证，文件可能损坏或压缩方式不受支持'
          : passwordProvided ? '密码不正确或压缩包损坏' : diagnostics || (thrown && typeof thrown.message === 'string' ? thrown.message : `7z 命令失败（退出码 ${Number.isInteger(exitCode) ? exitCode : '未知'}）`)
    const error = new Error(message)
    error.archiveFailure = failure
    if (packedDataFailure) error.archiveIntegrity = 'packed-data'
    if (Number.isInteger(exitCode)) error.exitCode = exitCode
    throw error
  }
  return output
}

function parseFields (source) {
  const fields = Object.create(null)
  for (const line of String(source || '').split('\n')) {
    const match = line.match(/^([^=]+?) = (.*)$/)
    if (match) {
      const key = match[1].trim()
      fields[key] = ['Path', 'Symbolic Link', 'Hard Link', 'Copy Link'].includes(key) ? match[2] : match[2].trim()
    }
  }
  return fields
}

function safeArchivePath (value) {
  const normalized = String(value || '').replace(/\\/g, '/')
  return Boolean(normalized) && !normalized.startsWith('/') && !/^[a-z]:/i.test(normalized) && !normalized.includes('\0') && !normalized.split('/').includes('..')
}

function zipUint16 (bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function zipUint32 (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function zipUint64 (bytes, offset) {
  const value = zipUint32(bytes, offset) + zipUint32(bytes, offset + 4) * 0x100000000
  if (!Number.isSafeInteger(value)) throw new Error('ZIP64 成员位置超过本机安全范围')
  return value
}

function zipWriteUint32 (bytes, offset, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('ZIP 成员位置超过可写范围')
  for (let shift = 0; shift < 4; shift++) bytes[offset + shift] = value >>> (shift * 8) & 255
}

function zipWriteUint64 (bytes, offset, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('ZIP64 成员位置超过可写范围')
  zipWriteUint32(bytes, offset, value % 0x100000000)
  zipWriteUint32(bytes, offset + 4, Math.floor(value / 0x100000000))
}

function findZipEocd (bytes) {
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (zipUint32(bytes, offset) === 0x06054b50 && offset + 22 + zipUint16(bytes, offset + 20) === bytes.length) return offset
  }
  throw new Error('ZIP 结束记录不完整')
}

function zipDirectoryDescriptor (bytes, eocd) {
  const disk = zipUint16(bytes, eocd + 4)
  const centralDisk = zipUint16(bytes, eocd + 6)
  let count = zipUint16(bytes, eocd + 10)
  let centralSize = zipUint32(bytes, eocd + 12)
  let centralOffset = zipUint32(bytes, eocd + 16)
  let centralEnd = eocd
  if (count !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff) {
    if (disk || centralDisk) throw new Error('分卷 ZIP 不能作为单文件按序号隔离')
    if (zipUint16(bytes, eocd + 8) !== count) throw new Error('ZIP 目录项数量不一致')
    return { count, centralSize, centralOffset, centralEnd, zip64: false }
  }
  const locator = eocd - 20
  if (locator < 0 || zipUint32(bytes, locator) !== 0x07064b50) throw new Error('ZIP64 定位器缺失')
  if (zipUint32(bytes, locator + 4) || zipUint32(bytes, locator + 16) !== 1) throw new Error('分卷 ZIP64 不能作为单文件按序号隔离')
  const record = zipUint64(bytes, locator + 8)
  if (record + 56 > locator || zipUint32(bytes, record) !== 0x06064b50 || zipUint64(bytes, record + 4) < 44) throw new Error('ZIP64 结束记录不完整')
  if (zipUint32(bytes, record + 16) || zipUint32(bytes, record + 20)) throw new Error('分卷 ZIP64 不能作为单文件按序号隔离')
  const diskCount = zipUint64(bytes, record + 24)
  count = zipUint64(bytes, record + 32)
  centralSize = zipUint64(bytes, record + 40)
  centralOffset = zipUint64(bytes, record + 48)
  if (diskCount !== count) throw new Error('ZIP64 目录项数量不一致')
  centralEnd = record
  return { count, centralSize, centralOffset, centralEnd, zip64: true }
}

function zipCentralLocation (bytes, record, extraStart, extraLength) {
  let localOffset = zipUint32(bytes, record + 42)
  let disk = zipUint16(bytes, record + 34)
  let localOffsetAt = -1
  let diskAt = -1
  if (localOffset !== 0xffffffff && disk !== 0xffff) return { localOffset, disk, localOffsetAt, diskAt }
  let cursor = extraStart
  const end = extraStart + extraLength
  while (cursor + 4 <= end) {
    const id = zipUint16(bytes, cursor)
    const size = zipUint16(bytes, cursor + 2)
    const data = cursor + 4
    if (data + size > end) break
    if (id === 0x0001) {
      let at = data
      if (zipUint32(bytes, record + 24) === 0xffffffff) {
        if (at + 8 > data + size) break
        at += 8
      }
      if (zipUint32(bytes, record + 20) === 0xffffffff) {
        if (at + 8 > data + size) break
        at += 8
      }
      if (localOffset === 0xffffffff) {
        if (at + 8 > data + size) break
        localOffsetAt = at
        localOffset = zipUint64(bytes, at)
        at += 8
      }
      if (disk === 0xffff) {
        if (at + 4 > data + size) break
        diskAt = at
        disk = zipUint32(bytes, at)
      }
      return { localOffset, disk, localOffsetAt, diskAt }
    }
    cursor = data + size
  }
  throw new Error('ZIP64 成员缺少本地头或磁盘位置')
}

function zip64LocalOffset (bytes, record, extraStart, extraLength) {
  return zipCentralLocation(bytes, record, extraStart, extraLength).localOffset
}

// A native ZIP decoder can decode an unmarked legacy filename differently
// from the central-directory decoder. Rebuild a byte-for-byte one-member ZIP
// so extraction no longer needs any decoded filename as its selector. The
// compressed/encrypted payload and all method-specific extras remain intact.
function isolateZipMember (input, memberIndex, options = {}) {
  const bytes = toUint8(input)
  const eocd = findZipEocd(bytes)
  const { count, centralSize, centralOffset, centralEnd } = zipDirectoryDescriptor(bytes, eocd)
  if (centralOffset + centralSize !== centralEnd) throw new Error('ZIP 中央目录边界不一致')
  if (!Number.isInteger(memberIndex) || memberIndex < 0 || memberIndex >= count) throw new Error('ZIP 成员序号无效')
  const records = []
  let cursor = centralOffset
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralEnd || zipUint32(bytes, cursor) !== 0x02014b50) throw new Error('ZIP 中央目录记录不完整')
    const nameLength = zipUint16(bytes, cursor + 28)
    const extraLength = zipUint16(bytes, cursor + 30)
    const commentLength = zipUint16(bytes, cursor + 32)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    if (end > centralEnd) throw new Error('ZIP 中央目录成员范围无效')
    records.push({ start: cursor, end, localOffset: zip64LocalOffset(bytes, cursor, cursor + 46 + nameLength, extraLength) })
    cursor = end
  }
  if (cursor !== centralEnd) throw new Error('ZIP 中央目录大小与成员记录不一致')
  const selected = records[memberIndex]
  if (selected.localOffset + 30 > centralOffset || zipUint32(bytes, selected.localOffset) !== 0x04034b50) throw new Error('ZIP 成员本地头无效')
  const nextLocalOffset = records.map(record => record.localOffset).filter(offset => offset > selected.localOffset).sort((a, b) => a - b)[0] || centralOffset
  if (nextLocalOffset > centralOffset || nextLocalOffset <= selected.localOffset) throw new Error('ZIP 成员数据范围无效')
  // Buffer.slice() aliases source memory in Node, and some WeChat views have
  // the same behavior. Isolation must never rewrite the user's archive when
  // central offsets or link attributes are adjusted in the private copy.
  const localRecord = new Uint8Array(bytes.subarray(selected.localOffset, nextLocalOffset))
  const centralRecord = new Uint8Array(bytes.subarray(selected.start, selected.end))
  if (options.linkPayloadAsFile) {
    // Decode the compressed link payload as ordinary bytes in the isolated
    // in-memory copy. This prevents 7-Zip from creating/following a link while
    // preserving the original method, CRC, size and payload for verification.
    centralRecord[5] = 0
    centralRecord[38] = 0
    centralRecord[39] = 0
    centralRecord[40] = 0
    centralRecord[41] = 0
  }
  centralRecord[34] = 0
  centralRecord[35] = 0
  centralRecord[42] = 0
  centralRecord[43] = 0
  centralRecord[44] = 0
  centralRecord[45] = 0
  const result = new Uint8Array(localRecord.length + centralRecord.length + 22)
  result.set(localRecord, 0)
  result.set(centralRecord, localRecord.length)
  const end = localRecord.length + centralRecord.length
  result.set([0x50, 0x4b, 0x05, 0x06], end)
  result[end + 8] = 1
  result[end + 10] = 1
  const write32 = (offset, value) => {
    for (let shift = 0; shift < 4; shift++) result[offset + shift] = value >>> (8 * shift) & 255
  }
  write32(end + 12, centralRecord.length)
  write32(end + 16, localRecord.length)
  return result
}

function listingSections (output) {
  const source = String(output || '')
  // Only the first standalone separator divides archive metadata from members.
  // A Path value containing the same characters is ordinary filename data.
  const marker = /^----------\r?$/m.exec(source)
  if (!marker) throw new Error('7z 没有返回可解析的目录清单')
  return { header: source.slice(0, marker.index), members: source.slice(marker.index + marker[0].length) }
}

function parseListing (output, maxEntrySize, passwordAvailable = false, archiveType = '7z-engine') {
  // Legacy parser retained for callers/tests of technical text, not extraction.
  const rows = listingSections(output).members.split(/\n\s*\n/).map(parseFields)
    .filter(fields => fields.Path).map((fields, index) => ({ fields, index, directory: /^D/.test(fields.Attributes || '') || fields.Path.endsWith('/') }))
  return entriesFromRows(rows, maxEntrySize, passwordAvailable, archiveType)
}

function entriesFromRows (rows, maxEntrySize, passwordAvailable, archiveType, options = {}) {
  const pathSeparator = options.pathSeparator || (archiveType === 'zip-engine' ? 'both' : 'slash')
  const maxSolidDecodeBytes = Number(options.maxSolidDecodeBytes || MAX_SOLID_DECODE_BYTES)
  const trackSolidBlocks = options.trackSolidBlocks == null ? archiveType === '7z-engine' : Boolean(options.trackSolidBlocks)
  const entries = []
  let solidDecodeSize = 0
  for (const row of rows) {
    const fields = row.fields
    // Native callbacks are the member identity. A backslash is a legal,
    // literal filename character in 7z archives created on Unix/WASM; turning
    // it into '/' changes both the visible path and the extraction selector.
    // ZIP keeps the historical dual-separator display through pathSeparator.
    const name = fields.Path
    const directory = row.directory
    const encrypted = fields.Encrypted === '+'
    const size = Number(fields.Size || 0)
    if (!trackSolidBlocks || fields['Packed Size'] !== '') solidDecodeSize = 0
    if (!directory && size > 0) solidDecodeSize += size
    const entryDecodeSize = !directory && size > 0 ? solidDecodeSize : 0
    const solidLimitExceeded = trackSolidBlocks && entryDecodeSize > maxSolidDecodeBytes
    const safe = safeArchivePath(name)
    const method = fields.Method || ''
    const unsupportedZipMethod = archiveType === 'zip-engine' && /^\d+$/.test(method)
    const linkKey = ['Symbolic Link', 'Hard Link', 'Copy Link'].find(key => Boolean(fields[key]))
    const unixMode = fields.AttributesRaw ? Number(fields.AttributesRaw) >>> 16 : Number(fields.PosixAttributesRaw || 0)
    const unixLink = Boolean(options.detectUnixLinks) && (unixMode & 0xf000) === 0xa000
    const tar = archiveType === 'tar-engine'
    const tarSymlink = tar && (unixMode & 0xf000) === 0xa000
    // Pinned TarHandler starts Characteristics with the raw type flag. It
    // suppresses the Hard Link property when its target is empty, so the
    // type flag is necessary to distinguish a malformed link from an empty file.
    const tarHardLink = tar && /^1(?: |$)/.test(fields.Characteristics || '')
    const tarMissingTarget = (tarSymlink || tarHardLink) && !linkKey
    const unsupportedTarType = tar && ![0x8000, 0x4000, 0xa000].includes(unixMode & 0xf000)
    entries.push({
      ...(unixLink && !linkKey ? { isLink: true, linkType: 1, linkTargetInData: true } : {}),
      ...(tarMissingTarget ? { isLink: true, linkType: tarHardLink ? 4 : 1, linkTarget: '' } : {}),
      ...(linkKey ? { isLink: true, linkTarget: fields[linkKey], linkType: linkKey === 'Hard Link' ? 4 : linkKey === 'Copy Link' ? 5 : 1 } : {}),
      ...(tar ? { posixMode: unixMode, unsupportedType: unsupportedTarType } : {}),
      id: entries.length,
      memberIndex: row.index,
      archiveType,
      pathSeparator,
      ...(trackSolidBlocks && entryDecodeSize > size ? { solidDecodeSize: entryDecodeSize } : {}),
      name,
      detail: `${directory ? '文件夹' : formatBytes(size)}${unixLink || tarSymlink || tarHardLink || linkKey ? ' · 链接' : ''} · ${method || (tar ? 'TAR 归档' : '7z 压缩')}${encrypted ? ' · 已加密' : ''}${tarMissingTarget ? ' · 链接目标为空，无法打开' : ''}${unsupportedTarType ? ' · 特殊系统条目，无法作为文件阅读' : ''}${unsupportedZipMethod ? ' · 当前内核不支持此方法' : ''}${!safe ? ' · 路径不安全' : ''}${!directory && size > maxEntrySize ? ' · 超过打开上限' : ''}${solidLimitExceeded && size <= maxEntrySize ? ` · 固实块需解码 ${formatBytes(entryDecodeSize)}，超过安全上限` : ''}`,
      isDirectory: directory,
      canOpen: (Boolean(linkKey) || unixLink || tarSymlink || !directory) && (!encrypted || passwordAvailable) && !unsupportedZipMethod && !unsupportedTarType && !tarMissingTarget && safe && size <= maxEntrySize && !solidLimitExceeded,
      encrypted,
      compressedSize: Number(fields['Packed Size'] || 0),
      uncompressedSize: size,
      method,
      crc: fields.CRC || ''
    })
  }
  return annotateArchiveMembers(entries)
}

function readNativeListing (engine, args, maxEntrySize, passwordAvailable, archiveType, options) {
  if (typeof createNativeListing !== 'function') throw new Error('7z 内核尚未加载')
  const listing = createNativeListing()
  const output = invoke(engine, args, listing)
  try {
    return { output, entries: entriesFromRows(listing.finish(), maxEntrySize, passwordAvailable, archiveType, options) }
  } catch (error) {
    enginePromise = null
    throw error
  }
}

function extractSelectedBytes (engine, archivePath, entry, options, maxSize) {
  if (!Number.isInteger(entry.memberIndex) || entry.memberIndex < 0) throw new Error('压缩包成员标识无效')
  const tar = options.archiveExtension === '.tar'
  const binary = { index: entry.memberIndex, limit: maxSize, length: 0, chunks: [], ...(tar ? { limitMessage: 'TAR 成员实际数据超过打开上限' } : {}) }
  const args = ['x', archivePath, '-so', '-spd', '-y']
  if (tar) args.push('-ttar')
  if (options.password) args.push(`-p${String(options.password)}`)
  args.push('--', String(entry.nativeName || entry.name))
  invoke(engine, args, null, { operation: 'extract', passwordVerified: Boolean(options.passwordVerified), binary })
  const bytes = new Uint8Array(binary.length)
  let offset = 0
  for (const chunk of binary.chunks) { bytes.set(chunk, offset); offset += chunk.length }
  verifyArchiveMember(bytes, entry, binary.limit)
  return bytes
}

function extractSelectedMember (engine, archivePath, outputRoot, entry, options, maxSize) {
  if (options.archiveExtension === '.tar') return extractSelectedBytes(engine, archivePath, entry, options, maxSize)
  if (options.readLinkTarget && entry.linkTargetInData && options.archiveExtension !== '.zip') return extractSelectedBytes(engine, archivePath, entry, options, Math.min(maxSize, MAX_LINK_BYTES))
  const selectedName = String(entry.nativeName || entry.name || '')
  const duplicateCount = Number.isInteger(entry.nativeDuplicateCount) ? entry.nativeDuplicateCount : entry.duplicateCount
  const duplicateIndex = Number.isInteger(entry.nativeDuplicateIndex) ? entry.nativeDuplicateIndex : entry.duplicateIndex
  const isolated = Boolean(options.isolatedZipMember)
  const duplicate = !isolated && duplicateCount > 1
  const args = ['x', archivePath, `-o${outputRoot}`, '-spd']
  if (duplicate) {
    if (!Number.isInteger(duplicateCount) || !Number.isInteger(duplicateIndex) || duplicateIndex < 0 || duplicateIndex >= duplicateCount) throw new Error('压缩包成员标识无效，请重新打开')
    let directory = outputRoot
    for (const part of selectedName.split('/').slice(0, -1).filter(Boolean)) {
      directory += `/${part}`
      try { engine.FS.mkdir(directory) } catch (_) {}
    }
    // Every same-name occurrence meets an existing file. Native overwrite
    // selection skips N occurrences before decoding/output and writes only Y.
    // Answers come from member order, never from filenames or prompt text.
    engine.FS.writeFile(`${outputRoot}/${selectedName}`, new Uint8Array())
    memberSelectionInput = { answers: Array.from({ length: duplicateCount }, (_, index) => index === duplicateIndex ? 'y\n' : 'n\n').join(''), position: 0 }
  } else args.push('-y')
  if (options.password) args.push(`-p${String(options.password)}`)
  if (!isolated) args.push('--', selectedName)
  try {
    invoke(engine, args, null, { operation: 'extract', passwordVerified: Boolean(options.passwordVerified) })
    const output = options.isolatedZipMember
      ? readOnlyExtractedFile(engine.FS, outputRoot)
      : toUint8(engine.FS.readFile(`${outputRoot}/${selectedName}`))
    verifyArchiveMember(output, entry, maxSize)
    return new Uint8Array(output)
  } catch (error) {
    // A failed native command can leave buffered overwrite answers. Do not
    // reuse its stdio state for another file/password attempt.
    if (duplicate) enginePromise = null
    throw error
  } finally {
    memberSelectionInput = null
  }
}

function readOnlyExtractedFile (FS, root) {
  const files = []
  let visited = 0
  const walk = directory => {
    for (const name of FS.readdir(directory)) {
      if (name === '.' || name === '..') continue
      if (++visited > 100) throw new Error('ZIP 单成员解压产生了异常数量的路径')
      const target = `${directory}/${name}`
      const stat = typeof FS.lstat === 'function' ? FS.lstat(target) : FS.stat(target)
      if (typeof FS.isLink === 'function' && FS.isLink(stat.mode)) throw new Error('ZIP 单成员解压结果是链接，已拒绝打开')
      if (FS.isDir(stat.mode)) walk(target)
      else if (FS.isFile(stat.mode)) files.push(target)
      else throw new Error('ZIP 单成员解压结果类型不受支持')
    }
  }
  walk(root)
  if (files.length !== 1) throw new Error(`ZIP 单成员解压结果数量异常：${files.length}`)
  return toUint8(FS.readFile(files[0]))
}

function uniquePath (prefix, extension = '') {
  operationId += 1
  return `/${prefix}-${operationId}${extension}`
}

function safeVolumeName (value) {
  const name = String(value || '')
  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') throw new Error('压缩分卷文件名不安全')
  return name
}

function normalizeArchiveVolumes (volumes, mainName) {
  if (!Array.isArray(volumes) || !volumes.length) throw new Error('没有可读取的压缩分卷')
  const normalized = volumes.map(volume => ({ name: safeVolumeName(volume && volume.name), bytes: toUint8(volume && volume.bytes) }))
  const names = new Set(normalized.map(volume => volume.name))
  if (names.size !== normalized.length) throw new Error('压缩分卷文件名重复')
  const selectedMain = safeVolumeName(mainName)
  if (!names.has(selectedMain)) throw new Error(`缺少主分卷：${selectedMain}`)
  return { volumes: normalized, mainName: selectedMain }
}

function archiveIntegrityError (message, kind) {
  const error = new Error(message)
  error.archiveFailure = 'command-failed'
  error.archiveIntegrity = kind
  return error
}

function numeric7zVolumeView (prepared) {
  const main = String(prepared && prepared.mainName || '').match(/^(.*\.7z)\.(\d{3,})$/i)
  if (!main || Number(main[2]) !== 1) return null
  const prefix = main[1].toLowerCase()
  const numbered = prepared.volumes.map(volume => {
    const match = volume.name.match(/^(.*\.7z)\.(\d{3,})$/i)
    const number = match ? Number(match[2]) : NaN
    if (!match || match[1].toLowerCase() !== prefix) throw archiveIntegrityError('7z 数字分卷名称不属于同一组', 'volume-name')
    if (!Number.isSafeInteger(number) || number < 1) throw archiveIntegrityError('7z 数字分卷序号无效', 'volume-number')
    return { ...volume, number }
  }).sort((left, right) => left.number - right.number)
  let total = 0
  for (let index = 0; index < numbered.length; index++) {
    if (numbered[index].number !== index + 1) throw archiveIntegrityError(`7z 数字分卷缺少第 ${index + 1} 卷`, 'missing-volume')
    total += numbered[index].bytes.length
    if (!Number.isSafeInteger(total)) throw archiveIntegrityError('7z 分卷合计大小超过本机安全范围', 'unsafe-size')
  }
  return { numbered, total }
}

function volumeByteAt (view, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= view.total) throw archiveIntegrityError('7z 分卷数据不完整：末卷缺失或已截断', 'truncated-volume')
  let cursor = offset
  for (const volume of view.numbered) {
    if (cursor < volume.bytes.length) return volume.bytes[cursor]
    cursor -= volume.bytes.length
  }
  throw archiveIntegrityError('7z 分卷数据不完整：末卷缺失或已截断', 'truncated-volume')
}

function volumeUint32 (view, offset) {
  return (volumeByteAt(view, offset) | (volumeByteAt(view, offset + 1) << 8) | (volumeByteAt(view, offset + 2) << 16) | (volumeByteAt(view, offset + 3) << 24)) >>> 0
}

function volumeUint64 (view, offset) {
  const value = volumeUint32(view, offset) + volumeUint32(view, offset + 4) * 0x100000000
  if (!Number.isSafeInteger(value)) throw archiveIntegrityError('7z 分卷头部范围超过本机安全范围', 'unsafe-size')
  return value
}

function volumeCrc32 (view, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > view.total) {
    throw archiveIntegrityError('7z 分卷数据不完整：末卷缺失或已截断', 'truncated-volume')
  }
  let crc = 0xffffffff
  if (!crc32Table) {
    crc32Table = new Uint32Array(256)
    for (let value = 0; value < 256; value++) {
      let item = value
      for (let bit = 0; bit < 8; bit++) item = (item >>> 1) ^ ((item & 1) ? 0xedb88320 : 0)
      crc32Table[value] = item >>> 0
    }
  }
  let remaining = length
  let sourceOffset = offset
  let volumeStart = 0
  for (const volume of view.numbered) {
    const volumeEnd = volumeStart + volume.bytes.length
    if (sourceOffset < volumeEnd && remaining) {
      const localStart = Math.max(0, sourceOffset - volumeStart)
      const count = Math.min(remaining, volume.bytes.length - localStart)
      for (let index = localStart; index < localStart + count; index++) crc = crc32Table[(crc ^ volume.bytes[index]) & 255] ^ (crc >>> 8)
      sourceOffset += count
      remaining -= count
    }
    volumeStart = volumeEnd
    if (!remaining) break
  }
  if (remaining) throw archiveIntegrityError('7z 分卷数据不完整：末卷缺失或已截断', 'truncated-volume')
  return (crc ^ 0xffffffff) >>> 0
}

function validateNumeric7zVolumes (prepared) {
  const view = numeric7zVolumeView(prepared)
  if (!view) return
  if (view.total < 32) throw archiveIntegrityError('7z 分卷数据不完整：起始头已截断', 'truncated-start-header')
  const signature = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
  if (signature.some((byte, index) => volumeByteAt(view, index) !== byte)) throw archiveIntegrityError('7z 分卷起始标识无效，文件可能损坏', 'signature')
  if (volumeCrc32(view, 12, 20) !== volumeUint32(view, 8)) throw archiveIntegrityError('7z 分卷起始头校验失败，文件可能损坏', 'start-header-crc')
  const nextOffset = volumeUint64(view, 12)
  const nextSize = volumeUint64(view, 20)
  const nextStart = 32 + nextOffset
  if (!Number.isSafeInteger(nextStart) || !Number.isSafeInteger(nextStart + nextSize) || nextStart + nextSize > view.total) {
    throw archiveIntegrityError('7z 分卷数据不完整：末卷缺失或已截断', 'truncated-volume')
  }
  if (volumeCrc32(view, nextStart, nextSize) !== volumeUint32(view, 28)) throw archiveIntegrityError('7z 分卷目录头校验失败，文件可能损坏', 'next-header-crc')
}

function joinNumericZipVolumes (prepared) {
  const main = String(prepared && prepared.mainName || '').match(/^(.*\.zip)\.(\d{3,})$/i)
  if (!main || Number(main[2]) !== 1) return null
  const prefix = main[1].toLowerCase()
  const numbered = prepared.volumes.map(volume => {
    const match = volume.name.match(/^(.*\.zip)\.(\d{3,})$/i)
    if (!match || match[1].toLowerCase() !== prefix) throw new Error('ZIP 数字分卷名称不属于同一组')
    return { ...volume, number: Number(match[2]) }
  }).sort((left, right) => left.number - right.number)
  let total = 0
  for (let index = 0; index < numbered.length; index++) {
    if (numbered[index].number !== index + 1) throw new Error(`ZIP 数字分卷缺少第 ${index + 1} 卷`)
    total += numbered[index].bytes.length
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const volume of numbered) {
    joined.set(volume.bytes, offset)
    offset += volume.bytes.length
  }
  return joined
}

function joinClassicZipVolumes (prepared) {
  const main = String(prepared && prepared.mainName || '').match(/^(.*)\.zip$/i)
  if (!main) return null
  const prefix = main[1].toLowerCase()
  let finalVolume = null
  const numbered = []
  for (const volume of prepared.volumes) {
    const final = volume.name.match(/^(.*)\.zip$/i)
    if (final && final[1].toLowerCase() === prefix) {
      if (finalVolume) throw new Error('ZIP 经典分卷主文件重复')
      finalVolume = volume
      continue
    }
    const part = volume.name.match(/^(.*)\.z(\d{2,})$/i)
    if (!part || part[1].toLowerCase() !== prefix) throw new Error('ZIP 经典分卷名称不属于同一组')
    numbered.push({ ...volume, number: Number(part[2]) })
  }
  if (!finalVolume || !numbered.length) return null
  numbered.sort((left, right) => left.number - right.number)
  for (let index = 0; index < numbered.length; index++) {
    if (numbered[index].number !== index + 1) throw new Error(`ZIP 经典分卷缺少第 ${index + 1} 卷`)
  }

  const ordered = numbered.concat(finalVolume)
  const starts = []
  let total = 0
  for (const volume of ordered) {
    starts.push(total)
    total += volume.bytes.length
  }
  const joined = new Uint8Array(total)
  let outputOffset = 0
  for (const volume of ordered) {
    joined.set(volume.bytes, outputOffset)
    outputOffset += volume.bytes.length
  }

  const eocd = findZipEocd(joined)
  const finalDisk = ordered.length - 1
  const eocdDisk = zipUint16(joined, eocd + 4)
  const legacyCentralDisk = zipUint16(joined, eocd + 6)
  let count = zipUint16(joined, eocd + 10)
  let centralSize = zipUint32(joined, eocd + 12)
  let centralOffset = zipUint32(joined, eocd + 16)
  let centralDisk = legacyCentralDisk
  let zip64Record = -1
  let zip64Locator = -1
  if (eocdDisk !== finalDisk) throw new Error('ZIP 经典分卷磁盘编号与所选文件不一致')
  const isZip64 = count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
  if (isZip64) {
    zip64Locator = eocd - 20
    if (zip64Locator < starts[finalDisk] || zipUint32(joined, zip64Locator) !== 0x07064b50) throw new Error('ZIP64 经典分卷定位器缺失')
    const recordDisk = zipUint32(joined, zip64Locator + 4)
    const recordOffset = zipUint64(joined, zip64Locator + 8)
    const totalDisks = zipUint32(joined, zip64Locator + 16)
    if (totalDisks !== ordered.length || recordDisk !== finalDisk) throw new Error('ZIP64 经典分卷定位器磁盘数量不一致')
    zip64Record = starts[recordDisk] + recordOffset
    if (zip64Record < starts[recordDisk] || zip64Record + 56 > zip64Locator || zipUint32(joined, zip64Record) !== 0x06064b50) throw new Error('ZIP64 经典分卷结束记录不完整')
    const recordSize = zipUint64(joined, zip64Record + 4)
    if (recordSize < 44 || zip64Record + 12 + recordSize !== zip64Locator) throw new Error('ZIP64 经典分卷结束记录范围无效')
    const recordDiskField = zipUint32(joined, zip64Record + 16)
    centralDisk = zipUint32(joined, zip64Record + 20)
    const diskCount = zipUint64(joined, zip64Record + 24)
    count = zipUint64(joined, zip64Record + 32)
    centralSize = zipUint64(joined, zip64Record + 40)
    centralOffset = zipUint64(joined, zip64Record + 48)
    if (recordDiskField !== recordDisk || centralDisk > finalDisk || diskCount > count) throw new Error('ZIP64 经典分卷结束记录磁盘编号无效')
    if (legacyCentralDisk !== centralDisk && legacyCentralDisk !== 0xffff) throw new Error('ZIP64 经典分卷目录磁盘编号不一致')
  } else if (centralDisk > finalDisk) throw new Error('ZIP 经典分卷磁盘编号与所选文件不一致')
  const centralStart = starts[centralDisk] + centralOffset
  const centralEnd = centralStart + centralSize
  const expectedCentralEnd = isZip64 ? zip64Record : eocd
  if (centralStart < starts[centralDisk] || centralEnd !== expectedCentralEnd) throw new Error('ZIP 经典分卷中央目录边界不一致')

  let cursor = centralStart
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralEnd || zipUint32(joined, cursor) !== 0x02014b50) throw new Error('ZIP 经典分卷中央目录记录不完整')
    const nameLength = zipUint16(joined, cursor + 28)
    const extraLength = zipUint16(joined, cursor + 30)
    const commentLength = zipUint16(joined, cursor + 32)
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (recordEnd > centralEnd) throw new Error('ZIP 经典分卷成员范围无效')
    const location = zipCentralLocation(joined, cursor, cursor + 46 + nameLength, extraLength)
    const disk = location.disk
    const localOffset = location.localOffset
    if (disk >= ordered.length) throw new Error('ZIP 经典分卷成员引用了不存在的磁盘')
    const absoluteLocalOffset = starts[disk] + localOffset
    if (absoluteLocalOffset + 30 > centralStart || zipUint32(joined, absoluteLocalOffset) !== 0x04034b50) throw new Error('ZIP 经典分卷成员本地头无效')
    if (location.diskAt >= 0) zipWriteUint32(joined, location.diskAt, 0)
    else {
      joined[cursor + 34] = 0
      joined[cursor + 35] = 0
    }
    if (location.localOffsetAt >= 0) zipWriteUint64(joined, location.localOffsetAt, absoluteLocalOffset)
    else zipWriteUint32(joined, cursor + 42, absoluteLocalOffset)
    cursor = recordEnd
  }
  if (cursor !== centralEnd) throw new Error('ZIP 经典分卷中央目录大小与成员记录不一致')
  joined[eocd + 4] = 0
  joined[eocd + 5] = 0
  joined[eocd + 6] = 0
  joined[eocd + 7] = 0
  if (isZip64) {
    zipWriteUint32(joined, zip64Record + 16, 0)
    zipWriteUint32(joined, zip64Record + 20, 0)
    zipWriteUint64(joined, zip64Record + 24, count)
    zipWriteUint64(joined, zip64Record + 32, count)
    zipWriteUint64(joined, zip64Record + 40, centralSize)
    zipWriteUint64(joined, zip64Record + 48, centralStart)
    zipWriteUint32(joined, zip64Locator + 4, 0)
    zipWriteUint64(joined, zip64Locator + 8, zip64Record)
    zipWriteUint32(joined, zip64Locator + 16, 1)
  } else {
    joined[eocd + 8] = joined[eocd + 10]
    joined[eocd + 9] = joined[eocd + 11]
    zipWriteUint32(joined, eocd + 16, centralStart)
  }
  return joined
}

function joinZipVolumes (prepared) {
  return joinNumericZipVolumes(prepared) || joinClassicZipVolumes(prepared)
}

function inspectJoinedZipVolumes (bytes) {
  const eocd = findZipEocd(bytes)
  const directory = zipDirectoryDescriptor(bytes, eocd)
  const descriptor = { count: directory.count, centralSize: directory.centralSize, offset: directory.centralOffset, zip64: directory.zip64 }
  const end = descriptor.offset + descriptor.centralSize
  if (descriptor.offset < 0 || end > bytes.length) throw new Error('ZIP 分卷中央目录范围无效')
  return inspectZipCentral(bytes.subarray(descriptor.offset, end), descriptor, { legacyEncoding: 'auto' })
}

function archiveVolumeLabel (format) {
  return format === 'rar' ? 'RAR' : format === 'zip' ? 'ZIP' : '7z'
}

function clearMemfsPath (FS, target) {
  try {
    const stat = FS.stat(target)
    if (FS.isDir(stat.mode)) {
      for (const name of FS.readdir(target)) {
        if (name !== '.' && name !== '..') clearMemfsPath(FS, `${target}/${name}`)
      }
      FS.rmdir(target)
    } else FS.unlink(target)
  } catch (_) {}
}

async function inspect7zArchive (input, options = {}) {
  const engine = await getEngine(options)
  const bytes = toUint8(input)
  const tar = options.archiveType === 'tar-engine'
  const archiveExtension = tar ? '.tar' : options.archiveExtension === '.zip' ? '.zip' : '.7z'
  const archiveType = tar ? 'tar-engine' : options.archiveType === 'zip-engine' ? 'zip-engine' : '7z-engine'
  const archiveLabel = tar ? 'TAR' : archiveType === 'zip-engine' ? 'ZIP' : '7z'
  const archivePath = uniquePath('rabbit-reader', archiveExtension)
  const maxEntrySize = Number(options.maxEntrySize || 20 * 1024 * 1024)
  const password = options.password ? String(options.password) : ''
  engine.FS.writeFile(archivePath, bytes)
  try {
    const args = ['l', '-slt']
    if (tar) args.push('-ttar')
    if (password) args.push(`-p${password}`)
    args.push(archivePath)
    const { output, entries } = readNativeListing(engine, args, maxEntrySize, Boolean(password), archiveType, {
      maxSolidDecodeBytes: options.maxSolidDecodeBytes,
      trackSolidBlocks: archiveType === '7z-engine',
      detectUnixLinks: !tar && [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((byte, index) => bytes[index] === byte)
    })
    const archiveFields = parseFields(listingSections(output).header)
    if (tar && archiveFields.Type !== 'tar') throw new Error('文件不是可读取的原始 TAR 归档')
    return {
      archiveType,
      title: tar ? 'TAR 归档' : `${archiveLabel} 压缩包`,
      summary: entries.some(entry => entry.encrypted)
        ? (password
            ? `已读取 ${entries.length} 个目录项；点开加密文件时会在本机验证本次输入的密码并解压。`
            : `已读取 ${entries.length} 个目录项；输入密码后可打开加密文件。`)
        : `已由按需加载的本机 7-Zip 内核读取 ${entries.length} 个 ${archiveLabel} 目录项；支持的文件可直接点开。`,
      metadata: [
        { label: '目录项', value: String(entries.length) },
        { label: '压缩方式', value: archiveFields.Method || Array.from(new Set(entries.map(entry => entry.method).filter(Boolean))).join('、') || '未声明' },
        { label: '固实压缩', value: archiveFields.Solid === '+' ? '是' : '否' },
        { label: '物理大小', value: archiveFields['Physical Size'] ? formatBytes(Number(archiveFields['Physical Size'])) : formatBytes(bytes.length) }
      ],
      entries,
      passwordRequired: entries.some(entry => entry.encrypted),
      passwordProvided: Boolean(password)
    }
  } finally {
    clearMemfsPath(engine.FS, archivePath)
  }
}

async function extract7zEntry (input, entry, options = {}) {
  const archiveExtension = options.archiveExtension === '.tar' ? '.tar' : options.archiveExtension === '.zip' ? '.zip' : '.7z'
  const archiveLabel = archiveExtension === '.tar' ? 'TAR' : archiveExtension === '.zip' ? 'ZIP' : '7z'
  if (!entry || (entry.isDirectory && !options.readLinkTarget)) throw new Error(`请选择 ${archiveLabel} 中的文件`)
  if (entry.isLink && !options.readLinkTarget) throw new Error(`${archiveLabel} 链接需先解析包内真实目标`)
  if (archiveExtension === '.tar' && (entry.archiveType !== 'tar-engine' || entry.unsupportedType || entry.isLink)) throw new Error('请选择可阅读的 TAR 普通成员')
  if (entry.encrypted && !options.password) throw new Error(`该 ${archiveLabel} 文件已加密，请先输入密码`)
  if (!safeArchivePath(entry.name)) throw new Error('包内路径不安全，已拒绝解压')
  if (entry.nativeName && !safeArchivePath(entry.nativeName)) throw new Error('包内原始路径不安全，已拒绝解压')
  const maxSize = Number(options.maxSize || 20 * 1024 * 1024)
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  const maxSolidDecodeBytes = Number(options.maxSolidDecodeBytes || MAX_SOLID_DECODE_BYTES)
  if (Number(entry.solidDecodeSize || 0) > maxSolidDecodeBytes) throw new Error(`该成员所在固实块需先解码 ${formatBytes(entry.solidDecodeSize)}，超过 ${formatBytes(maxSolidDecodeBytes)} 安全上限`)
  const engine = await getEngine(options)
  const archivePath = uniquePath('rabbit-reader', archiveExtension)
  const outputRoot = uniquePath('rabbit-reader-output')
  const isolatedZipMember = archiveExtension === '.zip' && entry.nativeName && Number.isInteger(entry.zipCentralIndex)
  const archiveBytes = isolatedZipMember ? isolateZipMember(input, entry.zipCentralIndex, { linkPayloadAsFile: Boolean(options.readLinkTarget) }) : toUint8(input)
  engine.FS.writeFile(archivePath, archiveBytes)
  engine.FS.mkdir(outputRoot)
  try {
    return extractSelectedMember(engine, archivePath, outputRoot, entry, { ...options, isolatedZipMember }, maxSize)
  } finally {
    clearMemfsPath(engine.FS, archivePath)
    clearMemfsPath(engine.FS, outputRoot)
  }
}

async function extract7zLinkTarget (input, entry, options = {}) {
  if (!entry || !entry.isLink) throw new Error('所选成员不是压缩包链接')
  if (options.archiveExtension !== '.zip' && !entry.linkTargetInData) throw new Error('7z 链接未声明原始目标数据')
  return extract7zEntry(input, entry, { ...options, readLinkTarget: true, maxSize: Math.min(Number(options.maxSize || MAX_LINK_BYTES), MAX_LINK_BYTES) })
}

async function readRarLinkTarget (input, entry, options = {}) {
  if (!entry || !entry.isLink) throw new Error('所选成员不是 RAR 链接')
  const inspection = await inspect7zArchive(input, options)
  const selected = inspection.entries.find(item => item.memberIndex === entry.memberIndex && item.name === entry.name)
  if (!selected) throw new Error('RAR 链接目标目录不一致')
  if (selected.isLink) return { target: selected.linkTarget, type: selected.linkType }
  // RAR 4 stores Unix symlink text as the entry's data. The 7-Zip RAR 4
  // decoder returns those bytes as a regular MEMFS file, never a host link.
  if (entry.rarVersion === 5) throw new Error('RAR 5 链接未返回可靠目标，未尝试创建文件系统链接')
  const bytes = await extract7zEntry(input, selected, { ...options, maxSize: MAX_LINK_BYTES })
  return { target: linkText(bytes), type: 1 }
}

async function inspectArchiveVolumes (inputVolumes, options = {}) {
  const prepared = normalizeArchiveVolumes(inputVolumes, options.mainName)
  const format = options.format === 'rar' ? 'rar' : options.format === 'zip' ? 'zip' : '7z'
  // ZIP split metadata is cheap to validate and must be checked before the
  // native decoder can turn a corrupt disk reference into a generic error.
  const joinedZip = format === 'zip' ? joinZipVolumes(prepared) : null
  if (format === '7z') validateNumeric7zVolumes(prepared)
  const engine = await getEngine(options)
  const label = archiveVolumeLabel(format)
  const root = uniquePath('rabbit-reader-volumes')
  const maxEntrySize = Number(options.maxEntrySize || 20 * 1024 * 1024)
  const maxSolidDecodeBytes = Number(options.maxSolidDecodeBytes || MAX_SOLID_DECODE_BYTES)
  const password = options.password ? String(options.password) : ''
  engine.FS.mkdir(root)
  for (const volume of prepared.volumes) engine.FS.writeFile(`${root}/${volume.name}`, volume.bytes)
  try {
    const args = ['l', '-slt']
    if (password) args.push(`-p${password}`)
    args.push(`${root}/${prepared.mainName}`)
    const { output, entries: nativeEntries } = readNativeListing(engine, args, maxEntrySize, Boolean(password), 'volume-engine', {
      pathSeparator: format === 'zip' ? 'both' : 'slash',
      maxSolidDecodeBytes,
      trackSolidBlocks: format === '7z',
      detectUnixLinks: format === '7z'
    })
    let entries = nativeEntries
    let zipIdentityEntries = null
    if (format === 'zip') {
      if (joinedZip) {
        const centralInspection = inspectJoinedZipVolumes(joinedZip)
        const merged = mergeZipEngineInspection({ archiveType: 'zip-engine', entries: nativeEntries, metadata: [] }, centralInspection)
        entries = merged.entries
        zipIdentityEntries = merged.zipIdentityEntries
      }
    }
    const archiveFields = parseFields(listingSections(output).header)
    const totalSize = prepared.volumes.reduce((sum, volume) => sum + volume.bytes.length, 0)
    return {
      archiveType: 'volume-engine',
      title: `${label} 分卷压缩包`,
      summary: entries.some(entry => entry.encrypted)
        ? (password ? `已合并 ${prepared.volumes.length} 个分卷并读取 ${entries.length} 个目录项；可点开已解锁正文。` : `已合并 ${prepared.volumes.length} 个分卷并读取 ${entries.length} 个目录项；输入密码后可打开加密正文。`)
        : `已把同组选中的 ${prepared.volumes.length} 个分卷交给本机 7-Zip 内核，读取 ${entries.length} 个目录项；文件可直接点开。`,
      metadata: [
        { label: '分卷数量', value: String(prepared.volumes.length) },
        { label: '目录项', value: String(entries.length) },
        { label: '压缩方式', value: archiveFields.Method || Array.from(new Set(entries.map(entry => entry.method).filter(Boolean))).join('、') || '未声明' },
        { label: '合计大小', value: formatBytes(totalSize) }
      ],
      entries,
      ...(zipIdentityEntries ? { zipIdentityEntries } : {}),
      passwordRequired: entries.some(entry => entry.encrypted),
      passwordProvided: Boolean(password)
    }
  } finally {
    clearMemfsPath(engine.FS, root)
  }
}

async function extractArchiveVolumeEntry (inputVolumes, entry, options = {}) {
  if (!entry || (entry.isDirectory && !options.readLinkTarget)) throw new Error('请选择分卷压缩包中的文件')
  if (entry.isLink && !options.readLinkTarget) throw new Error('分卷压缩包链接需先解析包内真实目标')
  if (entry.encrypted && !options.password) throw new Error('该分卷压缩包已加密，请先输入密码')
  if (!safeArchivePath(entry.name)) throw new Error('包内路径不安全，已拒绝解压')
  const maxSize = Number(options.maxSize || 20 * 1024 * 1024)
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  const maxSolidDecodeBytes = Number(options.maxSolidDecodeBytes || MAX_SOLID_DECODE_BYTES)
  if (Number(entry.solidDecodeSize || 0) > maxSolidDecodeBytes) throw new Error(`该成员所在固实块需先解码 ${formatBytes(entry.solidDecodeSize)}，超过 ${formatBytes(maxSolidDecodeBytes)} 安全上限`)
  const prepared = normalizeArchiveVolumes(inputVolumes, options.mainName)
  const format = options.format === 'rar' ? 'rar' : options.format === 'zip' ? 'zip' : '7z'
  if (format === '7z') validateNumeric7zVolumes(prepared)
  const engine = await getEngine(options)
  const root = uniquePath('rabbit-reader-volumes')
  const outputRoot = uniquePath('rabbit-reader-output')
  engine.FS.mkdir(root)
  engine.FS.mkdir(outputRoot)
  for (const volume of prepared.volumes) engine.FS.writeFile(`${root}/${volume.name}`, volume.bytes)
  try {
    return extractSelectedMember(engine, `${root}/${prepared.mainName}`, outputRoot, entry, options, maxSize)
  } finally {
    clearMemfsPath(engine.FS, root)
    clearMemfsPath(engine.FS, outputRoot)
  }
}

function resolveArchiveVolumeLink (entries, requested) {
  const canonicalEntries = []
  const entriesByPath = new Map()
  for (const item of entries) {
    let path
    try { path = packagePath(item.name) } catch (_) { continue }
    canonicalEntries.push({ item, path })
    if (!entriesByPath.has(path)) entriesByPath.set(path, [])
    entriesByPath.get(path).push(item)
  }
  let selected = entries.find(item => item.memberIndex === requested.memberIndex && item.name === requested.name)
  if (!selected) throw new Error('分卷压缩包链接成员已变化，请重新打开压缩包')
  let selectedPath = packagePath(selected.name)
  const visited = new Set()

  function linkDestination (linked, suffix = '') {
    const identity = `${linked.memberIndex}:${linked.name}`
    if (visited.has(identity)) throw new Error('分卷压缩包链接形成循环，无法打开')
    if (visited.size >= 16) throw new Error('分卷压缩包链接层数超过安全上限')
    visited.add(identity)
    if (![1, 2, 3, 4, 5].includes(linked.linkType || 1)) throw new Error('分卷压缩包链接类型暂不支持')
    const target = String(linked.linkTarget == null ? '' : linked.linkTarget)
    if (!target || utf8ByteLength(target) > MAX_LINK_BYTES) throw new Error('分卷压缩包链接目标缺失或超过长度上限')
    const linkPath = packagePath(linked.name)
    const parent = [4, 5].includes(linked.linkType || 1) ? '' : linkPath.split('/').slice(0, -1).join('/')
    const targetPath = packagePath(target, parent)
    return suffix ? packagePath(suffix, targetPath) : targetPath
  }

  while (selectedPath) {
    const matches = entriesByPath.get(selectedPath) || []
    if (matches.length > 1) throw new Error('分卷压缩包链接目标存在多个同名条目，不能确定正确内容')
    if (matches.length === 1) {
      selected = matches[0]
      if (!selected.isLink) break
      selectedPath = linkDestination(selected)
      continue
    }
    const parts = selectedPath.split('/')
    let intermediate = null
    for (let length = parts.length - 1; length > 0; length--) {
      const prefix = parts.slice(0, length).join('/')
      const prefixMatches = entriesByPath.get(prefix) || []
      if (prefixMatches.length > 1) throw new Error('分卷压缩包链接路径中存在多个同名条目，不能确定正确内容')
      if (prefixMatches.length === 1 && prefixMatches[0].isLink) {
        intermediate = { entry: prefixMatches[0], suffix: parts.slice(length).join('/') }
        break
      }
    }
    if (intermediate) {
      selectedPath = linkDestination(intermediate.entry, intermediate.suffix)
      continue
    }
    const children = canonicalEntries.filter(candidate => candidate.path.startsWith(`${selectedPath}/`)).map(candidate => candidate.item)
    if (!children.length) throw new Error('分卷压缩包链接目标在包内不存在')
    return { entry: { name: selectedPath, isDirectory: true }, entries: children }
  }
  return { entry: selected }
}

function utf8ByteLength (value) {
  let length = 0
  for (const symbol of String(value)) {
    const code = symbol.codePointAt(0)
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return length
}

async function readArchiveVolumeEntry (inputVolumes, entry, options = {}) {
  if (!entry) throw new Error('请选择分卷压缩包中的文件')
  if (!entry.isLink) return { entry, bytes: await extractArchiveVolumeEntry(inputVolumes, entry, options) }
  const inspection = await inspectArchiveVolumes(inputVolumes, options)
  let resolved
  if (options.format === 'zip' && inspection.zipIdentityEntries && Number.isInteger(entry.zipCentralIndex)) {
    const prepared = normalizeArchiveVolumes(inputVolumes, options.mainName)
    const joined = joinZipVolumes(prepared)
    const selected = inspection.zipIdentityEntries.find(item => item.zipCentralIndex === entry.zipCentralIndex)
    if (!selected || !joined) throw new Error('ZIP 分卷链接成员已变化，请重新打开压缩包')
    resolved = await resolveZipLink(inspection.zipIdentityEntries, selected, (linked, maxSize) => extract7zLinkTarget(joined, linked, { ...options, archiveExtension: '.zip', maxSize }))
  } else if (options.format !== 'rar' && options.format !== 'zip') {
    resolved = await resolveSevenZipLink(inspection.entries, entry, linked => extractArchiveVolumeEntry(inputVolumes, linked, { ...options, readLinkTarget: true, maxSize: MAX_LINK_BYTES }))
  } else resolved = resolveArchiveVolumeLink(inspection.entries, entry)
  if (resolved.entry.isDirectory) return resolved
  return { entry: resolved.entry, bytes: await extractArchiveVolumeEntry(inputVolumes, resolved.entry, options) }
}

module.exports = {
  MAX_SOLID_DECODE_BYTES,
  SEVEN_ZIP_WASM_FILE,
  exactArrayBuffer,
  extractArchiveVolumeEntry,
  extract7zEntry,
  extract7zLinkTarget,
  inspectArchiveVolumes,
  inspect7zArchive,
  isolateZipMember,
  parseListing,
  readArchiveVolumeEntry,
  readRarLinkTarget,
  resolveSevenZipLink,
  safeArchivePath
}
