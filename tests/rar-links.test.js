'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const test = require('node:test')
const { rar4Links, rar5Links, rar5HeaderEncryptedLinks } = require('./helpers/rar-links')
const { crc32 } = require('./helpers/archive-duplicates')
const { readRarLinks } = require('../miniprogram/file-reader/archive/rar-links')
const { inspectRarArchive, extractRarEntry, readRarEntry } = require('../miniprogram/file-reader/archive/rar-runtime')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))

for (const [format, make] of [['RAR4', rar4Links], ['RAR5', rar5Links]]) {
  test(`${format} 链接显示真实目标，点开无扩展名链接得到 HTML 正文及正确类型`, async () => {
    const archive = make([{ name: 'docs/page.html', content: '<h1>真正的目标页面</h1>' }, { name: 'shortcut', target: 'docs/page.html' }])
    const inspection = await inspectRarArchive(archive, { wasmBinary })
    const link = inspection.entries.find(entry => entry.name === 'shortcut')
    assert.equal(link.isLink, true)
    assert.equal(link.linkTarget, 'docs/page.html')
    assert.match(link.detail, /链接.*docs\/page.html/)
    const opened = await readRarEntry(archive, link, { wasmBinary })
    assert.equal(opened.entry.name, 'docs/page.html')
    assert.equal(Buffer.from(opened.bytes).toString(), '<h1>真正的目标页面</h1>')
    assert.equal(Buffer.from(await extractRarEntry(archive, link, { wasmBinary })).toString(), '<h1>真正的目标页面</h1>')
  })

  test(`${format} 相对上级路径和多级链接仅在包内解析`, async () => {
    const archive = make([{ name: 'target.txt', content: '正确内容' }, { name: 'folder/first', target: '../target.txt' }, { name: 'second', target: 'folder/first' }])
    const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(entry => entry.name === 'second')
    assert.equal(Buffer.from(await extractRarEntry(archive, link, { wasmBinary })).toString(), '正确内容')
  })

  test(`${format} 拒绝逃逸、缺失、循环和歧义链接，而不打开错误内容`, async () => {
    for (const [target, pattern] of [['../../outside.txt', /范围|越界|不安全/], ['/etc/passwd', /范围|越界|不安全/], ['C:\\outside.txt', /范围|越界|不安全/], ['missing.txt', /不存在|缺失|找不到/], ['shortcut', /循环/], ['target.txt', /同名|歧义|多个/]]) {
      const archive = make([{ name: 'target.txt', content: 'one' }, { name: 'target.txt', content: 'two' }, { name: 'shortcut', target }])
      const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(entry => entry.name === 'shortcut')
      await assert.rejects(extractRarEntry(archive, link, { wasmBinary }), pattern, target)
    }
  })

  test(`${format} 链接不能绕过实际目标大小上限`, async () => {
    const archive = make([{ name: 'large.txt', content: Buffer.alloc(65536, 65) }, { name: 'link', target: 'large.txt' }])
    const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(entry => entry.name === 'link')
    await assert.rejects(extractRarEntry(archive, link, { wasmBinary, maxSize: 32 }), /超过|上限/)
  })

  test(`${format} 文件夹链接返回真实子目录，空目录不是空白文件`, async () => {
    const archive = make([{ name: 'docs', directory: true }, { name: 'docs/readme.txt', content: '目录正文' }, { name: 'empty', directory: true }, { name: 'folder-link', target: 'docs', directory: true }, { name: 'empty-link', target: 'empty', directory: true }])
    const inspection = await inspectRarArchive(archive, { wasmBinary })
    const folder = await readRarEntry(archive, inspection.entries.find(e => e.name === 'folder-link'), { wasmBinary })
    assert.equal(folder.entry.isDirectory, true)
    const child = folder.entries.find(e => e.name === 'docs/readme.txt')
    assert.equal(Buffer.from(await extractRarEntry(archive, child, { wasmBinary })).toString(), '目录正文')
    const empty = await readRarEntry(archive, inspection.entries.find(e => e.name === 'empty-link'), { wasmBinary })
    assert.equal(empty.entry.isDirectory, true)
    assert.deepEqual(empty.entries, [])
  })

  test(`${format} 链接可作为包内路径中间目录并打开真实子文件`, async () => {
    const archive = make([
      { name: 'real/docs', directory: true },
      { name: 'real/docs/child.html', content: '<h1>中间目录链接真实正文</h1>' },
      { name: 'aliases/folder-link', target: '../real/docs', directory: true },
      { name: 'open-child', target: 'aliases/folder-link/child.html' }
    ])
    const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(entry => entry.name === 'open-child')
    const opened = await readRarEntry(archive, link, { wasmBinary })
    assert.equal(opened.entry.name, 'real/docs/child.html')
    assert.equal(Buffer.from(opened.bytes).toString(), '<h1>中间目录链接真实正文</h1>')
  })

  test(`${format} 多级中间目录链接保持限跳、循环和同名保护`, async () => {
    const chained = make([
      { name: 'docs/child.txt', content: '多级中间目录链接' },
      { name: 'first', target: 'docs', directory: true },
      { name: 'nested/second', target: '../first', directory: true },
      { name: 'shortcut', target: 'nested/second/child.txt' }
    ])
    const chainedLink = (await inspectRarArchive(chained, { wasmBinary })).entries.find(entry => entry.name === 'shortcut')
    assert.equal(Buffer.from(await extractRarEntry(chained, chainedLink, { wasmBinary })).toString(), '多级中间目录链接')

    const cyclic = make([{ name: 'first', target: 'second', directory: true }, { name: 'second', target: 'first', directory: true }, { name: 'shortcut', target: 'first/child.txt' }])
    const cyclicLink = (await inspectRarArchive(cyclic, { wasmBinary })).entries.find(entry => entry.name === 'shortcut')
    await assert.rejects(extractRarEntry(cyclic, cyclicLink, { wasmBinary }), /循环/)

    const ambiguous = make([{ name: 'docs-a/child.txt', content: 'a' }, { name: 'docs-b/child.txt', content: 'b' }, { name: 'alias', target: 'docs-a', directory: true }, { name: 'alias', target: 'docs-b', directory: true }, { name: 'shortcut', target: 'alias/child.txt' }])
    const ambiguousLink = (await inspectRarArchive(ambiguous, { wasmBinary })).entries.find(entry => entry.name === 'shortcut')
    await assert.rejects(extractRarEntry(ambiguous, ambiguousLink, { wasmBinary }), /同名|不能确定/)

    const unsafeSibling = make([{ name: '../outside.txt', content: '不应参与解析' }, { name: 'docs/child.txt', content: '安全正文' }, { name: 'alias', target: 'docs', directory: true }, { name: 'shortcut', target: 'alias/child.txt' }])
    const safeLink = (await inspectRarArchive(unsafeSibling, { wasmBinary })).entries.find(entry => entry.name === 'shortcut')
    assert.equal(Buffer.from(await extractRarEntry(unsafeSibling, safeLink, { wasmBinary })).toString(), '安全正文')
  })

  test(`${format} 中文目标、首尾空格与长链接链保持精确内容身份`, async () => {
    const members = [{ name: '目录/ page.html ', content: '不改写目标名称' }, { name: '入口', target: '目录/ page.html ' }]
    const archive = make(members)
    const entry = (await inspectRarArchive(archive, { wasmBinary })).entries.find(e => e.isLink)
    const opened = await readRarEntry(archive, entry, { wasmBinary })
    assert.equal(opened.entry.name, '目录/ page.html ')
    assert.equal(Buffer.from(opened.bytes).toString(), '不改写目标名称')
    const chain = make([{ name: 'target.txt', content: 'end' }, ...Array.from({ length: 17 }, (_, i) => ({ name: `link${i}`, target: i === 16 ? 'target.txt' : `link${i + 1}` }))])
    const first = (await inspectRarArchive(chain, { wasmBinary })).entries.find(e => e.name === 'link0')
    await assert.rejects(readRarEntry(chain, first, { wasmBinary }), /层数.*上限/)
  })

  test(`${format} 损坏头部、截断和超长目标不能产生伪造内容`, async () => {
    const archive = make([{ name: 'target.txt', content: 'actual' }, { name: 'shortcut', target: 'target.txt' }])
    for (const length of [10, archive.length - 15]) assert.throws(() => readRarLinks(archive.subarray(0, length)), /截断|越界/)
    const corrupt = Buffer.from(archive)
    corrupt[format === 'RAR4' ? 9 : 8] ^= 1
    assert.throws(() => readRarLinks(corrupt), /CRC/)
    assert.throws(() => readRarLinks(make([{ name: 'link', target: 'a'.repeat(4097) }])), /长度上限/)
  })
}

