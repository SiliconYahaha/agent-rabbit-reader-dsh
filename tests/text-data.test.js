'use strict'
const assert = require('node:assert/strict'), test = require('node:test')
const { formatJson, parseCsv, renderTextData, decodeTextData, MAX_INDENT_DEPTH } = require('../miniprogram/file-reader/document/text-data')
const { fileKind, textDataFormat, isMarkdownFile, SOURCE_TEXT_EXTENSIONS } = require('../miniprogram/file-reader/shared/file-types')
const { readerPage, flush } = require('./helpers/reader-host')
const references = require('./fixtures/text-data/references.json')
// Lexical output must keep every original JSON token, not merely values after
// a potentially lossy JS parse. Independent compact strings come from Python.
const compact = source => source.match(/"(?:\\.|[^"\\])*"|[^\s]/g).join('')

for (const sample of references.json) test('JSON source tokens: ' + sample.id, () => {
  const result = formatJson(sample.source)
  assert.equal(compact(result), sample.compact)
  assert.equal(renderTextData(sample.source, { format: 'json' }).mode, 'json')
})
for (const sample of references.csv) test('CSV independent cells: ' + sample.id, () => assert.deepEqual(parseCsv(sample.source), sample.rows))

test('invalid JSON/CSV and presentation limits show all original text with an explicit diagnostic', () => {
  for (const source of ['{"x":1,}', '[1 2]', '{x:1}', '01', 'NaN', '"bad\\q"', '"unterminated', '"bad\u0001"']) {
    assert.throws(() => formatJson(source), e => e.code === 'invalid-json')
    const result = renderTextData(source, { format: 'json' })
    assert.equal(result.mode, 'source'); assert.equal(result.diagnostic, 'invalid-json')
  }
  for (const source of ['a,"unclosed', 'a,"quoted"bad', 'a,un"quoted']) assert.throws(() => parseCsv(source), e => e.code === 'invalid-csv')
  for (const [source, format, limits] of [['[1,2,3]', 'json', { maxChars: 3 }], ['[[[0]]]', 'json', { maxDepth: 1 }], ['[1,2]', 'json', { maxOutput: 2 }], ['a,b\nc,d', 'csv', { maxCells: 3 }], ['a\nb\nc', 'csv', { maxRows: 2 }]]) {
    const result = renderTextData(source, { format, ...limits })
    assert.equal(result.mode, 'source'); assert.equal(result.diagnostic, 'presentation-limit')
  }
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('\r\na,b,\r\n\r\n'), [[], ['a', 'b', ''], []])
})

test('data/code suffixes cannot become executable markup through a conflicting MIME', () => {
  for (const extension of SOURCE_TEXT_EXTENSIONS) for (const type of ['', 'application/octet-stream', 'text/html', 'text/markdown', 'image/png']) {
    assert.equal(fileKind({ name: '文件.' + extension, type }), 'text')
  }
  assert.equal(fileKind({ name: 'unknown', type: 'application/ld+json' }), 'text')
  assert.equal(textDataFormat({ name: 'code.js', type: 'application/json' }), 'source')
  assert.equal(textDataFormat({ name: 'data.json', type: 'text/csv' }), 'json')
  for (const extension of ['txt', 'md', 'markdown']) for (const type of ['text/html', 'image/png', 'application/octet-stream']) {
    assert.equal(fileKind({ name: 'file.' + extension, type }), 'text')
    assert.equal(isMarkdownFile({ name: 'file.' + extension, type }), extension !== 'txt')
  }
  assert.equal(isMarkdownFile({ name: 'source.txt', type: 'text/markdown' }), false)
})

test('declared source encodings read independent bytes and BOM wins; invalid/unknown declarations fail', () => {
  for (const sample of references.encoded) assert.equal(decodeTextData(Buffer.from(sample.base64, 'base64'), { type: sample.mime }).text, sample.text, sample.id)
  assert.throws(() => decodeTextData(Buffer.from([0xff]), { type: 'text/csv; charset=utf-8' }), /不匹配/)
  assert.throws(() => decodeTextData(Buffer.from('a'), { type: 'text/csv; charset=utf-7' }), /暂不支持/)
  assert.equal(decodeTextData('<meta charset="gbk">中文', { type: 'text/plain' }).text, '<meta charset="gbk">中文')
})

function hostFor (source, extra = {}) {
  const data = Buffer.isBuffer(source) ? source : Buffer.from(source), reads = []
  const fs = { stat: o => o.success({ stats: { size: data.length } }), readFile: o => {
    reads.push(o)
    const b = o.length == null ? data : data.subarray(o.position, o.position + o.length)
    o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })
  }, ...extra }
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, request: () => assert.fail('must not fetch source URLs'), getFileSystemManager: () => fs })
  return { page, reads }
}

