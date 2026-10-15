'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readerPage } = require('./helpers/reader-host')
const LIMIT = 20 * 1024 * 1024

test('real HTML entry reads actual small files despite stale size hints above both entry thresholds', () => {
  const source = Buffer.from('<p>BEGIN 中文 😀 END</p>')
  for (const size of [0, 1, source.length, LIMIT, LIMIT + 1, LIMIT * 10 + 1]) {
    let reads = 0, stats = 0
    const page = readerPage({ getFileSystemManager: () => ({
      stat: o => { stats++; o.success({ stats: { size: source.length } }) },
      readFile: o => { reads++; o.success({ data: source }) }
    }) })
    try {
      page.openSelectedFile({ name: 'small.html', path: '/local/small.html', size })
      assert.equal(page.data.error, '', 'hint ' + size)
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'BEGIN 中文 😀 END')
      assert.equal(reads, 1)
      assert.equal(stats, 2, 'stat before and after reading')
    } finally { page.detached() }
  }
})

test('oversized actual HTML and failed stat are rejected without reading; valid inline content recovers', () => {
  for (const outcome of ['large', 'denied']) {
    let reads = 0
    const page = readerPage({ getFileSystemManager: () => ({
      stat: o => outcome === 'large' ? o.success({ stats: { size: LIMIT + 1 } }) : o.fail({ errMsg: 'stat denied' }),
      readFile: () => { reads++ }
    }) })
    try {
      page.openSelectedFile({ name: 'large.html', path: '/local/large.html', size: 1 })
      assert.match(page.data.error, outcome === 'large' ? /安全上限/ : /stat denied/)
      assert.equal(reads, 0)
      page.openSelectedFile({ name: 'valid.html', inlineHtml: '<p>Recovered</p>', size: LIMIT * 11 })
      assert.equal(page.data.error, '')
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'Recovered')
    } finally { page.detached() }
  }
})

test('inline HTML limits measure UTF-8 bytes before parsing, including CJK and surrogate pairs', () => {
  // Native Buffer.byteLength supplies the independent byte oracle. Large cases
  // intercept parsing to check the entry budget, not claim large-page fidelity.
  for (const unit of ['a', '中', '😀', '\ud800']) {
    const width = Buffer.byteLength(unit)
    const exact = unit.repeat(Math.floor(LIMIT / width)) + 'a'.repeat(LIMIT % width)
    assert.equal(Buffer.byteLength(exact), LIMIT)
    for (const delta of [0, 1]) {
      const source = exact + 'a'.repeat(delta)
      const page = readerPage()
      let parsed = false
      page.parseContent = value => { parsed = true; assert.equal(value, source); page.finishLoading() }
      try {
        page.openSelectedFile({ name: 'inline.html', inlineHtml: source, size: 1 })
        assert.equal(parsed, delta === 0, unit + '/' + delta)
        if (delta) assert.match(page.data.error, /超过 20 MB/)
        else assert.equal(page.data.error, '')
      } finally { page.detached() }
    }
  }
})

test('late native stat success or failure cannot disturb a replacement HTML document', () => {
  for (const outcome of ['success', 'fail']) {
    let pending, reads = 0
    const page = readerPage({ getFileSystemManager: () => ({ stat: o => { pending = o }, readFile: () => { reads++ } }) })
    try {
      page.openSelectedFile({ name: 'old.html', path: '/local/old.html', size: LIMIT * 11 })
      assert.ok(pending, 'actual size must be requested despite the large hint')
      page.openSelectedFile({ name: 'new.html', inlineHtml: '<p>Current</p>' })
      const before = structuredClone(page.data), patches = page.patches.length
      pending[outcome](outcome === 'success' ? { stats: { size: 50 } } : { errMsg: 'late stat' })
      assert.equal(reads, 0)
      assert.equal(page.patches.length, patches)
      assert.deepEqual(page.data, before)
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'Current')
    } finally { page.detached() }
  }
})
