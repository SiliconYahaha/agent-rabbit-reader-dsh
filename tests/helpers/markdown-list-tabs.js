'use strict'
const { parseHtmlDocument } = require('../../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cases } = require('../fixtures/markdown-list-tabs-reference.json')
function signature (html, suite) {
  const document = parseHtmlDocument(html).document
  if (suite === 'content' || suite === 'footnote') {
    return Array.from(document.querySelectorAll('pre,code'))
      .filter(n => n.localName === 'pre' || !n.closest('pre'))
      .map(n => ({ kind: n.localName, text: n.textContent }))
  }
  function walk (node) {
    if (node.nodeType === 3) return node.textContent.replace(/[ \t\r\n]+/g, ' ').trim() || null
    const name = node.localName
    if (name === 'pre') return { name, text: node.textContent }
    if (name === 'input') return { name, checked: node.hasAttribute('checked'), disabled: node.hasAttribute('disabled') }
    const children = Array.from(node.childNodes || []).map(walk).filter(n => n !== null)
    if (['ul', 'ol', 'li', 'blockquote', 'p', 'h1', 'h2', 'hr', 'script', 'style', 'textarea', 'div', 'span', 'custom'].includes(name)) {
      return { name, ...(name === 'ol' ? { start: node.getAttribute('start') || '1' } : {}), children }
    }
    return children.length ? children : null
  }
  return walk(document.body)
}
module.exports = { cases, signature }
