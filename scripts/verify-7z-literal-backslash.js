'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { files, nativeNamesArchive } = require('../tests/helpers/archive-native-names')
const { headerEncryptedDuplicateSevenZip } = require('../tests/helpers/archive-duplicates')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-backslash-'))
  fs.mkdirSync(out, { recursive: true })
  const archive = Buffer.from(await nativeNamesArchive(wasmBinary, '7z'))
  const archivePath = path.join(out, 'literal-backslash.7z')
  const bsdtarOut = path.join(out, 'bsdtar')
  fs.writeFileSync(archivePath, archive)
  fs.mkdirSync(bsdtarOut)
  execFileSync('/usr/bin/bsdtar', ['-xf', archivePath, '-C', bsdtarOut])

  const options = { wasmBinary, archiveExtension: '.7z' }
  const inspection = await seven.inspect7zArchive(archive, options)
  const expectedNames = ['literal\\backslash.html', 'literal/backslash.html']
  const members = []
  for (const name of expectedNames) {
    const entry = inspection.entries.find(item => item.name === name)
    assert.ok(entry, `missing exact member identity: ${JSON.stringify(name)}`)
    const reader = Buffer.from(await seven.extract7zEntry(archive, entry, options))
    const native = fs.readFileSync(path.join(bsdtarOut, name))
    assert.deepEqual(reader, files[name])
    assert.deepEqual(native, files[name])
    members.push({ name, bytes: reader.length, sha256: hash(reader), bsdtarBytesEqual: true })
  }

  const password = 'header-duplicate-password'
  const duplicateMembers = [
    { name: 'same\\name.html', content: '' },
    { name: 'same\\name.html', content: 'second-body' },
    { name: 'same/name.html', content: 'nested-decoy' }
  ]
  const encrypted = await headerEncryptedDuplicateSevenZip(duplicateMembers, wasmBinary, password)
  await assert.rejects(seven.inspect7zArchive(encrypted, { ...options, password: 'wrong' }), /密码不正确/)
  const encryptedInspection = await seven.inspect7zArchive(encrypted, { ...options, password })
  assert.deepEqual(encryptedInspection.entries.map(entry => entry.name), duplicateMembers.map(member => member.name))
  for (let index = 0; index < duplicateMembers.length; index++) {
    const body = Buffer.from(await seven.extract7zEntry(encrypted, encryptedInspection.entries[index], { ...options, password })).toString()
    assert.equal(body, duplicateMembers[index].content)
  }

  const report = {
    at: new Date().toISOString(),
    archiveSha256: hash(archive),
    members,
    headerEncryptedDuplicates: duplicateMembers.length,
    wrongPasswordRejected: true,
    pathSafety: {
      literalBackslash: seven.safeArchivePath('literal\\backslash.html'),
      driveAbsolute: seven.safeArchivePath('C:\\escape.html'),
      driveRelative: seven.safeArchivePath('c:relative.html'),
      parentTraversal: seven.safeArchivePath('folder\\..\\escape.html')
    },
    independentOracle: 'macOS bsdtar/libarchive extraction',
    output: out
  }
  assert.deepEqual(report.pathSafety, { literalBackslash: true, driveAbsolute: false, driveRelative: false, parentTraversal: false })
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
