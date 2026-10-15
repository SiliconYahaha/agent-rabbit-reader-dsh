'use strict'

const { buildArchiveTree } = require('./kernel').fileInspector
const { annotateArchiveMembers, verifyArchiveMember } = require('./kernel').archiveMembers
const { LEGACY_ENCODINGS, MAX_LINK_BYTES, packagePath, readRarLinks } = require('./rar-links')
const { createExtractorFromData } = require('./vendor/unrar/index')

const { modulePath } = require('./kernel').moduleRoot

const RAR_WASM_FILE = 'archive/vendor/unrar/unrar.wasm.br'
const DEFAULT_TIMEOUT_MS = 12000
const LEGACY_ENCODING_LABELS = {
  auto: '自动（UTF-8 / CP437）',
  'utf-8': 'UTF-8',
  cp437: 'CP437',
  gb18030: '简体中文 GB18030',
  shift_jis: '日文 Shift_JIS',
  cp949: '韩文 CP949',
  big5: '繁体中文 Big5'
}
let lastWxInstantiationError = ''

function toUint8 (input) {
  if (input instanceof Uint8Array) return input
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('RAR 解压需要 ArrayBuffer 或 Uint8Array')
}

function exactArrayBuffer (input) {
  const bytes = toUint8(input)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
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
    Promise.resolve(WXWebAssembly.instantiate(modulePath(RAR_WASM_FILE), imports))
      .then(result => {
        const instance = result && (result.instance || result)
        if (!instance || !instance.exports) throw new Error(`WXWebAssembly 返回值缺少 exports：${Object.prototype.toString.call(result)}`)
        receiveInstance(instance, result && result.module)
      })
      .catch(error => { lastWxInstantiationError = error && (error.stack || error.errMsg || error.message) || String(error) })
  } catch (error) {
    lastWxInstantiationError = error && (error.stack || error.errMsg || error.message) || String(error)
  }
  return {}
}

function extractorOptions (input, options = {}) {
  const output = { data: exactArrayBuffer(input) }
  if (options.password) output.password = String(options.password)
  if (options.wasmBinary) output.wasmBinary = exactArrayBuffer(options.wasmBinary)
  else if (typeof WXWebAssembly === 'object' && WXWebAssembly && typeof WXWebAssembly.instantiate === 'function') output.instantiateWasm = wxInstantiateWasm
  else throw new Error('当前运行环境没有可用的 RAR WebAssembly 内核')
  return output
}

function withTimeout (promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer
  const raced = Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('RAR 解压内核启动超时')), timeoutMs)
    })
  ])
  return raced.then(value => { clearTimeout(timer); return value }, error => { clearTimeout(timer); throw error })
}

