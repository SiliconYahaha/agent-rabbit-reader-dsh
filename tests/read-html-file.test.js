'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { readHtmlFileBytes, READ_CHUNK_BYTES } = require('../miniprogram/file-reader/document/read-html-file')
const { decodeText } = require('../miniprogram/file-reader/engine/core/text-decoder')
const read = (fs, options) => new Promise((resolve, reject) => readHtmlFileBytes(fs, { maxBytes: 20 * 1024 * 1024, ...options, success: resolve, fail: reject }))

test('large native reads are bounded and preserve UTF-8 characters split across chunks', async () => {
  const source = Buffer.from('a'.repeat(READ_CHUNK_BYTES - 1) + '测试文😀' + 'b'.repeat(READ_CHUNK_BYTES))
  const calls = []
  const fs = { readFile: options => {
    calls.push({ position: options.position, length: options.length })
    assert.ok(options.length <= READ_CHUNK_BYTES)
    const b = source.subarray(options.position, options.position + options.length)
    setImmediate(() => options.success({ data: b }))
  } }
  const result = await read(fs, { filePath: 'http://tmp/poster.html', size: source.length })
  assert.deepEqual(Buffer.from(result.data), source)
  assert.equal(decodeText(result.data).text, source.toString())
  assert.equal(calls.length, 3)
})

test('unknown material size is resolved with native stat before bounded reads', async () => {
  let calls = 0
  const fs = { stat: o => o.success({ stats: { size: READ_CHUNK_BYTES + 1 } }), readFile: o => { calls++;o.success({ data: new Uint8Array(o.length) }) } }
  const result = await read(fs, { filePath: 'http://tmp/file.html' })
  assert.equal(result.data.byteLength, READ_CHUNK_BYTES + 1)
  assert.equal(calls, 2)
})

test('incorrect chunk lengths and storage errors fail without partial success', async () => {
  for (const delta of [-1, 1]) {
    await assert.rejects(read({ readFile: o => o.success({ data: new Uint8Array(o.length + delta) }) }, { filePath: '/bad.html', size: READ_CHUNK_BYTES + 2 }), error => /长度不一致/.test(error.errMsg))
  }
  await assert.rejects(read({ readFile: o => o.fail({ errMsg: 'read failed' }) }, { filePath: '/bad.html', size: READ_CHUNK_BYTES + 2 }), error => error.errMsg === 'read failed')
  await assert.rejects(read({ readFile: () => assert.fail('must reject before allocation/read') }, { filePath: '/huge.html', size: 20 * 1024 * 1024 + 1 }), error => /安全上限/.test(error.errMsg))
})

test('changing files cancels future chunks and ignores late success/failure', async () => {
  for (const fail of [false, true]) {
    let pending, active = true, calls = 0
    readHtmlFileBytes({ readFile: o => { pending = o; calls++ } }, { filePath: '/old.html', size: READ_CHUNK_BYTES + 1, maxBytes: 1024 * 1024, isCurrent: () => active, success: () => assert.fail('stale success'), fail: () => assert.fail('stale error') })
    active = false
    if (fail) pending.fail({ errMsg: 'late' })
    else pending.success({ data: new Uint8Array(pending.length) })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(calls, 1)
  }
})

function paddedFileSystem (source, sizes = [source.length]) {
  let stats = 0
  return {
    stat: options => options.success({ stats: { size: sizes[Math.min(stats++, sizes.length - 1)] } }),
    readFile: options => {
      if (options.length == null) return options.success({ data: source })
      // DevTools may return a full requested buffer padded with zeros beyond EOF.
      const data = Buffer.alloc(options.length)
      source.subarray(options.position || 0, (options.position || 0) + options.length).copy(data)
      options.success({ data })
    }
  }
}

