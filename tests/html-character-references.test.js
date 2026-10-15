'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')

// Independent Chrome textContent results, verified on the v1.4.49 baseline.
// All eight originally failed on v1.4.49; retain the original inputs.
for (const [name, source, expected] of [
  ['outside Unicode range', '&#x110000;', '\ufffd'],
  ['null reference', '&#0;', '\ufffd'],
  ['C1 reference mapping', '&#128;', '\u20ac'],
  ['surrogate reference', '&#xD800;', '\ufffd'],
  ['named and multi-codepoint references', '&copy; &euro; &NotEqualTilde;', '\u00a9 \u20ac \u2242\u0338']
]) {
  test(`HTML character references preserve browser content: ${name}`, () => {
    const parsed = parseHtmlDocument(`<p id="content">${source}</p>`)
    assert.equal(parsed.document.getElementById('content').textContent, expected)
  })
}

test('out-of-range attribute reference does not abort the document body', () => {
  const parsed = parseHtmlDocument('<p id="content" title="&#x110000;">正文</p>')
  assert.equal(parsed.document.getElementById('content').getAttribute('title'), '\ufffd')
  assert.equal(parsed.document.body.textContent, '正文')
})

test('out-of-range textarea reference does not abort the form', () => {
  const parsed = parseHtmlDocument('<textarea id="content">&#x110000;</textarea>')
  assert.equal(parsed.document.getElementById('content').textContent, '\ufffd')
})

test('out-of-range title reference does not abort the document', () => {
  const parsed = parseHtmlDocument('<title>&#x110000;</title><p>正文</p>')
  assert.equal(parsed.title, '\ufffd')
  assert.equal(parsed.document.body.textContent, '正文')
})

for (const file of ['entities.test', 'namedEntities.test', 'numericEntities.test']) {
  test(`public html5lib corpus: ${file}, actual DOM text and attributes`, () => {
    const fs = require('node:fs'), path = require('node:path')
    const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/html-entities', file))).tests
    for (const item of cases) {
      const { document } = parseHtmlDocument(`<body>${item.input}</body>`)
      for (const token of item.output) {
        if (token[0] === 'Character') assert.equal(document.body.textContent, token[1], item.description)
        else if (token[0] === 'StartTag') {
          const el = document.body.querySelector(token[1]); assert.ok(el, item.description)
          for (const [key, value] of Object.entries(token[2])) assert.equal(el.getAttribute(key), value, item.description)
        } else assert.fail(`unhandled public expectation: ${token[0]}`)
      }
    }
  })
}

test('WHATWG complete named table preserves longest match and attribute ambiguity across 2231 names', () => {
  const source = require('./fixtures/html-entities/entities.json')
  const { decodeCharacterReferences: decode } = require('../miniprogram/file-reader/document/html-character-references')
  assert.equal(Object.keys(source).length, 2231)
  for (const [name, item] of Object.entries(source)) {
    assert.equal(decode(name), item.characters, name)
    assert.equal(decode(name, true), item.characters, `attribute ${name}`)
    if (!name.endsWith(';')) for (const suffix of ['=', 'a', '0']) {
      assert.equal(decode(name + suffix, true), name + suffix, `${name}${suffix}`)
    }
  }
  assert.equal(decode('&amp;copy; &amP; &notit; &notin;'), '&copy; &amP; ¬it; ∉')
  assert.equal(decode('&amp;copy; &amP; &notit; &notin;', true), '&copy; &amP; &notit; ∉')
})

test('innerHTML respects RCDATA and RAWTEXT contexts, textContent and setAttribute remain literal', () => {
  const { document } = parseHtmlDocument('<body><textarea id="t"></textarea><div id="d"></div></body>')
  for (const tag of ['textarea', 'title', 'script', 'style']) {
    const el = document.createElement(tag)
    el.innerHTML = '&copy;<b>x</b>&#x110000;'
    assert.equal(el.textContent, /^(script|style)$/.test(tag) ? '&copy;<b>x</b>&#x110000;' : '©<b>x</b>�', tag)
    assert.equal(el.children.length, 0)
  }
  const el = document.getElementById('d')
  el.textContent = '&copy;'; assert.equal(el.textContent, '&copy;')
  el.setAttribute('title', '&copy;'); assert.equal(el.getAttribute('title'), '&copy;')
  el.innerHTML = '&copy; &amp;copy;'; assert.equal(el.textContent, '© &copy;')
  assert.equal(parseHtmlDocument('<title>&nbsp; A <b>B</b> &amp; C &nbsp;</title><p>x</p>').title, '\u00a0 A <b>B</b> & C \u00a0')
})

