'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')
const { combineZips } = require('../tests/helpers/archive-duplicates')
const { renameSingleMemberZip } = require('../tests/helpers/zip-legacy-compat')
const { extractZipEntry, inspectZipCentral, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')

const rawNames = [Buffer.from('a2a52e747874', 'hex'), Buffer.from('f9e92e747874', 'hex')]
const bodies = [Buffer.from('第一份独立正文'), Buffer.from('第二份独立正文')]
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

for (const rawName of rawNames) {
  const converted = spawnSync('/usr/bin/iconv', ['-f', 'BIG5', '-t', 'UTF-8'], { input: rawName.subarray(0, 2) })
  assert.equal(converted.status, 0, converted.stderr.toString())
  assert.equal(converted.stdout.toString(), '╞')
}

const archive = combineZips(rawNames.map((rawName, index) => renameSingleMemberZip(
  zipSync({ 'entry.txt': bodies[index] }, { level: 0 }),
  rawName
)))
const descriptor = readZipDirectoryDescriptor(archive)
const inspection = inspectZipCentral(archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize), descriptor, { legacyEncoding: 'big5' })
const reader = inspection.entries.map(entry => ({
  centralIndex: entry.zipCentralIndex,
  label: entry.displayName,
  sha256: hash(extractZipEntry(archive, entry))
}))

const python = spawnSync('python3', ['-c', `
import base64,hashlib,io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))) as z:
 print(json.dumps([{'headerOffset':i.header_offset,'crc':i.CRC,'sha256':hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]))
`], { input: archive.toString('base64'), encoding: 'utf8' })
assert.equal(python.status, 0, python.stderr)
const oracle = JSON.parse(python.stdout)
assert.deepEqual(reader.map(item => item.sha256), oracle.map(item => item.sha256))
assert.deepEqual(reader.map(item => item.label), ['╞.txt（同名 1/2）', '╞.txt（同名 2/2）'])
assert.equal(new Set(oracle.map(item => item.headerOffset)).size, 2)
console.log(JSON.stringify({ archiveSha256: hash(archive), rawNames: rawNames.map(name => name.toString('hex')), decodedName: '╞.txt', reader, oracle }))
