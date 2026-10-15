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
const password = 'truncated-volume-fixture-92'
const body = Buffer.from('<h1>完整分卷正文</h1>')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function uint32 (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function uint64 (bytes, offset) {
  return uint32(bytes, offset) + uint32(bytes, offset + 4) * 0x100000000
}

function splitThree (archive) {
  const first = Math.ceil(archive.length / 3)
  const second = Math.ceil(archive.length * 2 / 3)
  return [archive.subarray(0, first), archive.subarray(first, second), archive.subarray(second)]
}

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-truncated-volumes-'))
  fs.mkdirSync(out, { recursive: true })
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(1024 * 1024, 0x72) },
    { name: '999-target.html', bytes: body }
  ], { password })
  const parts = splitThree(archive)
  const volumes = parts.map((bytes, index) => ({ name: `integrity.7z.${String(index + 1).padStart(3, '0')}`, bytes }))
  for (const volume of volumes) fs.writeFileSync(path.join(out, volume.name), volume.bytes)
  fs.writeFileSync(path.join(out, 'complete.7z'), archive)
  fs.writeFileSync(path.join(out, 'missing-final.7z'), Buffer.concat(parts.slice(0, 2).map(Buffer.from)))
  fs.writeFileSync(path.join(out, 'truncated-final.7z'), archive.subarray(0, archive.length - 1))
  const damagedDirectory = Buffer.from(archive)
  const nextStart = 32 + uint64(archive, 12)
  const nextSize = uint64(archive, 20)
  damagedDirectory[nextStart + Math.floor(nextSize / 2)] ^= 0x01
  fs.writeFileSync(path.join(out, 'damaged-directory.7z'), damagedDirectory)

  const volumeOptions = { wasmBinary, format: '7z', mainName: volumes[0].name, maxEntrySize: 2 * 1024 * 1024, password }
  const inspection = await seven.inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const target = inspection.entries.find(entry => entry.name === '999-target.html')
  assert.deepEqual(Buffer.from(await seven.extractArchiveVolumeEntry(volumes, target, volumeOptions)), body)
  const failures = {}
  for (const [name, selected, expected] of [
    ['missing-middle', [volumes[0], volumes[2]], 'missing-volume'],
    ['missing-final', volumes.slice(0, 2), 'truncated-volume'],
    ['truncated-final', [volumes[0], volumes[1], { ...volumes[2], bytes: volumes[2].bytes.subarray(0, volumes[2].bytes.length - 1) }], 'truncated-volume'],
    ['damaged-directory', splitThree(damagedDirectory).map((bytes, index) => ({ name: volumes[index].name, bytes })), 'next-header-crc']
  ]) {
    await assert.rejects(seven.inspectArchiveVolumes(selected, { ...volumeOptions, password: '' }), error => {
      assert.equal(error.archiveIntegrity, expected)
      assert.doesNotMatch(error.message, /000-filler|999-target/)
      failures[name] = { kind: error.archiveIntegrity, message: error.message }
      return true
    })
  }
  const recovered = await seven.inspectArchiveVolumes(volumes, volumeOptions)
  assert.deepEqual(Buffer.from(await seven.extractArchiveVolumeEntry(volumes, recovered.entries.find(entry => entry.name === target.name), volumeOptions)), body)

  let independentOracle = 'not-run (set PY7ZR_PYTHON to an isolated Python with py7zr)'
  if (process.env.PY7ZR_PYTHON) {
    const oracle = [
      'import hashlib, json, os, pathlib, py7zr, sys',
      'root = pathlib.Path(sys.argv[1])',
      "password = os.environ['READER_7Z_TEST_PASSWORD']",
      "target_root = root / 'oracle-complete'",
      'target_root.mkdir()',
      "with py7zr.SevenZipFile(root / 'complete.7z', mode='r', password=password) as handle:",
      '    names = handle.getnames()',
      "    handle.extract(path=target_root, targets=['999-target.html'])",
      "digest = hashlib.sha256((target_root / '999-target.html').read_bytes()).hexdigest()",
      "if digest != sys.argv[2]: raise RuntimeError('independent body hash mismatch')",
      'failures = {}',
      "for name in ['missing-final.7z', 'truncated-final.7z', 'damaged-directory.7z']:",
      '    try:',
      "        with py7zr.SevenZipFile(root / name, mode='r', password=password) as handle:",
      '            handle.getnames()',
      "        failures[name] = 'unexpected-success'",
      '    except Exception as error:',
      "        failures[name] = type(error).__name__",
      "if any(value == 'unexpected-success' for value in failures.values()): raise RuntimeError('independent corruption oracle accepted invalid archive')",
      "print(json.dumps({'py7zr': py7zr.__version__, 'members': names, 'bodySha256': digest, 'rejected': failures}))"
    ].join('\n')
    independentOracle = JSON.parse(execFileSync(process.env.PY7ZR_PYTHON, ['-c', oracle, out, hash(body)], {
      encoding: 'utf8',
      env: { ...process.env, READER_7Z_TEST_PASSWORD: password }
    }))
  }

  const report = {
    at: new Date().toISOString(),
    archiveBytes: archive.length,
    volumeBytes: volumes.map(volume => volume.bytes.length),
    nextHeader: { offset: nextStart, size: nextSize },
    bodySha256: hash(body),
    failures,
    recoveredBody: true,
    inputVolumesUnchanged: true,
    independentOracle,
    boundary: 'Generated header-encrypted solid 7z numeric volumes; validates container ranges and CRCs before password handling without reading the encrypted directory.',
    output: out
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
