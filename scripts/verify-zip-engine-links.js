'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { extractZipEntry, inspectZipCentral, readZip64DirectoryDescriptor, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { mergeZipEngineInspection } = require('../miniprogram/file-reader/archive/zip-engine-bridge')
const { resolveZipLink } = require('../miniprogram/file-reader/archive/zip-links')
const { extract7zEntry, extract7zLinkTarget, inspect7zArchive, inspectArchiveVolumes, readArchiveVolumeEntry } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { BZIP2_LINK_ZIP, PUBLIC_SYMLINK_ZIP, PUBLIC_UNSUPPORTED_LINK_ZIP, forceZip64Archive, splitClassicZip, splitClassicZip64 } = require('../tests/helpers/zip-legacy-compat')

const ZIP64_LINK_ZIP = forceZip64Archive(BZIP2_LINK_ZIP)
const ZIP64_DISK_EXTRA_LINK_ZIP = forceZip64Archive(BZIP2_LINK_ZIP, { includeDiskStart: true })

const EXPECTED_HASHES = {
  BZIP2_LINK_ZIP: '66e357e84ad2bc75df8d5201b5e0ab603f507ecf229e40331da50493c0b5f523',
  ZIP64_LINK_ZIP: '95021cd67edf65e4caf1c32d803a0d37efea007624aa73b6b6134a38b6656705',
  ZIP64_DISK_EXTRA_LINK_ZIP: 'e7b0f8fef37dfb9eaeecb303e54b9a61478ec9638378cad845fb5e5970ede1cf',
  PUBLIC_SYMLINK_ZIP: 'a2870ff361b39a3a3adfe40ebf34a36734812e483fcbee30ee37fbe1b4fee90a',
  PUBLIC_UNSUPPORTED_LINK_ZIP: '65da02ac0c9592f67704c444f8d66acb49cb72b9cf7b6b111149a37d01e07974'
}
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const runtimeOptions = { wasmBinary, maxEntrySize: 1024 * 1024, archiveExtension: '.zip', archiveType: 'zip-engine' }

function hash (bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function inspectCentral (archive) {
  let descriptor = readZipDirectoryDescriptor(archive)
  if (descriptor.zip64) descriptor = readZip64DirectoryDescriptor(archive.subarray(descriptor.zip64RecordOffset, descriptor.zip64RecordOffset + 56))
  return inspectZipCentral(archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize), descriptor)
}

function pythonZipfile (archive, names) {
  const source = `import base64,hashlib,io,json,sys,zipfile\nraw=base64.b64decode(sys.stdin.read())\nout=[]\nwith zipfile.ZipFile(io.BytesIO(raw)) as z:\n for name in ${JSON.stringify(names)}:\n  body=z.read(name)\n  out.append(dict(name=name,size=len(body),sha256=hashlib.sha256(body).hexdigest(),text=body.decode('utf-8')))\nprint(json.dumps(out,ensure_ascii=False))`
  const result = spawnSync(process.env.ZIP_PYTHON || 'python3', ['-c', source], {
    input: archive.toString('base64'),
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })
  assert.equal(result.status, 0, result.stderr || 'Python zipfile failed')
  return JSON.parse(result.stdout)
}

function bsdtar (archive, args) {
  const result = spawnSync(process.env.ZIP_BSDTAR || '/usr/bin/bsdtar', args, {
    input: archive,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })
  assert.equal(result.status, 0, result.stderr.toString() || 'bsdtar failed')
  return result.stdout
}

function infoZipJoin (parts) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-classic-zip-'))
  const main = path.join(temporary, 'linked.zip')
  const joined = path.join(temporary, 'joined.zip')
  try {
    parts.slice(0, -1).forEach((bytes, index) => fs.writeFileSync(path.join(temporary, `linked.z${String(index + 1).padStart(2, '0')}`), bytes))
    fs.writeFileSync(main, parts[parts.length - 1])
    const result = spawnSync(process.env.ZIP_INFOZIP || 'zip', ['-s', '0', main, '--out', joined], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Info-ZIP split join failed')
    return fs.readFileSync(joined)
  } finally {
    for (const name of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, name))
    fs.rmdirSync(temporary)
  }
}

