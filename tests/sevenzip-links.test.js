'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const zlib = require('node:zlib')
const path = require('node:path')
const test = require('node:test')
const seven = require('../miniprogram/file-reader/archive/sevenzip-runtime')
const { sevenZipLinks, safeMembers, destinations, body, rawCopyLinks } = require('./helpers/sevenzip-links')
const { readerPage } = require('./helpers/reader-host')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))

async function setup (members, options = {}, volumes = false) {
  const bytes = await sevenZipLinks(members, wasmBinary, options)
  const settings = { wasmBinary, ...options, format: '7z', mainName: 'links.7z.001' }
  const middle = Math.floor(bytes.length / 2)
  const parts = [{ name: 'links.7z.002', bytes: bytes.subarray(middle) }, { name: 'links.7z.001', bytes: bytes.subarray(0, middle) }]
  const inspection = volumes ? await seven.inspectArchiveVolumes(parts, settings) : await seven.inspect7zArchive(bytes, settings)
  const raw = entry => seven.extract7zLinkTarget(bytes, entry, settings)
  const open = async (entry, extra = {}) => {
    if (volumes) return seven.readArchiveVolumeEntry(parts, entry, { ...settings, ...extra })
    const resolved = await seven.resolveSevenZipLink(inspection.entries, entry, linked => seven.extract7zLinkTarget(bytes, linked, { ...settings, ...extra }))
    if (resolved.entry.isDirectory) return resolved
    return { ...resolved, bytes: await seven.extract7zEntry(bytes, resolved.entry, { ...settings, ...extra }) }
  }
  return { bytes, parts, settings, inspection, raw, open }
}

for (const variant of [
  { codec: 'copy', solid: false }, { codec: 'lzma2', solid: false }, { codec: 'lzma2' },
  { codec: 'lzma' }, { codec: 'ppmd' }, { codec: 'lzma2', password: 'link-fixture-password' }
]) {
  for (const volumes of [false, true]) test(`7z Unix 链接正文/目录 ${JSON.stringify(variant)} volumes=${volumes}`, async () => {
    const fixture = await setup(safeMembers, variant, volumes)
    for (const [name, target] of Object.entries(destinations)) {
      const entry = fixture.inspection.entries.find(item => item.name === name)
      assert.equal(entry.isLink, true)
      assert.equal(entry.linkTargetInData, true)
      assert.equal(entry.canOpen, true)
      const opened = await fixture.open(entry)
      assert.equal(opened.entry.name, target)
      assert.deepEqual(Buffer.from(opened.bytes), Buffer.from(safeMembers.find(item => item.name === target).content))
    }
    const folder = await fixture.open(fixture.inspection.entries.find(item => item.name === 'aliases/folder'))
    assert.equal(folder.entry.isDirectory, true)
    assert.deepEqual(folder.entries.map(item => item.name).sort(), ['real/docs/page.html', 'real/docs/empty.txt', 'real/docs/data.bin'].sort())
    const root = await fixture.open(fixture.inspection.entries.find(item => item.name === 'root'))
    assert.equal(root.entries.length, safeMembers.length)
  })
}

test('同名 7z 链接按原生序号分别读取；同名目标拒绝，失败后可恢复', async () => {
  const members = [{ name: 'same', target: 'one' }, { name: 'same', target: 'two' }, { name: 'one', content: 'FIRST' }, { name: 'two', content: 'SECOND' }, { name: 'ambiguous', target: 'same' }]
  for (const volumes of [false, true]) {
    const fixture = await setup(members, { password: 'duplicate-link-password' }, volumes)
    const links = fixture.inspection.entries.filter(e => e.name === 'same')
    for (const index of [1, 0, 1]) assert.equal(Buffer.from((await fixture.open(links[index])).bytes).toString(), index ? 'SECOND' : 'FIRST')
    await assert.rejects(fixture.open(fixture.inspection.entries.find(e => e.name === 'ambiguous')), /同名/)
    assert.equal(Buffer.from((await fixture.open(links[0])).bytes).toString(), 'FIRST')
  }
})

