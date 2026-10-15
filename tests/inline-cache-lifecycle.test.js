'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bootStore, cacheFilesystem } = require('./helpers/inline-cache-filesystem')
const source = n => 'data:image/png;base64,' + Buffer.alloc(9000, n).toString('base64')
const drain = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() }

test('a fresh runtime reclaims interrupted inline writes before a quota-limited image open', async () => {
  const disk = cacheFilesystem(10000)
  const first = bootStore()(disk.io, '/local'), oldPath = await first.resource(source(1))
  assert.equal(disk.files.size, 1)
  // No dispose: the first JS process was terminated while its image existed.
  const now = Date.now
  let second
  try { Date.now = () => now() + 1000; second = bootStore()(disk.io, '/local') } finally { Date.now = now }
  const nextPath = await second.resource(source(2))
  assert.notEqual(nextPath, oldPath); assert.equal(disk.files.has(oldPath), false)
  assert.deepEqual(disk.files.get(nextPath), Buffer.alloc(9000, 2))
  await second.dispose()
})

test('active stores survive later opens even through different adapters for the same root', async () => {
  const disk = cacheFilesystem(), create = bootStore()
  const first = create(disk.io, '/local'), a = await first.resource(source(1))
  const second = create({ ...disk.io }, '/local'), b = await second.resource(source(2))
  assert.deepEqual(disk.files.get(a), Buffer.alloc(9000, 1)); assert.deepEqual(disk.files.get(b), Buffer.alloc(9000, 2))
  await first.dispose(); assert.equal(disk.files.has(a), false); assert.equal(disk.files.has(b), true)
  await second.dispose(); assert.equal(disk.files.size, 0)
})

test('fifty interrupted boots do not accumulate cache bytes', async () => {
  const disk = cacheFilesystem(10000), paths = new Set()
  let last
  for (let n = 0; n < 50; n++) {
    last = bootStore()(disk.io, '/local')
    const file = await last.resource(source(n)); paths.add(file)
    assert.equal(disk.files.size, 1); assert.deepEqual(disk.files.get(file), Buffer.alloc(9000, n))
  }
  assert.equal(paths.size, 50); await last.dispose(); assert.equal(disk.files.size, 0)
})

test('unknown names, legacy root files, nested data and directory lookalikes are never removed', async () => {
  const disk = cacheFilesystem(), dir = '/local/reader-inline-cache-v1'
  disk.directories.add(dir)
  const protectedFiles = ['/local/original.html', '/local/reader-inline-1780000000000-1-0.png',
    dir + '/notes.txt', dir + '/reader-inline-a-b-1-0.png.bak', dir + '/folder/user.png', dir + '/reader-inline-a-b-1-0.png/keep.txt']
  disk.directories.add(dir + '/folder'); disk.directories.add(dir + '/reader-inline-a-b-1-0.png')
  for (const file of protectedFiles) disk.files.set(file, Buffer.from('user content'))
  const nativeRead = disk.io.readdir
  disk.io.readdir = o => nativeRead({ ...o, success: r => o.success({ files: r.files.concat('../original.html', 'folder/keep.png', '/local/original.html', null) }) })
  const store = bootStore()(disk.io, '/local'); await store.resource(source(1)); await store.dispose()
  for (const file of protectedFiles) assert.equal(disk.files.get(file).toString(), 'user content')
  assert.ok(disk.scans.every(file => file === dir)); assert.ok(disk.removals.every(file => file.startsWith(dir + '/') && !file.includes('..')))
})

test('failed dispose unlink is retried by the next store without poisoning opening', async () => {
  const disk = cacheFilesystem(10000), create = bootStore(), first = create(disk.io, '/local')
  const a = await first.resource(source(1)); disk.failUnlink(true); await first.dispose()
  assert.equal(disk.files.has(a), true)
  disk.failUnlink(false)
  const second = create(disk.io, '/local'), b = await second.resource(source(2))
  assert.equal(disk.files.has(a), false); assert.deepEqual(disk.files.get(b), Buffer.alloc(9000, 2)); await second.dispose()
})

test('partial writes whose unlink fails remain owned and are retried on dispose', async () => {
  const disk = cacheFilesystem(), write = disk.io.writeFile
  disk.io.writeFile = o => write({ ...o, success: () => o.fail({ errMsg: 'partial write' }) })
  disk.failUnlink(true)
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /partial write/); assert.equal(disk.files.size, 1)
  disk.failUnlink(false); await store.dispose(); assert.equal(disk.files.size, 0)
})

