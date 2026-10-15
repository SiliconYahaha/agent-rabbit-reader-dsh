'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const test = require('node:test')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const { files, names, nativeNamesArchive } = require('./helpers/archive-native-names')
const { duplicateZip, headerEncryptedDuplicateSevenZip } = require('./helpers/archive-duplicates')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { createNativeListing, MAX_MEMBERS, MAX_METADATA_CHARS, MAX_FIELD_CHARS } = require('../miniprogram/file-reader/sevenzip/runtime/native-listing')
const { buildArchiveTree } = require('../miniprogram/file-reader/engine/core/file-inspector')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))

for (const format of ['zip', '7z', 'encrypted-7z', 'volumes']) {
  test(`${format} 原生目录精确保留控制字符和字段伪装名称，逐项解压真实内容`, async () => {
    const password = format === 'encrypted-7z' ? 'native-fixture-password' : ''
    const bytes = await nativeNamesArchive(wasmBinary, format, password)
    const options = { wasmBinary, password, archiveExtension: format === 'zip' ? '.zip' : '.7z', format: '7z', mainName: 'native.7z.001' }
    const middle = Math.ceil(bytes.length / 2)
    const volumes = [{ name: 'native.7z.001', bytes: bytes.subarray(0, middle) }, { name: 'native.7z.002', bytes: bytes.subarray(middle) }]
    const result = format === 'volumes' ? await seven.inspectArchiveVolumes(volumes, options) : await seven.inspect7zArchive(bytes, options)
    const entries = result.entries.filter(entry => !entry.isDirectory)
    assert.deepEqual(entries.map(entry => entry.name).sort(), names.slice().sort())
    assert.equal(new Set(entries.map(entry => entry.memberIndex)).size, names.length)
    for (const entry of entries) {
      assert.equal(entry.duplicateCount, 1)
      assert.equal(entry.canOpen, true)
      const output = format === 'volumes' ? await seven.extractArchiveVolumeEntry(volumes, entry, options) : await seven.extract7zEntry(bytes, entry, options)
      assert.deepEqual(Buffer.from(output), files[entry.name])
    }
  })
}

test('7z 字面反斜杠文件名与真实目录路径分开显示并打开对应正文', async () => {
  const bytes = await nativeNamesArchive(wasmBinary, '7z')
  const options = { wasmBinary, archiveExtension: '.7z' }
  const { entries } = await seven.inspect7zArchive(bytes, options)
  const literal = entries.find(entry => entry.name === 'literal\\backslash.html')
  const nested = entries.find(entry => entry.name === 'literal/backslash.html')
  assert.ok(literal)
  assert.ok(nested)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(bytes, literal, options)), files[literal.name])
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(bytes, nested, options)), files[nested.name])
  const tree = buildArchiveTree(entries)
  assert.ok(tree.some(entry => entry.name === literal.name && entry.displayName === 'literal\\backslash.html' && entry.depth === 0))
  assert.ok(tree.some(entry => entry.name === nested.name && entry.displayName === 'backslash.html' && entry.depth === 1))
})

test('7z 加密文件头中的同名字面反斜杠成员保留序号、正文和分卷身份', async () => {
  const password = 'header-duplicate-password'
  const members = [
    { name: 'same\\name.html', content: '' },
    { name: 'same\\name.html', content: 'second-body' },
    { name: 'same/name.html', content: 'nested-decoy' }
  ]
  const bytes = await headerEncryptedDuplicateSevenZip(members, wasmBinary, password)
  const options = { wasmBinary, password, archiveExtension: '.7z' }
  await assert.rejects(seven.inspect7zArchive(bytes, { ...options, password: 'wrong' }), /密码不正确/)
  const inspection = await seven.inspect7zArchive(bytes, options)
  assert.deepEqual(inspection.entries.map(entry => entry.name), members.map(member => member.name))
  assert.deepEqual(inspection.entries.map(entry => entry.duplicateCount), [2, 2, 1])
  for (let index = 0; index < members.length; index++) {
    assert.equal(Buffer.from(await seven.extract7zEntry(bytes, inspection.entries[index], options)).toString(), members[index].content)
  }
  const split = Math.ceil(bytes.length / 2)
  const volumes = [
    { name: 'duplicate.7z.001', bytes: bytes.subarray(0, split) },
    { name: 'duplicate.7z.002', bytes: bytes.subarray(split) }
  ]
  const volumeOptions = { ...options, format: '7z', mainName: 'duplicate.7z.001' }
  const volumeInspection = await seven.inspectArchiveVolumes(volumes, volumeOptions)
  assert.deepEqual(volumeInspection.entries.map(entry => entry.name), members.map(member => member.name))
  for (let index = 0; index < members.length; index++) {
    assert.equal(Buffer.from(await seven.extractArchiveVolumeEntry(volumes, volumeInspection.entries[index], volumeOptions)).toString(), members[index].content)
  }
})

test('原生控制字符名称的同名序号仍对应不同正文，而下划线文件不是同名', async () => {
  const members = [{ name: 'a\nb.txt', content: 'first' }, { name: 'a\nb.txt', content: 'other' }, { name: 'a_b.txt', content: 'decoy' }]
  const bytes = duplicateZip(members)
  const options = { wasmBinary, archiveExtension: '.zip' }
  const { entries } = await seven.inspect7zArchive(bytes, options)
  assert.deepEqual(entries.map(entry => entry.duplicateCount), [2, 2, 1])
  for (const index of [1, 2, 0, 1]) assert.equal(Buffer.from(await seven.extract7zEntry(bytes, entries[index], options)).toString(), members[index].content)
  const tree = buildArchiveTree(entries)
  assert.ok(tree.some(entry => entry.displayName === 'a⟦U+000A⟧b.txt（同名 1/2）' && entry.name === 'a\nb.txt'))
  assert.ok(tree.every(entry => !/[\n\r\t]/.test(entry.displayName)))
})