test('actual JSON body, original/format taps and literal markup survive all entry MIME choices', async () => {
  const sample = references.json[0], poisoned = references.json[1]
  for (const type of ['', 'application/json', 'application/octet-stream', 'text/html']) {
    const { page } = hostFor(sample.source)
    page.openSelectedFile({ name: '真实数据.json', path: '/fixture/data.json', size: 1, type }); await flush()
    assert.equal(page.data.error, '')
    const d = page._htmlRuntime.document, button = d.getElementById('text-data-toggle')
    assert.equal(compact(d.querySelector('pre').textContent), sample.compact)
    for (const [visible, label] of [['block', '查看排版'], ['none', '查看原文']]) {
      page.onDomTap({ currentTarget: { dataset: { nid: button._nid } } }); await flush()
      assert.equal(d.getElementById('text-data-original').style.display, visible)
      assert.equal(button.textContent, label)
    }
    page.detached()
  }
  const { page } = hostFor(poisoned.source)
  page.openSelectedFile({ name: '安全.json', path: '/fixture/poison.json', size: 999 }); await flush()
  assert.equal(page._htmlRuntime.window.poison, undefined)
  assert.equal(page._htmlRuntime.window.polluted, undefined)
  assert.equal(compact(page._htmlRuntime.document.querySelector('pre').textContent), poisoned.compact)
  assert.deepEqual(page._runtimeErrors, [])
  page.detached()
})

test('actual CSV cells preserve quoted separators/newlines/zeros and formula source without execution', async () => {
  for (const sample of references.csv) {
    const { page } = hostFor(sample.source)
    page.openSelectedFile({ name: sample.id + '.csv', path: '/fixture/data.csv', type: 'application/octet-stream' }); await flush()
    assert.equal(page.data.error, '')
    const cells = page._htmlRuntime.document.querySelectorAll('td').map(cell => cell.textContent)
    assert.deepEqual(cells, sample.rows.flat().map(cell => cell.replace(/\r\n?/g, '\n')))
    assert.equal(page._htmlRuntime.window.poison, undefined)
    page.detached()
  }
})

test('source files render original code/config bytes as text, never as document scripts', async () => {
  const source = '<script>window.poison=1</script>\n<meta charset="gbk">\n# 中文 & 😀\n\tprint("hello")'
  for (const extension of SOURCE_TEXT_EXTENSIONS) {
    const { page } = hostFor(source)
    page.openSelectedFile({ name: '源码.' + extension, path: '/fixture/code', type: 'text/html' }); await flush()
    assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, source)
    assert.equal(page._htmlRuntime.window.poison, undefined)
    page.detached()
  }
})

test('literal inline image URLs in JSON and source remain text without cache writes', async () => {
  const uri = 'data:image/png;base64,' + Buffer.alloc(10000).toString('base64')
  for (const name of ['data.json', 'literal.js', 'literal.txt']) {
    const source = JSON.stringify({ value: uri }), { page } = hostFor(source, { writeFile: () => assert.fail('source text cannot create presentation resources') })
    page.openSelectedFile({ name, path: '/fixture/literal' }); await flush()
    assert.equal(page.data.error, '')
    assert.ok(page._htmlRuntime.document.querySelector('pre').textContent.includes(uri))
    page.detached()
  }
})

test('ZIP stat size and literal members use actual bytes despite stale picker metadata', async () => {
  const zip = Buffer.from(references.archive.base64, 'base64')
  for (const hint of [0, 1, 300 * 1024 * 1024]) {
    let body = Buffer.alloc(0)
    const manager = {
      stat: o => o.success({ stats: { size: o.path === '/fixture/data.zip' ? zip.length : body.length } }),
      readFile: o => { const bytes = o.filePath === '/fixture/data.zip' ? zip : body; const range = bytes.subarray(o.position || 0, o.length == null ? bytes.length : (o.position || 0) + o.length); o.success({ data: range }) },
      writeFile: o => { body = Buffer.from(o.data); o.success() }
    }
    for (const expected of references.archive.members) {
      const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => manager })
      page.openSelectedFile({ name: 'data.zip', path: '/fixture/data.zip', size: hint }); await flush()
      assert.equal(page.data.error, '')
      const index = page.data.inspectorEntries.findIndex(e => e.name === expected.name)
      assert.ok(index >= 0)
      await page.openInspectorEntry({ currentTarget: { dataset: { index } } }); await flush()
      assert.equal(page.data.error, '')
      assert.equal(body.toString(), expected.source)
      const d = page._htmlRuntime.document
      if (expected.rows) assert.deepEqual(d.querySelectorAll('td').map(e => e.textContent), expected.rows.flat().map(c => c.replace(/\r\n?/g, '\n')))
      else if (expected.compact) assert.equal(compact(d.querySelector('pre').textContent), expected.compact)
      else assert.equal(d.querySelector('pre').textContent, expected.source)
      assert.equal(page._htmlRuntime.window.poison, undefined)
      page.detached()
    }
  }
})

