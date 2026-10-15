'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), zlib = require('node:zlib')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const { tar } = require('./helpers/tar-fixtures')
const { readerPage } = require('./helpers/reader-host')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br'))
const options = { wasmBinary }
const reference = require('../compatibility/runs/2026-09-08-next-tar-links.json').longLinks.rows

test('TAR base-256 and PAX size overrides preserve body bytes and next-header offsets', async () => {
  const cases = require('../scripts/probe-tar-boundaries').cases().filter(s => /^(base256|pax-size)-/.test(s.name))
  for (const sample of cases) {
    const { entries } = await runtime.inspectTarArchive(sample.bytes, options)
    assert.equal(entries.length, 2, sample.name)
    for (const expected of sample.expected) {
      const entry = entries.find(e => e.name === expected.name)
      assert.deepEqual(Buffer.from(await runtime.extractTarEntry(sample.bytes, entry, options)), expected.body, sample.name + '/' + expected.name)
    }
  }
})

test('GNU/PAX header links retain independent reference bodies and native identities', async () => {
  for (const sample of reference) {
    assert.equal(sample.pythonBodyExact, true)
    assert.equal(sample.bsdTargetExact, true)
    const bytes = Buffer.from(sample.base64, 'base64'), info = await runtime.inspectTarArchive(bytes, options)
    assert.equal(info.title, 'TAR 归档')
    const selected = info.entries.find(e => e.name === 'links/open.html')
    const resolved = runtime.resolveTarLink(info.entries, selected)
    assert.equal(resolved.entry.name, sample.target)
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString(), sample.expected)
  }
})

test('TAR link navigation, preceding hard-link snapshots and explicit invalid targets', async () => {
  const members = [
    { name: 'docs/body.html', body: 'FIRST' },
    { name: 'first-hard', type: '1', target: 'docs/body.html' },
    { name: 'docs/body.html', body: 'SECOND' },
    { name: 'second-hard', type: '1', target: 'docs/body.html' },
    { name: 'ambiguous', type: '2', target: 'docs/body.html' },
    { name: 'folder', type: '2', target: 'docs' },
    { name: 'root', type: '2', target: '.' },
    { name: 'escape', type: '2', target: '../outside' },
    { name: 'missing', type: '2', target: 'absent' },
    { name: 'loop', type: '2', target: 'loop' },
    { name: 'fifo', type: '6' },
    { name: 'character-device', type: '3' },
    { name: 'block-device', type: '4' }
  ]
  for (const format of ['ustar', 'gnu', 'pax']) {
    const bytes = tar(members, format), info = await runtime.inspectTarArchive(bytes, options)
    const find = name => info.entries.find(e => e.name === name)
    for (const [name, expected] of [['first-hard', 'FIRST'], ['second-hard', 'SECOND']]) {
      const resolved = runtime.resolveTarLink(info.entries, find(name))
      assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString(), expected)
    }
    for (const [name, message] of [['ambiguous', /同名/], ['escape', /之外/], ['missing', /不存在/], ['loop', /循环/]]) assert.throws(() => runtime.resolveTarLink(info.entries, find(name)), message)
    assert.equal(runtime.resolveTarLink(info.entries, find('folder')).entries.length, 2)
    assert.equal(runtime.resolveTarLink(info.entries, find('root')).entry.name, '.')
    for (const name of ['fifo', 'character-device', 'block-device']) {
      assert.equal(find(name).canOpen, false)
      await assert.rejects(runtime.extractTarEntry(bytes, find(name), options), /普通成员/)
    }
  }
})

