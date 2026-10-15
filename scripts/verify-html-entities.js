'use strict'

const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { sources, contexts, contextCase, visualHtml } = require('../tests/helpers/html-entities')
const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'html-reader-entities-'))
const cases = []
for (const name of ['entities.test', 'namedEntities.test', 'numericEntities.test']) {
  const tests = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/html-entities', name))).tests
  for (const t of tests) {
    const start = t.output.find(o => o[0] === 'StartTag')
    if (start) for (const attr of Object.keys(start[2])) cases.push({ label: `${name}: ${t.description}`, html: `<body>${t.input}</body>`, selector: start[1], field: 'attribute', attribute: attr })
    else cases.push({ label: `${name}: ${t.description}`, html: `<body>${t.input}</body>`, selector: 'body', field: 'text' })
  }
}
for (const source of sources) for (const context of contexts) cases.push(contextCase(source, context))
for (const source of Object.keys(require('../tests/fixtures/html-entities/entities.json'))) cases.push(contextCase(source + '=x', 'attribute'))
function valueFor (document, item) {
  let element
  if (item.create) { element = document.createElement(item.create); document.body.appendChild(element); element.innerHTML = item.innerHTML } else element = document.querySelector(item.selector)
  if (item.field === 'title') return document.title
  if (!element) throw Error(`missing ${item.selector}`)
  return item.field === 'attribute' ? element.getAttribute(item.attribute) : item.field === 'value' ? element.value : element.textContent
}
const reader = cases.map(item => { try { return { value: valueFor(parseHtmlDocument(item.html).document, item) } } catch (e) { return { error: e.message } } })
const payload = JSON.stringify(cases).replace(/</g, '\\u003c')
const file = path.join(output, 'oracle.html')
// Use the full document parser. Chrome's DOMParser fast path gives different
// &notit;/&#x; results for unwrapped fragments; a real loaded page does not.
fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><output id="result"></output><iframe sandbox="allow-same-origin"></iframe><script>const valueFor=${valueFor.toString()};const frame=document.querySelector('iframe');const rows=${payload}.map(item=>{try{const d=frame.contentDocument;d.open();d.write(item.html);d.close();const value=valueFor(d,item);let fragmentControl;if(item.create==='div'){const range=d.createRange();range.selectNodeContents(d.body);fragmentControl=range.createContextualFragment(item.innerHTML).textContent}return {value,fragmentControl}}catch(e){return {error:e.message}}});frame.remove();document.getElementById('result').setAttribute('data-results',encodeURIComponent(JSON.stringify(rows)))</script>`, { flag: 'wx' })
fs.writeFileSync(path.join(output, 'visual.html'), visualHtml, { flag: 'wx' })
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dumped = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dumped.match(/data-results="([^"]+)"/)
assert.ok(match, 'Chrome did not return independent DOM results')
const browser = JSON.parse(decodeURIComponent(match[1]))
assert.equal(browser.length, cases.length)
const mismatches = cases.flatMap((item, i) => reader[i].error || browser[i].error || reader[i].value !== browser[i].value ? [{ ...item, reader: reader[i], browser: browser[i] }] : [])
// Do not copy a browser fast-path bug into the decoder. This exact invalid
// reference is independently preserved by Chrome's full and Range parsers and
// html5lib/WHATWG. Keep the discrepancy visible; no wildcard tolerance.
const isBrowserDeviation = r => r.label === 'innerHTML: &#x;' && r.reader.value === '&#x;' && r.browser.value === '�' && r.browser.fragmentControl === '&#x;'
const browserDeviations = mismatches.filter(isBrowserDeviation)
const differences = mismatches.filter(r => !isBrowserDeviation(r))
const result = { checked: cases.length, publicFiles: 3, publicCases: 4626, browserDeviations, differences }
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ checked: cases.length, differences: differences.length, browserDeviations, first: differences.slice(0, 12) }, null, 2))
assert.equal(differences.length, 0, 'actual DOM content differs from Chrome')
