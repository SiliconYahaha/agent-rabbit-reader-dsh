'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { zipMember } = require('./helpers/zip-integrity')
const { storedZipWithUnicodePaths } = require('./helpers/zip-unicode-path')
const { inspectZip, inspectZipCentral, readZipDirectoryDescriptor, extractZipEntry } = require('../miniprogram/file-reader/engine/core/file-inspector')
const invalid = ['ff', 'c3', 'c0af', 'eda080', 'f4908080']
const content = 'UNIQUE VISIBLE BODY'
const name = hex => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.from('.txt')])
const central = (bytes, legacyEncoding = 'auto') => {
  const d = readZipDirectoryDescriptor(bytes)
  return inspectZipCentral(bytes.subarray(d.offset, d.offset + d.centralSize), d, { legacyEncoding })
}
const invalidName = error => error.code === 'ZIP_INVALID_UTF8_NAME' && /UTF-8/.test(error.message)

for (const method of [0, 8]) test('ZIP EFS rejects malformed UTF-8 names without guessing legacy bytes: method ' + method, () => {
  for (const hex of invalid) {
    const bytes = zipMember({ name: name(hex), content, method })
    for (const choice of ['auto', 'cp437', 'gb18030', 'utf-8']) assert.throws(() => central(bytes, choice), invalidName)
    assert.throws(() => inspectZip(bytes), invalidName)
  }
})

test('ZIP EFS authority cannot be replaced by a valid Unicode Path extra field', () => {
  const bytes = storedZipWithUnicodePaths({ rawName: name('ff'), flags: 0x800, unicodePaths: [{ name: '伪装.txt' }], content })
  assert.throws(() => inspectZip(bytes), invalidName)
  const valid = storedZipWithUnicodePaths({ rawName: '正常🐇.txt', flags: 0x800, unicodePaths: [{ name: '过期.txt' }], content })
  assert.equal(inspectZip(valid).entries[0].name, '正常🐇.txt')
})

test('ZIP unflagged legacy filenames and valid UTF-8 keep exact visible content', () => {
  for (const raw of [...invalid.map(name), Buffer.from('正常🐇.txt')]) for (const efs of [false, true]) {
    if (efs && raw[0] !== 0xe6) continue
    const bytes = zipMember({ name: raw, content, method: 8 })
    if (!efs) {
      bytes.writeUInt16LE(0, 6)
      bytes.writeUInt16LE(0, readZipDirectoryDescriptor(bytes).offset + 8)
    }
    const row = inspectZip(bytes).entries.find(e => !e.isDirectory)
    if (efs) assert.equal(row.name, '正常🐇.txt')
    assert.equal(Buffer.from(extractZipEntry(bytes, row)).toString(), content)
  }
})

test('ZIP file entry reports invalid EFS without full-file recovery, then opens the next file', async () => {
  const { readerPage } = require('./helpers/reader-host')
  let bytes, pending, reads
  const page = readerPage({ getFileSystemManager: () => ({}) })
  page.readFileRange = async (file, start, length) => { reads.push({ start, length }); return bytes.subarray(start, start + length) }
  const inspect = page.inspectZipFile
  page.inspectZipFile = function (...args) { return pending = inspect.apply(this, args) }
  try {
    for (const rawName of [name('ff'), '正常.txt', name('c3'), '恢复.txt']) {
      bytes = zipMember({ name: rawName, content, method: 0 }); reads = []
      page.openSelectedFile({ name: 'styles.zip', path: '/local/same.zip', size: bytes.length })
      await pending
      assert.equal(reads.length, 2, 'only tail and directory reads; a filename error cannot trigger directory recovery')
      if (typeof rawName === 'string') {
        assert.equal(page.data.error, '')
        assert.equal(page.data.inspectorEntries[0].name, rawName)
      } else {
        assert.match(page.data.error, /UTF-8/)
        assert.equal(page.data.inspectorEntries.length, 0)
      }
    }
  } finally { page.detached() }
})

test('ZIP EFS validation also protects ZIP64 and numeric/classic volume directories', async () => {
  const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib')
  const { forceZip64Archive, splitClassicZip, splitClassicZip64 } = require('./helpers/zip-legacy-compat')
  const { inspectArchiveVolumes } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  for (const zip64 of [false, true]) {
    const ordinary = zipMember({ name: name('c3'), content, method: 0 })
    const bytes = zip64 ? forceZip64Archive(ordinary) : ordinary
    assert.throws(() => inspectZip(bytes), invalidName)
    const split = 40
    const numeric = [{ name: 'bad.zip.001', bytes: bytes.subarray(0, split) }, { name: 'bad.zip.002', bytes: bytes.subarray(split) }]
    await assert.rejects(inspectArchiveVolumes(numeric, { wasmBinary, format: 'zip', mainName: 'bad.zip.001' }), invalidName)
    const parts = (zip64 ? splitClassicZip64 : splitClassicZip)(bytes, [split])
    const classic = [{ name: 'bad.z01', bytes: parts[0] }, { name: 'bad.zip', bytes: parts[1] }]
    await assert.rejects(inspectArchiveVolumes(classic, { wasmBinary, format: 'zip', mainName: 'bad.zip' }), invalidName)
  }
  const bytes = zipMember({ name: '恢复.txt', content, method: 0 })
  const split = 40
  const rows = await inspectArchiveVolumes([{ name: 'good.zip.001', bytes: bytes.subarray(0, split) }, { name: 'good.zip.002', bytes: bytes.subarray(split) }], { wasmBinary, format: 'zip', mainName: 'good.zip.001' })
  assert.equal(rows.entries[0].name, '恢复.txt')
})
