'use strict'

const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { cases, selectors, caseHtml, visualHtml } = require('../tests/helpers/css-escapes')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const output = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'html-reader-css-escapes-'))
const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')
const inputs = cases.map(item => ({ ...item, html: caseHtml(item) }))
const reader = inputs.map(item => {
  try {
    const r = renderHtmlDomTree(item.html), p = r.nodes.find(n => n.name === 'p')
    const before = p.children.find(n => n.attrs && n.attrs.class === 'hr-pseudo-before')
    return { value: before ? text(before) : null, body: text(p).endsWith('正文必须保留') }
  } catch (e) { return { error: e.message } }
})
const publicBytes = fs.readFileSync(path.join(__dirname, '../tests/fixtures/css-escapes/input-preprocessing.html'), 'utf8')
const pairs = [...publicBytes.matchAll(/testParsing\(("[^"\n]*"), ("[^"\n]*")\)/g)]
const fromLiteral = s => JSON.parse(s.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'))
const queries = selectors.concat([{ selector: '.\\41 B', id: 'class-target', className: 'A B' }])
// Preserve the public test's type-selector context. Prefixing raw input with #
// changes it into a hash token and is not the original WPT assertion.
const publicCases = pairs.map(([, x, y]) => ({ input: fromLiteral(x), expected: fromLiteral(y) }))
const publicReader = publicCases.map(item => {
  const d = parseHtmlDocument('<body></body>').document, p = d.createElement(item.expected)
  p.textContent = '正文'; d.body.appendChild(p)
  const r = renderHtmlDomTree(d, { styles: [item.input + '{font-weight:bold}'] })
  return /font-weight:bold/.test(r.nodes[0].attrs.style)
})
const matched = queries.map(item => {
  const d = parseHtmlDocument('<p>正文</p>').document, p = d.querySelector('p')
  p.id = item.id; if (item.className) p.className = item.className
  try { return d.querySelector(item.selector) === p } catch (e) { return e.message }
})
const payload = JSON.stringify({ inputs, queries, publicCases, visualHtml }).replace(/</g, '\\u003c')
const file = path.join(output, 'oracle.html')
// Only deserialize Chrome's canonical, valid CSSOM string tokens here. This is
// not the reader decoder and is never run on the input CSS or invalid escapes.
const browserRunner = function (data) {
  const frame = document.querySelector('iframe'), d = frame.contentDocument
  function cssomText (value) {
    if (value === 'none' || value === 'normal') return null
    const strings = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    const remainder = value.replace(/"((?:[^"\\]|\\.)*)"/g, '').trim()
    if (remainder || !strings.length) throw Error('Unexpected CSSOM serialization: ' + value)
    return strings.map(s => s[1].replace(/\\([0-9a-f]{1,6})[\t\n ]?|\\(.)/gi, (_, hex, literal) => hex ? String.fromCodePoint(parseInt(hex, 16)) : literal)).join('')
  }
  const content = data.inputs.map(item => {
    try {
      d.open(); d.write(item.html); d.close()
      const p = d.getElementById('probe'), serialized = frame.contentWindow.getComputedStyle(p, '::before').content
      return { value: cssomText(serialized), serialized, body: p.textContent === '正文必须保留' }
    } catch (e) { return { error: e.message } }
  })
  const queries = data.queries.map(item => {
    d.open(); d.write('<p>正文</p>'); d.close()
    const p = d.querySelector('p'); p.id = item.id; if (item.className) p.className = item.className
    try { return d.querySelector(item.selector) === p } catch (e) { return e.message }
  })
  const publicResults = data.publicCases.map(item => {
    d.open(); d.write('<body></body>'); d.close()
    const style = d.createElement('style'); style.textContent = 'original-ident{font-weight:bold}'; d.head.appendChild(style)
    const rule = style.sheet.cssRules[0]; rule.selectorText = item.input
    const p = d.createElement(item.expected); p.textContent = '正文'; d.body.appendChild(p)
    return { selector: rule.selectorText, applied: frame.contentWindow.getComputedStyle(p).fontWeight === '700' }
  })
  // Keep the discovered raw-NUL hash-token differences visible, outside the
  // type-selector WPT pass count. No claim of complete CSS selector conformance.
  const rawNulHashDiagnostics = ['#\0foo', '#\0', '#\0\0\0'].map(selector => {
    try { d.querySelector(selector); return { selector, error: '' } } catch (e) { return { selector, error: e.name } }
  })
  d.open(); d.write(data.visualHtml); d.close()
  const layout = ['bad', 'spaces', 'literal', 'AB'].map(id => {
    const p = d.getElementById(id)
    return { id, height: p.getBoundingClientRect().height, fontWeight: frame.contentWindow.getComputedStyle(p).fontWeight }
  })
  document.getElementById('result').setAttribute('data-results', encodeURIComponent(JSON.stringify({ content, queries, publicResults, rawNulHashDiagnostics, layout })))
}
fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><output id="result"></output><iframe style="width:390px;height:844px;border:0" sandbox="allow-same-origin"></iframe><script>(${browserRunner.toString()})(${payload})</script>`, { flag: 'wx' })
fs.writeFileSync(path.join(output, 'visual.html'), visualHtml, { flag: 'wx' })
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dumped = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const encoded = dumped.match(/data-results="([^"]+)"/)
assert.ok(encoded, 'Chrome did not return independent results')
const browser = JSON.parse(decodeURIComponent(encoded[1])), failures = []
assert.equal(browser.content.length, inputs.length); assert.equal(browser.queries.length, queries.length)
inputs.forEach((item, i) => {
  if (reader[i].error || browser.content[i].error || reader[i].value !== item.expected || browser.content[i].value !== item.expected || !reader[i].body || !browser.content[i].body) failures.push({ input: item.css, expected: item.expected, reader: reader[i], browser: browser.content[i] })
})
queries.forEach((q, i) => { if (matched[i] !== true || browser.queries[i] !== true) failures.push({ query: q, reader: matched[i], browser: browser.queries[i] }) })
assert.equal(browser.publicResults.length, publicCases.length)
publicCases.forEach((item, i) => { if (!publicReader[i] || browser.publicResults[i].selector !== item.expected || !browser.publicResults[i].applied) failures.push({ publicCase: item, reader: publicReader[i], browser: browser.publicResults[i] }) })
assert.equal(browser.layout.length, 4)
browser.layout.forEach(item => { if (item.height !== 32 || item.id === 'AB' && item.fontWeight !== '700') failures.push({ layout: item }) })
const result = { checked: inputs.length + queries.length + publicCases.length, contentCases: inputs.length, selectorCases: queries.length, publicTypeSelectors: publicCases.length, failures, browser }
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ checked: result.checked, failureCount: failures.length, failures }, null, 2))
assert.equal(failures.length, 0, 'CSS actual generated content / selector targets differ from Chrome')
