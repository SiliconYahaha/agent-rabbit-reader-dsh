'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { ALL_PATTERNS, RULES, indexText, scan } = require('../scripts/scan-dead-code')

test('text indexing keeps exact LF line numbers, word grammar and first eight occurrences', () => {
  const inputs = ['', 'alpha\r\nbeta\rgamma\u2028delta\u2029epsilon\n\n$end_2', 'one '.repeat(2000), Array.from({length:800},(_,i)=>`${i}: word_${i % 11} repeated repeated\n\t_dash $money ${i % 5 === 0 ? '\n' : ''}`).join('\n')]
  for (const source of inputs) {
    const expected = new Map()
    source.split('\n').forEach((line, index) => {
      for (const word of line.match(/[A-Za-z_$][A-Za-z0-9_$-]*/g) || []) {
        if (!expected.has(word)) expected.set(word, [])
        if (expected.get(word).length < 8) expected.get(word).push(index + 1)
      }
    })
    assert.deepEqual(indexText(source), expected)
  }
})

// 扫描一次全仓约 15 秒；测试之间共享结果，只有确定性测试额外再扫一次。
let cached
function results () {
  if (!cached) cached = scan({ reportSuppressed: true })
  return cached
}

function find (file, symbol) {
  return results().results.find(row => row.file === file && (!symbol || row.symbol === symbol))
}

test('每一种动态引用模式都有对应的白名单规则，规则 id 唯一', () => {
  const covered = new Set(RULES.flatMap(rule => rule.patterns))
  assert.deepEqual(ALL_PATTERNS.filter(id => !covered.has(id)), [])
  assert.equal(new Set(RULES.map(rule => rule.id)).size, RULES.length)
  for (const rule of RULES) assert.ok(rule.description.length > 10, rule.id)
})

test('扫描结果确定：两次运行的 JSON 完全一致，按 (file, line, symbol) 码元排序', () => {
  const first = results().emitted.map(row => JSON.stringify(row))
  const second = scan({ reportSuppressed: true }).emitted.map(row => JSON.stringify(row))
  assert.deepEqual(first, second)
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const keys = results().emitted.map(row => [row.file, row.line, row.symbol])
  const sorted = [...keys].sort((a, b) => compare(a[0], b[0]) || (a[1] - b[1]) || compare(a[2], b[2]))
  assert.deepEqual(keys, sorted)
  assert.ok(first.length > 50 && first.length < 4000, `候选数量异常：${first.length}`)
})

test('WXML 绑定的组件方法与生成模板的 onDom* handler 不是候选', () => {
  for (const name of ['onDomTap', 'stopDomTap', 'toggleAudio', 'openInspectorEntry', 'onReaderTouchStart']) {
    const row = find('miniprogram/file-reader/engine/components/reader/reader.js', name)
    assert.ok(row, name)
    assert.ok(row.used || row.suppressed, `${name} 应被 WXML 绑定规则保活：${row.basis}`)
  }
})

test('生命周期、开发版探针、宿主 API 与沙盒 API 面只降信心不当死代码', () => {
  assert.ok(find('miniprogram/pages/index/index.js', 'onShareAppMessage').suppressed)
  const probe = find('miniprogram/file-reader/engine/components/reader/reader.js', 'startRarRuntimeProbeForDevelopment')
  assert.ok(probe.confidence <= 2 && probe.rules.includes('R-B14-host-api'))
  // 沙盒类/全局对象里的符号即使仓库内无调用，也由 R-B01 压低信心（ShimURL 本身在 globals 里在用）。
  const shim = find('miniprogram/file-reader/document/html-runtime/html-script-runtime.js', 'ShimURL')
  assert.ok(shim.rules.includes('R-B01-sandbox-globals'), shim.basis)
  assert.equal(find('miniprogram/file-reader/document/html-runtime/html-dom-shim.js', 'ShimElement').used, true)
})

test('配置字符串拉活的文件不是候选：页面四件套、usingComponents、生成物、测试 glob、profiles、vendored', () => {
  for (const file of [
    'miniprogram/pages/home/home.wxml',
    'miniprogram/file-reader/document/components/mp-html/node/node.js',
    'miniprogram/file-reader/engine/components/reader/dom-tree.wxml',
    'miniprogram/data/sample-html.js',
    'tests/page-state.test.js',
    'compatibility/profiles/zip.json',
    'miniprogram/file-reader/document/vendor/fflate.js',
    'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br',
    'scripts/verify-canvas-live-budget.js'
  ]) {
    const row = find(file)
    assert.ok(row, file)
    assert.ok(row.used || row.suppressed, `${file} 应由白名单保活：${row.basis}`)
  }
})

test('已知的零引用项以高信心列出，历史发布记录与约定文件压到低信心', () => {
  // 扫描器与本测试文件自身不算引用来源，否则这里点名的候选会被"救活"。
  assert.equal(find('package.json', 'verify:7z-solid-budget:wechat').confidence, 10)
  assert.ok(find('docs/reader-coverage.md').confidence <= 4)
  assert.ok(find('.github/dependabot.yml').confidence <= 2)
  const emitted = results().emitted
  assert.ok(emitted.every(row => row.confidence >= 1 && row.confidence <= 10))
  assert.ok(emitted.every(row => Array.isArray(row.rules) && Array.isArray(row.refKinds) && typeof row.basis === 'string'))
})
