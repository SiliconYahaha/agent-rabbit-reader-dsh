'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const SevenZip = require('../miniprogram/file-reader/sevenzip/runtime/7zz')
const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')
const { rar5HeaderEncryptedVolumeLinks, rar5Links, rar5VolumeLinks } = require('./helpers/rar-links')
const { BZIP2_LINK_ZIP, forceZip64Archive, splitClassicZip, splitClassicZip64 } = require('./helpers/zip-legacy-compat')
const { extractArchiveVolumeEntry, extract7zEntry, inspectArchiveVolumes, inspect7zArchive, parseListing, readArchiveVolumeEntry, safeArchivePath } = require('../miniprogram/file-reader/archive/sevenzip-runtime')

const LZMA2_7Z = Buffer.from('N3q8ryccAAToOxBVbAAAAAAAAABaAAAAAAAAAOxcm1XgeRcAZF0AdC/PLmTN6HiqT4tYzcqebtSJQiqyKuez0oEHGfOE5qXbsW/3CjiIAc+SNZv+VsRDsqrIutGvvlJFavRVzpLcMFE+QCNmo7ZaB8hX0hN+QI2yaDJVMgchhI/ReSLplG+zBmEAAAABBAYAAQlsAAcLAQABISEBBgzAGHkACAoB59WgGAAABQEZCgAAAAAAAAAAAAARFQBEjZllLwD0iw5mLgB0AHgAdAAAABQKAQAwppayQTjdARUGAQAggLaBAAA=', 'base64')
const ENCRYPTED_7Z = Buffer.from('N3q8ryccAARb2dJaoAAAAAAAAAAuAAAAAAAAAMMl24ByhwOTnOz0Hj2X/5QQfClaXvUH3WeyVGuUz+wT51ui6cfwT0QkMX2KpNy8wOXjQcQ389hwIKyg3l48kWHNw9OLWdLYp+Sh9GVpAl2AFddCETXmksiG9Javw7y3UK2Y/7dG8FZghIp448gwm228iDrdqonZMi1V/GwyowjieBiYYV56zlVGpf4I/w2HbQYwrAOE1S5FUh0J9F/Cq+l2MmBFFwYwAQlwAAcLAQABJAbxBwESUw9Szz0+ZtkoxiiXHzlBA/IyDGoKAbb9uMkAAA==', 'base64')
const AES_ZIP = Buffer.from('UEsDBDMAAQhjAEeDHl0AAAAAPAAAACAAAAAKAAsA6K+05piOLnR4dAGZBwACAEFFAwAAxqYMIEpxkD93Onq2L5ImmUfPhbPyetKmhWqhu6zsmy8UmbjOqKaLZFmSwivNKekk2YEYTwVVNvsBaSqRUEsBAj8DMwABCGMAR4MeXQAAAAA8AAAAIAAAAAoALwAAAAAAAAAggLaBAAAAAOivtOaYji50eHQKACAAAAAAAAEAGACgres3WTjdAQAAAAAAAAAAAAAAAAAAAAABmQcAAgBBRQMAAFBLBQYAAAAAAQABAGcAAABvAAAAAAA=', 'base64')
const BZIP2_ZIP = Buffer.from('UEsDBC4AAAgMAIeDHl0idKZffwAAADgYAAAKAAAA6K+05piOLnR4dEJaaDkxQVkmU1mdSiCdAAEsH/FAABAAECBAEAAgQABUhAEViAMLoDAAuAoAAAGBQAAAMApVQGgANDamoRbRFkIuIiyEWQi3iLIRbBFwEXwRchF3EWBF4EXcRaCLARaCLMRaCLaIsCLeItBFgRYEWBFgRZiL+LuSKcKEhOpRBOhQSwECPwMuAAAIDACHgx5dInSmX38AAAA4GAAACgAkAAAAAAAAACCAtoEAAAAA6K+05piOLnR4dAoAIAAAAAAAAQAYAJCjwn9ZON0BAAAAAAAAAAAAAAAAAAAAAFBLBQYAAAAAAQABAFwAAACnAAAAAAA=', 'base64')
const WASM = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'file-reader', 'sevenzip', 'runtime', '7zz.wasm.br')))
const options = { wasmBinary: WASM, maxEntrySize: 1024 * 1024 }

