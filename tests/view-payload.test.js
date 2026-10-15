'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { renderHtmlDomTree, sanitizeStandaloneSvg } = require('../miniprogram/file-reader/document/document-renderer')
const { buildProgressiveDomPlan, compactDomTreeForView, compactStyle, payloadBytes } = require('../miniprogram/file-reader/document/view-payload')

test('视图数据只保留 WXML 真正使用的属性并复用重复样式', () => {
  const repeated = Array.from({ length: 800 }, (_, index) => `<button id="button-${index}" class="key" data-value="${index}" style="color:red;transition:all .2s">${index}</button>`).join('')
  const rendered = renderHtmlDomTree(`<body>${repeated}</body>`, { viewportWidth: 390 })
  const compacted = compactDomTreeForView(rendered.nodes)
  const serialized = JSON.stringify(compacted)

  assert.equal(serialized.includes('button-799'), false)
  assert.equal(serialized.includes('data-value'), false)
  assert.equal(serialized.includes('transition'), false)
  assert.ok(compacted.styles.length < 10)
  assert.ok(payloadBytes(compacted) < payloadBytes(rendered.nodes) * 0.55)
})

test('居中流体容器会转换成真机稳定的完整左右留白和 max-width', () => {
  const style = compactStyle('width:min(1180px, calc(100% - 32px));margin:0 auto;border:1px solid #000')

  assert.match(style, /width:auto/)
  assert.match(style, /max-width:1180px/)
  assert.match(style, /margin-left:16px/)
  assert.match(style, /margin-right:16px/)
  assert.match(style, /border:1px solid #000/)
  assert.doesNotMatch(style, /width:min\(/)
})

test('大型 DOM 视图按安全体积分片且保留完整节点顺序', () => {
  const nodes = [{ type: 'element', name: 'main', nid: 1, attrs: {}, children: Array.from({ length: 1600 }, (_, index) => ({
    type: 'element',
    name: 'section',
    nid: index + 2,
    attrs: {},
    children: [{ type: 'text', nid: index + 2000, text: `第 ${index + 1} 段内容 ${'x'.repeat(120)}` }]
  })) }]
  const plan = buildProgressiveDomPlan(nodes, 96 * 1024)

  assert.equal(plan.initial[0].children.length, 0)
  assert.ok(plan.chunks.length > 1)
  assert.ok(plan.maxChunkBytes <= 96 * 1024)
  assert.equal(Object.keys(plan.chunks[0])[0].startsWith('domTree[0].children['), true)
  assert.equal(plan.totalBytes, payloadBytes(nodes))
})

test('独立 SVG 会输出去脚本、去外链的本地静态预览源码', () => {
  const result = sanitizeStandaloneSvg('<svg viewBox="0 0 20 10" onclick="bad()"><script>bad()</script><image href="https://example.com/x.png"/><circle r="3"><animate attributeName="r" to="6"/></circle></svg>')

  assert.match(result.source, /<svg\b/)
  assert.match(result.source, /<animate\b/)
  assert.doesNotMatch(result.fallbackSource, /<animate\b/)
  assert.doesNotMatch(result.fallbackSource, /onclick|<script|example\.com/)
})

function replayPlan (plan) {
  const state = { domTree: JSON.parse(JSON.stringify(plan.initial)) }
  for (const patch of plan.chunks) {
    const paths = Object.keys(patch)
    for (const left of paths) for (const right of paths) {
      if (left !== right) assert.ok(!right.startsWith(left + '.'), 'ancestor and child cannot share a patch')
    }
    for (const [key, value] of Object.entries(patch)) {
      const segments = key.split(/[.\[\]]/).filter(Boolean)
      let parent = state
      for (const segment of segments.slice(0, -1)) {
        assert.ok(parent[segment] != null, `missing parent before patch: ${key}`)
        parent = parent[segment]
      }
      parent[segments.at(-1)] = JSON.parse(JSON.stringify(value))
    }
  }
  return state.domTree
}

test('2049 个顶层段落按字节合并更新，不产生逐段跨线程等待且正文无丢失', () => {
  const nodes = Array.from({ length: 2049 }, (_, index) => ({
    type: 'element', name: 'p', nid: index * 2, attrs: {},
    children: [{ type: 'text', nid: index * 2 + 1, text: `第${index}段完整中文正文`.repeat(4) }]
  }))
  const plan = buildProgressiveDomPlan(nodes)
  assert.ok(plan.chunks.length < 10, `expected byte batches, got ${plan.chunks.length} updates`)
  assert.ok(plan.maxChunkBytes <= 160 * 1024)
  assert.deepEqual(replayPlan(plan), nodes)
})

test('跨顶层合并不打破大型子树的父壳先行及 Unicode 字节上限', () => {
  const leaf = index => ({ type: 'element', name: 'p', nid: index, attrs: {}, children: [{ type: 'text', text: '中文🙂'.repeat(70) }] })
  const nodes = [leaf(0), { type: 'element', name: 'main', nid: 1, attrs: {}, children: [{
    type: 'element', name: 'section', nid: 2, attrs: {}, children: Array.from({ length: 150 }, (_, i) => leaf(i + 3))
  }] }, leaf(200)]
  const plan = buildProgressiveDomPlan(nodes, 16 * 1024)
  assert.ok(plan.maxChunkBytes <= 16 * 1024)
  assert.deepEqual(replayPlan(plan), nodes)
  assert.deepEqual(buildProgressiveDomPlan([], 16 * 1024).chunks, [])
})
