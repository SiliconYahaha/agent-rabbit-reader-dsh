'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { originalCases, expandedCases, malformedCases, head, rect } = require('./helpers/ai-lexical')
const { extractLegacyAiPreview, extractLegacyAiRasterPreview } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview } = require('./helpers/reader-host')
const jpeg = require('jpeg-js')
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }

test('PostScript strings retain artwork, physical bounds and genuine EPSI across lexical contexts', () => {
  const expandedBefore = require('./fixtures/ai-lexical/expanded-before.json').cases
  for (const row of [...originalCases, ...expandedCases()]) {
    const b = Buffer.from(row.source), retained = row.sha256 ? row : expandedBefore.find(x => x.name === row.name)
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'), retained.sha256, row.name + ' original bytes')
    if (row.expected.paths) {
      const v = extractLegacyAiPreview(b)
      assert.deepEqual([v.width, v.height, v.paths], [40, 20, 2], row.name)
      assert.match(v.svg, /fill="rgb\(255,0,0\)"/, row.name)
      assert.match(v.svg, /fill="rgb\(0,0,255\)"/, row.name)
    } else assert.throws(() => extractLegacyAiPreview(b), /路径|矢量/, row.name)
    if (row.expected.rasterPreview) assert.deepEqual([...jpeg.decode(extractLegacyAiRasterPreview(b).jpeg).data], row.expected.pixel, row.name)
    else assert.throws(() => extractLegacyAiRasterPreview(b), /没有 DSC\/EPSI/, row.name)
  }
})

test('unterminated and excessive strings fail explicitly while the depth boundary remains readable', () => {
  for (const row of malformedCases()) {
    assert.throws(() => extractLegacyAiPreview(Buffer.from(row.source)), row.expected.error, row.name)
    assert.throws(() => extractLegacyAiRasterPreview(Buffer.from(row.source)), row.expected.error, row.name)
  }
  const v = extractLegacyAiPreview(Buffer.from(head + '('.repeat(1024) + ')'.repeat(1024) + ' pop\n' + rect(0, '1 0 0')))
  assert.deepEqual([v.width, v.height, v.paths], [40, 20, 1])
})

test('numeric arrays remain usable and malformed arrays fail without phantom paths', () => {
  const prefix = head + '[1 0 0 1 0 0] concat\n'
  assert.equal(extractLegacyAiPreview(Buffer.from(prefix + rect(0, '1 0 0'))).paths, 1)
  for (const body of ['[1 2', '['.repeat(1025) + ']'.repeat(1025)]) assert.throws(() => extractLegacyAiPreview(Buffer.from(head + rect(0, '1 0 0') + body)), /数组/)
  assert.equal(extractLegacyAiPreview(Buffer.from(head + '['.repeat(1024) + ']'.repeat(1024) + ' pop\n' + rect(0, '1 0 0'))).paths, 1)
})

test('actual component keeps fake previews hidden, selects real previews and recovers after failures', async () => {
  let input, writes = []
  const page = designPreview({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => o.success({ data: input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)) }),
    writeFile: o => { writes.push(o); o.success() }
  }) })
  try {
    for (const row of [...originalCases, ...expandedCases(), ...malformedCases().flatMap(x => [x, originalCases[0]])]) {
      input = Buffer.from(row.source); writes = []
      page.open({ name: row.name + '.ai', path: '/fixture/input.ai', size: input.length })
      await tick()
      assert.equal(page.data.loading, false, row.name)
      if (row.expected.noPreview || row.expected.error) {
        assert.equal(page.data.previewPath, '', row.name)
        assert.equal(writes.length, 0, row.name)
        assert.match(page.data.message, row.expected.error || /没有 DSC\/EPSI/, row.name)
      } else {
        assert.ok(page.data.previewPath, row.name)
        assert.equal(writes.length, 1, row.name)
        if (row.expected.rasterPreview) assert.deepEqual([...jpeg.decode(Buffer.from(writes[0].data)).data], row.expected.pixel)
        else {
          assert.match(String(writes[0].data), /viewBox="0 -20 40 20"/, row.name)
          assert.match(String(writes[0].data), /fill="rgb\(0,0,255\)"/, row.name)
        }
      }
    }
  } finally { page.detached() }
})

test('late invalid-string reads and detached reads cannot replace a subsequent valid preview', async () => {
  const good = Buffer.from(originalCases[0].source), bad = Buffer.from(malformedCases()[0].source)
  const held = [], writes = []
  const page = designPreview({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile: o => { if (o.filePath === '/late') held.push(o); else o.success({ data: good.subarray(o.position || 0, (o.position || 0) + o.length) }) },
    writeFile: o => { writes.push(o); o.success() }
  }) })
  try {
    page.open({ name: 'late.ai', path: '/late', size: bad.length }); await tick()
    assert.ok(held.length)
    page.open({ name: 'good.ai', path: '/good', size: good.length }); await tick()
    const visible = page.data.previewPath
    assert.ok(visible)
    for (const o of held.splice(0)) o.success({ data: bad.subarray(o.position || 0, (o.position || 0) + o.length) })
    await tick()
    assert.equal(page.data.previewPath, visible)
    assert.equal(page.data.loading, false)
    assert.equal(writes.length, 1)
    page.open({ name: 'late.ai', path: '/late', size: bad.length }); await tick(); page.detached()
    const patches = page.patches.length
    for (const o of held.splice(0)) o.fail({ errMsg: 'late read failure' })
    await tick()
    assert.equal(page.patches.length, patches)
  } finally { page.detached() }
})

test('Illustrator compound paths retain holes, XR fill rule and nested groups', () => {
 const source = head + '1 XR\n0 0 0 k\n*u\n0 0 m 30 0 L 30 20 L 0 20 L f\nu\n5 5 m 25 5 L 25 15 L 5 15 L f\nU\n*U\n'
 const result=extractLegacyAiPreview(Buffer.from(source))
 assert.equal(result.paths,1)
 assert.match(result.svg,/fill-rule="evenodd"/)
 assert.match(result.svg,/M0 0 L30 0 L30 20 L0 20 M5 5 L25 5 L25 15 L5 15/)
 assert.doesNotMatch(extractLegacyAiPreview(Buffer.from(source.replace('1 XR','0 XR'))).svg,/fill-rule="evenodd"/)
 assert.throws(()=>extractLegacyAiPreview(Buffer.from(source.replace('*U',''))),/未闭合/)
 assert.throws(()=>extractLegacyAiPreview(Buffer.from(head+'*U')),/不匹配/)
 const nested = extractLegacyAiPreview(Buffer.from(source.replace('u\n5','*u\n5').replace('U\n*U','*U\n*U')))
 assert.equal(nested.paths,1)
})
