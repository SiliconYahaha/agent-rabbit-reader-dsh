'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bootStore, cacheFilesystem } = require('./helpers/inline-cache-filesystem')
const { readerPage, flush } = require('./helpers/reader-page')
const source = n => 'data:image/png;base64,' + Buffer.alloc(9000, n).toString('base64')
const dir = '/local/reader-inline-cache-v1'
const orphan = n => `${dir}/reader-inline-old-boot-1-${String(n).padStart(4, '0')}.png`
const drain = async () => { for (let n = 0; n < 25; n++) await Promise.resolve() }

test('retry continues a bounded orphan sweep until a valid image fits', async () => {
  const disk = cacheFilesystem(10000); disk.directories.add(dir)
  for (let n = 0; n < 300; n++) disk.files.set(orphan(n), Buffer.alloc(40))
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /disk full/)
  assert.equal(disk.scans.length, 1); assert.equal(disk.files.size, 44)
  const recovered = await store.resource(source(1))
  assert.equal(disk.scans.length, 2); assert.deepEqual(disk.files.get(recovered), Buffer.alloc(9000, 1))
  assert.equal(disk.files.size, 1); await store.dispose()
})

test('undeletable directory lookalikes cannot starve later eligible cache files', async () => {
  const disk = cacheFilesystem(10000); disk.directories.add(dir)
  for (let n = 0; n < 256; n++) disk.directories.add(orphan(n))
  for (let n = 256; n < 300; n++) disk.files.set(orphan(n), Buffer.alloc(40))
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /disk full/)
  const recovered = await store.resource(source(1))
  assert.deepEqual(disk.files.get(recovered), Buffer.alloc(9000, 1)); assert.equal(disk.directories.size, 258)
  assert.ok(disk.removals.length <= 514, 'one bounded sweep per attempt plus failed partial-file cleanup')
  await store.dispose()
})

test('failed individual deletions cannot repeatedly hide later reclaimable files', async () => {
  const disk = cacheFilesystem(12000); disk.directories.add(dir)
  for (let n = 0; n < 300; n++) disk.files.set(orphan(n), Buffer.alloc(n < 256 ? 10 : 40))
  const unlink = disk.io.unlink
  disk.io.unlink = o => /-0(?:0\d\d|1\d\d|2[0-4]\d|25[0-5])\.png$/.test(o.filePath) ? o.fail({ errMsg: 'busy' }) : unlink(o)
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /disk full/)
  const recovered = await store.resource(source(1))
  assert.deepEqual(disk.files.get(recovered), Buffer.alloc(9000, 1)); assert.equal(disk.files.size, 257)
  await store.dispose()
})

test('a missing directory is recreated on retry of a failed new image write', async () => {
  const disk = cacheFilesystem(), store = bootStore()(disk.io, '/local')
  await store.resource(source(1))
  // Simulated cache eviction affects only generated fixture files, not inputs.
  disk.files.clear(); disk.directories.delete(dir)
  await assert.rejects(store.resource(source(2)), /parent directory missing/)
  const recovered = await store.resource(source(2))
  assert.deepEqual(disk.files.get(recovered), Buffer.alloc(9000, 2)); assert.equal(disk.scans.length, 2)
  await store.dispose()
})

test('a retry cleans its own failed partial write once deletion becomes available', async () => {
  const disk = cacheFilesystem(10000), write = disk.io.writeFile; let partial = true
  disk.io.writeFile = o => write({ ...o, success: () => partial ? o.fail({ errMsg: 'partial write' }) : o.success({}) })
  disk.failUnlink(true)
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)), /partial write/); assert.equal(disk.files.size, 1)
  partial = false; disk.failUnlink(false)
  const recovered = await store.resource(source(1))
  assert.equal(disk.files.size, 1); assert.deepEqual(disk.files.get(recovered), Buffer.alloc(9000, 1)); await store.dispose()
})

test('permanent space exhaustion stays explicit with no background or unlimited retry', async () => {
  const disk = cacheFilesystem(10000); disk.files.set('/local/original.bin', Buffer.alloc(9000, 42))
  const store = bootStore()(disk.io, '/local')
  for (let n = 0; n < 3; n++) {
    await assert.rejects(store.resource(source(1)), /disk full/)
    await drain(); assert.equal(disk.scans.length, n + 1); assert.equal(disk.writes.length, n + 1)
    assert.equal(store.bytes, 0); assert.equal(store.size, 0)
  }
  assert.deepEqual(disk.files.get('/local/original.bin'), Buffer.alloc(9000, 42)); await store.dispose()
})

