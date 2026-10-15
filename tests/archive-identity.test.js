'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { combineZips, crc32, duplicateRar, duplicateSevenZip, duplicateZip } = require('./helpers/archive-duplicates')
const { buildArchiveTree, inspectZip, inspectZipCentral, extractZipEntry, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { renameSingleMemberZip } = require('./helpers/zip-legacy-compat')
const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const rar = require('../miniprogram/file-reader/archive/rar-runtime')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const rarWasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))
const members = ['first', 'other', 'third'].map(content => ({ name: 'same.txt', content }))

test('ZIP 目录保留同名成员、独立标识和正确正文', () => {
  const archive = duplicateZip(members)
  const entries = inspectZip(archive).entries
  assert.equal(entries.length, 3)
  assert.equal(new Set(entries.map(entry => entry.id)).size, 3)
  assert.deepEqual(entries.map(entry => entry.displayName), ['same.txt（同名 1/3）', 'same.txt（同名 2/3）', 'same.txt（同名 3/3）'])
  assert.deepEqual(entries.map(entry => Buffer.from(extractZipEntry(archive, entry)).toString()), members.map(member => member.content))
})

test('不同 Big5 原始字节解码成同名后仍逐项标识并打开各自正文', () => {
  const rawNames = [Buffer.from('a2a52e747874', 'hex'), Buffer.from('f9e92e747874', 'hex')]
  const archive = combineZips(rawNames.map((rawName, index) => renameSingleMemberZip(zipSync({ 'entry.txt': Buffer.from(`正文 ${index + 1}`) }, { level: 0 }), rawName)))
  const descriptor = readZipDirectoryDescriptor(archive)
  const inspection = inspectZipCentral(archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize), descriptor, { legacyEncoding: 'big5' })
  assert.deepEqual(inspection.entries.map(entry => entry.displayName), ['╞.txt（同名 1/2）', '╞.txt（同名 2/2）'])
  assert.deepEqual(inspection.entries.map(entry => Buffer.from(extractZipEntry(archive, entry)).toString()), ['正文 1', '正文 2'])
})

test('目录显示规范化后才标记同名，且保留每个成员原始身份', () => {
  const archive = duplicateZip([{ name: 'docs//same.txt', content: 'first' }, { name: 'docs/same.txt', content: 'second' }])
  const entries = inspectZip(archive).entries.filter(entry => !entry.isDirectory)
  assert.deepEqual(entries.map(entry => entry.displayName), ['same.txt（同名 1/2）', 'same.txt（同名 2/2）'])
  assert.deepEqual(entries.map(entry => entry.name), ['docs//same.txt', 'docs/same.txt'])
  assert.deepEqual(entries.map(entry => Buffer.from(extractZipEntry(archive, entry)).toString()), ['first', 'second'])
})

test('普通 ZIP 不把绝对路径规范化成可打开成员', () => {
  const archive = duplicateZip([{ name: '/same.txt', content: 'unsafe' }, { name: 'same.txt', content: 'safe' }])
  const entries = inspectZip(archive).entries.filter(entry => !entry.isDirectory)
  assert.equal(entries.find(entry => entry.name === '/same.txt').canOpen, false)
  assert.equal(entries.find(entry => entry.name === '/same.txt').displayName, '/same.txt')
  assert.match(entries.find(entry => entry.name === '/same.txt').detail, /路径不安全/)
  assert.equal(entries.find(entry => entry.name === 'same.txt').canOpen, true)
})

test('归档目录保留与目录同名的文件，不吞掉其中任何成员', () => {
  const tree = buildArchiveTree([{ id: 0, name: 'docs', isDirectory: false }, { id: 1, name: 'docs/first.txt', isDirectory: false }])
  assert.equal(tree.length, 3)
  assert.equal(tree.filter(entry => entry.isDirectory).length, 1)
  assert.deepEqual(tree.filter(entry => !entry.isDirectory).map(entry => entry.id), [0, 1])
})