test('RAR4 旧式路径按同一原始编码显示并打开真实链接目标', async () => {
  const samples = [
    ['shift_jis', '8abf8e9a', '漢字.txt'],
    ['gb18030', 'd6d0cec4', '中文.txt'],
    ['cp949', 'c7d1b1db', '한글.txt'],
    ['big5', 'a4a4a4e5', '中文.txt']
  ]
  for (const [legacyEncoding, nameHex, expectedName] of samples) {
    const rawName = Buffer.concat([Buffer.from(nameHex, 'hex'), Buffer.from('.txt')])
    const archive = rar4Links([{ name: rawName, content: `${legacyEncoding} 正文` }, { name: 'shortcut', target: rawName }])

    const automatic = await inspectRarArchive(archive, { wasmBinary })
    const automaticLink = automatic.entries.find(entry => entry.isLink)
    assert.equal(Buffer.from(await extractRarEntry(archive, automaticLink, { wasmBinary })).toString(), `${legacyEncoding} 正文`)
    assert.equal(automatic.filenameEncoding, 'auto')
    assert.equal(automatic.filenameEncodingOptions.length, 7)

    const selected = await inspectRarArchive(archive, { wasmBinary, legacyEncoding })
    const target = selected.entries.find(entry => !entry.isLink)
    const link = selected.entries.find(entry => entry.isLink)
    assert.equal(target.name, expectedName)
    assert.equal(link.linkTarget, expectedName)
    assert.equal(selected.filenameEncoding, legacyEncoding)
    assert.equal(Buffer.from(await extractRarEntry(archive, link, { wasmBinary, legacyEncoding })).toString(), `${legacyEncoding} 正文`)
  }
})