test('actual TAR opens and link taps render body, preserve labels and recover on one host', async () => {
  const oldWasm = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(wasmBinary, imports) }
  const reads = [], writes = [], files = new Map()
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => reads.push(o),
    writeFile: o => { files.set(o.filePath, o.data); writes.push(Buffer.from(o.data)); o.success() }
  }) })
  async function open (bytes, type = '') {
    page.openSelectedFile({ name: 'input.tar', path: '/fixture/input.tar', size: bytes.length, type })
    const read = reads.shift(); assert.ok(read)
    await read.success({ data: bytes })
  }
  try {
    for (const sample of reference) for (const type of ['', 'application/x-tar']) {
      await open(Buffer.from(sample.base64, 'base64'), type)
      assert.equal(page.data.error, '', sample.name)
      assert.equal(page.data.inspectorTitle, 'TAR 归档')
      const index = page._inspectorVisibleEntries.findIndex(e => e.name === 'links/open.html')
      assert.ok(index >= 0)
      await page.openInspectorEntry({ detail: { index } })
      assert.equal(writes.at(-1).toString(), sample.expected)
      const read = reads.shift(); assert.ok(read)
      await read.success({ data: files.get(read.filePath) })
      assert.equal(page.data.error, '')
      assert.equal(page._htmlRuntime.document.body.textContent, sample.name + ' 原文')
      assert.ok(JSON.stringify(page.data.domTree).includes(sample.name + ' 原文'))
    }
    await open(Buffer.from('NOT A TAR ARCHIVE'))
    assert.match(page.data.error, /TAR 读取失败/)
    const directoryBytes = tar([{ name: 'docs/body.html', body: '<p>RECOVERED</p>' }, { name: 'alias', type: '2', target: 'docs' }])
    await open(directoryBytes)
    assert.equal(page.data.error, '')
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'alias') } })
    assert.equal(page.data.inspectorLinkFolder, 'docs')
    assert.ok(page._inspectorEntries.some(e => e.name === 'docs/body.html'))
    page.returnToArchiveRoot()
    assert.equal(page.data.inspectorLinkFolder, '')
    assert.ok(page._inspectorEntries.some(e => e.name === 'alias'))
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'docs/body.html') } })
    const read = reads.shift(); await read.success({ data: files.get(read.filePath) })
    assert.equal(page._htmlRuntime.document.body.textContent, 'RECOVERED')
  } finally {
    page.detached()
    if (oldWasm === undefined) delete global.WXWebAssembly
    else global.WXWebAssembly = oldWasm
  }
})

test('TAR header damage and declared/actual body limits fail before later recovery', async () => {
  const bytes = tar([{ name: 'body.txt', body: 'EXACT BODY' }])
  const bad = Buffer.from(bytes); bad[148] ^= 1
  await assert.rejects(runtime.inspectTarArchive(bad, options))
  await assert.rejects(runtime.inspectTarArchive(new Uint8Array(80 * 1024 * 1024 + 1), options), /80 MB/)
  const info = await runtime.inspectTarArchive(bytes, options), entry = info.entries[0]
  assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entry, { ...options, maxSize: 10 })).toString(), 'EXACT BODY')
  await assert.rejects(runtime.extractTarEntry(bytes, entry, { ...options, maxSize: 9 }), /超过/)
  await assert.rejects(runtime.extractTarEntry(bytes, { ...entry, uncompressedSize: 1 }, { ...options, maxSize: 9 }), /超过/)
  assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entry, options)).toString(), 'EXACT BODY')
})

test('TAR link limits, intermediate paths and literal backslashes retain exact targets', async () => {
  const members = [
    { name: 'real/body.txt', body: 'SLASH BODY' },
    { name: 'real\\body.txt', body: 'BACKSLASH BODY' },
    { name: 'folder', type: '2', target: 'real' },
    { name: 'through-folder', type: '2', target: 'folder/body.txt' },
    { name: 'literal', type: '2', target: 'real\\body.txt' },
    { name: 'not-folder', type: '2', target: 'real/body.txt/child' },
    { name: 'empty-link', type: '2', target: '' },
    { name: 'absolute', type: '2', target: '/real/body.txt' },
    { name: 'url', type: '2', target: 'https://example.invalid/body' },
    { name: 'control', type: '2', target: 'real/\nbody.txt' },
    { name: 'too-long', type: '2', target: './'.repeat(2048) + 'real/body.txt' },
    ...Array.from({ length: 17 }, (_, i) => ({ name: 'chain-' + i, type: '2', target: i === 16 ? 'real/body.txt' : 'chain-' + (i + 1) }))
  ]
  const bytes = tar(members, 'pax'), info = await runtime.inspectTarArchive(bytes, options), find = name => info.entries.find(e => e.name === name)
  for (const [name, body] of [['through-folder', 'SLASH BODY'], ['literal', 'BACKSLASH BODY'], ['chain-1', 'SLASH BODY']]) {
    const resolved = runtime.resolveTarLink(info.entries, find(name))
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString(), body)
  }
  for (const [name, message] of [['chain-0', /层数/], ['too-long', /长度/], ['empty-link', /为空/], ['not-folder', /普通文件/], ['absolute', /不安全/], ['url', /不安全/], ['control', /不安全/]]) assert.throws(() => runtime.resolveTarLink(info.entries, find(name)), message)
})