const ERROR_TEXT_FILES = Object.fromEntries([
  'Data Error.txt', 'Wrong password.txt', 'Can not open.txt', 'ERROR:details.txt',
  'data error lower.txt', 'prefix-WRONG PASSWORD-suffix.txt', 'Enter password.txt',
  'Enter password:.txt', '正常内容.txt', 'Everything is Ok.txt'
].map((name, index) => [name, Buffer.from(`关键词文件 ${index} 的真实正文：${name}`)]))

async function errorTextSevenZip (password = '') {
  const engine = await SevenZip({ wasmBinary: WASM, print () {}, printErr () {} })
  for (const [name, bytes] of Object.entries(ERROR_TEXT_FILES)) engine.FS.writeFile(`/${name}`, bytes)
  const args = ['a', '-t7z', '-m0=lzma2', '/keywords.7z']
  if (password) args.push(`-p${password}`, '-mhe=on')
  args.push('--', ...Object.keys(ERROR_TEXT_FILES).map(name => `/${name}`))
  assert.equal(engine.callMain(args), 0)
  return engine.FS.readFile('/keywords.7z')
}

for (const format of ['zip', '7z', 'encrypted-7z']) {
  test(`${format} 正常文件名中的错误和密码关键词不会阻止目录或解压`, async () => {
    const password = format === 'encrypted-7z' ? 'keyword-fixture-140' : ''
    const archive = format === 'zip' ? zipSync(ERROR_TEXT_FILES) : await errorTextSevenZip(password)
    const archiveOptions = { ...options, password, archiveExtension: format === 'zip' ? '.zip' : '.7z', archiveType: format === 'zip' ? 'zip-engine' : '7z-engine' }
    const inspection = await inspect7zArchive(archive, archiveOptions)
    assert.deepEqual(inspection.entries.map(entry => entry.name).sort(), Object.keys(ERROR_TEXT_FILES).sort())
    assert.equal(inspection.passwordRequired, Boolean(password))
    for (const entry of inspection.entries) {
      assert.equal(entry.canOpen, true)
      assert.deepEqual(Buffer.from(await extract7zEntry(archive, entry, archiveOptions)), ERROR_TEXT_FILES[entry.name])
    }
  })
}