test('long numeric and unknown named references are bounded and keep trailing content', () => {
  const { execFileSync } = require('node:child_process')
  const modulePath = require.resolve('../miniprogram/file-reader/document/html-character-references')
  const program = `const a=require('assert/strict'),d=require(${JSON.stringify(modulePath)}).decodeCharacterReferences;const n='9'.repeat(512*1024);a.equal(d('A&#'+n+';B'),'A�B');const unknown='&z'+'z'.repeat(512*1024)+';';a.equal(d(unknown),unknown);a.equal(d('&'.repeat(20000)+'&#000065;'),'&'.repeat(20000)+'A');console.log('bounded-ok')`
  assert.match(execFileSync(process.execPath, ['-e', program], { encoding: 'utf8', timeout: 5000 }), /bounded-ok/)
})

test('actual static mp-html parser uses the same decoder, without recursive amp decoding', () => {
  global.wx = { canIUse: () => true, getWindowInfo: () => ({ windowWidth: 390 }), getDeviceInfo: () => ({ system: 'iOS' }) }
  const Parser = require('../miniprogram/file-reader/document/components/mp-html/parser')
  const { transformHtml } = require('../miniprogram/file-reader/document/html-compat')
  const parser = new Parser({ data: { useAnchor: true }, imgList: [], plugins: [] })
  const nodes = parser.parse(transformHtml('<p>&copy; &euro; &NotEqualTilde; &amp;copy; &#x110000;</p>').html)
  const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')
  assert.equal(nodes.map(text).join(''), '© € ≂̸ &copy; �')
})

test('decoded HTML entities cannot bypass URL filtering or create markup', () => {
  const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
  const { transformHtml } = require('../miniprogram/file-reader/document/html-compat')
  for (const href of ['javascript&colon;alert(1)', 'java&Tab;script:alert(1)', 'java&#115cript:alert(1)', 'javascript&#58alert(1)']) {
    const html = `<a href="${href}">safe</a>`
    const r = renderHtmlDomTree(html)
    assert.equal(r.nodes[0].attrs.href || '', '', href)
    assert.doesNotMatch(transformHtml(html).html, /href\s*=/i, href)
  }
  const d = parseHtmlDocument('<p>&lt;script&gt;bad()&lt;/script&gt;</p>').document
  assert.equal(d.querySelectorAll('script').length, 0)
  assert.equal(d.body.textContent, '<script>bad()</script>')
})

test('text inputs sanitize decoded and assigned line breaks without changing attributes or textarea', () => {
  for (const type of ['text', 'search', 'tel', 'password']) {
    const { document } = parseHtmlDocument(`<input type="${type}" value="A&NewLine;B&#13;C">`)
    const input = document.querySelector('input')
    assert.equal(input.getAttribute('value'), 'A\nB\rC')
    assert.equal(input.value, 'ABC')
    input.value = 'D\r\nE'; assert.equal(input.value, 'DE')
    assert.equal(input.getAttribute('value'), 'A\nB\rC')
  }
  assert.equal(parseHtmlDocument('<textarea>A&NewLine;B</textarea>').document.querySelector('textarea').value, 'A\nB')
})

test('static fallback form values decode exactly once', () => {
  const { transformHtml } = require('../miniprogram/file-reader/document/html-compat')
  const { document } = parseHtmlDocument(transformHtml('<input value="&copy; &amp;copy; &#x110000;">').html)
  assert.match(document.body.textContent, /© &copy; �/)
})

test('actual sandbox click updates decoded body and textarea without executing literal markup', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  const { visualHtml } = require('./helpers/html-entities')
  const runtime = createRuntime(visualHtml)
  try {
    runtime.run()
    assert.equal(runtime.document.getElementById('value').value, '© € �')
    assert.equal(runtime.dispatchTap(runtime.document.getElementById('entity-update')._nid), true)
    assert.equal(runtime.document.getElementById('updated').textContent, '© € � &copy;')
    assert.equal(runtime.document.getElementById('area').value, '€ <b>原样标签</b> �')
    assert.equal(runtime.document.getElementById('area').children.length, 0)
    assert.deepEqual(runtime.errors, [])
  } finally { runtime.destroy() }
})
