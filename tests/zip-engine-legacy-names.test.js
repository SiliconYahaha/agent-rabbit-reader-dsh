'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const iconv = require('iconv-lite')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const { inspectZipCentral, readZip64DirectoryDescriptor, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { mergeZipEngineInspection } = require('../miniprogram/file-reader/archive/zip-engine-bridge')
const { resolveZipLink } = require('../miniprogram/file-reader/archive/zip-links')
const { extract7zEntry, extract7zLinkTarget, inspect7zArchive, isolateZipMember } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { AES_ZIP, BZIP2_LINK_ZIP, BZIP2_ZIP, PUBLIC_SYMLINK_ZIP, PUBLIC_UNSUPPORTED_LINK_ZIP, appendStoredUnixSymlink, forceZip64Archive, renameSingleMemberZip } = require('./helpers/zip-legacy-compat')
const { combineZips, duplicateZip } = require('./helpers/archive-duplicates')
const { storedZipWithUnicodePaths } = require('./helpers/zip-unicode-path')

const WASM = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const runtimeOptions = { wasmBinary: WASM, maxEntrySize: 1024 * 1024, archiveExtension: '.zip', archiveType: 'zip-engine' }

function inspectCentral (archive, legacyEncoding = 'auto') {
  let descriptor = readZipDirectoryDescriptor(archive)
  if (descriptor.zip64) descriptor = readZip64DirectoryDescriptor(archive.subarray(descriptor.zip64RecordOffset, descriptor.zip64RecordOffset + 56))
  return inspectZipCentral(archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize), descriptor, { legacyEncoding })
}

for (const sample of [
  { name: '한글/읽기.txt', encoding: 'cp949' },
  { name: '갂힣/확장.txt', encoding: 'cp949' }
]) {
  test(`兼容解压内核保留 ${sample.name} 的旧编码显示名和真实正文`, async () => {
    const archive = renameSingleMemberZip(BZIP2_ZIP, iconv.encode(sample.name, sample.encoding))
    const native = await inspect7zArchive(archive, runtimeOptions)
    assert.notEqual(native.entries[0].name, sample.name, '测试前提要求固定 7-Zip WASM 先产生乱码名称')
    const central = inspectCentral(archive, sample.encoding)
    const merged = mergeZipEngineInspection(native, central)
    assert.equal(merged.entries[0].name, sample.name)
    assert.equal(merged.entries[0].nativeName, native.entries[0].name)
    assert.equal(merged.entries[0].canOpen, true)
    assert.equal(merged.filenameEncoding, sample.encoding)
    const output = await extract7zEntry(archive, merged.entries[0], runtimeOptions)
    assert.equal(new TextDecoder().decode(output), 'BZip2 ZIP 里的真实正文。'.repeat(200))
  })
}

test('兼容内核合并前严格核对成员序号、大小、CRC 与文件类型', async () => {
  const archive = renameSingleMemberZip(BZIP2_ZIP, iconv.encode('한글/읽기.txt', 'cp949'))
  const native = await inspect7zArchive(archive, runtimeOptions)
  const central = inspectCentral(archive, 'cp949')
  assert.throws(() => mergeZipEngineInspection({ ...native, entries: [{ ...native.entries[0], memberIndex: 2 }] }, central), /无效成员序号/)
  assert.throws(() => mergeZipEngineInspection({ ...native, entries: [{ ...native.entries[0], uncompressedSize: native.entries[0].uncompressedSize + 1 }] }, central), /原始大小不同/)
  assert.throws(() => mergeZipEngineInspection({ ...native, entries: [{ ...native.entries[0], compressedSize: native.entries[0].compressedSize + 1 }] }, central), /压缩大小不同/)
  assert.throws(() => mergeZipEngineInspection({ ...native, entries: [{ ...native.entries[0], crc: '00000000' }] }, central), /CRC 不同/)
  assert.throws(() => mergeZipEngineInspection({ ...native, entries: [{ ...native.entries[0], isDirectory: true }] }, central), /文件类型不同/)
})