test('错误关键词出现在分卷主文件名或 ZIP 注释中也不是解压错误', async () => {
  const archive = await errorTextSevenZip()
  const split = Math.ceil(archive.length / 2)
  const volumes = [{ name: 'Wrong password.7z.001', bytes: archive.subarray(0, split) }, { name: 'Wrong password.7z.002', bytes: archive.subarray(split) }]
  const volumeOptions = { ...options, mainName: volumes[0].name, format: '7z' }
  const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
  assert.equal(inspection.entries.length, Object.keys(ERROR_TEXT_FILES).length)
  for (const entry of inspection.entries) assert.deepEqual(Buffer.from(await extractArchiveVolumeEntry(volumes, entry, volumeOptions)), ERROR_TEXT_FILES[entry.name])
  const commented = zipSync({ 'plain.txt': [Buffer.from('评论不是错误'), { comment: 'Data Error / Wrong password / ERROR:' }] })
  assert.ok(Buffer.from(commented).includes(Buffer.from('Data Error')), '样本必须实际包含注释')
  const zipOptions = { ...options, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const listed = await inspect7zArchive(commented, zipOptions)
  assert.deepEqual(Buffer.from(await extract7zEntry(commented, listed.entries[0], zipOptions)), Buffer.from('评论不是错误'))
})

test('文件名含密码关键词的 CRC 损坏仍报真实错误，不能冒充密码请求', async () => {
  const name = 'Wrong password.txt'
  const valid = zipSync({ [name]: Buffer.from('正确的原始内容') }, { level: 0 })
  const corrupt = Buffer.from(valid)
  corrupt[30 + Buffer.byteLength(name)] ^= 0xff
  const zipOptions = { ...options, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const listed = await inspect7zArchive(corrupt, zipOptions)
  await assert.rejects(extract7zEntry(corrupt, listed.entries[0], zipOptions), error => {
    assert.equal(error.archiveFailure, 'command-failed')
    assert.equal(error.exitCode, 2)
    assert.match(error.message, /CRC Failed/)
    return true
  })
  const good = await inspect7zArchive(valid, zipOptions)
  assert.deepEqual(Buffer.from(await extract7zEntry(valid, good.entries[0], zipOptions)), Buffer.from('正确的原始内容'))
})

const LITERAL_FILES = Object.fromEntries([
  'first.txt', 'report---------final.txt', 'report----------final.txt',
  'report-----------final.txt', '--------------------', '----------',
  ' leading.txt', 'trailing.txt ', ' both sides.txt ', ' name = value.txt ', 'last.txt'
].map((name, index) => [name, Buffer.from(`第 ${index} 份真实正文：${JSON.stringify(name)}`)]))

async function literalSevenZip () {
  const engine = await SevenZip({ wasmBinary: WASM, print () {}, printErr () {} })
  for (const [name, bytes] of Object.entries(LITERAL_FILES)) engine.FS.writeFile(`/${name}`, bytes)
  assert.equal(engine.callMain(['a', '-t7z', '-m0=lzma2', '-ms=on', '/literal.7z', '--', ...Object.keys(LITERAL_FILES).map(name => `/${name}`)]), 0)
  return engine.FS.readFile('/literal.7z')
}

for (const format of ['zip', '7z']) {
  test(`${format} 连续横线与首尾空格文件名保留全部目录和原始内容`, async () => {
    const archive = format === 'zip' ? zipSync(LITERAL_FILES) : await literalSevenZip()
    const archiveOptions = { ...options, archiveExtension: `.${format}`, archiveType: `${format}-engine` }
    const inspection = await inspect7zArchive(archive, archiveOptions)
    assert.deepEqual(inspection.entries.map(item => item.name).sort(), Object.keys(LITERAL_FILES).sort())
    if (format === '7z') assert.equal(inspection.metadata.find(item => item.label === '固实压缩').value, '是')
    for (const entry of inspection.entries) {
      assert.equal(entry.canOpen, true)
      assert.equal(entry.uncompressedSize, LITERAL_FILES[entry.name].length)
      assert.deepEqual(Buffer.from(await extract7zEntry(archive, entry, archiveOptions)), LITERAL_FILES[entry.name])
    }
  })
}

test('分卷归档和主分卷名中的横线不改变条目或压缩方式', async () => {
  const archive = await literalSevenZip()
  const split = Math.ceil(archive.length / 2)
  const volumes = [
    { name: 'report----------final.7z.001', bytes: archive.subarray(0, split) },
    { name: 'report----------final.7z.002', bytes: archive.subarray(split) }
  ]
  const volumeOptions = { ...options, format: '7z', mainName: volumes[0].name }
  const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
  assert.deepEqual(inspection.entries.map(item => item.name).sort(), Object.keys(LITERAL_FILES).sort())
  assert.match(inspection.metadata.find(item => item.label === '压缩方式').value, /LZMA2/)
  for (const entry of inspection.entries) {
    assert.deepEqual(Buffer.from(await extractArchiveVolumeEntry(volumes, entry, volumeOptions)), LITERAL_FILES[entry.name])
  }
})

test('RAR5 真实分卷中的链接按成员身份打开跨卷目标正文', async () => {
  const volumes = rar5VolumeLinks()
  const volumeOptions = { ...options, format: 'rar', mainName: 'linked.part1.rar' }
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const target = inspection.entries.find(entry => entry.name === 'docs/page.html')
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(target.uncompressedSize, Buffer.byteLength('<h1>分卷链接真实正文</h1>'))
  assert.equal(link.isLink, true)
  assert.equal(link.linkTarget, 'docs/page.html')
  await assert.rejects(extractArchiveVolumeEntry(volumes, link, volumeOptions), /链接需先解析/)
  const opened = await readArchiveVolumeEntry(volumes, link, volumeOptions)
  assert.equal(opened.entry.memberIndex, target.memberIndex)
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>分卷链接真实正文</h1>')
  await assert.rejects(inspectArchiveVolumes(volumes.slice(0, 1), volumeOptions))
})

test('RAR5 加密文件头分卷解锁后仍能通过链接打开跨卷目标', async () => {
  const volumes = rar5HeaderEncryptedVolumeLinks()
  const volumeOptions = { ...options, format: 'rar', mainName: volumes[0].name }
  await assert.rejects(inspectArchiveVolumes(volumes, volumeOptions), error => error.archiveFailure === 'password-required')
  await assert.rejects(inspectArchiveVolumes(volumes, { ...volumeOptions, password: '错误密码' }), error => error.archiveFailure === 'password-or-corrupt')
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), { ...volumeOptions, password: '1234' })
  const target = inspection.entries.find(entry => entry.name === 'docs/page.html')
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(link.isLink, true)
  assert.equal(link.linkTarget, 'docs/page.html')
  const opened = await readArchiveVolumeEntry(volumes, link, { ...volumeOptions, password: '1234' })
  assert.equal(opened.entry.memberIndex, target.memberIndex)
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>加密分卷链接真实正文</h1>')
  await assert.rejects(inspectArchiveVolumes(volumes.slice(0, 1), { ...volumeOptions, password: '1234' }))
})