test('material size is a hint: native stat prevents silent truncation and padded NUL text', async () => {
  const source = Buffer.from('<p>BEGIN' + '中'.repeat(100000) + 'END</p>')
  for (const size of [source.length - 46, source.length + 46, 1, 0, 21 * 1024 * 1024]) {
    const result = await read(paddedFileSystem(source), { filePath: '/metadata.html', size })
    assert.equal(Buffer.compare(Buffer.from(result.data), source), 0, `reported size ${size} must not change bytes`)
  }
})

test('native size enforces the limit despite a small hint; stat failures do not fall back', async () => {
  let reads = 0
  const fs = { stat: o => o.success({ stats: { size: 33 } }), readFile: o => { reads++; o.success({ data: Buffer.alloc(33) }) } }
  await assert.rejects(read(fs, { filePath: '/too-big.html', size: 1, maxBytes: 32 }), e => /安全上限/.test(e.errMsg))
  assert.equal(reads, 0)
  await assert.rejects(read({ stat: o => o.fail({ errMsg: 'stat denied' }), readFile: () => assert.fail('must not bypass stat failure') }, { filePath: '/denied.html', size: 1 }), e => e.errMsg === 'stat denied')
})

test('size changes during reading and unexpected small-read bytes never become successful partial content', async () => {
  const source = Buffer.from('x'.repeat(READ_CHUNK_BYTES + 10))
  for (const delta of [-10, 10]) {
    await assert.rejects(read(paddedFileSystem(source, [source.length, source.length + delta]), { filePath: '/changed.html', size: source.length }), e => /改变|不一致/.test(e.errMsg))
  }
  await assert.rejects(read({ readFile: o => o.success({ data: Buffer.alloc(33) }) }, { filePath: '/small-hint.html', size: 1, maxBytes: 32 }), e => /安全上限/.test(e.errMsg))
  await assert.rejects(read({ readFile: o => o.success({ data: Buffer.alloc(4) }) }, { filePath: '/short.html', size: 5 }), e => /不一致/.test(e.errMsg))
})

test('empty files and legitimate NUL bytes retain their exact bytes', async () => {
  for (const source of [Buffer.alloc(0), Buffer.from([65, 0, 66, 0])]) {
    for (const size of [0, 1, 999999]) {
      const result = await read(paddedFileSystem(source), { filePath: '/nul.html', size })
      assert.deepEqual(Buffer.from(result.data), source)
    }
  }
})

test('late initial and final stat callbacks cannot update a different file', () => {
  for (const stage of ['initial', 'final']) {
    for (const outcome of ['success', 'fail']) {
      let pending, active = true, calls = 0
      const fs = {
        stat: o => {
          calls++
          if (stage === 'final' && calls === 1) o.success({ stats: { size: 1 } })
          else pending = o
        },
        readFile: o => o.success({ data: Buffer.from('x') })
      }
      readHtmlFileBytes(fs, { filePath: '/old.html', size: 1, maxBytes: 32, isCurrent: () => active,
        success: () => assert.fail('late content'), fail: () => assert.fail('late error') })
      active = false
      pending[outcome](outcome === 'success' ? { stats: { size: 1 } } : { errMsg: 'late stat failure' })
      assert.equal(calls, stage === 'initial' ? 1 : 2)
    }
  }
})

test('100 deterministic size-hint and binary-boundary variants preserve every byte', async () => {
  let seed = 40999
  for (let i = 0; i < 100; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const length = [0, 1, READ_CHUNK_BYTES - 1, READ_CHUNK_BYTES, READ_CHUNK_BYTES + 1][i % 5] + seed % 7
    const source = Buffer.alloc(length)
    for (let j = 0; j < length; j++) source[j] = (j * 17 + i) % 256
    const size = [0, 1, length - 1, length + 1, 25 * 1024 * 1024][i % 5]
    const result = await read(paddedFileSystem(source), { filePath: '/generated.html', size })
    assert.equal(Buffer.compare(Buffer.from(result.data), source), 0, `variant ${i}`)
  }
})