test('AES ZIP 解锁后仍保留手动文件名编码并按原生成员提取', async () => {
  const name = '한글/암호.txt'
  const archive = renameSingleMemberZip(AES_ZIP, iconv.encode(name, 'cp949'))
  const locked = mergeZipEngineInspection(await inspect7zArchive(archive, runtimeOptions), inspectCentral(archive, 'cp949'))
  assert.equal(locked.entries[0].name, name)
  assert.equal(locked.entries[0].canOpen, false)
  const unlockedNative = await inspect7zArchive(archive, { ...runtimeOptions, password: 'zip-rabbit-149' })
  const unlocked = mergeZipEngineInspection(unlockedNative, inspectCentral(archive, 'cp949'))
  assert.equal(unlocked.entries[0].name, name)
  assert.equal(unlocked.entries[0].canOpen, true)
  const output = await extract7zEntry(archive, unlocked.entries[0], { ...runtimeOptions, password: 'zip-rabbit-149' })
  assert.equal(new TextDecoder().decode(output), '加密 ZIP 里的真实正文。')
})

test('显示编码不能把兼容内核成员变成目录穿越路径', async () => {
  const archive = renameSingleMemberZip(BZIP2_ZIP, Buffer.from('../escape.txt'))
  const native = await inspect7zArchive(archive, runtimeOptions)
  const merged = mergeZipEngineInspection(native, inspectCentral(archive, 'cp437'))
  assert.equal(merged.entries[0].name, '../escape.txt')
  assert.equal(merged.entries[0].canOpen, false)
  await assert.rejects(extract7zEntry(archive, merged.entries[0], runtimeOptions), /路径不安全/)
})

test('按中央目录序号隔离时同名多成员逐项返回各自正文', async () => {
  const members = ['第一份正文', '第二份正文', '第三份正文'].map(content => ({ name: 'same.txt', content }))
  const archive = duplicateZip(members)
  const native = await inspect7zArchive(archive, runtimeOptions)
  for (const [index, entry] of native.entries.entries()) {
    const isolatedEntry = { ...entry, nativeName: entry.name, zipCentralIndex: index }
    const output = await extract7zEntry(archive, isolatedEntry, runtimeOptions)
    assert.equal(new TextDecoder().decode(output), members[index].content)
  }
})

test('兼容内核中不同 Big5 原始名称显示同名后仍按中央序号打开各自正文', async () => {
  const sources = [
    'UEsDBC4AAAAMAIMYIlAHyf8rPgAAABUAAAAJAAAAZW50cnkudHh0QlpoOTFBWSZTWbRlYL0AAAoAeUKAAQAIBwBuB4AgACKBoZGPVChppgA5CSo2EPWaNdCQ+LuSKcKEhaMrBehQSwECLgMuAAAADACDGCJQB8n/Kz4AAAAVAAAACQAAAAAAAAAAAAAAgAEAAAAAZW50cnkudHh0UEsFBgAAAAABAAEANwAAAGUAAAAAAA==',
    'UEsDBC4AAAAMAIMYIlAIiuFYPgAAABUAAAAJAAAAZW50cnkudHh0QlpoOTFBWSZTWVxhGogAAAoAeQKEAQAIBwA+B4AgACKA0ZNM9UKGmmACMtKjYTpRYRwkPi7kinChILjCNRBQSwECLgMuAAAADACDGCJQCIrhWD4AAAAVAAAACQAAAAAAAAAAAAAAgAEAAAAAZW50cnkudHh0UEsFBgAAAAABAAEANwAAAGUAAAAAAA=='
  ].map(value => Buffer.from(value, 'base64'))
  const rawNames = ['a2a52e747874', 'f9e92e747874'].map(value => Buffer.from(value, 'hex'))
  const archive = combineZips(sources.map((source, index) => renameSingleMemberZip(source, rawNames[index])))
  const merged = mergeZipEngineInspection(await inspect7zArchive(archive, runtimeOptions), inspectCentral(archive, 'big5'))
  assert.deepEqual(merged.entries.map(entry => entry.name), ['╞.txt', '╞.txt'])
  for (const [index, entry] of merged.entries.entries()) {
    assert.equal(new TextDecoder().decode(await extract7zEntry(archive, entry, runtimeOptions)), index ? '第二份兼容正文' : '第一份兼容正文')
  }
})