for (const reverse of [false, true]) {
  for (const volume of [false, true]) {
    test(`7-Zip ${volume ? '分卷' : '单包'}按成员身份打开同名正文，中央目录反序=${reverse}`, async () => {
      const archive = duplicateZip(members, reverse)
      const options = { wasmBinary, archiveExtension: '.zip', archiveType: 'zip-engine', mainName: 'test.zip.001', format: 'zip' }
      const middle = Math.ceil(archive.length / 2)
      const volumes = [{ name: 'test.zip.001', bytes: archive.subarray(0, middle) }, { name: 'test.zip.002', bytes: archive.subarray(middle) }]
      const inspection = volume ? await seven.inspectArchiveVolumes(volumes, options) : await seven.inspect7zArchive(archive, options)
      assert.equal(inspection.entries.length, 3)
      // Native 7-Zip may reorder by physical offset; CRC identifies the oracle.
      const { crc32 } = require('./helpers/archive-duplicates')
      for (const entry of inspection.entries) {
        const expected = members.find(member => crc32(Buffer.from(member.content)) === parseInt(entry.crc, 16))
        const output = volume ? await seven.extractArchiveVolumeEntry(volumes, entry, options) : await seven.extract7zEntry(archive, entry, options)
        assert.equal(Buffer.from(output).toString(), expected.content, `id ${entry.id}`)
      }
    })
  }
}

test('RAR 内核目录不合并同名成员，逐个选择不同正文', async () => {
  const archive = duplicateRar(members)
  const options = { wasmBinary: rarWasm }
  const inspection = await rar.inspectRarArchive(archive, options)
  assert.equal(inspection.entries.length, 3)
  for (const [index, entry] of inspection.entries.entries()) {
    assert.equal(Buffer.from(await rar.extractRarEntry(archive, entry, options)).toString(), members[index].content)
  }
})

for (const password of ['', 'duplicate-fixture-142']) {
  test(`真实固实 7z 同名成员与空文件逐个打开，加密=${Boolean(password)}`, async () => {
    const variants = [...members, { name: 'same.txt', content: '' }]
    const archive = await duplicateSevenZip(variants, wasmBinary, password)
    const options = { wasmBinary, password }
    const inspection = await seven.inspect7zArchive(archive, options)
    assert.equal(inspection.entries.length, 4)
    for (const entry of inspection.entries) {
      const expected = variants.find(member => crc32(Buffer.from(member.content)) === parseInt(entry.crc || '0', 16))
      assert.ok(expected)
      const output = await seven.extract7zEntry(archive, entry, options)
      assert.equal(Buffer.from(output).toString(), expected.content)
    }
    if (password) {
      const target = inspection.entries.find(entry => entry.uncompressedSize > 0)
      await assert.rejects(seven.extract7zEntry(archive, target, { ...options, password: 'wrong-password' }))
      assert.equal((await seven.extract7zEntry(archive, target, options)).length, 5)
    }
  })
}

test('同名成员覆盖中文、字面通配符、空格、空内容和连续重复打开', async () => {
  const names = ['same.txt', '资料/说明.txt', 'report*.txt', ' note?.txt ', '@same.txt', '-same.txt']
  for (const name of names) {
    const variants = members.map(member => ({ ...member, name }))
    const archive = duplicateZip(variants)
    const options = { wasmBinary, archiveExtension: '.zip' }
    const inspection = await seven.inspect7zArchive(archive, options)
    for (const index of [2, 0, 1, 0, 2]) {
      assert.equal(Buffer.from(await seven.extract7zEntry(archive, inspection.entries[index], options)).toString(), variants[index].content)
    }
  }
})

