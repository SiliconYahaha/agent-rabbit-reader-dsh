import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')

const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const fixture = `<!doctype html><html><head><title>Raw </head> boundary</title><style>
  i + b{color:rgb(1,2,3)} i ~ strong{color:rgb(4,5,6)}
  .author{color:rgb(7,8,9)} .label::before{content:attr(data-label)}
  input:checked{outline-width:7px} i:last-of-type{letter-spacing:3px}
  #raw-boundary::before{content:"</head>"}
</style></head><body bgcolor="#abcdef">
  <i></i><b id="adjacent">x</b><strong id="general">y</strong>
  <font id="hint" color="red">h</font><font id="author" class="author" color="red">a</font>
  <span id="label" class="label" data-label="rabbit"></span>
  <input id="checked" type="checkbox" checked><div><i id="last"></i></div>
  <table id="table"><tr><td>x</td></tr></table>
  <textarea id="raw-text">&lt;ok&gt; </body> remains text</textarea><p id="after-raw">AFTER</p>
  <span id="raw-boundary"></span>
  <div id="result"></div><script>
  const fakeBodyEnd="</body>";
  const css=id=>getComputedStyle(document.getElementById(id));
  const result={adjacent:css('adjacent').color,general:css('general').color,hint:css('hint').color,author:css('author').color,pseudo:getComputedStyle(document.getElementById('label'),'::before').content,checked:css('checked').outlineWidth,last:css('last').letterSpacing,tbody:document.querySelectorAll('#table>tbody').length,body:css(document.body.id||'result').backgroundColor,title:document.title,rawText:document.getElementById('raw-text').value,afterRaw:document.getElementById('after-raw').textContent};
  document.getElementById('result').setAttribute('data-oracle',btoa(JSON.stringify(result)));
  </script></body></html>`

const dumped = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', `data:text/html;charset=utf-8,${encodeURIComponent(fixture)}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const encoded = (dumped.match(/data-oracle="([^"]+)"/) || [])[1]
assert.ok(encoded, 'Chrome oracle did not return results')
const oracle = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))

const rendered = renderHtmlDomTree(fixture, { viewportWidth: 390 })
const all = []
const visit = nodes => (nodes || []).forEach(node => { all.push(node); visit(node.children) })
visit(rendered.nodes)
const style = id => (all.find(node => node.attrs && node.attrs.id === id)?.attrs.style || '').replace(/\s+/g, '')

assert.equal(oracle.adjacent, 'rgb(1, 2, 3)'); assert.match(style('adjacent'), /color:rgb\(1,2,3\)/)
assert.equal(oracle.general, 'rgb(4, 5, 6)'); assert.match(style('general'), /color:rgb\(4,5,6\)/)
assert.equal(oracle.hint, 'rgb(255, 0, 0)'); assert.match(style('hint'), /color:red/)
assert.equal(oracle.author, 'rgb(7, 8, 9)'); assert.match(style('author'), /color:rgb\(7,8,9\)/)
assert.equal(oracle.pseudo, '"rabbit"'); assert.match(JSON.stringify(all.find(node => node.attrs?.id === 'label')), /rabbit/)
assert.equal(oracle.checked, '7px'); assert.match(style('checked'), /outline-width:7px/)
assert.equal(oracle.last, '3px'); assert.match(style('last'), /letter-spacing:3px/)
assert.equal(oracle.tbody, 1); assert.equal(rendered.document.querySelectorAll('#table > tbody').length, 1)
assert.equal(oracle.title, 'Raw </head> boundary'); assert.equal(rendered.document.title, oracle.title)
assert.equal(oracle.rawText, '<ok> </body> remains text'); assert.equal(rendered.document.getElementById('raw-text').value, oracle.rawText)
assert.equal(oracle.afterRaw, 'AFTER'); assert.equal(rendered.document.getElementById('after-raw').textContent, oracle.afterRaw)

console.log('Chrome oracle passed: 11 browser/reader semantic comparisons')
