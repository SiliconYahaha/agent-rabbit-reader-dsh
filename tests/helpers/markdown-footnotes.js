'use strict'
const { cases: footnoteCases } = require('../fixtures/markdown-footnotes-reference.json')
const { cases: codeIndentCases } = require('../fixtures/markdown-code-indent-reference.json')
const cases = [...footnoteCases, ...codeIndentCases]
const htmlCases = []
for (const outer of ['ul', 'ol']) for (const inner of ['ul', 'ol']) {
  htmlCases.push({ name: outer + '-' + inner, source: `<${outer} id="outer"><li id="first">FIRST<${inner} id="inner"><li id="nested">NESTED<li id="second">SECOND</${inner}>END<li id="last">LAST</${outer}>TAIL` })
}
for (const wrapper of ['div', 'address', 'p', 'span', 'article', 'aside', 'blockquote', 'button', 'details', 'dl', 'fieldset', 'figure', 'footer', 'header', 'main', 'nav', 'ol', 'section', 'ul']) {
  htmlCases.push({ name: 'scope-' + wrapper, source: `<ul id="outer"><li id="first">FIRST<${wrapper} id="wrapper"><li id="nested">NESTED</li></${wrapper}></li><li id="last">LAST</li></ul>` })
}
htmlCases.push({ name: 'nested-dl', source: '<dl id="outer"><dt id="term">TERM<dd id="first">FIRST<dl id="inner"><dt id="nested">NESTED<dd id="second">SECOND</dl>END<dt id="last">LAST</dl>' })
htmlCases.push({ name: 'paragraph-before-li', source: '<ul id="outer"><li id="first"><p id="paragraph">FIRST<li id="last">LAST</ul>' })
htmlCases.push({ name: 'paragraph-before-dd', source: '<dl id="outer"><dt id="first"><p id="paragraph">FIRST<dd id="last">LAST</dl>' })
module.exports = { cases, htmlCases }
