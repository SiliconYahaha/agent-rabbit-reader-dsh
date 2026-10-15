'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { inspectZip, inspectZipCentral, extractZipEntry, zipLocalHeaderLength, zipEntryDataOffset, extractZipEntryPayload, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { zipMember } = require('./helpers/zip-integrity')
const { combineZips } = require('./helpers/archive-duplicates')
const { localNameMismatch, localZip64, withLocalExtra, variants } = require('./helpers/zip-local-identity')
const fileEntry = bytes => inspectZip(bytes).entries.find(e => !e.isDirectory)
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const contentOf = bytes => Buffer.from(extractZipEntry(bytes, fileEntry(bytes)))

test('60种ZIP整包与分段入口拒绝同长度原始名称冲突，正文CRC相同也不能放行', () => {
  for (const variant of variants) {
    const normal = zipMember(variant), damaged = localNameMismatch(variant), entry = fileEntry(damaged)
    const before = hash(damaged)
    assert.deepEqual(contentOf(normal), variant.content)
    assert.throws(() => extractZipEntry(damaged, entry), /文件名不一致/)
    const size = zipLocalHeaderLength(damaged.subarray(0, 30), entry)
    assert.throws(() => zipEntryDataOffset(damaged.subarray(0, size), entry), /文件名不一致/)
    assert.equal(hash(damaged), before)
  }
})

test('名称长度、压缩方法、标记、CRC和本地大小不一致均拒绝，损坏内容不进入解压', () => {
  const source = zipMember({ name: 'safe.txt', content: 'real body', method: 0 })
  for (const [at, width, value, expected] of [
    [26, 2, 7, /名称|文件名/], [8, 2, 8, /方法/], [6, 2, 0, /标记/],
    [6, 2, 0x801, /标记/], [6, 2, 0x808, /标记/], [14, 4, 0, /CRC/],
    [18, 4, 0, /大小/], [22, 4, 0, /大小/]
  ]) {
    const bytes = Buffer.from(source); bytes[width === 2 ? 'writeUInt16LE' : 'writeUInt32LE'](value, at)
    assert.throws(() => extractZipEntry(bytes, fileEntry(bytes)), expected)
  }
  const entry = fileEntry(source)
  assert.throws(() => zipLocalHeaderLength(source.subarray(0, 29), entry), /位置/)
  assert.throws(() => zipLocalHeaderLength(source, { ...entry, zipRawName: undefined }), /原始文件名/)
  const headerSize = zipLocalHeaderLength(source, entry)
  for (let n = 30; n < headerSize; n++) assert.throws(() => zipEntryDataOffset(source.subarray(0, n), entry), /不完整/)
  assert.throws(() => zipEntryDataOffset(source, { ...entry, zipCentralOffset: 35 }), /重叠/)
})

test('ZIP64本地大小、描述符占位及任意合法本地extra保留真实正文', () => {
  for (const method of [0, 8]) for (const descriptor of [false, 'signed', 'unsigned']) {
    const content = Buffer.from('ZIP64 占位、描述符和真实正文\n'.repeat(3))
    const bytes = localZip64({ name: 'zip64.txt', content, method, descriptor })
    assert.deepEqual(contentOf(bytes), content)
    const entry = fileEntry(bytes), length = zipLocalHeaderLength(bytes.subarray(0, 30), entry)
    const start = zipEntryDataOffset(bytes.subarray(0, length), entry)
    assert.deepEqual(Buffer.from(extractZipEntryPayload(bytes.subarray(start, start + entry.compressedSize), entry)), content)
    if (!descriptor) {
      const damaged = Buffer.from(bytes); damaged[30 + Buffer.byteLength('zip64.txt') + 4] ^= 1
      assert.throws(() => contentOf(damaged), /大小/)
    }
  }
  // Maximum 16-bit extra length, unrelated field data must not be interpreted
  // as file names, and declared header truncation cannot skip validation.
  const extra = Buffer.alloc(65535); extra.writeUInt16LE(0x1234); extra.writeUInt16LE(65531, 2)
  const bytes = withLocalExtra(zipMember({ content: 'large extra' }), extra)
  assert.equal(contentOf(bytes).toString(), 'large extra')
  const entry = fileEntry(bytes), n = zipLocalHeaderLength(bytes, entry)
  assert.throws(() => zipEntryDataOffset(bytes.subarray(0, n - 1), entry), /不完整/)
})

test('比较原始名称而非解码结果：旧编码、UTF8、反斜线和65535-byte名称仍正确', () => {
  const names = [Buffer.from('目录/名字😀.txt'), Buffer.from('dir\\body.txt'), Buffer.alloc(65535, 97)]
  for (let b = 128; b <= 255; b++) names.push(Buffer.from([b, 46, 116, 120, 116]))
  for (const name of names) {
    const bytes = zipMember({ name, content: 'identity body', method: 0 })
    bytes.writeUInt16LE(0, 6)
    const end = bytes.length - 22, centralAt = bytes.readUInt32LE(end + 16)
    bytes.writeUInt16LE(0, centralAt + 8)
    const descriptor = readZipDirectoryDescriptor(bytes)
    for (const legacyEncoding of ['auto', 'cp437']) {
      const entry = inspectZipCentral(bytes.subarray(centralAt, end), descriptor, { legacyEncoding }).entries.find(e => !e.isDirectory)
      assert.equal(entry.zipRawName.length, name.length)
      assert.equal(Buffer.from(extractZipEntry(bytes, entry)).toString(), 'identity body')
    }
  }
})

test('同名成员和逆序目录按各自本地头打开，不误用相邻成员或显示排序', () => {
  for (const reversed of [false, true]) {
    const bytes = combineZips(['first', 'second'].map(content => zipMember({ name: 'same.txt', content })), reversed)
    const entries = inspectZip(bytes).entries
    assert.deepEqual(entries.map(e => Buffer.from(extractZipEntry(bytes, e)).toString()), reversed ? ['second', 'first'] : ['first', 'second'])
    assert.notEqual(entries[0].localHeaderOffset, entries[1].localHeaderOffset)
  }
})

test('三个公开原件保留字节身份；七项正文含空尾随Deflate流均成功', () => {
  for (const sample of require('./fixtures/zip-local-identity/samples.json')) {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/zip-local-identity', sample.name))
    assert.equal(hash(bytes), sample.sha256)
    const entries = inspectZip(bytes).entries.filter(e => !e.isDirectory)
    assert.deepEqual(entries.map(e => e.name), sample.entries.map(e => e.name))
    for (let n = 0; n < entries.length; n++) {
      const entry = entries[n], expected = sample.entries[n]
      const length = zipLocalHeaderLength(bytes.subarray(entry.localHeaderOffset, entry.localHeaderOffset + 30), entry)
      assert.ok(zipEntryDataOffset(bytes.subarray(entry.localHeaderOffset, entry.localHeaderOffset + length), entry) > entry.localHeaderOffset)
      const output = extractZipEntry(bytes, entry)
      assert.equal(output.length, expected.size); assert.equal(hash(output), expected.sha256)
    }
    assert.equal(hash(bytes), sample.sha256)
  }
})
