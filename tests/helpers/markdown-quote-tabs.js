'use strict'
const { parseHtmlDocument } = require('../../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cases } = require('../fixtures/markdown-quote-tabs-reference.json')
function signature (html) {
  const walk = node => {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/[ \t\r\n]+/g, ' ').trim()
      return text ? { name: '#text', text } : null
    }
    const name = node.localName
    if (['pre', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) {
      return { name, text: name === 'pre' ? node.textContent : node.textContent.replace(/[ \t\r\n]+/g, ' ').trim() }
    }
    const children = (node.childNodes || []).map(walk).filter(Boolean)
    if (['blockquote', 'ul', 'ol', 'li'].includes(name)) return { name, ...(name === 'ol' ? { start: node.getAttribute('start') || '1' } : {}), children }
    if (name === 'hr') return { name }
    return children.length ? { name, children } : null
  }
  return walk(parseHtmlDocument(html).document.body)
}
module.exports = { cases, signature }
