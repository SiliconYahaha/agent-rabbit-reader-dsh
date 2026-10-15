'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createInlineImageStore } = require('../miniprogram/file-reader/document/inline-image-store')
const { readerPage, flush } = require('./helpers/reader-page')
const source = (n = 1) => 'data:image/png;base64,' + Buffer.alloc(9000, n).toString('base64')

test('failed writes release reservations and the same URL can be retried', async () => {
  const writes = [], removed = []
  const store = createInlineImageStore({ writeFile: o => { writes.push(o); writes.length === 1 ? o.fail({ errMsg: 'disk full' }) : o.success() }, unlink: o => removed.push(o.filePath) }, '/local')
  await assert.rejects(store.resource(source()), /disk full/)
  assert.equal(store.size, 0); assert.equal(store.bytes, 0)
  const path = await store.resource(source())
  assert.equal(writes.length, 2); assert.equal(store.size, 1); assert.equal(store.bytes, 9000)
  assert.notEqual(path, writes[0].filePath, 'late removal of the failed file must not delete its replacement')
  assert.deepEqual(Buffer.from(writes[1].data, 'base64'), Buffer.alloc(9000, 1))
  assert.deepEqual(removed, [writes[0].filePath]); store.dispose(); await flush()
})

test('concurrent readers share one failed write and one subsequent retry', async () => {
  const pending = [], store = createInlineImageStore({ writeFile: o => pending.push(o), unlink () {} }, '/local')
  const first = Promise.allSettled([store.resource(source()), store.resource(source())])
  assert.equal(pending.length, 1); pending[0].fail({ errMsg: 'temporary' })
  assert.ok((await first).every(r => r.status === 'rejected')); assert.equal(store.bytes, 0)
  const second = Promise.all([store.resource(source()), store.resource(source())])
  assert.equal(pending.length, 2); pending[1].success()
  const paths = await second; assert.equal(paths[0], paths[1]); assert.equal(store.bytes, 9000)
  store.dispose(); await flush()
})

test('many failed unique images cannot exhaust entry or byte budgets', async () => {
  let failing = true, calls = 0
  const store = createInlineImageStore({ writeFile: o => { calls++; failing ? o.fail({ errMsg: 'temporary' }) : o.success() }, unlink () {} }, '/local')
  for (let i = 0; i < 160; i++) await assert.rejects(store.resource(source(i)), /temporary/)
  assert.equal(calls, 160); assert.equal(store.size, 0); assert.equal(store.bytes, 0)
  failing = false; await store.resource(source()); assert.equal(store.size, 1)
  store.dispose(); await flush()
})

test('successful and pending resources still obey the 128-entry limit', async () => {
  const store = createInlineImageStore({ writeFile: o => o.success(), unlink () {} }, '/local')
  for (let i = 0; i < 128; i++) await store.resource(source(i))
  await assert.rejects(store.resource(source(129)), /安全上限/)
  assert.equal(store.size, 128); store.dispose(); await flush(); assert.equal(store.bytes, 0)
})

test('synchronous filesystem throws and empty failures are retryable without masking errors', async () => {
  for (const nativeFailure of [o => { throw new Error('sync failure') }, o => o.fail()]) {
    let failing = true
    const store = createInlineImageStore({ writeFile: o => failing ? nativeFailure(o) : o.success(), unlink () {} }, '/local')
    await assert.rejects(store.resource(source()), /图片保存失败/)
    assert.equal(store.size, 0); assert.equal(store.bytes, 0)
    failing = false; assert.match(await store.resource(source()), /reader-inline-/)
    store.dispose(); await flush()
  }
})

test('dispose during pending writes never publishes a path or leaves nonzero accounting', async () => {
  for (const fail of [false, true]) {
    let pending; const removed = []
    const store = createInlineImageStore({ writeFile: o => { pending = o }, unlink: o => removed.push(o.filePath) }, '/local')
    const result = store.resource(source()); store.dispose()
    if (fail) pending.fail({ errMsg: 'late' }); else pending.success()
    await assert.rejects(result); await flush()
    assert.equal(store.bytes, 0); assert.equal(store.size, 0)
    assert.deepEqual(removed, [pending.filePath]); await assert.rejects(store.resource(source()), /关闭/)
  }
})

test('late deletion cannot remove a successful retry or another cached image', async () => {
  const files = new Map(), removals = []; let first = true
  const store = createInlineImageStore({ writeFile: o => { files.set(o.filePath, o.data); if (first) { first = false; o.fail({ errMsg: 'partial' }) } else o.success() }, unlink: o => removals.push(o) }, '/local')
  await assert.rejects(store.resource(source()), /partial/)
  const retry = await store.resource(source()), other = await store.resource(source(2))
  assert.notEqual(retry, other); assert.notEqual(removals[0].filePath, retry)
  files.delete(removals[0].filePath); removals[0].success?.()
  assert.equal(files.get(retry), source().split(',')[1]); assert.equal(files.get(other), source(2).split(',')[1])
  store.dispose(); await flush()
})