test('concurrent retry readers share preparation, cleanup and exactly one successful replacement', async () => {
  const disk = cacheFilesystem(), write = disk.io.writeFile; let failing = true
  disk.io.writeFile = o => failing ? o.fail({ errMsg: 'temporary' }) : write(o)
  const store = bootStore()(disk.io, '/local')
  const failures = await Promise.allSettled(Array.from({ length: 20 }, () => store.resource(source(1))))
  assert.ok(failures.every(row => row.status === 'rejected')); failing = false
  const paths = await Promise.all(Array.from({ length: 20 }, () => store.resource(source(1))))
  assert.equal(new Set(paths).size, 1); assert.equal(disk.scans.length, 2); assert.equal(disk.writes.length, 1)
  assert.equal(store.bytes, 9000); await store.dispose()
})

test('a late failure from an older preparation does not invalidate a successful newer preparation', async () => {
  const disk = cacheFilesystem(), write = disk.io.writeFile, pending = []
  disk.io.writeFile = o => pending.push(o)
  const store = bootStore()(disk.io, '/local')
  const a = store.resource(source(1)), b = store.resource(source(2)); await drain()
  pending[0].fail({ errMsg: 'first failure' }); await assert.rejects(a)
  const c = store.resource(source(3)); await drain(); write(pending[2]); await c
  pending[1].fail({ errMsg: 'late old failure' }); await assert.rejects(b)
  const d = store.resource(source(4)); await drain(); write(pending[3]); await d
  assert.equal(disk.scans.length, 2); assert.equal(store.bytes, 18000); await store.dispose()
})

test('successful cached images remain usable without rescanning on every ordinary render', async () => {
  const disk = cacheFilesystem(), store = bootStore()(disk.io, '/local'), p = await store.resource(source(1))
  for (let n = 0; n < 30; n++) assert.equal(await store.resource(source(1)), p)
  assert.equal(disk.scans.length, 1); assert.equal(disk.writes.length, 1)
  await store.dispose()
})

test('actual Page retry continues reclaiming and shows original image plus working author interaction', async () => {
  const disk = cacheFilesystem(10000); disk.directories.add(dir)
  for (let n = 0; n < 300; n++) disk.files.set(orphan(n), Buffer.alloc(40))
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => disk.io })
  try {
    page.openSelectedFile({ name: 'inline-retry.html', inlineHtml: '<img id="picture" src="' + source(1) + '"><button id="tap">验证</button><p id="result">0</p><script>document.getElementById("tap").onclick=()=>document.getElementById("result").textContent="1"</script>' })
    await flush(); assert.equal(page.data.htmlPresentationRetry, true); assert.match(page.data.error, /disk full/)
    await flush(); assert.equal(disk.scans.length, 1); assert.equal(disk.writes.length, 1)
    page.retryHtmlPresentation(); page.retryHtmlPresentation(); await flush()
    assert.equal(page.data.error, ''); assert.equal(page.data.htmlPresentationRetry, false); assert.equal(page.data.domMode, true)
    assert.equal(disk.scans.length, 2); assert.equal(disk.writes.length, 2)
    const d = page._htmlRuntime.document
    assert.equal(d.getElementById('picture').src, source(1))
    const img = page.data.domTree.find(n => n.name === 'img')
    assert.deepEqual(disk.files.get(img.attrs.src), Buffer.alloc(9000, 1))
    page.onDomTap({ currentTarget: { dataset: { nid: d.getElementById('tap')._nid } } }); await flush()
    assert.match(JSON.stringify(page.data.domTree), /"text":"1"/)
    assert.equal(page.data.sourceName, 'inline-retry.html')
  } finally { page.disposeHtmlRuntime(); await flush() }
})

test('closing during retried partial-file cleanup cannot write or publish a stale image', async () => {
  const disk = cacheFilesystem(), write = disk.io.writeFile; let partial = true
  disk.io.writeFile = o => write({ ...o, success: () => partial ? o.fail({ errMsg: 'partial' }) : o.success({}) })
  disk.failUnlink(true)
  const store = bootStore()(disk.io, '/local')
  await assert.rejects(store.resource(source(1)))
  const pending = []; disk.io.unlink = o => pending.push(o); partial = false
  const retry = store.resource(source(1)); await drain()
  const close = store.dispose(); assert.equal(pending.length, 1)
  pending[0].success({}); await assert.rejects(retry, /关闭/); await close
  assert.equal(disk.writes.length, 1); assert.equal(store.size, 0); assert.equal(store.bytes, 0)
})
