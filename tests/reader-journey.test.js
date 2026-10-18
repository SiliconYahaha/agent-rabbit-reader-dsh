'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { readerPage, flush } = require('./helpers/reader-host')
const event = (path, revision) => ({ currentTarget: { dataset: { path, revision } } })

test('first GIF stays loading until decoded, never invokes the native viewer', () => {
  const page = readerPage({ previewImage () { throw Error('automatic popup') } })
  try {
    page.openSelectedFile({ name: '动画.gif', path: '/chat/a.gif' })
    assert.equal(page.data.isLoading, true)
    assert.equal(page.events.some(e => e.name === 'ready'), false)
    page.onImagePreviewLoad(event('/chat/a.gif', page._fileOpenRevision))
    assert.equal(page.data.isLoading, false)
    assert.equal(page.events.filter(e => e.name === 'ready').length, 1)
  } finally { page.host.onUnload() }
})

test('same-path reopen ignores the previous image load and error events', () => {
  const page = readerPage()
  try {
    const file = { name: '动画.gif', path: '/chat/a.gif' }
    page.openSelectedFile(file);const old = page._fileOpenRevision
    page.openSelectedFile(file)
    page.onImagePreviewLoad(event(file.path, old))
    page.onImagePreviewError(event(file.path, old))
    assert.equal(page.data.isLoading, true);assert.equal(page.data.error, '')
    page.onImagePreviewLoad(event(file.path, page._fileOpenRevision))
    assert.equal(page.data.isLoading, false)
  } finally { page.host.onUnload() }
})

test('image decode retry uses an ASCII copy and only cleans its own file', () => {
  let copy, removed = []
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({
    copyFile (o) { copy = o }, unlink (o) { removed.push(o.filePath) }
  }) })
  try {
    const original = '/chat/动画.gif'
    page.openSelectedFile({ name: '动画.gif', path: original })
    const revision = page._fileOpenRevision
    page.onImagePreviewError(event(original, revision));assert.equal(copy.srcPath, original)
    assert.match(copy.destPath, /^\/local\/rabbit-image-preview-\d+-\d+\.gif$/)
    copy.success();assert.equal(page.data.imagePath, copy.destPath)
    page.onImagePreviewError(event(original, revision));assert.equal(page.data.error, '')
    page.onImagePreviewLoad(event(copy.destPath, revision));assert.equal(page.data.isLoading, false)
    page.openSelectedFile({ name: 'next.gif', path: '/chat/next.gif' })
    assert.deepEqual(removed, [copy.destPath])
  } finally { page.host.onUnload() }
})

test('late image-copy completion cannot replace a newer HTML or retain its temporary copy', async () => {
  let copy, removed = []
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ copyFile (o) { copy = o }, unlink (o) { removed.push(o.filePath) } }) })
  try {
    page.openSelectedFile({ name: '动画.gif', path: '/chat/动画.gif' })
    page.onImagePreviewError(event('/chat/动画.gif', page._fileOpenRevision))
    page.openSelectedFile({ name: 'next.html', inlineHtml: '<h1>新的正文</h1>' })
    copy.success();await flush()
    assert.equal(page.data.imagePath, '');assert.equal(page.data.error, '')
    assert.match(JSON.stringify(page.data.domTree), /新的正文/)
    assert.deepEqual(removed, [copy.destPath])
  } finally { page.host.onUnload() }
})

test('corrupt image retries once, then reports failure without blocking the next file', () => {
  let copied = 0
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ copyFile (o) { copied++;o.success() }, unlink () {} }) })
  try {
    page.openSelectedFile({ name: 'bad.png', path: '/chat/bad.png' })
    page.onImagePreviewError(event(page.data.imagePath, page._fileOpenRevision))
    page.onImagePreviewError(event(page.data.imagePath, page._fileOpenRevision))
    assert.equal(copied, 1);assert.match(page.data.error, /未能显示/)
    assert.equal(page.data.isLoading, false)
    page.openSelectedFile({ name: 'good.gif', path: '/chat/good.gif' })
    page.onImagePreviewLoad(event(page.data.imagePath, page._fileOpenRevision))
    assert.equal(page.data.error, '');assert.equal(page.data.isLoading, false)
  } finally { page.host.onUnload() }
})

test('SVG first frame remains available while animation starts; stale animation cannot finish the next image', () => {
  const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50"><animate attributeName="x" to="50" dur="1s"/></rect></svg>'
  const page = readerPage({ getFileSystemManager: () => ({ readFile (o) { o.success({ data: svg }) } }) })
  try {
    page.openSelectedFile({ name: 'a.svg', path: '/chat/a.svg' })
    const revision = page._fileOpenRevision
    assert.ok(page.data.standaloneSvgSource);assert.equal(page.data.standaloneSvgAnimationReady, false)
    page.onStandaloneSvgLoad(event('', revision));assert.equal(page.data.isLoading, false)
    page.onStandaloneSvgAnimatedReady({ ...event('', revision), detail: { animated: true } })
    assert.equal(page.data.standaloneSvgAnimationReady, true)
    page.openSelectedFile({ name: 'next.gif', path: '/chat/next.gif' })
    page.onStandaloneSvgLoad(event('', revision))
    page.onStandaloneSvgAnimatedError({ ...event('', revision), detail: { message: 'late failure' } })
    page.onStandaloneSvgAnimatedReady(event('', revision))
    assert.equal(page.data.isLoading, true);assert.equal(page.data.error, '')
    assert.equal(page.data.standaloneSvgAnimationReady, false)
  } finally { page.host.onUnload() }
})

test('failed SVG static decode cannot cover a successfully drawn animation with an error', () => {
  let write
  const svg = '<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="x" to="5" dur="1s"/></rect></svg>'
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ readFile (o) { o.success({ data: svg }) }, writeFile (o) { write = o } }) })
  try {
    page.openSelectedFile({ name: 'a.svg', path: '/chat/a.svg' })
    const e = event('', page._fileOpenRevision)
    page.onStandaloneSvgError(e)
    page.onStandaloneSvgAnimatedReady({ ...e, detail: { animated: true } })
    write.fail({ errMsg: 'disk full' })
    page.onStandaloneSvgError(e)
    assert.equal(page.data.error, '');assert.equal(page.data.standaloneSvgAnimationReady, true)
  } finally { page.host.onUnload() }
})

test('copy failure removes only its partial temporary file and preserves a newer selection', () => {
  let copy;const removed = []
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ copyFile (o) { copy = o }, unlink (o) { removed.push(o.filePath) } }) })
  try {
    page.openSelectedFile({ name: 'a.gif', path: '/chat/a.gif' })
    page.onImagePreviewError(event(page.data.imagePath, page._fileOpenRevision))
    page.openSelectedFile({ name: 'b.gif', path: '/chat/b.gif' })
    copy.fail({ errMsg: 'disk full' })
    assert.deepEqual(removed, [copy.destPath]);assert.equal(page.data.error, '')
    assert.equal(page.data.imagePath, '/chat/b.gif')
  } finally { page.host.onUnload() }
})
