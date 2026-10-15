'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { solidArchive } = require('../tests/helpers/7z-solid')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const password = 'many-tiny-fixture-73'
const body = Buffer.from('<h1>大量小成员后的真实正文</h1>')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function membersAtBoundary (extraBytes) {
  const count = 2048
  const fillerBytes = seven.MAX_SOLID_DECODE_BYTES - body.length + extraBytes
  const baseSize = Math.floor(fillerBytes / count)
  let remainder = fillerBytes % count
  const members = Array.from({ length: count }, (_, index) => {
    const size = baseSize + (remainder-- > 0 ? 1 : 0)
    return { name: `piece-${String(index).padStart(4, '0')}.dat`, bytes: Buffer.alloc(size, index % 251) }
  })
  members.push({ name: 'zzzz-target.html', bytes: body })
  return members
}

async function inspectCase (name, extraBytes, out) {
  const members = membersAtBoundary(extraBytes)
  const archive = await solidArchive(wasmBinary, members, { archiveName: name, password })
  fs.writeFileSync(path.join(out, name), archive)
  const options = { wasmBinary, archiveExtension: '.7z', archiveType: '7z-engine', password }
  const inspection = await seven.inspect7zArchive(archive, options)
  assert.equal(inspection.entries.length, members.length)
  assert.equal(new Set(inspection.entries.map(entry => entry.name)).size, members.length)
  for (const index of [0, 499, 500, 1023, 1024, 2047]) {
    const expected = members[index]
    const entry = inspection.entries.find(item => item.name === expected.name)
    assert.ok(entry, expected.name)
    assert.equal(entry.id, index)
    assert.equal(entry.canOpen, true)
    assert.deepEqual(Buffer.from(await seven.extract7zEntry(archive, entry, options)), expected.bytes)
  }
  const target = inspection.entries.find(entry => entry.name === 'zzzz-target.html')
  assert.equal(target.solidDecodeSize, seven.MAX_SOLID_DECODE_BYTES + extraBytes)
  assert.equal(target.canOpen, extraBytes === 0)
  if (extraBytes === 0) assert.deepEqual(Buffer.from(await seven.extract7zEntry(archive, target, options)), body)
  else await assert.rejects(seven.extract7zEntry(archive, target, options), /固实块需先解码/)
  return { archive, members: members.length, target }
}

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-many-tiny-'))
  fs.mkdirSync(out, { recursive: true })
  const exact = await inspectCase('many-tiny-exact.7z', 0, out)
  const over = await inspectCase('many-tiny-over.7z', 1, out)
  const options = { wasmBinary, archiveExtension: '.7z', archiveType: '7z-engine' }
  await assert.rejects(seven.inspect7zArchive(over.archive, options), error => error.archiveFailure === 'password-required')
  await assert.rejects(seven.inspect7zArchive(over.archive, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const recovered = await seven.inspect7zArchive(exact.archive, { ...options, password })
  assert.equal(recovered.entries.length, exact.members)

  let independentOracle = 'not-run (set PY7ZR_PYTHON to an isolated Python with py7zr)'
  if (process.env.PY7ZR_PYTHON) {
    const oracle = [
      'import hashlib, json, os, pathlib, py7zr, sys',
      'root = pathlib.Path(sys.argv[1])',
      "cases = ['many-tiny-exact.7z', 'many-tiny-over.7z']",
      'result = {}',
      'for index, archive in enumerate(cases):',
      "    target_root = root / ('oracle-' + str(index))",
      '    target_root.mkdir()',
      "    with py7zr.SevenZipFile(root / archive, mode='r', password=os.environ['READER_7Z_TEST_PASSWORD']) as handle:",
      '        names = handle.getnames()',
      "        handle.extract(path=target_root, targets=['piece-0500.dat', 'piece-2047.dat', 'zzzz-target.html'])",
      "    if len(names) != 2049 or len(set(names)) != 2049: raise RuntimeError('independent member identity mismatch')",
      "    target_hash = hashlib.sha256((target_root / 'zzzz-target.html').read_bytes()).hexdigest()",
      "    if target_hash != sys.argv[2]: raise RuntimeError('independent target hash mismatch')",
      "    result[archive] = {'members': len(names), 'targetSha256': target_hash}",
      "print(json.dumps({'py7zr': py7zr.__version__, 'cases': result}))"
    ].join('\n')
    independentOracle = JSON.parse(execFileSync(process.env.PY7ZR_PYTHON, ['-c', oracle, out, hash(body)], {
      encoding: 'utf8',
      env: { ...process.env, READER_7Z_TEST_PASSWORD: password },
      maxBuffer: 4 * 1024 * 1024
    }))
  }

  const report = {
    at: new Date().toISOString(),
    memberCount: exact.members,
    limitBytes: seven.MAX_SOLID_DECODE_BYTES,
    exact: { archiveBytes: exact.archive.length, archiveSha256: hash(exact.archive), decodedPrefixBytes: exact.target.solidDecodeSize, canOpen: exact.target.canOpen },
    over: { archiveBytes: over.archive.length, archiveSha256: hash(over.archive), decodedPrefixBytes: over.target.solidDecodeSize, canOpen: over.target.canOpen },
    bodySha256: hash(body),
    independentOracle,
    output: out
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