test('7z 链接路径、缺失、循环、层数和正文大小边界', async () => {
  for (const [target, message] of [['../../outside', /之外/], ['/absolute', /不安全/], ['https://outside', /不安全/], ['C:relative', /不安全/], ['bad\nname', /不安全/], ['missing', /不存在/], ['file/child', /普通文件/]]) {
    const fixture = await setup([{ name: 'link', target }, { name: 'file', content: body }])
    await assert.rejects(fixture.open(fixture.inspection.entries.find(e => e.isLink)), message)
  }
  const cycle = await setup([{ name: 'a', target: 'b' }, { name: 'b', target: 'a' }])
  await assert.rejects(cycle.open(cycle.inspection.entries[0]), /循环/)
  for (const depth of [16, 17]) {
    const fixture = await setup([...Array.from({ length: depth }, (_, i) => ({ name: `link${i}`, target: i === depth - 1 ? 'body' : `link${i + 1}` })), { name: 'body', content: body }])
    const result = fixture.open(fixture.inspection.entries.find(e => e.name === 'link0'))
    if (depth === 17) await assert.rejects(result, /层数/)
    else assert.equal(Buffer.from((await result).bytes).toString(), body)
  }
  const fixture = await setup(safeMembers)
  const link = fixture.inspection.entries.find(e => e.name === 'direct')
  await assert.rejects(fixture.open(link, { maxSize: Buffer.byteLength(body) - 1 }), /超过/)
  assert.equal(Buffer.from((await fixture.open(link, { maxSize: Buffer.byteLength(body) })).bytes).toString(), body)
  await assert.rejects(fixture.open(link, { maxSolidDecodeBytes: 1 }), /固实/)
})

test('7z 链接原始输出上限在复制前生效，CRC 损坏拒绝且正常包恢复', async () => {
  const bytes = rawCopyLinks([{ name: 'link', targetBytes: Buffer.from('x'.repeat(4096)) }, { name: 'body', content: body }])
  const settings = { wasmBinary }
  const inspection = await seven.inspect7zArchive(bytes, settings)
  const fixture = { bytes, settings, inspection, raw: entry => seven.extract7zLinkTarget(bytes, entry, settings) }
  const link = inspection.entries.find(e => e.name === 'link')
  assert.equal((await fixture.raw(link)).length, 4096)
  await assert.rejects(seven.extract7zLinkTarget(fixture.bytes, { ...link, uncompressedSize: 1 }, { ...fixture.settings, maxSize: 4095 }), /长度上限/)
  const damaged = Buffer.from(fixture.bytes)
  const payload = damaged.indexOf(Buffer.from('x'.repeat(4096)))
  assert.ok(payload >= 32)
  damaged[payload] ^= 1
  await assert.rejects(seven.extract7zLinkTarget(damaged, link, fixture.settings), /CRC|校验/)
  assert.equal((await fixture.raw(link)).length, 4096)
})

