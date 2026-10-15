'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), http = require('node:http')
const { cases, selectors, caseHtml, visualHtml } = require('../tests/helpers/css-structure')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-css-structure-'))
const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')
const find = (ns, test) => { for (const n of ns) { if (test(n)) return n; const child = find(n.children || [], test); if (child) return child } }
const inputs = cases.map(item => ({ ...item, html: caseHtml(item) }))
const reader = inputs.map(item => {
  const r = renderHtmlDomTree(item.html), p = find(r.nodes, n => n.attrs && n.attrs.id === 'probe')
  return { text: text(p), after: text(find(r.nodes, n => n.attrs && n.attrs.id === 'after')) }
})
const selectorReader = selectors.map(item => {
  const d = parseHtmlDocument('<p>正文</p>').document, p = d.querySelector('p'); p.id = item.id
  return { matched: d.querySelector(item.selector) === p, bold: /font-weight:bold/.test(renderHtmlDomTree(d, { styles: [item.selector + '{font-weight:bold}'] }).nodes[0].attrs.style) }
})
const publicNames = ['blocks-and-strings-001.xht', 'comments-001.xht', 'escaped-ident-spaces-001.xht']
const publicFiles = publicNames.map(name => ({ name, html: fs.readFileSync(path.join(__dirname, '../tests/fixtures/css-structure', name), 'utf8') }))
const publicReader = publicFiles.map(item => {
  const d = find(renderHtmlDomTree(item.html).nodes, n => n.name === 'div')
  return { text: text(d), green: /(?:^|;)color:green(?:;|$)/.test(d.attrs.style) }
})
const runner = async function (data) {
  const frame = document.querySelector('iframe'), d = frame.contentDocument
  function decode (s) {
    if (s === 'none' || s === 'normal') return ''
    const strings = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    if (!strings.length || s.replace(/"((?:[^"\\]|\\.)*)"/g, '').trim()) throw Error('Unexpected canonical CSSOM: ' + s)
    return strings.map(x => x[1].replace(/\\([0-9a-f]{1,6})[\t\n ]?|\\(.)/gi, (_, h, c) => h ? String.fromCodePoint(parseInt(h, 16)) : c)).join('')
  }
  const content = data.inputs.map(item => {
    d.open(); d.write(item.html); d.close()
    const p = d.getElementById('probe'), raw = frame.contentWindow.getComputedStyle(p, '::before').content
    return { text: decode(raw) + p.textContent, after: d.getElementById('after').textContent, raw }
  })
  const selectors = data.selectors.map(item => {
    d.open(); d.write('<style></style><p>正文</p>'); d.close()
    const p = d.querySelector('p'); p.id = item.id; d.querySelector('style').textContent = item.selector + '{font-weight:bold}'
    return { matched: d.querySelector(item.selector) === p, bold: frame.contentWindow.getComputedStyle(p).fontWeight === '700' }
  })
  const publicResults = []
  for (const item of data.publicFiles) {
    const url = URL.createObjectURL(new Blob([item.html], { type: 'application/xhtml+xml' }))
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; frame.src = url })
    const doc = frame.contentDocument, div = doc.querySelector('div')
    publicResults.push({ name: item.name, mime: doc.contentType, text: div.textContent, green: frame.contentWindow.getComputedStyle(div).color === 'rgb(0, 128, 0)' })
    URL.revokeObjectURL(url)
  }
  document.getElementById('result').setAttribute('data-results', encodeURIComponent(JSON.stringify({ content, selectors, publicResults })))
}
const payload = JSON.stringify({ inputs, selectors, publicFiles }).replace(/</g, '\\u003c')
const file = path.join(out, 'oracle.html')
fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><output id="result"></output><iframe style="width:390px" sandbox="allow-same-origin"></iframe><script>(${runner.toString()})(${payload}).catch(e=>document.getElementById('result').textContent=e.stack)</script>`, { flag: 'wx' })
fs.writeFileSync(path.join(out, 'visual.html'), visualHtml, { flag: 'wx' })
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
async function verify () {
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(file)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let html
try {
  const r = await promisify(execFile)(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=5000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { encoding: 'utf8', timeout: 60000, maxBuffer: 3 * 1024 * 1024 })
  html = r.stdout
} finally { server.close() }
const encoded = html.match(/data-results="([^"]+)"/); assert.ok(encoded, 'No independent Chrome result: ' + html.slice(0, 1200))
const browser = JSON.parse(decodeURIComponent(encoded[1])), failures = []
assert.equal(browser.content.length, cases.length)
cases.forEach((c, i) => { if (reader[i].text !== c.expected + '正文' || browser.content[i].text !== c.expected + '正文' || reader[i].after !== '后续正文' || browser.content[i].after !== '后续正文') failures.push({ name: c.name, expected: c.expected, reader: reader[i], browser: browser.content[i] }) })
assert.equal(browser.selectors.length, selectors.length)
selectors.forEach((c, i) => { if (!selectorReader[i].matched || !selectorReader[i].bold || !browser.selectors[i].matched || !browser.selectors[i].bold) failures.push({ selector: c, reader: selectorReader[i], browser: browser.selectors[i] }) })
assert.equal(browser.publicResults.length, 3)
for (let i = 0; i < 3; i++) if (browser.publicResults[i].mime !== 'application/xhtml+xml' || !browser.publicResults[i].green || !publicReader[i].green || publicReader[i].text !== browser.publicResults[i].text) failures.push({ publicFile: publicNames[i], reader: publicReader[i], browser: browser.publicResults[i] })
const diagnostics = []
const result = { checked: cases.length + selectors.length + 3, failureCount: failures.length, failures, diagnostics, browser }
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ checked: result.checked, failureCount: failures.length, failures, diagnostics }, null, 2))
assert.equal(failures.length, 0, 'CSS structure differs from actual browser content/style')
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