test('raw TAR routing rejects compressed wrappers, retains empty members and actual MIME identities', async () => {
  const bytes = tar([{ name: 'empty.txt' }, { name: 'body.txt', body: 'BODY' }])
  const zip = require('fflate').zipSync({ 'body.txt': Buffer.from('ZIP BODY') })
  for (const invalid of [zlib.gzipSync(bytes), zip, bytes.subarray(0, 600)]) await assert.rejects(runtime.inspectTarArchive(invalid, options))
  const info = await runtime.inspectTarArchive(bytes, options)
  assert.equal((await runtime.extractTarEntry(bytes, info.entries[0], options)).length, 0)
  assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, info.entries[1], options)).toString(), 'BODY')
  const { fileKind, isSupportedMaterial } = require('../miniprogram/file-reader/shared/file-types')
  for (const type of ['application/x-tar', 'application/tar', 'application/x-gtar', 'APPLICATION/X-TAR; charset=utf-8']) {
    const file = { name: 'attachment', path: '/fixture/input', type }
    assert.equal(fileKind(file), 'archive')
    assert.equal(isSupportedMaterial(file), true)
  }
})

test('TAR entry preserves HTML anchors and stale extraction cannot replace a newly opened file', async () => {
  const body = '<h1>TAR CONTENT</h1><a href="#end">Jump</a><p id="end">TARGET</p>'
  const bytes = tar([{ name: 'docs/body.html', body }, { name: 'open', type: '2', target: 'docs/body.html' }])
  await runtime.inspectTarArchive(bytes, options)
  const reads = [], writes = [], files = new Map(), scrolls = []
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => reads.push(o), writeFile: o => { files.set(o.filePath, o.data); writes.push(o); o.success() }
  }) })
  page.scrollToDomNid = nid => scrolls.push(nid)
  async function open () {
    page.openSelectedFile({ name: 'links.tar', path: '/fixture/input.tar', size: bytes.length })
    await reads.shift().success({ data: bytes })
  }
  try {
    await open()
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'open') } })
    const read = reads.shift(); await read.success({ data: files.get(read.filePath) })
    const doc = page._htmlRuntime.document, anchor = doc.querySelector('a'), target = doc.getElementById('end')
    page.onDomTap({ currentTarget: { dataset: { nid: anchor._nid } } })
    assert.equal(scrolls.at(-1), target._nid)
    await open()
    const count = writes.length
    const pending = page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'open') } })
    page.openSelectedFile({ name: 'new.html', path: '/fixture/new.html' })
    await reads.shift().success({ data: Buffer.from('<p>NEW FILE</p>') })
    await pending
    assert.equal(writes.length, count)
    assert.equal(page._htmlRuntime.document.body.textContent, 'NEW FILE')
  } finally { page.detached() }
})

test('native TAR type survives an empty link target without misclassifying legitimate empty files', async () => {
  for (const format of ['ustar', 'gnu', 'pax']) {
    const bytes = tar([
      { name: 'empty-hard.txt', type: '1' },
      { name: 'empty-symbolic.txt', type: '2' },
      { name: 'Characteristics = 1 POSIX.txt' },
      { name: 'body.txt', body: 'AFTER INVALID LINKS' }
    ], format)
    const { entries } = await runtime.inspectTarArchive(bytes, options)
    for (const entry of entries.slice(0, 2)) {
      assert.equal(entry.isLink, true)
      assert.equal(entry.canOpen, false)
      assert.match(entry.detail, /链接目标为空/)
      assert.throws(() => runtime.resolveTarLink(entries, entry), /为空/)
    }
    assert.equal(entries[2].isLink, undefined)
    assert.equal(entries[2].canOpen, true)
    assert.equal((await runtime.extractTarEntry(bytes, entries[2], options)).length, 0)
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, entries[3], options)).toString(), 'AFTER INVALID LINKS')
  }
})