test('真实阅读器点击 7z 链接后写入正确正文、显示 HTML，目录链接可返回', async () => {
  const fixture = await setup(safeMembers)
  const reads = []
  const writes = []
  const files = new Map()
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: options => reads.push(options),
    writeFile: options => { writes.push(options); files.set(options.filePath, Buffer.from(options.data)); options.success() }
  }) })
  async function openArchive () {
    page.openSelectedFile({ name: 'links.7z', path: '/fixture/links.7z', size: fixture.bytes.length })
    await reads.shift().success({ data: seven.exactArrayBuffer(fixture.bytes) })
  }
  await openArchive()
  let index = page._inspectorVisibleEntries.findIndex(e => e.name === 'direct')
  await page.openInspectorEntry({ detail: { index } })
  assert.equal(writes.length, 1)
  assert.equal(Buffer.from(writes[0].data).toString(), body)
  assert.equal(page.data.error, '')
  // Complete the real HTML read callback produced by openSelectedFile.
  const htmlRead = reads.shift()
  assert.ok(htmlRead)
  await htmlRead.success({ data: seven.exactArrayBuffer(files.get(htmlRead.filePath)) })
  assert.equal(page.data.hasContent, true)
  assert.ok(JSON.stringify(page.data.domTree).includes('7z 链接真实正文'))
  await openArchive()
  index = page._inspectorVisibleEntries.findIndex(e => e.name === 'aliases/folder')
  await page.openInspectorEntry({ detail: { index } })
  assert.equal(page.data.inspectorLinkFolder, 'real/docs')
  assert.ok(page._inspectorEntries.some(e => e.name === 'real/docs/page.html'))
  page.returnToArchiveRoot()
  assert.equal(page.data.inspectorLinkFolder, '')
  assert.ok(page._inspectorEntries.some(e => e.name === 'direct'))
  page.detached()
})

test('7z 连续调用恢复参数栈，成功与失败后均不积累', async () => {
  const SevenZip = require('../miniprogram/file-reader/sevenzip/runtime/7zz')
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  const bytes = rawCopyLinks([{ name: 'long-name-'.repeat(20), content: 'stack-body' }])
  engine.FS.writeFile('/repeat.7z', bytes)
  const saved = engine.stackSave()
  for (let i = 0; i < 600; i++) {
    assert.equal(engine.callMain(['l', '-slt', '/repeat.7z']), 0)
    assert.equal(engine.stackSave(), saved, `argv leaked on operation ${i}`)
  }
  let failed = false
  try { failed = engine.callMain(['l', '/missing.7z']) !== 0 } catch (_) { failed = true }
  assert.equal(failed, true)
  assert.equal(engine.stackSave(), saved)
  assert.equal(engine.callMain(['l', '/repeat.7z']), 0)
  assert.equal(engine.stackSave(), saved)
})

test('7z 原始链接目标拒绝无效 UTF-8、NUL 和超长数据', async () => {
  for (const data of [Buffer.from([0xff]), Buffer.from('bad\0path'), Buffer.from('x'.repeat(4097))]) {
    const bytes = rawCopyLinks([{ name: 'link', targetBytes: data }])
    const { entries } = await seven.inspect7zArchive(bytes, { wasmBinary })
    await assert.rejects(seven.resolveSevenZipLink(entries, entries[0], e => seven.extract7zLinkTarget(bytes, e, { wasmBinary })), /UTF-8|超过/)
  }
})

test('同名链接在解码前按原生序号筛选，不读取后续损坏数据', async () => {
  const bytes = await sevenZipLinks([{ name: 'same', target: 'target-a' }, { name: 'same', target: 'x'.repeat(200) }], wasmBinary, { plainHeader: true })
  const { entries } = await seven.inspect7zArchive(bytes, { wasmBinary })
  const end = 32 + Number(bytes.readBigUInt64LE(12))
  assert.ok(entries[0].crc)
  for (let back = 1; back <= 7; back++) {
    const damaged = Buffer.from(bytes)
    damaged[end - back] ^= 0xff
    assert.equal(Buffer.from(await seven.extract7zLinkTarget(damaged, entries[0], { wasmBinary, maxSolidDecodeBytes: 8 })).toString(), 'target-a')
    await assert.rejects(seven.extract7zLinkTarget(damaged, entries[1], { wasmBinary }), /CRC|Data Error|校验/)
  }
  const earlyDamage = Buffer.from(bytes)
  earlyDamage[end - 8] ^= 0xff
  await assert.rejects(seven.extract7zLinkTarget(earlyDamage, entries[0], { wasmBinary }), /CRC|Data Error|校验/)
  assert.equal(Buffer.from(await seven.extract7zLinkTarget(bytes, entries[0], { wasmBinary })).toString(), 'target-a')
})