async function createExtractor (input, options = {}) {
  lastWxInstantiationError = ''
  try {
    return await withTimeout(createExtractorFromData(extractorOptions(input, options)), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  } catch (error) {
    if (/启动超时/.test(error && error.message) && lastWxInstantiationError) {
      error = new Error(`RAR 解压内核启动失败：${lastWxInstantiationError}`)
    }
    if (error && typeof error === 'object') error.code = 'RAR_ENGINE_UNAVAILABLE'
    throw error
  }
}

async function inspectRarArchive (input, options = {}) {
  const extractor = await createExtractor(input, options)
  const list = extractor.getFileList()
  const headers = Array.from(list.fileHeaders)
  const legacyEncoding = LEGACY_ENCODINGS.includes(options.legacyEncoding) ? options.legacyEncoding : 'auto'
  const links = readRarLinks(toUint8(input), { legacyEncoding })
  if (links.length && links.length !== headers.length) throw new Error('RAR 链接目录与解压内核不一致，未打开不确定的内容')
  const maxEntrySize = Number(options.maxEntrySize || 20 * 1024 * 1024)
  const passwordAvailable = Boolean(options.password)
  const entries = headers.map((header, index) => {
    const directory = Boolean(header.flags && header.flags.directory)
    const encrypted = Boolean(header.flags && header.flags.encrypted)
    const unpacked = Number(header.unpSize || 0)
    const link = links[index] || { isLink: header.hostOS === 3 && (header.fileAttr & 0xf000) === 0xa000 }
    const nativeName = String(header.name || `文件 ${index + 1}`).replace(/\\/g, '/')
    return {
      ...link,
      id: index,
      memberIndex: index,
      archiveType: 'rar-engine',
      name: link.name === undefined ? nativeName : String(link.name).replace(/\\/g, '/'),
      nativeName,
      detail: link.isLink ? `链接 → ${link.linkTarget === undefined ? '点开后在本机读取目标' : link.linkTarget}${link.linkDirectory ? '（文件夹）' : ''}` : `${directory ? '文件夹' : formatBytes(unpacked)} · ${header.method || 'RAR 压缩'}${encrypted ? ' · 已加密' : ''}${!directory && unpacked > maxEntrySize ? ' · 超过打开上限' : ''}`,
      isDirectory: directory,
      canOpen: !directory && (!encrypted || passwordAvailable) && unpacked <= maxEntrySize,
      encrypted,
      compressedSize: Number(header.packSize || 0),
      uncompressedSize: unpacked,
      method: header.method || '',
      crc: header.crc
    }
  })
  const ambiguousEncoding = entries.some(entry => entry.legacyEncodingAmbiguous)
  return {
    archiveType: 'rar-engine',
    title: 'RAR 压缩包',
    summary: entries.some(entry => entry.encrypted)
      ? (passwordAvailable
          ? `已读取 ${entries.length} 个目录项；点开加密文件时会在本机验证本次输入的密码并解压。`
          : `已读取 ${entries.length} 个目录项；输入密码后可打开加密文件。`)
      : `已由本机 RAR 解压内核读取 ${entries.length} 个目录项；文件可直接点开。`,
    metadata: [
      { label: '目录项', value: String(entries.length) },
      { label: '压缩方式', value: Array.from(new Set(entries.filter(entry => !entry.isDirectory).map(entry => entry.method))).join('、') || '未声明' },
      { label: '固实压缩', value: list.arcHeader && list.arcHeader.flags && list.arcHeader.flags.solid ? '是' : '否' },
      { label: '头部加密', value: list.arcHeader && list.arcHeader.flags && list.arcHeader.flags.headerEncrypted ? '是' : '否' }
    ],
    entries: options.rawEntries ? annotateArchiveMembers(entries) : buildArchiveTree(entries),
    filenameEncoding: ambiguousEncoding ? legacyEncoding : '',
    filenameEncodingLabel: ambiguousEncoding ? `${LEGACY_ENCODING_LABELS[legacyEncoding]}${legacyEncoding === 'auto' ? '' : '（手动）'}` : '',
    filenameEncodingOptions: ambiguousEncoding ? LEGACY_ENCODINGS.map(value => ({ value, label: LEGACY_ENCODING_LABELS[value], active: value === legacyEncoding })) : [],
    passwordRequired: entries.some(entry => entry.encrypted),
    passwordProvided: passwordAvailable
  }
}

async function extractRegularRarEntry (input, entry, options = {}) {
  if (!entry || entry.isDirectory) throw new Error('请选择 RAR 中的文件')
  if (entry.encrypted && !options.password) throw new Error('该 RAR 文件已加密，请先输入密码')
  const maxSize = Number(options.maxSize || 20 * 1024 * 1024)
  if (entry.uncompressedSize > maxSize) throw new Error(`包内文件超过 ${formatBytes(maxSize)}，为避免内存不足未打开`)
  const extractor = await createExtractor(input, options)
  const memberIndex = Number.isInteger(entry.memberIndex) ? entry.memberIndex : entry.id
  if (!Number.isInteger(memberIndex) || memberIndex < 0) throw new Error('RAR 成员标识无效，请重新打开压缩包')
  const nativeName = entry.nativeName || entry.name
  let currentIndex = 0
  const result = extractor.extract({ files: header => currentIndex++ === memberIndex && String(header.name).replace(/\\/g, '/') === nativeName, password: options.password || undefined })
  const files = Array.from(result.files)
  const file = files.find(item => item.fileHeader && String(item.fileHeader.name).replace(/\\/g, '/') === nativeName)
  if (!file || !file.extraction) throw new Error('RAR 解压器没有返回所选文件内容')
  const output = toUint8(file.extraction)
  verifyArchiveMember(output, entry, maxSize)
  return output
}

async function readRarEntry (input, entry, options = {}) {
  if (!entry || entry.isDirectory) throw new Error('请选择 RAR 中的文件')
  if (!entry.isLink) return { entry, bytes: await extractRegularRarEntry(input, entry, options) }
  const inspection = await inspectRarArchive(input, { ...options, rawEntries: true })
  const entries = inspection.entries
  const canonicalEntries = []
  const entriesByPath = new Map()
  for (const item of entries) {
    let path
    try { path = packagePath(item.name) } catch (_) { continue }
    canonicalEntries.push({ item, path })
    if (!entriesByPath.has(path)) entriesByPath.set(path, [])
    entriesByPath.get(path).push(item)
  }
  let selected = entries.find(item => item.memberIndex === entry.memberIndex && item.name === entry.name)
  let selectedPath = selected && packagePath(selected.name)
  const visited = new Set()
  async function linkDestination (linked, suffix = '') {
    if (visited.has(linked.memberIndex)) throw new Error('RAR 链接形成循环，无法打开')
    if (visited.size >= 16) throw new Error('RAR 链接层数超过安全上限')
    visited.add(linked.memberIndex)
    let target = linked.linkTarget
    let type = linked.linkType || 1
    if (target === undefined) {
      if (linked.uncompressedSize > MAX_LINK_BYTES) throw new Error('RAR 链接目标超过长度上限')
      if (!options.readLinkTarget) throw new Error('此 RAR 链接需兼容内核读取目标')
      const result = await options.readLinkTarget(input, linked, options)
      target = result.target
      type = result.type || type
    }
    if (![1, 2, 3, 4, 5].includes(type)) throw new Error('RAR 链接类型暂不支持')
    const linkPath = packagePath(linked.name)
    const parent = [4, 5].includes(type) ? '' : linkPath.split('/').slice(0, -1).join('/')
    const targetPath = packagePath(target, parent)
    return suffix ? packagePath(suffix, targetPath) : targetPath
  }
  while (selectedPath) {
    const matches = entriesByPath.get(selectedPath) || []
    if (matches.length > 1) throw new Error('RAR 链接目标存在多个同名条目，不能确定正确内容')
    if (matches.length === 1) {
      selected = matches[0]
      if (!selected.isLink) break
      selectedPath = await linkDestination(selected)
      continue
    }

    const parts = selectedPath.split('/')
    let intermediate = null
    for (let length = parts.length - 1; length > 0; length--) {
      const prefix = parts.slice(0, length).join('/')
      const prefixMatches = entriesByPath.get(prefix) || []
      if (prefixMatches.length > 1) throw new Error('RAR 链接路径中存在多个同名条目，不能确定正确内容')
      if (prefixMatches.length === 1 && prefixMatches[0].isLink) {
        intermediate = { entry: prefixMatches[0], suffix: parts.slice(length).join('/') }
        break
      }
    }
    if (intermediate) {
      selectedPath = await linkDestination(intermediate.entry, intermediate.suffix)
      continue
    }

    const children = canonicalEntries.filter(candidate => candidate.path.startsWith(`${selectedPath}/`)).map(candidate => candidate.item)
    if (!children.length) throw new Error('RAR 链接目标在压缩包内不存在')
    selected = { name: selectedPath, isDirectory: true }
    break
  }
  if (!selected) throw new Error('RAR 链接成员已变化，请重新打开压缩包')
  if (selected.isDirectory) {
    const directory = packagePath(selected.name)
    const children = entries.filter(item => {
      try { return packagePath(item.name).startsWith(`${directory}/`) } catch (_) { return false }
    })
    return { entry: selected, entries: buildArchiveTree(children) }
  }
  return { entry: selected, bytes: await extractRegularRarEntry(input, selected, options) }
}

async function extractRarEntry (input, entry, options = {}) {
  const result = await readRarEntry(input, entry, options)
  if (result.entry.isDirectory) throw new Error('RAR 链接目标是文件夹，请在目录中查看内容')
  return result.bytes
}

module.exports = {
  RAR_WASM_FILE,
  exactArrayBuffer,
  extractRarEntry,
  inspectRarArchive,
  readRarEntry
}
