'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), zlib = require('node:zlib')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const { tar } = require('./helpers/tar-fixtures')
const { readerPage } = require('./helpers/reader-host')
const baseline = require('../compatibility/runs/2026-09-12-next-tar-link-components.json').originalBatch
const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')) }

test('TAR component traversal preserves independently extracted bodies and directory errors', async () => {
  for (const format of ['ustar', 'gnu', 'pax']) for (const sample of baseline.specs) {
    const native = baseline.rows.find(r => r.name === sample.name && r.format === 'ustar').native
    const bytes = tar(sample.members, format), { entries } = await runtime.inspectTarArchive(bytes, options)
    const selected = entries.find(e => e.name === sample.selected), label = format + '/' + sample.name
    if (native.error) {
      assert.throws(() => runtime.resolveTarLink(entries, selected), native.error === 'ENOENT' ? /不存在/ : /普通文件/, label)
    } else {
      const resolved = runtime.resolveTarLink(entries, selected)
      assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString(), native.body, label)
    }
  }
})

test('TAR finite repeated links, active cycles and intermediate directory requirements remain bounded', async () => {
  const bytes = tar([
    { name: 'docs/body.txt', body: 'BODY' },
    { name: 'dir', type: '2', target: 'docs' },
    { name: 'repeat', type: '2', target: 'dir/../dir/./body.txt' },
    { name: 'directory-slash', type: '2', target: 'dir/' },
    { name: 'self', type: '2', target: 'self/../docs/body.txt' },
    { name: 'missing-dot', type: '2', target: 'missing/./../docs/body.txt' },
    { name: 'file-dot', type: '2', target: 'docs/body.txt/.' },
    { name: 'escape', type: '2', target: 'dir/../../docs/body.txt' },
    { name: 'limit', type: '2', target: 'dir/../'.repeat(16) + 'docs/body.txt' },
    { name: 'hard-1', type: '1', target: 'dir' },
    { name: 'hard-2', type: '1', target: 'hard-1' }
  ], 'pax'), { entries } = await runtime.inspectTarArchive(bytes, options)
  const resolve = name => runtime.resolveTarLink(entries, entries.find(e => e.name === name))
  assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolve('repeat').entry, options)).toString(), 'BODY')
  for (const name of ['directory-slash', 'hard-2']) assert.equal(resolve(name).entries[0].name, 'docs/body.txt')
  for (const [name, error] of [['self', /循环/], ['missing-dot', /不存在/], ['file-dot', /普通文件/], ['escape', /之外/], ['limit', /层数/]]) assert.throws(() => resolve(name), error)
  assert.equal(resolve('repeat').entry.name, 'docs/body.txt', 'failed resolution must not leak traversal state')
})

test('actual TAR host rejects invalid component chains then opens the correct linked HTML and anchor', async () => {
  const oldWasm = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(options.wasmBinary, imports) }
  const reads = [], files = new Map(), writes = []
  const host = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => reads.push(o), writeFile: o => { writes.push(o.data); files.set(o.filePath, o.data); o.success() }
  }) })
  try {
    for (const format of ['ustar', 'gnu', 'pax']) for (const sample of baseline.specs) {
      const native = baseline.rows.find(r => r.name === sample.name && r.format === 'ustar').native
      // Rename each .txt member and matching target consistently; the same path
      // relations now reach HTML rendering and an actual anchor event.
      const body = text => '<p>' + text.trim() + '</p><a href="#end">跳转</a><p id="end">目标</p>'
      const htmlName = name => name.replace(/\.txt/g, '.html')
      const members = sample.members.map(m => ({ ...m, name: htmlName(m.name), ...(m.target ? { target: htmlName(m.target) } : {}), ...(m.body ? { body: body(m.body) } : {}) }))
      members.push({ name: 'view.html', type: '2', target: htmlName(sample.selected) })
      const bytes = tar(members, format)
      host.openSelectedFile({ name: 'components.tar', path: '/fixture/in.tar', size: bytes.length })
      await reads.shift().success({ data: bytes })
      assert.equal(host.data.error, '')
      const before = writes.length
      await host.openInspectorEntry({ detail: { index: host._inspectorVisibleEntries.findIndex(e => e.name === 'view.html') } })
      if (native.error) {
        assert.equal(writes.length, before)
        assert.ok(host.data.error)
        continue
      }
      assert.equal(Buffer.from(writes.at(-1)).toString(), body(native.body))
      const read = reads.shift(); assert.ok(read)
      await read.success({ data: files.get(read.filePath) })
      assert.equal(host.data.error, '')
      const doc = host._htmlRuntime.document
      assert.equal(doc.querySelector('p').textContent, native.body.trim())
      assert.ok(JSON.stringify(host.data.domTree).includes(native.body.trim()))
      let scrolled
      host.scrollToDomNid = nid => { scrolled = nid }
      host.onDomTap({ currentTarget: { dataset: { nid: doc.querySelector('a')._nid } } })
      assert.equal(scrolled, doc.getElementById('end')._nid)
    }
  } finally {
    host.detached()
    if (oldWasm === undefined) delete global.WXWebAssembly
    else global.WXWebAssembly = oldWasm
  }
})


test('TAR hard-link target components use the preceding namespace without dropping required directories', async () => {
  for (const format of ['ustar', 'gnu', 'pax']) for (const sample of require('./helpers/tar-hard-components')) {
    const bytes = tar(sample.members, format), { entries } = await runtime.inspectTarArchive(bytes, options)
    const selected = entries.find(e => e.name === sample.selected)
    if (sample.body === null) assert.throws(() => runtime.resolveTarLink(entries, selected), /先前成员|普通文件/)
    else assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, runtime.resolveTarLink(entries, selected).entry, options)).toString(), sample.body)
  }
  const bytes = tar([
    { name: 'old/body', body: 'OLD' }, { name: 'new/body', body: 'NEW' },
    { name: 'folder', type: '2', target: 'old' },
    { name: 'saved', type: '1', target: 'folder/body' },
    { name: 'folder', type: '2', target: 'new' },
    { name: 'next', type: '1', target: 'folder/body' },
    { name: 'early', type: '1', target: 'future/body' },
    { name: 'future/body', body: 'FUTURE' }
  ]), { entries } = await runtime.inspectTarArchive(bytes, options)
  for (const [name, expected] of [['saved', 'OLD'], ['next', 'NEW']]) {
    const resolved = runtime.resolveTarLink(entries, entries.find(e => e.name === name))
    assert.equal(Buffer.from(await runtime.extractTarEntry(bytes, resolved.entry, options)).toString(), expected)
  }
  assert.throws(() => runtime.resolveTarLink(entries, entries.find(e => e.name === 'early')), /先前成员/)
})
