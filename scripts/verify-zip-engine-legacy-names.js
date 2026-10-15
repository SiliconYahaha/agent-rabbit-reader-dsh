'use strict'

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { inspectZipCentral, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { mergeZipEngineInspection } = require('../miniprogram/file-reader/archive/zip-engine-bridge')
const { extract7zEntry, inspect7zArchive } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { BZIP2_ZIP, renameSingleMemberZip } = require('../tests/helpers/zip-legacy-compat')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const runtimeOptions = { wasmBinary, maxEntrySize: 1024 * 1024, archiveExtension: '.zip', archiveType: 'zip-engine' }
const samples = ['한글/읽기.txt', '갂힣/확장.txt']

async function main () {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-zip-legacy-'))
  const results = []
  try {
    for (const [index, name] of samples.entries()) {
      const rawName = childProcess.execFileSync('/usr/bin/iconv', ['-f', 'UTF-8', '-t', 'CP949'], { input: name })
      const archive = renameSingleMemberZip(BZIP2_ZIP, rawName)
      const archivePath = path.join(temporary, `sample-${index}.zip`)
      fs.writeFileSync(archivePath, archive)
      const bsdtarName = childProcess.execFileSync('/usr/bin/bsdtar', ['--options', 'zip:hdrcharset=CP949', '-tf', archivePath], { encoding: 'utf8' }).trim().normalize('NFC')
      assert.equal(bsdtarName, name)
      const bsdtarBody = childProcess.execFileSync('/usr/bin/bsdtar', ['--options', 'zip:hdrcharset=CP949', '-xOf', archivePath])

      const descriptor = readZipDirectoryDescriptor(archive)
      const centralBytes = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
      const decoded = inspectZipCentral(centralBytes, descriptor, { legacyEncoding: 'cp949' })
      const native = await inspect7zArchive(archive, runtimeOptions)
      assert.notEqual(native.entries[0].name, name)
      const merged = mergeZipEngineInspection(native, decoded)
      assert.equal(merged.entries[0].name, name)
      const body = Buffer.from(await extract7zEntry(archive, merged.entries[0], runtimeOptions))
      assert.deepEqual(body, bsdtarBody)
      results.push({ name, nativeBaseline: native.entries[0].name, bytes: body.length, result: 'pass' })
    }
    console.log(JSON.stringify({ oracle: '/usr/bin/iconv + /usr/bin/bsdtar', engine: 'pinned 7-Zip 24.09 WASM', samples: results }, null, 2))
  } finally {
    for (const name of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, name))
    fs.rmdirSync(temporary)
  }
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