test('兼容内核不沿用重复 Unicode Path 的顺序相关名称', async () => {
  const archive = storedZipWithUnicodePaths({ unicodePaths: [{ name: 'first.html' }, { name: 'second.html' }] })
  const native = await inspect7zArchive(archive, runtimeOptions)
  assert.equal(native.entries[0].name, 'first.html', '测试前提要求兼容内核采用其中一个重复字段')
  const merged = mergeZipEngineInspection(native, inspectCentral(archive))
  assert.equal(merged.entries[0].name, 'safe/raw.html')
  assert.equal(merged.entries[0].nativeName, 'first.html')
  assert.equal(new TextDecoder().decode(await extract7zEntry(archive, merged.entries[0], runtimeOptions)), '<h1>ZIP 原始正文</h1>')
})

async function openCompatibilityLink (archive, options = {}) {
  const central = inspectCentral(archive)
  const native = await inspect7zArchive(archive, { ...runtimeOptions, ...options })
  const merged = mergeZipEngineInspection(native, central)
  const link = merged.zipIdentityEntries.find(entry => entry.name === 'shortcut')
  const resolved = await resolveZipLink(merged.zipIdentityEntries, link, (entry, maxSize) => extract7zLinkTarget(archive, entry, { ...runtimeOptions, ...options, maxSize }))
  return { merged, link, resolved }
}

test('兼容内核 ZIP 链接先解析目标，再打开 BZip2 正文', async () => {
  const archive = appendStoredUnixSymlink(BZIP2_ZIP, 'shortcut', '说明.txt')
  const opened = await openCompatibilityLink(archive)
  assert.equal(opened.link.isLink, true)
  assert.match(opened.link.detail, /符号链接/)
  assert.equal(opened.resolved.entry.name, '说明.txt')
  const output = await extract7zEntry(archive, opened.resolved.entry, runtimeOptions)
  assert.equal(new TextDecoder().decode(output), 'BZip2 ZIP 里的真实正文。'.repeat(200))
})

test('BZip2 压缩的 ZIP 链接记录只读取 MEMFS 目标，不创建宿主链接', async () => {
  const before = Buffer.from(BZIP2_LINK_ZIP)
  const opened = await openCompatibilityLink(BZIP2_LINK_ZIP)
  assert.equal(new TextDecoder().decode(await extract7zLinkTarget(BZIP2_LINK_ZIP, opened.link, runtimeOptions)), 'docs/page.html')
  assert.deepEqual(BZIP2_LINK_ZIP, before, '隔离成员不得改写原 ZIP 内存')
  assert.equal(opened.resolved.entry.name, 'docs/page.html')
  const output = await extract7zEntry(BZIP2_LINK_ZIP, opened.resolved.entry, runtimeOptions)
  assert.equal(new TextDecoder().decode(output), '<h1>链接成员BZip2真实正文</h1>')
})

test('ZIP64 中的 BZip2 链接按中央成员序号隔离并连续打开真实正文', async () => {
  const archive = forceZip64Archive(BZIP2_LINK_ZIP)
  const before = Buffer.from(archive)
  const first = await openCompatibilityLink(archive)
  const second = await openCompatibilityLink(archive)
  assert.equal(first.link.isLink, true)
  assert.equal(first.resolved.entry.name, 'docs/page.html')
  assert.equal(second.resolved.entry.name, 'docs/page.html')
  assert.equal(new TextDecoder().decode(await extract7zEntry(archive, first.resolved.entry, runtimeOptions)), '<h1>链接成员BZip2真实正文</h1>')
  assert.deepEqual(archive, before, 'ZIP64 隔离不得改写原归档')
})

