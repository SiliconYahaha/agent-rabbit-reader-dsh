'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { inspectZip, inspectZipCentral, recoverZipDirectory, extractZipEntry, MAX_ZIP_RECOVERY_BYTES } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { omittedDescriptors, recoveryMembers } = require('./helpers/zip-recovery')
const { zipMember } = require('./helpers/zip-integrity')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const read = name => fs.readFileSync(path.join(__dirname, 'fixtures/zip-integrity', name))

test('signed/unsigned 原件恢复全部正文；Buffer、子视图和 ArrayBuffer 原件不被改写', () => {
  const expected = inspectZip(read('bla-stored.zip')).entries.map(e => hash(extractZipEntry(read('bla-stored.zip'), e)))
  for (const name of ['bla-stored-dd.zip', 'bla-stored-dd-nosig.zip']) {
    const original = read(name)
    const padded = new Uint8Array(original.length + 12); padded.set(original, 6)
    for (const input of [Buffer.from(original), new Uint8Array(original), padded.subarray(6, 6 + original.length), Uint8Array.from(original).buffer]) {
      const result = inspectZip(input)
      assert.match(result.summary, /已核对全部内容并恢复/)
      assert.deepEqual(result.entries.map(e => e.name), ['test1.xml', 'test2.xml'])
      assert.deepEqual(result.entries.map(e => hash(extractZipEntry(input, e))), expected)
      const view = input instanceof ArrayBuffer ? new Uint8Array(input) : input
      assert.equal(hash(view), hash(original))
    }
  }
})

test('120个长度/Store/Deflate/描述符组合恢复精确字节，普通有效包仍走原路径', () => {
  for (let n = 0; n < 120; n++) {
    const members = [
      { name: 'first.txt', content: 'A😀中文'.repeat(n), method: n % 2 ? 0 : 8, descriptor: n % 3 ? 'signed' : 'unsigned', zlib: { level: n % 10 } },
      { name: 'second.txt', content: 'PK\x03\x04伪签名不应被扫描'.repeat(n + 1), method: n % 2 ? 8 : 0, descriptor: n % 4 ? false : 'unsigned' }
    ]
    const bytes = omittedDescriptors(members)
    const entries = inspectZip(bytes).entries
    entries.forEach((e, i) => assert.deepEqual(Buffer.from(extractZipEntry(bytes, e)), Buffer.from(members[i].content)))
    const normal = zipMember(members[0])
    assert.doesNotMatch(inspectZip(normal).summary, /恢复/)
  }
})

test('多次遗漏与同名记录保留身份，重新选择名称编码不丢失恢复偏移', () => {
  const bytes = omittedDescriptors(recoveryMembers), originalHash = hash(bytes)
  const recovered = recoverZipDirectory(bytes)
  for (const legacyEncoding of ['auto', 'cp437', 'gb18030', 'utf-8']) {
    const entries = inspectZipCentral(recovered.central, recovered.descriptor, { legacyEncoding }).entries.filter(e => !e.isDirectory)
    const names = new Map(recoveryMembers.map(m => [m.content, m.name]))
    for (const e of entries) assert.equal(names.get(Buffer.from(extractZipEntry(bytes, e)).toString()), e.name)
    const duplicates = entries.filter(e => e.name === recoveryMembers[0].name)
    assert.equal(duplicates.length, 2)
    assert.notEqual(duplicates[0].id, duplicates[1].id)
    assert.notEqual(duplicates[0].localHeaderOffset, duplicates[1].localHeaderOffset)
  }
  assert.equal(hash(bytes), originalHash)
})

test('名称/方法/CRC/大小/描述符/偏移矛盾全部拒绝，失败也不改写输入', () => {
  const source = read('bla-stored-dd.zip')
  const mutations = [
    b => { b[30] ^= 1 }, b => { b[8] = 8 }, b => { b[14] = 1 },
    b => { b[67] ^= 1 }, b => { b[677] ^= 1 }, b => { b[681] ^= 1 },
    b => { b[685] ^= 1 }, b => { b[689] ^= 1 }, b => { b[842 + 42] = 1 },
    b => { b[921 + 42] ^= 1 }, b => { b[842 + 8] |= 1 }, b => { b[842 + 34] = 1 },
    b => { b[1000 + 8] = 1 }, b => { b[1000 + 20] = 1 }, b => { b[1000 + 16] ^= 1 },
    b => { b[842 + 28] = 0 }, b => { b[842 + 24] ^= 1 }
  ]
  for (const mutate of mutations) {
    const bytes = Buffer.from(source); mutate(bytes); const before = hash(bytes)
    assert.throws(() => recoverZipDirectory(bytes), /恢复|CRC/)
    assert.equal(hash(bytes), before)
  }
  for (let n = 0; n < source.length; n++) assert.throws(() => recoverZipDirectory(source.subarray(0, n)))
})

test('不绕过中央目录、扫描伪签名或自动接受ZIP64/逆序/大包', () => {
  const source = read('bla-stored-dd.zip')
  const prefixed = Buffer.concat([Buffer.from('prefix'), source])
  assert.throws(() => recoverZipDirectory(prefixed), /恢复/)
  const reordered = Buffer.from(source)
  source.subarray(921, 1000).copy(reordered, 842); source.subarray(842, 921).copy(reordered, 921)
  assert.throws(() => recoverZipDirectory(reordered), /恢复/)
  const zip64 = Buffer.from(source); zip64.writeUInt16LE(0xffff, 1010)
  assert.throws(() => recoverZipDirectory(zip64), /ZIP64/)
  assert.throws(() => recoverZipDirectory(Buffer.alloc(MAX_ZIP_RECOVERY_BYTES + 1)), /8 MB/)
  const many = omittedDescriptors(Array.from({ length: 501 }, (_, n) => ({ content: '', name: n + '.txt', method: 0, descriptor: 'signed' })))
  assert.throws(() => recoverZipDirectory(many), /500/)
  const oversized = omittedDescriptors([{ content: 'tiny', size: 20 * 1024 * 1024 + 1, descriptor: 'signed' }])
  assert.throws(() => recoverZipDirectory(oversized), /20 MB/)
  const bomb = omittedDescriptors([{ content: Buffer.alloc(4 * 1024 * 1024, 65), size: 20, descriptor: 'signed' }])
  assert.throws(() => recoverZipDirectory(bomb), /实际解压.*上限/)
})

test('公开描述符尺寸损坏原件仍拒绝，不能为兼容而忽略CRC或长度', () => {
  for (const name of ['bla-stored-dd-sizes-differ.zip', 'bla-stored-dd-contradicts-actualsize.zip']) {
    assert.throws(() => inspectZip(read(name)), /恢复|CRC/)
  }
})