test('RAR4 旧式路径的名称长度和手动编码必须在记录内可验证', () => {
  const archive = rar4Links([{ name: 'target.txt', content: 'body' }])
  const fileHeader = 20
  const headerSize = archive.readUInt16LE(fileHeader + 5)
  archive.writeUInt16LE(0xffff, fileHeader + 26)
  archive.writeUInt16LE(crc32(archive.subarray(fileHeader + 2, fileHeader + headerSize)) & 0xffff, fileHeader)
  assert.throws(() => readRarLinks(archive), /越界/)

  const invalidShiftJis = Buffer.from([0x82])
  const invalid = rar4Links([{ name: invalidShiftJis, content: 'body' }, { name: 'shortcut', target: invalidShiftJis }])
  assert.throws(() => readRarLinks(invalid, { legacyEncoding: 'shift_jis' }), /所选字符编码不匹配/)
})

test('RAR5 链接目标仍必须是规范要求的 UTF-8', () => {
  const invalidTarget = Buffer.from([0x8a, 0xbf, 0x8e, 0x9a])
  const archive = rar5Links([{ name: 'target.txt', content: 'body' }, { name: 'shortcut', target: invalidTarget }])
  assert.throws(() => readRarLinks(archive, { legacyEncoding: 'shift_jis' }), /编码无法可靠识别/)
})