test('ZIP64 隔离拒绝超出安全整数和目录边界矛盾且不修改输入', () => {
  const source = forceZip64Archive(BZIP2_LINK_ZIP)
  const locatorAt = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]))
  const recordAt = Number(source.readBigUInt64LE(locatorAt + 8))

  const unsafeCount = Buffer.from(source)
  unsafeCount.writeUInt32LE(0x00200000, recordAt + 36)
  const unsafeBefore = Buffer.from(unsafeCount)
  assert.throws(() => isolateZipMember(unsafeCount, 0), /安全范围/)
  assert.deepEqual(unsafeCount, unsafeBefore)

  const wrongCentralSize = Buffer.from(source)
  wrongCentralSize.writeBigUInt64LE(wrongCentralSize.readBigUInt64LE(recordAt + 40) + 1n, recordAt + 40)
  const wrongBefore = Buffer.from(wrongCentralSize)
  assert.throws(() => isolateZipMember(wrongCentralSize, 0), /边界不一致/)
  assert.deepEqual(wrongCentralSize, wrongBefore)
})

test('兼容内核 ZIP 链接可指向 AES 正文，解锁前不可打开、解锁后内容正确', async () => {
  const archive = appendStoredUnixSymlink(AES_ZIP, 'shortcut', '说明.txt')
  const locked = mergeZipEngineInspection(await inspect7zArchive(archive, runtimeOptions), inspectCentral(archive))
  assert.equal(locked.entries.find(entry => entry.name === '说明.txt').canOpen, false)
  const opened = await openCompatibilityLink(archive, { password: 'zip-rabbit-149' })
  const output = await extract7zEntry(archive, opened.resolved.entry, { ...runtimeOptions, password: 'zip-rabbit-149' })
  assert.equal(new TextDecoder().decode(output), '加密 ZIP 里的真实正文。')
})

test('兼容内核 ZIP 链接目标 CRC 被篡改时明确拒绝', async () => {
  const archive = BZIP2_LINK_ZIP
  const central = inspectCentral(archive)
  const native = await inspect7zArchive(archive, runtimeOptions)
  const merged = mergeZipEngineInspection(native, central)
  const link = merged.zipIdentityEntries.find(entry => entry.name === 'shortcut')
  await assert.rejects(extract7zLinkTarget(archive, { ...link, crc: (link.crc ^ 0xffffffff) >>> 0 }, runtimeOptions), /CRC/)
})

test('libarchive 公开 ZIP 链接样本打开真实文件正文', async () => {
  const central = inspectCentral(PUBLIC_SYMLINK_ZIP)
  const link = central.zipIdentityEntries.find(entry => entry.name === 'symlink')
  const resolved = await resolveZipLink(central.zipIdentityEntries, link, entry => require('../miniprogram/file-reader/engine/core/file-inspector').extractZipEntry(PUBLIC_SYMLINK_ZIP, entry, { maxSize: 4096 }))
  assert.equal(resolved.entry.name, 'file')
  assert.equal(new TextDecoder().decode(require('../miniprogram/file-reader/engine/core/file-inspector').extractZipEntry(PUBLIC_SYMLINK_ZIP, resolved.entry)), 'file\n')
})

test('libarchive 不支持方法样本只禁用坏链接，后续正文仍可打开', async () => {
  const central = inspectCentral(PUBLIC_UNSUPPORTED_LINK_ZIP)
  const native = await inspect7zArchive(PUBLIC_UNSUPPORTED_LINK_ZIP, runtimeOptions)
  const merged = mergeZipEngineInspection(native, central)
  const unsupported = merged.entries.find(entry => entry.name === 'bad_symlink')
  const second = merged.entries.find(entry => entry.name === 'second')
  assert.equal(unsupported.isLink, true)
  assert.equal(unsupported.canOpen, false)
  assert.match(unsupported.detail, /不支持/)
  assert.equal(second.canOpen, true)
  assert.equal(new TextDecoder().decode(await extract7zEntry(PUBLIC_UNSUPPORTED_LINK_ZIP, second, runtimeOptions)), 'hello world')
})