test('actual Page retains author data and recovers visible image after a transient write error', async () => {
  let fail = true; const files = new Map()
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { if (fail) { fail = false; o.fail({ errMsg: 'temporary' }) } else { files.set(o.filePath, o.data); o.success() } }, unlink: o => files.delete(o.filePath) }) })
  try {
    page.openSelectedFile({ name: 'retry.html', inlineHtml: '<img id="out"><button id="retry">重试</button><script>document.getElementById("retry").onclick=()=>document.getElementById("out").src=' + JSON.stringify(source()) + '</script>' }); await flush()
    const d = page._htmlRuntime.document, nid = d.getElementById('retry')._nid
    const tap = () => page.onDomTap({ currentTarget: { dataset: { nid } } })
    tap(); await flush(); assert.match(page.data.error, /temporary/)
    tap(); await flush(); assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true)
    assert.equal(d.getElementById('out').src, source())
    const image = page.data.domTree.find(n => n.name === 'img')
    assert.equal(files.get(image.attrs.src), source().split(',')[1])
    const count = page.patches.length
    tap(); await flush(); assert.equal(page.patches.length, count, 'ordinary identical taps must remain deduplicated')
  } finally { page.disposeHtmlRuntime(); await flush() }
})

test('initial image failure offers one explicit retry without automatic write loops', async () => {
  let failing = true, calls = 0
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { calls++; failing ? o.fail({ errMsg: 'temporary' }) : o.success() }, unlink () {} }) })
  try {
    page.openSelectedFile({ name: 'initial.html', inlineHtml: '<img src="' + source() + '">' }); await flush()
    assert.equal(page.data.htmlPresentationRetry, true); assert.equal(calls, 1)
    await flush(); assert.equal(calls, 1)
    page.retryHtmlPresentation(); page.retryHtmlPresentation(); await flush()
    assert.equal(calls, 2); assert.equal(page.data.htmlPresentationRetry, true)
    failing = false; page.retryHtmlPresentation(); await flush()
    assert.equal(calls, 3); assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true)
    assert.equal(page.data.htmlPresentationRetry, false)
  } finally { page.disposeHtmlRuntime(); await flush() }
})

test('retry takes the latest author state and cannot restore a stale failed snapshot', async () => {
  let pending
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { pending = o }, unlink () {} }) })
  try {
    page.openSelectedFile({ name: 'latest.html', inlineHtml: '<img id="out"><p id="label">old</p>' }); await flush()
    const runtime = page._htmlRuntime
    runtime.document.getElementById('out').src = source(); runtime.flush(true)
    runtime.document.getElementById('label').textContent = 'latest'; runtime.flush(true)
    pending.fail({ errMsg: 'temporary' }); await flush()
    page.retryHtmlPresentation(); pending.success(); await flush()
    assert.match(JSON.stringify(page.data.domTree), /latest/); assert.equal(page.data.error, '')
    assert.equal(page._pendingDomRender, null)
  } finally { page.disposeHtmlRuntime(); await flush() }
})

test('switching files cancels both initial and dynamic retry actions', async () => {
  for (const initial of [true, false]) {
    let pending
    const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { pending = o }, unlink () {} }) })
    try {
      page.openSelectedFile({ name: 'old.html', inlineHtml: initial ? '<img src="' + source() + '">' : '<img id="out">' }); await flush()
      if (!initial) { page._htmlRuntime.document.getElementById('out').src = source(); page._htmlRuntime.flush(true) }
      pending.fail({ errMsg: 'temporary' }); await flush(); assert.equal(page.data.htmlPresentationRetry, true)
      page.openSelectedFile({ name: 'new.html', inlineHtml: '<p>new file</p>' }); await flush()
      page.retryHtmlPresentation(); await flush()
      assert.equal(page.data.sourceName, 'new.html'); assert.equal(page.data.error, '')
      assert.equal(page.data.htmlPresentationRetry, false); assert.equal(page._retryHtmlPresentation, null)
      assert.match(JSON.stringify(page.data.domTree), /new file/)
    } finally { page.disposeHtmlRuntime(); await flush() }
  }
})

test('cleanup throws do not mask write failures or permanently poison the cache', async () => {
  let failing = true
  const store = createInlineImageStore({ writeFile: o => failing ? o.fail({ errMsg: 'original' }) : o.success(), unlink () { throw Error('cleanup') } }, '/local')
  await assert.rejects(store.resource(source()), /original/)
  failing = false; await store.resource(source()); store.dispose(); await flush(); assert.equal(store.bytes, 0)
})
