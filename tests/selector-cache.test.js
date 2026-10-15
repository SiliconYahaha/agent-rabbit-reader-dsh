'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { parseHtmlDocument, matchSelector } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')

test('复用选择器语法后仍逐次读取 class、属性、伪类及节点顺序', () => {
  const { document } = parseHtmlDocument('<main><input id="x" class="old" data-state="a"><p id="y">邻居</p></main>')
  const input = document.getElementById('x'), p = document.getElementById('y')
  const selectors = ['main > input.old', '[data-state="a"]', 'input:disabled', 'input + p', 'p:first-child']
  const check = () => selectors.map((s, i) => matchSelector(i < 3 ? input : p, s))
  assert.deepEqual(check(), [true, true, false, true, false])
  input.className = 'new'; input.setAttribute('data-state', 'b'); input.disabled = true
  input.parentNode.insertBefore(p, input)
  assert.deepEqual(check(), [false, false, true, false, true])
  for (let i = 0; i < 1500; i++) matchSelector(input, '.unused-' + i)
  assert.deepEqual(check(), [false, false, true, false, true])
})

test('转义选择器跨文档复用不会混用 HTML 与 XHTML 大小写语义', () => {
  const html = parseHtmlDocument('<DIV id="a:b" class="1x"></DIV>').document
  const xml = parseHtmlDocument('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><DIV id="a:b" class="1x"/></body></html>', { contentType: 'application/xhtml+xml' }).document
  for (let i = 0; i < 2; i++) {
    assert.equal(matchSelector(html.getElementById('a:b'), 'div#a\\:b.\\31 x'), true)
    assert.equal(matchSelector(xml.getElementById('a:b'), 'div#a\\:b.\\31 x'), false)
    assert.equal(matchSelector(xml.getElementById('a:b'), 'DIV#a\\:b.\\31 x'), true)
  }
})