test('RAR5 硬链接和文件复制记录按包根目标读取，而不是链接所在目录', async () => {
  for (const linkType of [4, 5]) {
    const archive = rar5Links([{ name: 'target.txt', content: 'root target' }, { name: 'sub/link', target: 'target.txt', linkType }])
    const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(e => e.isLink)
    assert.equal(Buffer.from(await extractRarEntry(archive, link, { wasmBinary })).toString(), 'root target')
  }
})

test('RAR5 加密头部输入密码后仍能读取链接目标并打开真实正文', async () => {
  const archive = rar5HeaderEncryptedLinks([
    { name: 'docs/page.html', content: '<h1>加密头部链接真实正文</h1>' },
    { name: 'shortcut', target: 'docs/page.html' }
  ])
  await assert.rejects(inspectRarArchive(archive, { wasmBinary }), error => error.reason === 'ERAR_MISSING_PASSWORD')
  const inspection = await inspectRarArchive(archive, { wasmBinary, password: '1234' })
  const link = inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(link.isLink, true)
  assert.equal(link.linkTarget, undefined)
  const runtime = require('../miniprogram/file-reader/archive/sevenzip-runtime')
  const sevenWasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const opened = await readRarEntry(archive, link, {
    wasmBinary,
    password: '1234',
    readLinkTarget: (input, entry) => runtime.readRarLinkTarget(input, entry, { wasmBinary: sevenWasm, password: '1234' })
  })
  assert.equal(opened.entry.name, 'docs/page.html')
  assert.equal(Buffer.from(opened.bytes).toString(), '<h1>加密头部链接真实正文</h1>')
})

test('RAR4 目标数据 CRC 损坏会明确拒绝，不把路径文本当正文', () => {
  const archive = rar4Links([{ name: 'link', target: 'target.txt' }])
  archive[archive.length - 8] ^= 1
  assert.throws(() => readRarLinks(archive), /CRC/)
})

test('RAR5 额外记录长度必须限制在本记录内，即使头部 CRC 正确', () => {
  const archive = rar5Links([{ name: 'link', target: 'target.txt' }])
  const start = 16
  assert.equal(archive[start + 5], 2)
  const end = start + 5 + archive[start + 4]
  archive[end - 11] = 127 // redirection target size
  archive.writeUInt32LE(crc32(archive.subarray(start + 4, end)), start)
  assert.throws(() => readRarLinks(archive), /越界/)
})

test('兼容内核分别读取 RAR4 数据目标与 RAR5 重定向目标，保留首尾空格', async () => {
  const runtime = require('../miniprogram/file-reader/archive/sevenzip-runtime')
  const sevenWasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  for (const make of [rar4Links, rar5Links]) {
    const archive = make([{ name: ' target.txt ', content: 'actual' }, { name: 'link', target: ' target.txt ' }])
    const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(e => e.isLink)
    const target = await runtime.readRarLinkTarget(archive, link, { wasmBinary: sevenWasm })
    assert.equal(target.target, ' target.txt ')
  }
})

test('20 个链接名称变体逐一保持目标身份，不用显示标签定位内容', async () => {
  const names = ['a.txt', '中文.html', ' page.txt ', 'a'.repeat(240) + '.txt', 'x?.txt', 'x*.txt', '@list.txt', '-pword.txt', 'emoji-🐇.txt', 'a=b.txt']
  for (const make of [rar4Links, rar5Links]) {
    for (const [index, name] of names.entries()) {
      const payload = `真实文件 ${index}：${name}`
      const archive = make([{ name: `docs/${name}`, content: payload }, { name: 'nested/shortcut', target: `../docs/${name}` }])
      const link = (await inspectRarArchive(archive, { wasmBinary })).entries.find(e => e.isLink)
      const actual = await readRarEntry(archive, link, { wasmBinary })
      assert.equal(actual.entry.name, `docs/${name}`)
      assert.equal(Buffer.from(actual.bytes).toString(), payload)
    }
  }
})