test('ZIP short ranges, changing size and obsolete stat callbacks fail without contaminating a new file', async () => {
  const zip = Buffer.from(references.archive.base64, 'base64')
  for (const mode of ['short', 'change', 'over-limit']) {
    let stats = 0, reads = 0
    const { page } = hostFor(zip, {
      stat: o => o.success({ stats: { size: mode === 'over-limit' ? 200 * 1024 * 1024 + 1 : zip.length + (mode === 'change' && stats++ ? 1 : 0) } }),
      readFile: o => { reads++; const bytes = zip.subarray(o.position, o.position + o.length - (mode === 'short' ? 1 : 0)); o.success({ data: bytes }) }
    })
    page.openSelectedFile({ name: 'bad.zip', path: '/fixture/bad', size: 1 }); await flush()
    assert.match(page.data.error, /长度不一致|大小发生变化|安全上限/)
    if (mode === 'over-limit') assert.equal(reads, 0)
    page.detached()
  }
  for (const fail of [true, false]) {
    const pending = [], { page } = hostFor('{"ok":true}', { stat: o => { if (o.path.endsWith('old')) pending.push(o); else o.success({ stats: { size: 11 } }) } })
    page.openSelectedFile({ name: 'old.zip', path: '/fixture/old' })
    page.openSelectedFile({ name: 'new.json', path: '/fixture/new' }); await flush()
    if (fail) pending[0].fail({ errMsg: 'late' }); else pending[0].success({ stats: { size: zip.length } })
    await flush(); assert.equal(page.data.sourceName, 'new.json'); assert.equal(page.data.error, '')
    assert.equal(compact(page._htmlRuntime.document.querySelector('pre').textContent), '{"ok":true}')
    page.detached()
  }
})

test('native actual byte length enforces limits and stale reads cannot overwrite the next file', async () => {
  let reads = 0
  const { page } = hostFor('x', { stat: o => o.success({ stats: { size: 5 * 1024 * 1024 + 1 } }), readFile: () => { reads++ } })
  page.openSelectedFile({ name: 'huge.json', path: '/fixture/huge', size: 1 }); await flush()
  assert.match(page.data.error, /安全上限/); assert.equal(reads, 0)
  page.detached()
  for (const fail of [false, true]) {
    const pending = []
    const { page } = hostFor('{"ok":true}', { readFile: o => pending.push(o) })
    page.openSelectedFile({ name: 'old.csv', path: '/fixture/old' })
    page.openSelectedFile({ name: 'new.json', path: '/fixture/new' })
    pending[1].success({ data: Buffer.from('{"ok":true}') }); await flush()
    if (fail) pending[0].fail({ errMsg: 'late' })
    else pending[0].success({ data: Buffer.from('bad late') })
    await flush()
    assert.equal(page.data.sourceName, 'new.json'); assert.equal(page.data.error, '')
    assert.equal(compact(page._htmlRuntime.document.querySelector('pre').textContent), '{"ok":true}')
    page.detached()
  }
})

// 深嵌套 JSON 的缩进曾按真实深度线性增长：深度 60、1 万个数字的 48 kB 输入会放大成
// 1.2 MB 以上的桥接载荷，再大一点就越过 maxOutput，连缩进视图都保不住，只能整体退回
// 原文。缩进只服务可读性，因此上限固定；词元、原文切换与浅嵌套排版都不受影响。
test('deeply nested JSON keeps its indented view with a payload proportional to content', () => {
  const nested = (depth, count) => '['.repeat(depth) + Array.from({ length: count }, (_, index) => index).join(',') + ']'.repeat(depth)
  const source = nested(60, 10000)
  assert.ok(source.length <= 200000, '样本必须仍在字符上限内，否则测的是另一个限制')
  const formatted = formatJson(source)
  assert.equal(compact(formatted), compact(source), '每个 JSON 词元都必须逐字保留')
  assert.ok(formatted.length < source.length * 8, `载荷应随内容增长而不是随嵌套深度膨胀：${formatted.length} / ${source.length}`)
  const widest = Math.max(...formatted.split('\n').map(line => line.match(/^ */)[0].length))
  assert.ok(widest <= MAX_INDENT_DEPTH * 2, `缩进不得超过 ${MAX_INDENT_DEPTH} 层：${widest}`)
  assert.equal(renderTextData(source, { format: 'json' }).mode, 'json')
  // 修复前这些体积直接越过 maxOutput 退回原文；现在仍保留缩进视图且词元不变。
  for (const count of [14000, 18000, 24000]) {
    const larger = nested(60, count)
    const result = renderTextData(larger, { format: 'json' })
    assert.equal(result.mode, 'json', `${larger.length} 字符的深嵌套 JSON 仍应显示缩进视图`)
    assert.equal(result.diagnostic, '')
    assert.equal(compact(formatJson(larger)), compact(larger))
  }
  // 浅嵌套排版逐字不变，原文切换按钮与两个视图都保留。
  assert.equal(formatJson('{"a":[1,{"b":2}]}'), '{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}')
  assert.equal(formatJson('[1,2,3]'), '[\n  1,\n  2,\n  3\n]')
  const view = renderTextData('{"a":[1,{"b":2}]}', { format: 'json', labels: { original: '查看原文', formatted: '查看排版' } })
  assert.ok(view.html.includes('id="text-data-toggle"'))
  assert.ok(view.html.includes('id="text-data-original"') && view.html.includes('id="text-data-formatted"'))
  // 超出字符上限仍按原策略明确退回原文，不放行无限放大。
  assert.throws(() => formatJson(nested(60, 100), { maxChars: 10 }), e => e.code === 'presentation-limit')
})