test('directory failures are explicit, keep accounting empty and can be retried', async () => {
  const disk = cacheFilesystem(); disk.failScan(true)
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /缓存准备失败/)
  assert.equal(disk.writes.length, 0); assert.equal(store.bytes, 0); assert.equal(store.size, 0)
  disk.failScan(false); await store.resource(source(1)); assert.equal(disk.writes.length, 1); await store.dispose()
})

test('mkdir existing-directory failure is accepted only after a successful directory read', async () => {
  const disk = cacheFilesystem(); disk.directories.add('/local/reader-inline-cache-v1'); disk.failMkdir(true)
  const store = bootStore()(disk.io, '/local'); await store.resource(source(1)); await store.dispose()
  const inaccessible = cacheFilesystem(); inaccessible.failMkdir(true)
  const failed = bootStore()(inaccessible.io, '/local')
  await assert.rejects(failed.resource(source(1)), /缓存准备失败/); assert.equal(inaccessible.writes.length, 0); await failed.dispose()
})

test('concurrent initial reads share preparation and one write per source', async () => {
  const disk = cacheFilesystem(), store = bootStore()(disk.io, '/local')
  const paths = await Promise.all(Array.from({ length: 30 }, () => store.resource(source(1))))
  assert.equal(new Set(paths).size, 1); assert.equal(disk.writes.length, 1); assert.equal(disk.scans.length, 1)
  await store.dispose(); assert.equal(disk.files.size, 0)
})

test('closing during preparation cannot publish an image or write after a replacement opens', async () => {
  const disk = cacheFilesystem(), readdir = disk.io.readdir, pending = []
  disk.io.readdir = o => pending.push(o)
  const create = bootStore(), first = create(disk.io, '/local')
  const result = first.resource(source(1)); await drain(); await first.dispose()
  const second = create(disk.io, '/local'), next = second.resource(source(2)); await drain()
  assert.equal(pending.length, 1); readdir(pending[0]); await assert.rejects(result, /关闭/)
  const b = await next; assert.equal(disk.writes.length, 1); assert.deepEqual(disk.files.get(b), Buffer.alloc(9000, 2)); await second.dispose()
})

test('a closing lease protects pending writes until callbacks settle; late cleanup cannot delete a new image', async () => {
  const disk = cacheFilesystem(), write = disk.io.writeFile, pending = []
  disk.io.writeFile = o => pending.push(o)
  const create = bootStore(), first = create(disk.io, '/local'), result = first.resource(source(1))
  await drain(); assert.equal(pending.length, 1)
  const closing = first.dispose(), second = create(disk.io, '/local'), next = second.resource(source(2))
  await drain(); assert.equal(pending.length, 2)
  write(pending[1]); const b = await next
  write(pending[0]); await assert.rejects(result, /关闭/); await closing
  assert.equal(disk.files.size, 1); assert.deepEqual(disk.files.get(b), Buffer.alloc(9000, 2)); await second.dispose()
})

test('one sweep is bounded and later opens continue reclaiming owned orphans', async () => {
  const disk = cacheFilesystem(), dir = '/local/reader-inline-cache-v1'; disk.directories.add(dir)
  for (let n = 0; n < 300; n++) disk.files.set(dir + '/reader-inline-old-boot-1-' + n + '.png', Buffer.alloc(1))
  const create = bootStore(), first = create(disk.io, '/local'); await first.resource(source(1))
  assert.equal(disk.removals.length, 256); assert.equal(disk.files.size, 45)
  const second = create(disk.io, '/local'); await second.resource(source(2)); assert.equal(disk.files.size, 2)
  await first.dispose(); await second.dispose(); assert.equal(disk.files.size, 0)
})

test('unavailable deletion preserves a visible write failure instead of returning a missing image', async () => {
  const disk = cacheFilesystem(10000), old = bootStore()(disk.io, '/local'); await old.resource(source(1))
  disk.failUnlink(true)
  const next = bootStore()(disk.io, '/local'); await assert.rejects(next.resource(source(2)), /disk full/)
  assert.equal(next.bytes, 0); assert.equal(next.size, 0); assert.equal(disk.files.size, 1); await next.dispose()
})