test('分卷链接拒绝越界、缺失、循环和重名，并支持中间目录链接', async () => {
  async function openLink (archive, name = 'shortcut') {
    const volumes = [{ name: 'safety.part1.rar', bytes: archive }]
    const volumeOptions = { ...options, format: 'rar', mainName: volumes[0].name }
    const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
    const link = inspection.entries.find(entry => entry.name === name)
    return readArchiveVolumeEntry(volumes, link, volumeOptions)
  }
  await assert.rejects(openLink(rar5Links([{ name: 'shortcut', target: '../../outside.txt' }])), /范围|不安全/)
  await assert.rejects(openLink(rar5Links([{ name: 'shortcut', target: 'missing.txt' }])), /不存在/)
  await assert.rejects(openLink(rar5Links([{ name: 'first', target: 'second' }, { name: 'second', target: 'first' }]), 'first'), /循环/)
  await assert.rejects(openLink(rar5Links([{ name: 'target.txt', content: 'one' }, { name: 'target.txt', content: 'two' }, { name: 'shortcut', target: 'target.txt' }])), /同名/)
  const opened = await openLink(rar5Links([
    { name: 'real/docs/page.html', content: '中间目录链接真实正文' },
    { name: 'aliases/folder', target: '../real/docs', directory: true },
    { name: 'shortcut', target: 'aliases/folder/page.html' }
  ]))
  assert.equal(opened.entry.name, 'real/docs/page.html')
  assert.equal(Buffer.from(opened.bytes).toString(), '中间目录链接真实正文')
  const hard = await openLink(rar5Links([{ name: 'target.txt', content: '包根硬链接正文' }, { name: 'sub/shortcut', target: 'target.txt', linkType: 4 }]), 'sub/shortcut')
  assert.equal(Buffer.from(hard.bytes).toString(), '包根硬链接正文')
  const folder = await openLink(rar5Links([{ name: 'docs/child.txt', content: '目录子文件' }, { name: 'folder', target: 'docs', directory: true }]), 'folder')
  assert.equal(folder.entry.isDirectory, true)
  assert.deepEqual(folder.entries.map(entry => entry.name), ['docs/child.txt'])
})

