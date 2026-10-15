'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { renderHtmlDomTree, selectorSpecificity } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { preprocessCss, parseTextContent } = require('../miniprogram/file-reader/document/css-escapes')
const { cases, selectors, caseHtml, visualHtml } = require('./helpers/css-escapes')
const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')

test('CSS generated content: invalid escapes preserve body and use standard replacement characters', () => {
  for (const item of cases) {
    const r = renderHtmlDomTree(caseHtml(item)), p = r.nodes.find(n => n.name === 'p')
    assert.ok(p, item.name)
    const before = p.children.find(n => n.attrs && n.attrs.class === 'hr-pseudo-before')
    assert.equal(before ? text(before) : null, item.expected, item.name)
    assert.ok(text(p).endsWith('正文必须保留'), item.name)
  }
})

test('CSS escaped selector values reach actual DOM targets without treating escapes as combinators', () => {
  for (const item of selectors) {
    const { document: d } = parseHtmlDocument('<p>正文</p>'), p = d.querySelector('p')
    p.id = item.id
    assert.equal(d.querySelector(item.selector), p, item.selector)
  }
  const d = parseHtmlDocument('<div class="A B">NBSP class</div>').document
  assert.ok(d.querySelector('.\\41 B'))
})

test('CSS escaped class/id names keep their specificity and applied rendering style', () => {
  assert.equal(selectorSpecificity('.\\41 B'), 100)
  assert.equal(selectorSpecificity('#a\\.b'), 10000)
  for (const selector of ['#\\41 B', '#\\000041B']) {
    const r = renderHtmlDomTree(`<style>${selector}{font-weight:bold}p{font-weight:normal}</style><p id="AB">正文</p>`)
    assert.match(r.nodes[0].attrs.style, /font-weight:bold/)
  }
})

test('generated pseudo content remains inline unless the author explicitly makes it block', () => {
  for (const block of [false, true]) {
    const r = renderHtmlDomTree(`<style>p::before{content:"前";${block ? 'display:block' : ''}}</style><p>正文</p>`)
    const before = r.nodes[0].children[0]
    assert.match(before.attrs.style, /^display:inline;/)
    if (block) assert.match(before.attrs.style, /display:block$/)
    assert.equal(text(r.nodes[0]), '前正文')
  }
})

test('CSS preprocessing, C1 distinction, string continuation, EOF and literal attr boundaries', () => {
  assert.equal(preprocessCss('\r\n\r\f\0\ud800🐰\udc00'), '\n\n\n��🐰�')
  assert.equal(parseTextContent('"\\80"'), '\u0080') // Not HTML's euro mapping.
  assert.equal(parseTextContent('"foo\\'), 'foo')
  assert.equal(parseTextContent('"a" attr(x) "b"', () => '\\110000'), 'a\\110000b')
  assert.equal(parseTextContent('"attr(x)"', () => 'wrong'), 'attr(x)')
})

test('public WPT input-preprocessing expectations match escaped selector targets', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
  const root = path.join(__dirname, 'fixtures/css-escapes')
  for (const [file, sha] of Object.entries({
    'input-preprocessing.html': '8792806053c83b90517e2c4b64fec98ba8b6146e15f19e1fa1078694aace6aa0',
    'escaped-eof.html': 'dec0d40911d7247999dbb2866c5a58b7a884198285dd766bf55d5ce468c8cff2',
    'LICENSE.md': '5fac07febb0e2a97fb0d7b0def149ec08b642e1ba4b9c345283ab1cbd2af6570'
  })) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), sha, file)
  const bytes = fs.readFileSync(path.join(root, 'input-preprocessing.html'))
  const pairs = [...bytes.toString().matchAll(/testParsing\(("[^"\n]*"), ("[^"\n]*")\)/g)]
  assert.equal(pairs.length, 10)
  const fromLiteral = s => JSON.parse(s.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'))
  for (const [, rawInput, rawExpected] of pairs) {
    const input = fromLiteral(rawInput), expected = fromLiteral(rawExpected)
    const d = parseHtmlDocument('<body></body>').document, p = d.createElement(expected)
    p.textContent = '正文'; d.body.appendChild(p)
    const r = renderHtmlDomTree(d, { styles: [input + '{font-weight:bold}'] })
    assert.match(r.nodes[0].attrs.style, /font-weight:bold/)
    assert.equal(preprocessCss(input), expected)
  }
})

test('CSS escape failures cannot prevent actual sandbox button and generated attr updates', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  const rt = createRuntime(visualHtml)
  try {
    rt.run(); assert.deepEqual(rt.errors, [])
    assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid), true)
    const r = renderHtmlDomTree(rt.document, { styles: parseHtmlDocument(visualHtml).styles })
    assert.match(r.nodes.map(text).join(''), /属性原文：更新完成/)
    assert.equal(rt.document.getElementById('result').textContent, '点击已生效')
    assert.deepEqual(rt.errors, [])
  } finally { rt.destroy() }
})

test('long CSS escape streams finish in a bounded child process without losing trailing text', () => {
  const { execFileSync } = require('node:child_process')
  const target = require.resolve('../miniprogram/file-reader/document/css-escapes')
  const p = `const a=require('assert/strict'),d=require(${JSON.stringify(target)}).parseTextContent;const n=60000;a.equal(d('"'+'\\\\110000 '.repeat(n)+'END"'),'�'.repeat(n)+'END')`
  execFileSync(process.execPath, ['-e', p], { timeout: 5000 })
})
