'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib')
const { inspectZip, extractZipEntry, extractZipEntryPayload, zipEntryDataOffset, zipLocalHeaderLength } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { inflateRawBounded, MAX_BLOCKS } = require('../miniprogram/file-reader/engine/core/bounded-zlib')
const { zipMember, cases } = require('./helpers/zip-integrity')
function entryOf (archive) { return inspectZip(archive).entries.find(e => !e.isDirectory) }

test('ZIP 60 个 Store/Deflate/描述符变体逐字节打开，CRC零不是关闭校验', () => {
  for (const c of cases) {
    const zip = zipMember(c), entry = entryOf(zip)
    assert.deepEqual(Buffer.from(extractZipEntry(zip, entry)), c.content, c.name)
    const offset = zipEntryDataOffset(zip.subarray(0, zipLocalHeaderLength(zip.subarray(0, 30), entry)), entry)
    assert.deepEqual(Buffer.from(extractZipEntryPayload(zip.subarray(offset, offset + entry.compressedSize), entry)), c.content, c.name + ' range')
    const damaged = zipMember({ ...c, crc: 0 })
    assert.throws(() => extractZipEntry(damaged, entryOf(damaged)), /CRC/, c.name)
  }
})

test('合法非空CRC零、空文件、无数据空成员和描述符占位零均不误拒绝', () => {
  for (const content of [Buffer.alloc(0), Buffer.from('9d0ad96d', 'hex')]) {
    for (const method of [0, 8]) for (const descriptor of [false, 'signed', 'unsigned']) {
      const zip = zipMember({ content, method, descriptor }), entry = entryOf(zip)
      assert.equal(entry.crc, 0)
      assert.deepEqual(Buffer.from(extractZipEntry(zip, entry)), content)
    }
  }
  const zip = zipMember({ packed: Buffer.alloc(0) })
  assert.equal(extractZipEntry(zip, entryOf(zip), { maxSize: 0 }).length, 0)
  assert.throws(() => extractZipEntry(zip, { ...entryOf(zip), crc: 1 }), /CRC/)
})

test('ZIP 无效校验值、声明长度、显式零/非法预算不能跳过限制', () => {
  const zip = zipMember({ content: 'text' }), entry = entryOf(zip)
  for (const crc of [undefined, null, -1, 0x100000000, NaN, 1.5, '00000000']) assert.throws(() => extractZipEntry(zip, { ...entry, crc }), /CRC/)
  for (const size of [NaN, Infinity, -1, 1.5]) assert.throws(() => extractZipEntryPayload(Buffer.alloc(0), { ...entry, uncompressedSize: size }), /长度|超过/)
  for (const maxSize of [0, NaN, Infinity, -1, 1.5]) assert.throws(() => extractZipEntry(zip, entry, { maxSize }), /上限|超过/)
  const stored = zipMember({ content: 'four', method: 0, size: 0 })
  assert.throws(() => extractZipEntry(stored, entryOf(stored)), /大小/)
})

test('Raw DEFLATE 各尺寸、压缩策略和窗口结果与 Node 原生逐字节一致', () => {
  let checked = 0
  for (const size of [0, 1, 17, 32769, 70001]) for (const kind of [0, 1, 2]) for (const strategy of [0, 2, 3, 4]) for (const level of [0, 9]) {
    let seed = 81397
    const plain = Buffer.from(Array.from({ length: size }, (_, i) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return kind === 0 ? 0 : kind === 1 ? i % 251 : seed & 255 }))
    const raw = zlib.deflateRawSync(plain, { level, strategy, windowBits: kind === 1 ? 9 : 15 })
    assert.deepEqual(Buffer.from(inflateRawBounded(raw, plain.length)), plain)
    assert.deepEqual(zlib.inflateRawSync(raw), plain)
    checked++
  }
  assert.equal(checked, 120)
})

test('ZIP 解压在首次越界写入前停止，不先分配完整膨胀内容', () => {
  const allocations = []
  class U8 extends Uint8Array { constructor (...args) { super(...args); allocations.push(this.byteLength) } }
  class U16 extends Uint16Array { constructor (...args) { super(...args); allocations.push(this.byteLength) } }
  const scope = { module: { exports: {} }, Uint8Array: U8, Uint16Array: U16 }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/file-reader/engine/core/bounded-zlib'), 'utf8'), scope)
  for (const options of [{ level: 0 }, { strategy: zlib.constants.Z_FIXED }, { level: 9 }]) {
    const raw = zlib.deflateRawSync(Buffer.alloc(4 * 1024 * 1024, 65), options)
    allocations.length = 0
    let reads = 0
    const observed = new Proxy(raw, { get (target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, target) } })
    assert.throws(() => scope.module.exports.inflateRawBounded(observed, 20, 80), /实际解压.*上限/)
    assert.ok(allocations.includes(20))
    assert.ok(allocations.every(size => size <= 65536))
    assert.ok(allocations.reduce((sum, size) => sum + size, 0) < 140000)
    assert.ok(reads < 1024, String(reads))
    const zip = zipMember({ packed: raw, content: 'twenty chars only!!!!', size: 20 })
    assert.throws(() => extractZipEntry(zip, entryOf(zip), { maxSize: 80 }), /实际解压.*上限/)
  }
})