test('同名成员选中空文件不返回其他正文，错误元数据不能误通过', async () => {
  const archive = duplicateZip([{ name: 'same.txt', content: '' }, ...members])
  const options = { wasmBinary, archiveExtension: '.zip' }
  const inspection = await seven.inspect7zArchive(archive, options)
  assert.equal((await seven.extract7zEntry(archive, inspection.entries[0], options)).length, 0)
  await assert.rejects(seven.extract7zEntry(archive, { ...inspection.entries[1], uncompressedSize: 0 }, options), /大小不匹配/)
  await assert.rejects(seven.extract7zEntry(archive, { ...inspection.entries[1], crc: '00000000' }, options), /CRC/)
  assert.equal(Buffer.from(await seven.extract7zEntry(archive, inspection.entries[1], options)).toString(), 'first')
})

test('同名成员中未选中的大文件及坏 CRC 不阻止正常文件，选中损坏仍拒绝', async () => {
  const archive = duplicateZip([{ name: 'same.txt', content: Buffer.alloc(65536, 65) }, ...members])
  // Damage the first member payload while retaining its original CRC.
  archive[30 + Buffer.byteLength('same.txt')] ^= 1
  const options = { wasmBinary, archiveExtension: '.zip' }
  const inspection = await seven.inspect7zArchive(archive, options)
  const output = await seven.extract7zEntry(archive, inspection.entries[1], { ...options, maxSize: 16 })
  assert.equal(Buffer.from(output).toString(), 'first')
  await assert.rejects(seven.extract7zEntry(archive, inspection.entries[0], options))
  assert.equal(Buffer.from(await seven.extract7zEntry(archive, inspection.entries[3], options)).toString(), 'third')
})

test('真实 MEMFS 写入仅包含选中同名成员，不临时展开未选中大文件', async () => {
  const runtimePath = path.join(__dirname, '../miniprogram/file-reader/archive/sevenzip-runtime.js')
  const realRequire = createRequire(runtimePath)
  const writes = []
  const module = { exports: {} }
  const sevenZipPath = '../../sevenzip/runtime/7zz.js'
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), {
    module, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, process,
    require (id) {
      if (id !== './kernel') return realRequire(id)
      const kernel = realRequire(id)
      return { ...kernel, subpackageLoader: { load: relativePath => Promise.resolve(relativePath === sevenZipPath ? wrappedSevenZip : kernel.subpackageLoader.load(relativePath)) } }
    }
  }, { filename: runtimePath })
  async function wrappedSevenZip (options) {
    const engine = await require('../miniprogram/file-reader/sevenzip/runtime/7zz')(options)
    const original = engine.FS.write.bind(engine.FS)
    engine.FS.write = (stream, buffer, offset, length, position, canOwn) => {
      if (engine.FS.getPath(stream.node).startsWith('/rabbit-reader-output-') && length) writes.push(length)
      return original(stream, buffer, offset, length, position, canOwn)
    }
    return engine
  }
  const archive = duplicateZip([{ name: 'same.txt', content: Buffer.alloc(65536, 65) }, ...members])
  const options = { wasmBinary, archiveExtension: '.zip', maxSize: 16 }
  const inspection = await module.exports.inspect7zArchive(archive, options)
  const output = await module.exports.extract7zEntry(archive, inspection.entries[1], options)
  assert.equal(Buffer.from(output).toString(), 'first')
  assert.ok(writes.length > 0, 'must observe actual WASM file writes')
  assert.equal(writes.reduce((sum, length) => sum + length, 0), 5)
})

test('先遇到加密包缺密码，再打开同名成员，不沿用原生 stdin 的 EOF 状态', async () => {
  const source = fs.readFileSync(path.join(__dirname, '7z-runtime.test.js'), 'utf8')
  const match = source.match(/const ENCRYPTED_7Z = Buffer.from\('([^']+)'/)
  assert.ok(match)
  await assert.rejects(seven.inspect7zArchive(Buffer.from(match[1], 'base64'), { wasmBinary }))
  const archive = duplicateZip(members)
  const options = { wasmBinary, archiveExtension: '.zip' }
  const entries = (await seven.inspect7zArchive(archive, options)).entries
  assert.equal(Buffer.from(await seven.extract7zEntry(archive, entries[0], options)).toString(), 'first')
})
