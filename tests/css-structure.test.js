'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { renderHtmlDomTree, parseCssRules } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { splitCssTopLevel, stripCssComments, cssRules } = require('../miniprogram/file-reader/document/css-structure')
const { cases, selectors, caseHtml, visualHtml } = require('./helpers/css-structure')
const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')
const find = (ns, id) => { for (const n of ns) { if (n.attrs && n.attrs.id === id) return n; const c = find(n.children || [], id); if (c) return c } }

test('CSS structural delimiters inside strings preserve generated and following prose in 68 cases', () => {
  for (const c of cases) {
    const r = renderHtmlDomTree(caseHtml(c))
    assert.equal(text(find(r.nodes, 'probe')), c.expected + '正文', c.name)
    assert.equal(text(find(r.nodes, 'after')), '后续正文', c.name)
  }
})
test('CSS trailing escaped/Unicode spaces and punctuation retain query targets and applied bold style', () => {
  for (const c of selectors) {
    const d = parseHtmlDocument('<p>正文</p>').document, p = d.querySelector('p'); p.id = c.id
    assert.equal(d.querySelector(c.selector), p, c.selector)
    assert.match(renderHtmlDomTree(d, { styles: [c.selector + '{font-weight:bold}'] }).nodes[0].attrs.style, /font-weight:bold/)
  }
})
test('CSS comments, nested blocks and string tokens do not create false declarations', () => {
  assert.equal(stripCssComments('p/**/{content:"/*literal*/";/*}*/color:green}'), 'p{content:"/*literal*/";color:green}')
  assert.deepEqual(splitCssTopLevel('--x:{a;b};content:"x;y";color:green', ';'), ['--x:{a;b}', 'content:"x;y"', 'color:green'])
  const rules = parseCssRules('#probe{color:green;color:red{};color:red {};background-color:white}')
  assert.equal(rules.length, 1)
  assert.deepEqual(rules[0].declarations.filter(x => x.property === 'color').map(x => x.value), ['green'])
  assert.equal(Array.from(cssRules('p{content:"{;}";--x:{a;b}}q{color:green}')).length, 2)
})
test('public CSS WPT bytes and three original rendered green outcomes remain fixed', () => {
  const root = path.join(__dirname, 'fixtures/css-structure'), crypto = require('node:crypto')
  const hashes = { 'blocks-and-strings-001.xht': '867baaab1cb6f7b4714c897f76fdaa5b71745bc163fb4c29cfd63a2c79fe062a', 'comments-001.xht': '269730632673ce7e140a61eae054300bdf7df6735feccfc227de0892626c2d82', 'escaped-ident-spaces-001.xht': '662c74109172cd233a2f3b146c23fd6cfb8d6b89818e4e2a177b6a88ddc8bbec', 'LICENSE.md': '5fac07febb0e2a97fb0d7b0def149ec08b642e1ba4b9c345283ab1cbd2af6570' }
  for (const [name, expected] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), expected)
  for (const name of Object.keys(hashes).slice(0, 3)) {
    const r = renderHtmlDomTree(fs.readFileSync(path.join(root, name), 'utf8')), p = r.nodes.find(n => n.name === 'div')
    assert.equal(text(p), 'Filler Text'); assert.match(p.attrs.style, /color:green/)
  }
})
test('CSS literal URL/at-rule text is safe prose while actual external resource URLs remain blocked', () => {
  const { _internals: c } = require('../miniprogram/file-reader/document/html-compat')
  const source = 'content:"url(https://example.invalid/word) @import x";background:url("https://example.invalid/image")'
  assert.equal(c.stripCssResourceUrls(source), 'content:"url(https://example.invalid/word) @import x";background:none')
  assert.match(c.stripCssResourceUrls('background:url("data:image/png;base64,AAAA")'), /data:image\/png;base64,AAAA/)
  const r = parseCssRules('@import "https://example.invalid/s.css";@font-face{src:url(x)}p{color:green}')
  assert.equal(r.length, 1); assert.equal(r[0].selector, 'p')
})
test('CSS animation extraction cannot consume quoted keyframes or damage generated braces', () => {
  const html = '<style>@keyframes reveal{to{color:green}}p{animation:reveal 1s forwards}p::before{content:"@keyframes x {to {x:y}}"}</style><p id="p">正文</p>'
  const p = find(renderHtmlDomTree(html).nodes, 'p')
  assert.equal(text(p), '@keyframes x {to {x:y}}正文'); assert.match(p.attrs.style, /color:green/)
})
test('CSS structural text survives actual sandbox click and attr updates', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  const rt = createRuntime(visualHtml)
  try {
    rt.run(); assert.deepEqual(rt.errors, []); assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid), true)
    const r = renderHtmlDomTree(rt.document, { styles: parseHtmlDocument(visualHtml).styles })
    assert.equal(text(find(r.nodes, 'dynamic')), '{更新完成}')
    assert.equal(text(find(r.nodes, 'result')), '点击已生效'); assert.deepEqual(rt.errors, [])
  } finally { rt.destroy() }
})
test('CSS scanners handle long strings and deep groups without recursive stack failure within a 5s process', () => {
  const { execFileSync } = require('node:child_process'), root = path.join(__dirname, '..')
  const code = `const a=require('assert/strict'),s=require('./miniprogram/file-reader/document/css-structure'),h=require('./miniprogram/file-reader/document/html-compat')._internals;const body='p{content:"'+'{;}/*literal*/'.repeat(30000)+'";color:green}';a.equal(Array.from(s.cssRules(body)).length,1);const css='@media (min-width:1px){'.repeat(600)+body+'}'.repeat(600);a.match(h.flattenResponsiveCss(css,390),/color:green/);a.equal(Array.from(s.cssRules('p{content:"unterminated')).length,1)`
  execFileSync(process.execPath, ['-e', code], { cwd: root, timeout: 5000 })
})
