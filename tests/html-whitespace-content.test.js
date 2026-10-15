'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')

function visibleText (text, whiteSpace = 'normal') {
  const result = renderHtmlDomTree(`<p id="sample" style="white-space:${whiteSpace}">${text}</p>`, { viewportWidth: 390 })
  function collect (node) { return node.type === 'text' ? node.text : (node.children || []).map(collect).join('') }
  return result.nodes.map(collect).join('')
}

// Chrome innerText independently preserves the two line feeds and both NBSPs.
// These fail on v1.4.48: source text must not be silently rewritten by \s+.
test('pre-line preserves intentional blank lines in actual article content', () => {
  assert.equal(visibleText('第一行\n\n第三行', 'pre-line'), '第一行\n\n第三行')
})

test('normal white-space preserves non-breaking spaces and their count', () => {
  assert.equal(visibleText('甲\u00a0\u00a0乙'), '甲\u00a0\u00a0乙')
})

test('pre-line keeps non-breaking spaces instead of converting them to breakable spaces', () => {
  assert.equal(visibleText('甲\u00a0\u00a0乙', 'pre-line'), '甲\u00a0\u00a0乙')
})

test('137 whitespace variants preserve Unicode separators, line counts, source CRLF and references', () => {
  const { cases } = require('./helpers/html-whitespace')
  for (const item of cases) assert.equal(visibleText(item.html, item.mode), item.expected, item.id)
})

test('pure NBSP and ideographic text nodes remain at body, paragraph, flex and grid boundaries', () => {
  for (const display of ['block', 'flex', 'grid']) for (const content of ['&nbsp;&nbsp;', '&#12288;&#12288;']) {
    const result = renderHtmlDomTree(`<body>${content}<div style="display:${display}">${content}<b>正文</b>${content}</div></body>`)
    assert.equal(result.nodes[0].type, 'text')
    const children = result.nodes[1].children
    assert.equal(children[0].type, 'text'); assert.equal(children[2].type, 'text')
    assert.equal(children[0].text.length, 2)
  }
})

test('pre-line preserves newline-only nodes between inlines and at body level', () => {
  const r = renderHtmlDomTree('<body style="white-space:pre-line">\n\n<span>A</span>\n\n<span>B</span></body>')
  assert.equal(r.nodes[0].text, '\n\n'); assert.equal(r.nodes[2].text, '\n\n')
})

test('ASCII indentation does not create anonymous flex/grid items, including preserving modes', () => {
  for (const display of ['flex', 'grid']) for (const mode of ['normal', 'pre-line', 'pre', 'pre-wrap', 'break-spaces']) {
    const r = renderHtmlDomTree(`<div style="display:${display};white-space:${mode}">\n  <b>A</b>\n  <b>B</b>\n</div>`)
    assert.deepEqual(r.nodes[0].children.map(n => n.name), ['b', 'b'])
  }
})

test('HTML input normalizes CRLF while scripted DOM and character-reference CR stay distinct', () => {
  const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
  const parsed = parseHtmlDocument('<p id="source">A\r\nB\rC</p><p id="ref">A&#13;B</p>')
  assert.equal(parsed.document.getElementById('source').textContent, 'A\nB\nC')
  assert.equal(parsed.document.getElementById('ref').textContent, 'A\rB')
  const node = parsed.document.getElementById('source'); node.textContent = 'A\rB'
  assert.equal(node.textContent, 'A\rB')
  assert.equal(renderHtmlDomTree(parsed).nodes[0].children[0].text, 'A B')
  node.innerHTML = 'A\r\nB'; assert.equal(node.textContent, 'A\nB')
})

test('runtime updates preserve source DOM and actual rendered blank lines and NBSPs', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  const { visualHtml } = require('./helpers/html-whitespace')
  const runtime = createRuntime(visualHtml)
  try {
    runtime.run(); runtime.dispatchTap(runtime.document.getElementById('update')._nid)
    assert.deepEqual(runtime.errors, [])
    const expected = '更新A\n\n更新B\u00a0\u00a0结束'
    assert.equal(runtime.document.getElementById('dynamic').textContent, expected)
    const state = runtime.renderState(); const r = renderHtmlDomTree(`<style>${state.styles || ''}</style>${state.bodyHtml}`)
    const find = nodes => { for (const n of nodes) { if (n.attrs?.id === 'dynamic') return n; const nested = find(n.children || []); if (nested) return nested } }
    assert.equal(find(r.nodes).children[0].text, expected)
  } finally { runtime.destroy() }
})

test('long pre-line whitespace runs complete within a bounded worker without quadratic newline searching', () => {
  const { execFileSync } = require('node:child_process')
  const rendererPath = require.resolve('../miniprogram/file-reader/document/document-renderer')
  const program = `const a=require('assert/strict');const {renderHtmlDomTree}=require(${JSON.stringify(rendererPath)});const r=renderHtmlDomTree('<p style="white-space:pre-line">A'+' '.repeat(512*1024)+'B</p>');a.equal(r.nodes[0].children[0].text,'A B');console.log('bounded-content-ok')`
  assert.match(execFileSync(process.execPath, ['-e', program], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }), /bounded-content-ok/)
})
