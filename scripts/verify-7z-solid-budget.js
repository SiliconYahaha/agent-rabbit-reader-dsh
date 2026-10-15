'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const SevenZip = require('../miniprogram/file-reader/sevenzip/runtime/7zz')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { solidArchive } = require('../tests/helpers/7z-solid')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const body = Buffer.from('<h1>固实块真实边界正文</h1>')
const password = 'solid-header-fixture-91'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-solid-budget-'))
  fs.mkdirSync(out, { recursive: true })
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  const build = (archiveName, members, encrypted = false) => {
    for (const member of members) engine.FS.writeFile(`/${member.name}`, member.bytes)
    const args = ['a', '-t7z', '-m0=lzma2:d=1m', '-ms=on', '-mqs=off']
    if (encrypted) args.push(`-p${password}`, '-mhe=on')
    args.push(`/${archiveName}`, '--', ...members.map(member => `/${member.name}`))
    assert.equal(engine.callMain(args), 0, `生成 ${archiveName} 失败`)
    const archive = Buffer.from(engine.FS.readFile(`/${archiveName}`))
    for (const member of members) engine.FS.unlink(`/${member.name}`)
    engine.FS.unlink(`/${archiveName}`)
    fs.writeFileSync(path.join(out, archiveName), archive)
    return archive
  }

  const limit = seven.MAX_SOLID_DECODE_BYTES
  const exact = build('exact-limit.7z', [
    { name: '000-filler.bin', bytes: Buffer.alloc(limit - body.length, 0x61) },
    { name: '999-target.html', bytes: body }
  ])
  const over = build('over-limit.7z', [
    { name: '000-filler.bin', bytes: Buffer.alloc(limit - body.length + 1, 0x62) },
    { name: '999-target.html', bytes: body }
  ])
  const targetFirst = build('target-first.7z', [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(limit + 1, 0x63) }
  ])
  const encryptedExact = build('encrypted-exact-limit.7z', [
    { name: '000-filler.bin', bytes: Buffer.alloc(limit - body.length, 0x64) },
    { name: '999-target.html', bytes: body }
  ], true)
  const encryptedOver = build('encrypted-over-limit.7z', [
    { name: '000-filler.bin', bytes: Buffer.alloc(limit - body.length + 1, 0x65) },
    { name: '999-target.html', bytes: body }
  ], true)
  const encryptedTargetFirst = build('encrypted-target-first.7z', [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(limit + 1, 0x66) }
  ], true)
  const resetBody = Buffer.alloc(768 * 1024, 0x68)
  const encryptedEmptyReset = await solidArchive(wasmBinary, [
    { name: '000-empty-dir', directory: true },
    { name: '010-empty.txt', bytes: Buffer.alloc(0) },
    { name: '020-nested', directory: true },
    { name: '020-nested/empty.txt', bytes: Buffer.alloc(0) },
    { name: '100-filler.bin', bytes: Buffer.alloc(768 * 1024, 0x69) },
    { name: '999-target.html', bytes: resetBody }
  ], { archiveName: 'encrypted-empty-reset.7z', password, solid: '1m' })
  fs.writeFileSync(path.join(out, 'encrypted-empty-reset.7z'), encryptedEmptyReset)
  const options = { wasmBinary, archiveExtension: '.7z', archiveType: '7z-engine' }

  const exactInspection = await seven.inspect7zArchive(exact, options)
  const exactTarget = exactInspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(exactTarget.solidDecodeSize, limit)
  assert.equal(exactTarget.canOpen, true)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(exact, exactTarget, options)), body)

  const overInspection = await seven.inspect7zArchive(over, options)
  const overTarget = overInspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(overTarget.solidDecodeSize, limit + 1)
  assert.equal(overTarget.canOpen, false)
  assert.match(overTarget.detail, /固实块需解码 80\.0 MB，超过安全上限/)
  await assert.rejects(seven.extract7zEntry(over, overTarget, options), /固实块需先解码 80\.0 MB，超过 80\.0 MB 安全上限/)

  const firstInspection = await seven.inspect7zArchive(targetFirst, options)
  const firstTarget = firstInspection.entries.find(entry => entry.name === '000-target.html')
  assert.equal(firstTarget.canOpen, true)
  assert.equal(firstTarget.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(targetFirst, firstTarget, options)), body)

  await assert.rejects(seven.inspect7zArchive(encryptedOver, options), error => error.archiveFailure === 'password-required')
  await assert.rejects(seven.inspect7zArchive(encryptedOver, { ...options, password: 'wrong-password' }), error => error.archiveFailure === 'password-or-corrupt')
  const encryptedOptions = { ...options, password }
  const encryptedExactInspection = await seven.inspect7zArchive(encryptedExact, encryptedOptions)
  const encryptedExactTarget = encryptedExactInspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(encryptedExactTarget.solidDecodeSize, limit)
  assert.equal(encryptedExactTarget.canOpen, true)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(encryptedExact, encryptedExactTarget, encryptedOptions)), body)
  const encryptedOverInspection = await seven.inspect7zArchive(encryptedOver, encryptedOptions)
  const encryptedOverTarget = encryptedOverInspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(encryptedOverTarget.solidDecodeSize, limit + 1)
  assert.equal(encryptedOverTarget.canOpen, false)
  await assert.rejects(seven.extract7zEntry(encryptedOver, encryptedOverTarget, encryptedOptions), /固实块需先解码/)
  const encryptedFirstInspection = await seven.inspect7zArchive(encryptedTargetFirst, encryptedOptions)
  const encryptedFirstTarget = encryptedFirstInspection.entries.find(entry => entry.name === '000-target.html')
  assert.equal(encryptedFirstTarget.canOpen, true)
  assert.equal(encryptedFirstTarget.solidDecodeSize, undefined)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(encryptedTargetFirst, encryptedFirstTarget, encryptedOptions)), body)
  const encryptedResetInspection = await seven.inspect7zArchive(encryptedEmptyReset, encryptedOptions)
  assert.deepEqual(encryptedResetInspection.entries.slice(0, 4).map(entry => entry.name), [
    '000-empty-dir', '020-nested', '010-empty.txt', '020-nested/empty.txt'
  ])
  const encryptedResetEmpty = encryptedResetInspection.entries.find(entry => entry.name === '020-nested/empty.txt')
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(encryptedEmptyReset, encryptedResetEmpty, encryptedOptions)), Buffer.alloc(0))
  const encryptedResetTarget = encryptedResetInspection.entries.find(entry => entry.name === '999-target.html')
  assert.equal(encryptedResetTarget.solidDecodeSize, undefined)
  assert.equal(encryptedResetTarget.canOpen, true)
  assert.deepEqual(Buffer.from(await seven.extract7zEntry(encryptedEmptyReset, encryptedResetTarget, encryptedOptions)), resetBody)

  const oracleExact = execFileSync('/usr/bin/bsdtar', ['-xOf', path.join(out, 'exact-limit.7z'), '999-target.html'])
  const oracleOver = execFileSync('/usr/bin/bsdtar', ['-xOf', path.join(out, 'over-limit.7z'), '999-target.html'])
  const oracleFirst = execFileSync('/usr/bin/bsdtar', ['-xOf', path.join(out, 'target-first.7z'), '000-target.html'])
  for (const oracle of [oracleExact, oracleOver, oracleFirst]) assert.deepEqual(oracle, body)

  let encryptedOracle = 'not-run (set PY7ZR_PYTHON to an isolated Python with py7zr)'
  if (process.env.PY7ZR_PYTHON) {
    const oracleScript = [
      'import hashlib, json, os, pathlib, py7zr, sys',
      'root = pathlib.Path(sys.argv[1])',
      "cases = [('encrypted-exact-limit.7z', '999-target.html', sys.argv[2]), ('encrypted-over-limit.7z', '999-target.html', sys.argv[2]), ('encrypted-target-first.7z', '000-target.html', sys.argv[2]), ('encrypted-empty-reset.7z', '999-target.html', sys.argv[3])]",
      'result = {}',
      'for index, (archive, target, expected) in enumerate(cases):',
      "    target_root = root / ('py7zr-' + str(index))",
      '    target_root.mkdir()',
      "    with py7zr.SevenZipFile(root / archive, mode='r', password=os.environ['READER_7Z_TEST_PASSWORD']) as handle:",
      '        names = handle.getnames()',
      '        handle.extract(path=target_root, targets=[target])',
      "    digest = hashlib.sha256((target_root / target).read_bytes()).hexdigest()",
      "    if archive == 'encrypted-empty-reset.7z' and not {'000-empty-dir', '020-nested', '010-empty.txt', '020-nested/empty.txt'}.issubset(set(names)): raise RuntimeError('independent empty-member listing mismatch')",
      "    if digest != expected: raise RuntimeError('independent body hash mismatch')",
      "    result[archive] = {'target': target, 'listed': target in names, 'sha256': digest}",
      "print(json.dumps({'py7zr': py7zr.__version__, 'cases': result}))"
    ].join('\n')
    const oracleOutput = execFileSync(process.env.PY7ZR_PYTHON, ['-c', oracleScript, out, hash(body), hash(resetBody)], {
      encoding: 'utf8',
      env: { ...process.env, READER_7Z_TEST_PASSWORD: password },
      maxBuffer: 4 * 1024 * 1024
    })
    encryptedOracle = JSON.parse(oracleOutput)
  }

  const report = {
    at: new Date().toISOString(),
    limitBytes: limit,
    bodyBytes: body.length,
    bodySha256: hash(body),
    cases: {
      exact: { archiveBytes: exact.length, archiveSha256: hash(exact), decodedPrefixBytes: exactTarget.solidDecodeSize, canOpen: exactTarget.canOpen },
      over: { archiveBytes: over.length, archiveSha256: hash(over), decodedPrefixBytes: overTarget.solidDecodeSize, canOpen: overTarget.canOpen, independentlyExtractable: true },
      targetFirst: { archiveBytes: targetFirst.length, archiveSha256: hash(targetFirst), canOpen: firstTarget.canOpen },
      encryptedExact: { archiveBytes: encryptedExact.length, archiveSha256: hash(encryptedExact), decodedPrefixBytes: encryptedExactTarget.solidDecodeSize, canOpen: encryptedExactTarget.canOpen },
      encryptedOver: { archiveBytes: encryptedOver.length, archiveSha256: hash(encryptedOver), decodedPrefixBytes: encryptedOverTarget.solidDecodeSize, canOpen: encryptedOverTarget.canOpen },
      encryptedTargetFirst: { archiveBytes: encryptedTargetFirst.length, archiveSha256: hash(encryptedTargetFirst), canOpen: encryptedFirstTarget.canOpen },
      encryptedEmptyReset: { archiveBytes: encryptedEmptyReset.length, archiveSha256: hash(encryptedEmptyReset), emptyMembers: 4, targetCanOpen: encryptedResetTarget.canOpen, targetSolidDecodeSize: encryptedResetTarget.solidDecodeSize || null }
    },
    independentOracle: 'macOS bsdtar/libarchive extracted each selected body byte-identically',
    encryptedIndependentOracle: encryptedOracle,
    policy: 'The limit bounds decoded-prefix work for one solid block; it is not a claim about exact peak memory.',
    output: out
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