test('原生目录不会因伪造字段绕过大小、路径、CRC 边界；失败后普通包正常', async () => {
  const members = [{ name: 'a\nSize = 0.txt', content: 'more-than-one-byte' }, { name: '../a\nb.txt', content: 'unsafe' }]
  const bytes = duplicateZip(members)
  const options = { wasmBinary, archiveExtension: '.zip', maxEntrySize: 1 }
  const { entries } = await seven.inspect7zArchive(bytes, options)
  assert.equal(entries[0].canOpen, false)
  assert.equal(entries[1].canOpen, false)
  await assert.rejects(seven.extract7zEntry(bytes, entries[0], { ...options, maxSize: 1 }), /超过/)
  await assert.rejects(seven.extract7zEntry(bytes, entries[1], options), /不安全/)
  const corrupted = Buffer.from(bytes)
  corrupted[30 + Buffer.byteLength(members[0].name)] ^= 1
  await assert.rejects(seven.extract7zEntry(corrupted, entries[0], options), /CRC/)
  assert.equal(Buffer.from(await seven.extract7zEntry(bytes, entries[0], options)).toString(), members[0].content)
})

test('7z 字面反斜杠可用，Windows 盘符和反斜杠越界路径仍被拒绝', () => {
  assert.equal(seven.safeArchivePath('literal\\backslash.html'), true)
  assert.equal(seven.safeArchivePath('folder\\child.html'), true)
  assert.equal(seven.safeArchivePath('C:\\escape.html'), false)
  assert.equal(seven.safeArchivePath('c:relative.html'), false)
  assert.equal(seven.safeArchivePath('folder\\..\\escape.html'), false)
})

const fields = { Size: '5', 'Packed Size': '5', Encrypted: '-', Method: 'Copy', CRC: '12345678', 'Symbolic Link': '', 'Hard Link': '', 'Copy Link': '', AttributesRaw: '', PosixAttributesRaw: '', Characteristics: '' }
function row (listing, index = 0, overrides = {}) {
  listing.entry(index, 'a\nb.txt', false)
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) listing.field(index, key, value)
}

test('空归档与带原生索引间隙的完整目录有效，缺少回调不能冒充空包', () => {
  const empty = createNativeListing()
  assert.throws(() => empty.finish(), /不完整/)
  empty.boundary('begin', 0); empty.boundary('end', 0)
  assert.deepEqual(empty.finish(), [])
  const gap = createNativeListing()
  gap.boundary('begin', 3); row(gap, 2); gap.boundary('end', 1)
  assert.equal(gap.finish()[0].index, 2)
})

test('目录协议拒绝重复标识、顺序错误、未知字段、缺字段和超大数值', () => {
  for (const mutate of [
    c => c.entry(0, 'a', false),
    c => { c.boundary('begin', 1); row(c); c.entry(0, 'b', false) },
    c => { c.boundary('begin', 1); c.entry(1, 'b', false) },
    c => { c.boundary('begin', 1); c.entry(0, 'a', false); c.field(0, 'Path', 'fake') },
    c => { c.boundary('begin', 1); c.entry(0, 'a', false); c.boundary('end', 1); c.finish() },
    c => { c.boundary('begin', 1); row(c, 0, { Size: '9007199254740992' }); c.boundary('end', 1); c.finish() },
    c => { c.boundary('begin', 1); row(c, 0, { CRC: 'fake' }); c.boundary('end', 1); c.finish() },
    c => { c.boundary('begin', 1); row(c); c.boundary('end', 0) },
    c => { c.boundary('begin', 1); c.entry(0, 'a\0b', false) }
  ]) assert.throws(() => mutate(createNativeListing()), /不完整/)
})

test('目录成员数、单字段和合计文字均有限额', () => {
  assert.throws(() => createNativeListing().boundary('begin', MAX_MEMBERS + 1), /10000/)
  const field = createNativeListing(); field.boundary('begin', 1)
  assert.throws(() => field.entry(0, 'a'.repeat(MAX_FIELD_CHARS + 1), false), /文字超过/)
  const total = createNativeListing(); total.boundary('begin', MAX_MEMBERS)
  assert.throws(() => { for (let i = 0; i <= MAX_METADATA_CHARS / MAX_FIELD_CHARS; i++) total.entry(i, 'a'.repeat(MAX_FIELD_CHARS), false) }, /文字超过/)
})

test('原生内核缺少身份 API 或丢失结束回调时不能退回文本目录', async () => {
  const filename = path.join(__dirname, '../miniprogram/file-reader/archive/sevenzip-runtime.js')
  const realRequire = createRequire(filename)
  for (const old of [true, false]) {
    const module = { exports: {} }
    const sevenZipPath = '../../sevenzip/runtime/7zz.js'
    const wrappedSevenZip = async options => {
      const original = options.rabbitOnListing
      options.rabbitOnListing = (phase, count) => { if (phase !== 'end') original(phase, count) }
      const engine = await require('../miniprogram/file-reader/sevenzip/runtime/7zz')(options)
      if (old) engine._rabbit_reader_listing_version = undefined
      return engine
    }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, process,
      require (id) {
        if (id !== './kernel') return realRequire(id)
        const kernel = realRequire(id)
        return { ...kernel, subpackageLoader: { load: relativePath => Promise.resolve(relativePath === sevenZipPath ? wrappedSevenZip : kernel.subpackageLoader.load(relativePath)) } }
      }
    }, { filename })
    await assert.rejects(module.exports.inspect7zArchive(duplicateZip([{ name: 'a', content: 'a' }]), { wasmBinary }), old ? /版本不匹配/ : /不完整/)
  }
})
