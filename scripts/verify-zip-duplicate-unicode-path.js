'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')
const { inspectFileBytes, extractZipEntry } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { inspect7zArchive } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { crc32Bytes, storedZipWithUnicodePaths } = require('../tests/helpers/zip-unicode-path')

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const rawName = 'safe/raw.html'
const rawCrc = crc32Bytes(Buffer.from(rawName))
const cases = [
  { id: 'valid-conflict', unicodePaths: [{ name: 'first.html' }, { name: 'second.html' }] },
  { id: 'valid-identical', unicodePaths: [{ name: 'same.html' }, { name: 'same.html' }] },
  { id: 'valid-then-bad', unicodePaths: [{ name: 'valid.html' }, { name: 'bad.html', crc: (rawCrc ^ 0xffffffff) >>> 0 }] },
  { id: 'bad-then-valid', unicodePaths: [{ name: 'bad.html', crc: (rawCrc ^ 0xffffffff) >>> 0 }, { name: 'valid.html' }] },
  { id: 'truncated-tail', unicodePaths: [{ name: 'valid.html' }], extraTail: Buffer.from([0x75, 0x70, 0x20, 0x00, 0x01]) }
]

async function main () {
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const report = []
  for (const sample of cases) {
    const body = `<h1>${sample.id} 正文</h1>`
    const archive = storedZipWithUnicodePaths({ rawName, unicodePaths: sample.unicodePaths, extraTail: sample.extraTail, content: body })
    const entry = inspectFileBytes(archive, { name: sample.id + '.zip', type: 'application/zip' }).entries.find(item => item.canOpen)
    assert.equal(entry.name, rawName)
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString(), body)
    const python = spawnSync('python3', ['-c', 'import io,sys,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).infolist()[0].filename)'], { input: archive })
    const pythonName = python.status === 0 ? python.stdout.toString().trim() : null
    if (sample.id === 'truncated-tail') assert.match(python.stderr.toString(), /Corrupt extra field/)
    else assert.equal(pythonName, rawName, python.stderr.toString())
    let sevenZipName = null
    try {
      const sevenZip = await inspect7zArchive(archive, { wasmBinary, maxEntrySize: 1024 * 1024, archiveExtension: '.zip', archiveType: 'zip-engine' })
      sevenZipName = sevenZip.entries[0] && sevenZip.entries[0].name
    } catch (_) {}
    const bsdtar = spawnSync('/usr/bin/bsdtar', ['-tf', '-'], { input: archive })
    report.push({
      id: sample.id,
      archiveSha256: sha256(archive),
      bodySha256: sha256(Buffer.from(body)),
      readerName: entry.name,
      pythonName,
      pythonRejected: python.status !== 0,
      sevenZipName,
      bsdtarName: bsdtar.status === 0 ? bsdtar.stdout.toString().trim() : null
    })
  }
  assert.ok(report.some(row => row.sevenZipName !== row.readerName), '前提失败：兼容内核没有表现出顺序相关名称')
  console.log(JSON.stringify({
    standardRule: 'Common ZIP Spec: duplicate 0x7075 extra fields SHALL NOT occur',
    policy: '重复或截断 extra 元数据不用于改名，回退中央目录原始名称并按原成员身份读取正文',
    cases: report
  }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