test('只有独立分隔行可开始目录，空归档不伪造成员', () => {
  assert.throws(() => parseListing('Path = report----------final.zip\nType = zip\n', 1024), /目录清单/)
  assert.deepEqual(parseListing('Path = empty.zip\nType = zip\n\n----------\n', 1024), [])
  const entries = parseListing('Path = archive----------name.zip\nType = zip\n\n----------\nPath =  report----------name.txt \nSize = 12\nMethod = Copy\n', 1024)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, ' report----------name.txt ')
  assert.equal(entries[0].uncompressedSize, 12)
})

test('特殊文件名不绕过大小保护，截断归档报错后内核仍可重试', async () => {
  const archive = await literalSevenZip()
  const inspection = await inspect7zArchive(archive, { ...options, maxEntrySize: 1 })
  assert.equal(inspection.entries.length, Object.keys(LITERAL_FILES).length)
  assert.ok(inspection.entries.every(entry => !entry.canOpen))
  await assert.rejects(extract7zEntry(archive, inspection.entries[0], { ...options, maxSize: 1 }), /超过/)
  await assert.rejects(inspect7zArchive(archive.subarray(0, 20), options))
  const recovered = await inspect7zArchive(archive, options)
  assert.equal(recovered.entries.length, Object.keys(LITERAL_FILES).length)
  assert.deepEqual(Buffer.from(await extract7zEntry(archive, recovered.entries[0], options)), LITERAL_FILES[recovered.entries[0].name])
})

