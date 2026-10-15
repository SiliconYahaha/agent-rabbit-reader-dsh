'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { sources, capture } = require('./helpers/cdr-record-host')
const { decodedTree, encoded } = require('./helpers/cdr-records')
const { cdrCompressedVectorFixture } = require('./helpers/cdr-zlib')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { readerPage } = require('./helpers/reader-host')
const native = require('./fixtures/cdr-record-integrity/native-reference.json')
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate) }

test('CDR table indexes, literal lengths and zero padding retain native-supported artwork', () => {
  for (const row of sources()) {
    const actual = inspectFileBytes(Buffer.from(row.base64, 'base64'), { name: row.name + '.cdr' })
    if (row.category.startsWith('malformed')) {
      assert.equal(actual.previewSvg, '', row.name)
      assert.match(actual.summary, /记录头不完整|长度超过所属列表/, row.name)
    } else {
      const ref = native.rows.find(x => x.name === row.name)
      assert.equal(ref.raw.status, 0, row.name)
      assert.match(ref.raw.stdout, /drawPath/, row.name)
      const xy = row.translation || [2, 3], color = row.color ?? 0xff5b43
      assert.match(actual.previewSvg, new RegExp(`M${xy[0]} ${-xy[1]}L${xy[0] + 1} ${-xy[1]}L${xy[0]} ${-(xy[1] + 1)}Z`), row.name)
      assert.ok(actual.previewSvg.includes('fill="#' + color.toString(16).padStart(6, '0') + '"'), row.name)
    }
  }
})

test('real host opens every original and never reports corrupt partial artwork as success', async () => {
  for (const row of await capture()) {
    assert.equal(row.loading, false, row.name)
    if (row.category.startsWith('malformed')) {
      assert.equal(row.source, '', row.name)
      assert.match(row.summary, /记录头不完整|长度超过所属列表/, row.name)
    } else {
      assert.match(row.svg, /data-cdr-vectors="1"/, row.name)
      assert.equal(row.error, '', row.name)
    }
  }
})

test('CDR compressed record and nesting limits fail explicitly instead of silently discarding suffixes', () => {
  const fixture = cdrCompressedVectorFixture(), tree = decodedTree(fixture)
  const unknown = { id: 'JUNK', data: Buffer.alloc(0) }
  const run = nodes => inspectFileBytes(encoded(fixture, nodes), { name: 'bounds.cdr' })
  assert.match(run(tree.concat(Array(2492).fill(unknown))).previewSvg, /data-cdr-vectors="1"/)
  const over = run(tree.concat(Array(2493).fill(unknown)))
  assert.equal(over.previewSvg, '')
  assert.match(over.summary, /记录数量超过/)
  const wrap = n => { let nodes = tree; for (let i = 0; i < n; i++) nodes = [{ id: 'LIST', type: 'wrap', children: nodes }]; return nodes }
  assert.match(run(wrap(7)).previewSvg, /data-cdr-vectors="1"/)
  assert.equal(run(wrap(8)).previewSvg, '')
  assert.match(run(wrap(8)).summary, /列表层数超过/)
  const badList = [...tree, { id: 'LIST', data: Buffer.from([1, 2, 3]) }]
  assert.match(run(badList).summary, /列表缺少类型/)
})

test('CDR corruption can use an independent thumbnail with a warning, then normal artwork reopens', async () => {
  const bad = Buffer.from(sources().find(x => x.name === 'short-header-tail-z6').base64, 'base64')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const h = Buffer.alloc(8); h.write('prev'); h.writeUInt32LE(png.length, 4)
  const fallback = Buffer.concat([bad, bad.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0), h, png, png.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  fallback.writeUInt32LE(fallback.length - 8, 4)
  const result = inspectFileBytes(fallback, { name: 'fallback.cdr' })
  assert.equal(result.previewSvg, '')
  assert.ok(result.preview)
  assert.match(result.summary, /记录头不完整.*独立内嵌缩略图.*不代表完整正文/)
  let input, saved
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => o.success({ data: input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)) }),
    writeFile: o => { saved = Buffer.from(o.data); o.success() }
  }) })
  try {
    for (const bytes of [fallback, bad, cdrCompressedVectorFixture(), bad, cdrCompressedVectorFixture()]) {
      input = bytes; page.openSelectedFile({ name: 'reopen.cdr', path: '/fixture/input', size: input.length }); await tick()
      assert.equal(page.data.isLoading, false)
      if (bytes === bad) {
        assert.equal(page.data.inspectorPreviewSource, '')
        assert.equal(page.data.inspectorPreviewPath, '')
      } else if (bytes === fallback) {
        assert.ok(page.data.inspectorPreviewPath)
        assert.deepEqual(saved, png)
        assert.match(page.data.inspectorSummary, /不代表完整正文/)
      } else assert.ok(page.data.inspectorPreviewSource)
    }
  } finally { page.detached() }
})

test('late failed CDR reads cannot change new artwork or detached host state', async () => {
  const held = [], good = cdrCompressedVectorFixture()
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => {
    if (o.filePath === '/late') held.push(o)
    else o.success({ data: good.subarray(o.position || 0, (o.position || 0) + (o.length || good.length)) })
  } }) })
  try {
    page.openSelectedFile({ name: 'late.cdr', path: '/late', size: good.length }); await tick()
    assert.ok(held.length)
    page.openSelectedFile({ name: 'good.cdr', path: '/good', size: good.length }); await tick()
    const visible = page.data.inspectorPreviewSource; assert.ok(visible)
    for (const o of held.splice(0)) o.fail({ errMsg: 'old read failed' })
    await tick(); assert.equal(page.data.inspectorPreviewSource, visible)
    page.openSelectedFile({ name: 'late.cdr', path: '/late', size: good.length }); await tick(); page.detached()
    const patches = page.patches.length
    for (const o of held.splice(0)) o.success({ data: good })
    await tick(); assert.equal(page.patches.length, patches)
  } finally { page.detached() }
})