async function main () {
  for (const [name, bytes] of Object.entries({ BZIP2_LINK_ZIP, ZIP64_LINK_ZIP, ZIP64_DISK_EXTRA_LINK_ZIP, PUBLIC_SYMLINK_ZIP, PUBLIC_UNSUPPORTED_LINK_ZIP })) {
    assert.equal(hash(bytes), EXPECTED_HASHES[name], `${name} 固定样本已变化`)
  }

  const python = pythonZipfile(BZIP2_LINK_ZIP, ['shortcut', 'docs/page.html'])
  assert.equal(python[0].text, 'docs/page.html')
  assert.equal(python[1].text, '<h1>链接成员BZip2真实正文</h1>')

  const original = Buffer.from(BZIP2_LINK_ZIP)
  const central = inspectCentral(BZIP2_LINK_ZIP)
  const native = await inspect7zArchive(BZIP2_LINK_ZIP, runtimeOptions)
  const merged = mergeZipEngineInspection(native, central)
  const link = merged.zipIdentityEntries.find(entry => entry.name === 'shortcut')
  assert.equal(link.isLink, true)
  for (let attempt = 0; attempt < 2; attempt++) {
    const resolved = await resolveZipLink(merged.zipIdentityEntries, link, (entry, maxSize) => extract7zLinkTarget(BZIP2_LINK_ZIP, entry, { ...runtimeOptions, maxSize }))
    assert.equal(resolved.entry.name, 'docs/page.html')
    const body = Buffer.from(await extract7zEntry(BZIP2_LINK_ZIP, resolved.entry, runtimeOptions))
    assert.equal(hash(body), python[1].sha256)
    assert.deepEqual(BZIP2_LINK_ZIP, original, '重复打开不得改写原 ZIP 内存')
  }

  const zip64Python = pythonZipfile(ZIP64_LINK_ZIP, ['shortcut', 'docs/page.html'])
  assert.deepEqual(zip64Python.map(item => item.sha256), python.map(item => item.sha256))
  assert.deepEqual(bsdtar(ZIP64_LINK_ZIP, ['-tf', '-']).toString().trim().split('\n'), ['docs/page.html', 'shortcut'])
  assert.equal(bsdtar(ZIP64_LINK_ZIP, ['-xOf', '-', 'docs/page.html']).toString(), '<h1>链接成员BZip2真实正文</h1>')
  const zip64Central = inspectCentral(ZIP64_LINK_ZIP)
  const zip64Merged = mergeZipEngineInspection(await inspect7zArchive(ZIP64_LINK_ZIP, runtimeOptions), zip64Central)
  const zip64Link = zip64Merged.zipIdentityEntries.find(entry => entry.name === 'shortcut')
  const zip64Original = Buffer.from(ZIP64_LINK_ZIP)
  for (let attempt = 0; attempt < 2; attempt++) {
    const resolved = await resolveZipLink(zip64Merged.zipIdentityEntries, zip64Link, (entry, maxSize) => extract7zLinkTarget(ZIP64_LINK_ZIP, entry, { ...runtimeOptions, maxSize }))
    assert.equal(resolved.entry.name, 'docs/page.html')
    assert.equal(hash(Buffer.from(await extract7zEntry(ZIP64_LINK_ZIP, resolved.entry, runtimeOptions))), zip64Python[1].sha256)
    assert.deepEqual(ZIP64_LINK_ZIP, zip64Original)
  }

  const partSize = Math.ceil(ZIP64_LINK_ZIP.length / 3)
  const volumes = Array.from({ length: 3 }, (_, index) => ({
    name: `linked.zip.${String(index + 1).padStart(3, '0')}`,
    bytes: ZIP64_LINK_ZIP.subarray(index * partSize, Math.min(ZIP64_LINK_ZIP.length, (index + 1) * partSize))
  }))
  const volumeOptions = { ...runtimeOptions, format: 'zip', mainName: volumes[0].name }
  const volumeInspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const volumeLink = volumeInspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(volumeLink.isLink, true)
  for (let attempt = 0; attempt < 2; attempt++) {
    const opened = await readArchiveVolumeEntry(volumes, volumeLink, volumeOptions)
    assert.equal(opened.entry.name, 'docs/page.html')
    assert.equal(hash(Buffer.from(opened.bytes)), zip64Python[1].sha256)
  }

  const classicParts = splitClassicZip(BZIP2_LINK_ZIP, [67, 134])
  assert.deepEqual(classicParts.map(hash), [
    '99a19a4a78b23e7162e5d293c26cc69433186baa7586e85c43f3af7ef7fef700',
    'b993666e48c88bf5b6af8bf22ece74b35bf7c564492e09a1c2b5d6465fcfe715',
    '8fa24ef0ec95b1daa2dd70b7bf9836270260b6bc6638a7ba55add9080d97d3d5'
  ])
  const infoZipJoined = infoZipJoin(classicParts)
  const classicOracle = pythonZipfile(infoZipJoined, ['shortcut', 'docs/page.html'])
  assert.deepEqual(classicOracle.map(item => item.sha256), python.map(item => item.sha256))
  const classicVolumes = classicParts.map((bytes, index) => ({ name: index === classicParts.length - 1 ? 'linked.zip' : `linked.z${String(index + 1).padStart(2, '0')}`, bytes }))
  const classicOriginals = classicVolumes.map(volume => Buffer.from(volume.bytes))
  const classicOptions = { ...runtimeOptions, format: 'zip', mainName: 'linked.zip' }
  const classicInspection = await inspectArchiveVolumes(classicVolumes.slice().reverse(), classicOptions)
  const classicLink = classicInspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(classicLink.isLink, true)
  for (let attempt = 0; attempt < 2; attempt++) {
    const opened = await readArchiveVolumeEntry(classicVolumes.slice().reverse(), classicLink, classicOptions)
    assert.equal(opened.entry.name, 'docs/page.html')
    assert.equal(hash(Buffer.from(opened.bytes)), python[1].sha256)
  }
  assert.deepEqual(classicVolumes.map(volume => Buffer.from(volume.bytes)), classicOriginals)

  const classicZip64Parts = splitClassicZip64(ZIP64_LINK_ZIP, [67, 134])
  assert.deepEqual(classicZip64Parts.map(hash), [
    '99a19a4a78b23e7162e5d293c26cc69433186baa7586e85c43f3af7ef7fef700',
    'b993666e48c88bf5b6af8bf22ece74b35bf7c564492e09a1c2b5d6465fcfe715',
    '354701e8a041d311ac286628862e45ab646abcf624c2deb49e222a9b7b7de2c6'
  ])
  const infoZip64Joined = infoZipJoin(classicZip64Parts)
  const classicZip64Oracle = pythonZipfile(infoZip64Joined, ['shortcut', 'docs/page.html'])
  assert.deepEqual(classicZip64Oracle.map(item => item.sha256), zip64Python.map(item => item.sha256))
  const classicZip64Volumes = classicZip64Parts.map((bytes, index) => ({ name: index === classicZip64Parts.length - 1 ? 'linked64.zip' : `linked64.z${String(index + 1).padStart(2, '0')}`, bytes }))
  const classicZip64Originals = classicZip64Volumes.map(volume => Buffer.from(volume.bytes))
  const classicZip64Options = { ...runtimeOptions, format: 'zip', mainName: 'linked64.zip' }
  const classicZip64Inspection = await inspectArchiveVolumes(classicZip64Volumes.slice().reverse(), classicZip64Options)
  const classicZip64Link = classicZip64Inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(classicZip64Link.isLink, true)
  for (let attempt = 0; attempt < 2; attempt++) {
    const opened = await readArchiveVolumeEntry(classicZip64Volumes.slice().reverse(), classicZip64Link, classicZip64Options)
    assert.equal(opened.entry.name, 'docs/page.html')
    assert.equal(hash(Buffer.from(opened.bytes)), zip64Python[1].sha256)
  }
  assert.deepEqual(classicZip64Volumes.map(volume => Buffer.from(volume.bytes)), classicZip64Originals)

  const classicZip64DiskExtraParts = splitClassicZip64(ZIP64_DISK_EXTRA_LINK_ZIP, [67, 134])
  assert.deepEqual(classicZip64DiskExtraParts.map(hash), [
    '99a19a4a78b23e7162e5d293c26cc69433186baa7586e85c43f3af7ef7fef700',
    'b993666e48c88bf5b6af8bf22ece74b35bf7c564492e09a1c2b5d6465fcfe715',
    '00f7a3eb5e8370d7e4f6fae5618a773bd6653be4f7d82e3737b04f316984f27d'
  ])
  const infoZip64DiskExtraJoined = infoZipJoin(classicZip64DiskExtraParts)
  const classicZip64DiskExtraOracle = pythonZipfile(infoZip64DiskExtraJoined, ['shortcut', 'docs/page.html'])
  assert.deepEqual(classicZip64DiskExtraOracle.map(item => item.sha256), zip64Python.map(item => item.sha256))

  const publicCentral = inspectCentral(PUBLIC_SYMLINK_ZIP)
  const publicLink = publicCentral.zipIdentityEntries.find(entry => entry.name === 'symlink')
  const publicResolved = await resolveZipLink(publicCentral.zipIdentityEntries, publicLink, entry => extractZipEntry(PUBLIC_SYMLINK_ZIP, entry, { maxSize: 4096 }))
  assert.equal(publicResolved.entry.name, 'file')
  const publicBody = Buffer.from(extractZipEntry(PUBLIC_SYMLINK_ZIP, publicResolved.entry))
  assert.deepEqual(publicBody, bsdtar(PUBLIC_SYMLINK_ZIP, ['-xOf', '-', 'file']))
  assert.deepEqual(bsdtar(PUBLIC_SYMLINK_ZIP, ['-tf', '-']).toString().trim().split('\n'), ['file', 'symlink'])

  const unsupportedCentral = inspectCentral(PUBLIC_UNSUPPORTED_LINK_ZIP)
  const unsupportedMerged = mergeZipEngineInspection(await inspect7zArchive(PUBLIC_UNSUPPORTED_LINK_ZIP, runtimeOptions), unsupportedCentral)
  const unsupported = unsupportedMerged.entries.find(entry => entry.name === 'bad_symlink')
  const second = unsupportedMerged.entries.find(entry => entry.name === 'second')
  assert.equal(unsupported.isLink, true)
  assert.equal(unsupported.canOpen, false)
  assert.match(unsupported.detail, /不支持/)
  const secondBody = Buffer.from(await extract7zEntry(PUBLIC_UNSUPPORTED_LINK_ZIP, second, runtimeOptions))
  assert.deepEqual(secondBody, bsdtar(PUBLIC_UNSUPPORTED_LINK_ZIP, ['-xOf', '-', 'second']))

  console.log(JSON.stringify({
    result: 'pass',
    engine: 'pinned 7-Zip 24.09 WASM',
    independentOracles: ['CPython zipfile', 'libarchive bsdtar', 'Info-ZIP split join'],
    deterministicBzip2Link: { sha256: hash(BZIP2_LINK_ZIP), repeatedOpens: 2, target: 'docs/page.html', contentSha256: hash(Buffer.from(python[1].text)) },
    zip64Bzip2Link: { sha256: hash(ZIP64_LINK_ZIP), pythonAndBsdtar: true, repeatedSingleOpens: 2, numericVolumes: 3, repeatedVolumeOpens: 2, target: 'docs/page.html', contentSha256: zip64Python[1].sha256 },
    classicBzip2LinkVolumes: { partSha256: classicParts.map(hash), infoZipJoined: true, volumes: classicParts.length, repeatedOpens: 2, target: 'docs/page.html', contentSha256: classicOracle[1].sha256 },
    classicZip64Bzip2LinkVolumes: { partSha256: classicZip64Parts.map(hash), infoZipJoined: true, volumes: classicZip64Parts.length, repeatedOpens: 2, target: 'docs/page.html', contentSha256: classicZip64Oracle[1].sha256 },
    classicZip64DiskExtraVolumes: { archiveSha256: hash(ZIP64_DISK_EXTRA_LINK_ZIP), partSha256: classicZip64DiskExtraParts.map(hash), infoZipJoined: true, target: 'docs/page.html', contentSha256: classicZip64DiskExtraOracle[1].sha256 },
    publicLibarchiveSymlink: { sha256: hash(PUBLIC_SYMLINK_ZIP), target: publicResolved.entry.name, contentSha256: hash(publicBody) },
    unsupportedCompressionIsolation: { sha256: hash(PUBLIC_UNSUPPORTED_LINK_ZIP), disabledEntry: unsupported.name, laterEntry: second.name, laterContentSha256: hash(secondBody) },
    sourceArchiveUnchanged: true
  }, null, 2))
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