test('ZIP raw流截断、额外整字节、错误大小和stored补码明确拒绝', () => {
  const content = Buffer.from('content 中文'.repeat(100)), raw = zlib.deflateRawSync(content)
  for (let i = 0; i < raw.length; i++) assert.throws(() => inflateRawBounded(raw.subarray(0, i), content.length))
  for (const size of [content.length - 1, content.length + 1]) assert.throws(() => inflateRawBounded(raw, size), /长度/)
  assert.throws(() => inflateRawBounded(Buffer.concat([raw, Buffer.from([0])]), content.length), /额外/)
  // Node's inflater accepts trailing bytes; intentionally record stricter ZIP payload policy.
  assert.deepEqual(zlib.inflateRawSync(Buffer.concat([raw, Buffer.from([0])])), content)
  assert.throws(() => inflateRawBounded(Buffer.from([1, 1, 0, 1, 0, 65]), 1), /校验/)
})

test('ZIP 仅恢复正文后的完整零输出 Deflate 流，随机尾字节和第二正文仍拒绝', () => {
  const content = Buffer.from('带空尾流的真实正文\n'.repeat(40))
  const raw = zlib.deflateRawSync(content)
  const emptyFixed = Buffer.from([0x03, 0x00])
  const emptyStored = Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff])
  for (const tail of [emptyFixed, emptyStored, Buffer.concat([emptyFixed, emptyStored]), Buffer.concat(Array(4).fill(emptyFixed))]) {
    const zip = zipMember({ content, packed: Buffer.concat([raw, tail]) })
    assert.deepEqual(Buffer.from(extractZipEntry(zip, entryOf(zip))), content)
  }
  for (const tail of [Buffer.from([0]), Buffer.from([0x03]), Buffer.from([0x03, 0x00, 0]), zlib.deflateRawSync('第二正文'), Buffer.concat(Array(5).fill(emptyFixed))]) {
    const zip = zipMember({ content, packed: Buffer.concat([raw, tail]) })
    assert.throws(() => extractZipEntry(zip, entryOf(zip)), /DEFLATE|额外|上限/)
  }
  const wrongCrc = zipMember({ content, packed: Buffer.concat([raw, emptyFixed]), crc: 1 })
  assert.throws(() => extractZipEntry(wrongCrc, entryOf(wrongCrc)), /CRC/)
  const blockTail = Buffer.concat(Array.from({ length: MAX_BLOCKS }, (_, index) => Buffer.from([index === MAX_BLOCKS - 1 ? 1 : 0, 0, 0, 0xff, 0xff])))
  const blockBudgetZip = zipMember({ content, packed: Buffer.concat([raw, blockTail]) })
  assert.throws(() => extractZipEntry(blockBudgetZip, entryOf(blockBudgetZip)), /区块数量.*上限/)
})

test('公开 ZIP 原件哈希不变，正常及恢复正文正确，损坏描述符明确拒绝', () => {
  const crypto = require('node:crypto'), hash = b => crypto.createHash('sha256').update(b).digest('hex')
  for (const [name, expected] of [
    ['LICENSE.txt', '51b88fd3e9e24edcdce1dd145a4fca2dcd12911407f00b06dfa6ff600f9733c1'],
    ['NOTICE.txt', '5318998af3591f72e0e3e80667d32ba334c080399011a767f93e611d907036ca']
  ]) assert.equal(hash(fs.readFileSync(path.join(__dirname, 'fixtures/zip-integrity', name))), expected)
  for (const sample of require('./fixtures/zip-integrity/samples.json')) {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/zip-integrity', sample.name))
    assert.equal(hash(bytes), sample.sha256)
    if (sample.readerError) { assert.throws(() => inspectZip(bytes), /恢复/); continue }
    const entries = inspectZip(bytes).entries
    assert.deepEqual(entries.map(e => e.name), sample.entries.map(e => e.name))
    for (let i = 0; i < entries.length; i++) {
      const actual = extractZipEntry(bytes, entries[i]), expected = sample.entries[i]
      assert.equal(actual.length, expected.size)
      assert.equal(hash(actual), expected.sha256)
    }
  }
})