test('7-Zip 兼容目录保留所有 ZIP 条目分隔并逐条打开真实内容', async () => {
  const files = { 'docs/first.txt': Buffer.from('第一份正文'), 'docs/second.txt': Buffer.from('第二份正文'), 'empty.txt': Buffer.alloc(0) }
  const archive = zipSync(files)
  const zipOptions = { ...options, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const inspection = await inspect7zArchive(archive, zipOptions)
  assert.deepEqual(inspection.entries.filter(item => !item.isDirectory).map(item => item.name).sort(), Object.keys(files).sort())
  for (const entry of inspection.entries.filter(item => !item.isDirectory)) {
    assert.equal(entry.canOpen, true)
    const actual = await extract7zEntry(archive, entry, { ...zipOptions, maxSize: 1024 * 1024 })
    assert.deepEqual(Buffer.from(actual), files[entry.name])
  }
})

test('7-Zip 固实多文件归档不会只剩最后一项', async () => {
  const engine = await SevenZip({ wasmBinary: WASM, print () {}, printErr () {} })
  const files = { 'first.txt': Buffer.from('first real content'), 'second.txt': Buffer.from('second real content') }
  for (const [name, bytes] of Object.entries(files)) engine.FS.writeFile(`/${name}`, bytes)
  assert.equal(engine.callMain(['a', '-t7z', '-m0=lzma2', '-ms=on', '/multi.7z', '/first.txt', '/second.txt']), 0)
  const archive = engine.FS.readFile('/multi.7z')
  const inspection = await inspect7zArchive(archive, options)
  assert.deepEqual(inspection.entries.filter(item => !item.isDirectory).map(item => item.name).sort(), Object.keys(files).sort())
  for (const entry of inspection.entries.filter(item => !item.isDirectory)) {
    const actual = await extract7zEntry(archive, entry, { ...options, maxSize: 1024 * 1024 })
    assert.deepEqual(Buffer.from(actual), files[entry.name])
  }
})

test('7z 内核列出中文目录并解压 LZMA2 真实正文', async () => {
  const inspection = await inspect7zArchive(LZMA2_7Z, options)
  const entry = inspection.entries.find(item => item.name === '资料/说明.txt')

  assert.equal(inspection.archiveType, '7z-engine')
  assert.ok(entry)
  assert.equal(entry.method, 'LZMA2:15')
  assert.equal(entry.uncompressedSize, 31000)
  assert.equal(entry.canOpen, true)

  const output = await extract7zEntry(LZMA2_7Z, entry, { wasmBinary: WASM, maxSize: 1024 * 1024 })
  assert.equal(output.length, 31000)
  assert.equal(new TextDecoder().decode(output), '这是 7z 里的真实正文。'.repeat(1000))
})

test('7z 路径检查拒绝绝对路径和目录穿越', () => {
  assert.equal(safeArchivePath('资料/说明.txt'), true)
  assert.equal(safeArchivePath('/etc/passwd'), false)
  assert.equal(safeArchivePath('../逃逸.txt'), false)
  assert.equal(safeArchivePath('资料/../../逃逸.txt'), false)
})

test('7z 密码只在本次调用中使用，并能解锁头部加密目录与真实正文', async () => {
  await assert.rejects(inspect7zArchive(ENCRYPTED_7Z, options), /需要密码/)
  await assert.rejects(inspect7zArchive(ENCRYPTED_7Z, { ...options, password: '错误密码' }), /密码不正确/)

  const inspection = await inspect7zArchive(ENCRYPTED_7Z, { ...options, password: 'test-兔子-147' })
  const entry = inspection.entries.find(item => item.name === '说明.txt')
  assert.equal(inspection.passwordRequired, true)
  assert.equal(inspection.passwordProvided, true)
  assert.equal(entry.encrypted, true)
  assert.equal(entry.canOpen, true)

  const output = await extract7zEntry(ENCRYPTED_7Z, entry, { wasmBinary: WASM, maxSize: 1024 * 1024, password: 'test-兔子-147' })
  assert.equal(new TextDecoder().decode(output), '加密压缩包里的真实正文。')
})

test('同一本机内核可解锁 AES ZIP 并打开真实正文', async () => {
  const zipOptions = { ...options, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const locked = await inspect7zArchive(AES_ZIP, zipOptions)
  const lockedEntry = locked.entries.find(item => item.name === '说明.txt')
  assert.equal(locked.archiveType, 'zip-engine')
  assert.equal(locked.title, 'ZIP 压缩包')
  assert.equal(lockedEntry.encrypted, true)
  assert.equal(lockedEntry.canOpen, false)

  const unlocked = await inspect7zArchive(AES_ZIP, { ...zipOptions, password: 'zip-rabbit-149' })
  const entry = unlocked.entries.find(item => item.name === '说明.txt')
  assert.equal(entry.canOpen, true)
  await assert.rejects(extract7zEntry(AES_ZIP, entry, { ...zipOptions, password: '错误密码' }), /密码|Wrong password|Data Error/i)
  const output = await extract7zEntry(AES_ZIP, entry, { ...zipOptions, password: 'zip-rabbit-149' })
  assert.equal(new TextDecoder().decode(output), '加密 ZIP 里的真实正文。')
})

test('同一本机内核可打开 BZip2 方法 ZIP 正文', async () => {
  const zipOptions = { ...options, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const inspection = await inspect7zArchive(BZIP2_ZIP, zipOptions)
  const entry = inspection.entries.find(item => item.name === '说明.txt')
  assert.match(entry.method, /BZip2/i)
  assert.equal(entry.canOpen, true)
  const output = await extract7zEntry(BZIP2_ZIP, entry, zipOptions)
  assert.equal(new TextDecoder().decode(output), 'BZip2 ZIP 里的真实正文。'.repeat(200))
})

test('本机内核合并 7z 数字分卷后列目录并打开真实正文', async () => {
  const first = Math.ceil(LZMA2_7Z.length / 3)
  const volumes = [
    { name: '资料.7z.001', bytes: LZMA2_7Z.subarray(0, first) },
    { name: '资料.7z.002', bytes: LZMA2_7Z.subarray(first, first * 2) },
    { name: '资料.7z.003', bytes: LZMA2_7Z.subarray(first * 2) }
  ]
  const volumeOptions = { ...options, format: '7z', mainName: '资料.7z.001' }
  const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
  const entry = inspection.entries.find(item => item.name === '资料/说明.txt')
  assert.equal(inspection.archiveType, 'volume-engine')
  assert.equal(inspection.title, '7z 分卷压缩包')
  assert.ok(inspection.metadata.some(item => item.label === '分卷数量' && item.value === '3'))
  assert.equal(entry.canOpen, true)

  const output = await extractArchiveVolumeEntry(volumes, entry, { ...volumeOptions, maxSize: 1024 * 1024 })
  assert.equal(new TextDecoder().decode(output), '这是 7z 里的真实正文。'.repeat(1000))
})

test('ZIP64 数字分卷保留链接身份并连续打开跨卷真实正文', async () => {
  const archive = forceZip64Archive(BZIP2_LINK_ZIP)
  const first = Math.ceil(archive.length / 3)
  const volumes = [
    { name: 'linked.zip.001', bytes: archive.subarray(0, first) },
    { name: 'linked.zip.002', bytes: archive.subarray(first, first * 2) },
    { name: 'linked.zip.003', bytes: archive.subarray(first * 2) }
  ]
  const before = volumes.map(volume => Buffer.from(volume.bytes))
  const volumeOptions = { ...options, format: 'zip', mainName: volumes[0].name }
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  const target = inspection.entries.find(entry => entry.name === 'docs/page.html')
  assert.equal(link.isLink, true)
  assert.match(link.detail, /符号链接/)
  assert.equal(target.canOpen, true)
  for (let index = 0; index < 2; index++) {
    const opened = await readArchiveVolumeEntry(volumes, link, volumeOptions)
    assert.equal(opened.entry.memberIndex, target.memberIndex)
    assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
  }
  assert.deepEqual(volumes.map(volume => Buffer.from(volume.bytes)), before, '分卷读取不得改写原字节')
})

test('经典 z01/z02/zip 分卷恢复磁盘相对偏移并连续打开跨卷链接正文', async () => {
  const parts = splitClassicZip(BZIP2_LINK_ZIP, [67, 134])
  const volumes = [
    { name: 'linked.z01', bytes: parts[0] },
    { name: 'linked.z02', bytes: parts[1] },
    { name: 'linked.zip', bytes: parts[2] }
  ]
  const before = volumes.map(volume => Buffer.from(volume.bytes))
  const volumeOptions = { ...options, format: 'zip', mainName: 'linked.zip' }
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  const target = inspection.entries.find(entry => entry.name === 'docs/page.html')
  assert.equal(link.isLink, true)
  assert.equal(link.zipCentralIndex, 1)
  assert.equal(target.zipCentralIndex, 0)
  assert.match(link.detail, /符号链接/)
  for (let index = 0; index < 2; index++) {
    const opened = await readArchiveVolumeEntry(volumes.slice().reverse(), link, volumeOptions)
    assert.equal(opened.entry.memberIndex, target.memberIndex)
    assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
  }
  assert.deepEqual(volumes.map(volume => Buffer.from(volume.bytes)), before, '经典分卷读取不得改写原字节')
})

test('经典 ZIP 成员引用不存在磁盘时拒绝且不影响随后重试', async () => {
  const parts = splitClassicZip(BZIP2_LINK_ZIP, [134])
  const brokenFinal = Buffer.from(parts[1])
  let eocd = -1
  for (let offset = brokenFinal.length - 22; offset >= 0; offset--) {
    if (brokenFinal.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  }
  const central = brokenFinal.readUInt32LE(eocd + 16)
  brokenFinal.writeUInt16LE(9, central + 34)
  const bad = [{ name: 'broken.z01', bytes: parts[0] }, { name: 'broken.zip', bytes: brokenFinal }]
  await assert.rejects(inspectArchiveVolumes(bad, { ...options, format: 'zip', mainName: 'broken.zip' }), /不存在的磁盘|Data Error|Unexpected end|错误/i)

  const good = [{ name: 'good.z01', bytes: parts[0] }, { name: 'good.zip', bytes: parts[1] }]
  const goodOptions = { ...options, format: 'zip', mainName: 'good.zip' }
  const inspection = await inspectArchiveVolumes(good, goodOptions)
  const opened = await readArchiveVolumeEntry(good, inspection.entries.find(entry => entry.name === 'shortcut'), goodOptions)
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
})

test('ZIP64 经典 z01/z02/zip 分卷恢复结束记录和成员的磁盘相对位置', async () => {
  const parts = splitClassicZip64(forceZip64Archive(BZIP2_LINK_ZIP), [67, 134])
  const volumes = [
    { name: 'linked64.z01', bytes: parts[0] },
    { name: 'linked64.z02', bytes: parts[1] },
    { name: 'linked64.zip', bytes: parts[2] }
  ]
  const before = volumes.map(volume => Buffer.from(volume.bytes))
  const volumeOptions = { ...options, format: 'zip', mainName: 'linked64.zip' }
  const inspection = await inspectArchiveVolumes(volumes.slice().reverse(), volumeOptions)
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  const target = inspection.entries.find(entry => entry.name === 'docs/page.html')
  assert.equal(link.isLink, true)
  assert.equal(link.zipCentralIndex, 1)
  assert.equal(target.zipCentralIndex, 0)
  for (let index = 0; index < 2; index++) {
    const opened = await readArchiveVolumeEntry(volumes.slice().reverse(), link, volumeOptions)
    assert.equal(opened.entry.memberIndex, target.memberIndex)
    assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
  }
  assert.deepEqual(volumes.map(volume => Buffer.from(volume.bytes)), before, 'ZIP64 经典分卷读取不得改写原字节')
})

test('ZIP64 经典分卷支持成员起始磁盘号也存入 ZIP64 extra', async () => {
  const parts = splitClassicZip64(forceZip64Archive(BZIP2_LINK_ZIP, { includeDiskStart: true }), [67, 134])
  const volumes = parts.map((bytes, index) => ({ name: index === parts.length - 1 ? 'extra64.zip' : `extra64.z${String(index + 1).padStart(2, '0')}`, bytes }))
  const volumeOptions = { ...options, format: 'zip', mainName: 'extra64.zip' }
  const inspection = await inspectArchiveVolumes(volumes, volumeOptions)
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(link.isLink, true)
  const opened = await readArchiveVolumeEntry(volumes, link, volumeOptions)
  assert.equal(opened.entry.name, 'docs/page.html')
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
})

test('ZIP64 经典分卷拒绝损坏定位器、结束记录和成员磁盘后仍可重试', async () => {
  const goodParts = splitClassicZip64(forceZip64Archive(BZIP2_LINK_ZIP), [67, 134])
  const corruptions = [
    final => {
      const eocd = final.length - 22
      final.writeUInt32LE(99, eocd - 20 + 16)
    },
    final => {
      const eocd = final.length - 22
      const locator = eocd - 20
      const record = Number(final.readBigUInt64LE(locator + 8))
      final.writeUInt32LE(9, record + 16)
    },
    final => {
      const eocd = final.length - 22
      const locator = eocd - 20
      const record = Number(final.readBigUInt64LE(locator + 8))
      const central = Number(final.readBigUInt64LE(record + 48))
      final.writeUInt16LE(9, central + 34)
    }
  ]
  for (const corrupt of corruptions) {
    const parts = goodParts.map(part => Buffer.from(part))
    corrupt(parts[parts.length - 1])
    const volumes = parts.map((bytes, index) => ({ name: index === parts.length - 1 ? 'bad64.zip' : `bad64.z${String(index + 1).padStart(2, '0')}`, bytes }))
    await assert.rejects(inspectArchiveVolumes(volumes, { ...options, format: 'zip', mainName: 'bad64.zip' }), /磁盘|定位器|结束记录|不存在/i)
  }

  const good = goodParts.map((bytes, index) => ({ name: index === goodParts.length - 1 ? 'retry64.zip' : `retry64.z${String(index + 1).padStart(2, '0')}`, bytes }))
  const goodOptions = { ...options, format: 'zip', mainName: 'retry64.zip' }
  const inspection = await inspectArchiveVolumes(good, goodOptions)
  const opened = await readArchiveVolumeEntry(good, inspection.entries.find(entry => entry.name === 'shortcut'), goodOptions)
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>链接成员BZip2真实正文</h1>')
})
