'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')
const { cases, caseMarkup, visualHtml } = require('../tests/helpers/html-whitespace')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')

const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'html-reader-whitespace-'))
assert.ok(fs.statSync(output).isDirectory(), 'provide a dedicated existing output directory')
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function readerHtml (html) {
  const parsed = parseHtmlDocument(html), runtime = createRuntime(html)
  try {
    runtime.run(); assert.deepEqual(runtime.errors, [])
    const r = renderHtmlDomTree(runtime.document, { styles: parsed.styles, viewportWidth: 390 })
    const serialize = node => node.type === 'text' ? `<span>${escape(node.text).replace(/\r/g, '&#13;')}</span>` : `<${node.name} ${Object.entries(node.attrs || {}).filter(([k]) => !k.startsWith('data-hr-')).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(node.children || []).map(serialize).join('')}</${node.name}>`
    return `<!doctype html><meta charset="utf-8"><body style="${escape(r.wrapperStyle)}">${r.nodes.map(serialize).join('')}</body>`
  } finally { runtime.destroy() }
}
// Explicit author margin avoids comparing Chrome's 8px UA body margin with the
// reader's documented edge-to-edge shell; no measured differences are waived.
const fixtures = [{ name: '137 generated content variants', html: `<!doctype html><meta charset="utf-8"><body style="margin:0">${cases.map(caseMarkup).join('')}</body>`, selectors: cases.map(item => `#case-${item.id}`) }, { name: 'visible article and interaction fixture', html: visualHtml, selectors: ['#blank', '#nbsp', '#wide', '#split', '#normal', '#dynamic'] }]
const publicRoot = process.argv[3] && path.resolve(process.argv[3])
if (publicRoot) {
  const samples = [
    ['pre-line-051.html', 'a315c16e8806b683048cb96e09591b4aab3624c361e0f85caec0bee6b2e099a0', ['div']],
    ['pre-line-052.html', 'de990872c427fde94708ce3851b678b0f14c3b5d1f480ab7024d420aa91b881e', ['div']],
    ['pre-line-with-space-and-newline.html', '95e243fee4bf8570d6ef09406e63788db9bf5a193ad2ceacac77a3003566d965', ['.static.together > span', '.static.separated > span', '.dynamic.together > span', '.dynamic.separated > span']]
  ]
  for (const [name, sha, selectors] of samples) {
    const bytes = fs.readFileSync(path.join(publicRoot, 'css/css-text/white-space', name))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha)
    fixtures.push({ name, html: bytes.toString('utf8'), selectors })
  }
}
const font = publicRoot ? `<style>@font-face{font-family:Ahem;src:url(data:font/ttf;base64,${fs.readFileSync(path.join(publicRoot, 'fonts/Ahem.ttf')).toString('base64')})}</style>` : ''
const controls = fixtures.map(f => ({ name: f.name, selectors: f.selectors }))
const body = fixtures.map((f, i) => `<h2>${escape(f.name)}</h2><div class="pair"><iframe id="original-${i}" srcdoc="${escape(font + f.html)}"></iframe><iframe id="reader-${i}" srcdoc="${escape(font + readerHtml(f.html))}"></iframe></div>`).join('')
const html = `<!doctype html><meta charset="utf-8"><title>HTML 空白字符独立对照</title><style>body{font:16px sans-serif;background:#eee}.pair{display:flex;gap:16px}iframe{width:390px;flex:none;height:600px;background:white;border:1px solid #777}</style><h1>左：Chrome原件　右：阅读器文本节点与样式</h1>${body}<output id="result"></output><script>
window.addEventListener('load',async()=>{try{const groups=${JSON.stringify(controls)};const results=[];for(let i=0;i<groups.length;i++){const a=document.getElementById('original-'+i).contentDocument,b=document.getElementById('reader-'+i).contentDocument;await Promise.all([a.fonts.ready,b.fonts.ready]);for(const selector of groups[i].selectors){const x=a.querySelector(selector),y=b.querySelector(selector);if(!x||!y)throw Error('missing '+selector);const ra=x.getBoundingClientRect(),rb=y.getBoundingClientRect();results.push({file:groups[i].name,selector,original:x.innerText,reader:y.innerText,originalBox:[ra.width,ra.height],readerBox:[rb.width,rb.height]});}}document.getElementById('result').setAttribute('data-results',encodeURIComponent(JSON.stringify(results)));}catch(e){document.getElementById('result').setAttribute('data-error',e.message)}});
</script>`
const target = path.join(output, 'comparison.html')
fs.writeFileSync(target, html, { flag: 'wx' })
fs.writeFileSync(path.join(output, 'visual.html'), visualHtml, { flag: 'wx' })
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dumped = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(target).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const encoded = dumped.match(/data-results="([^"]+)"/)
assert.ok(encoded, 'Chrome did not return results: ' + (dumped.match(/data-error="([^"]+)"/)?.[1] || 'timeout'))
const results = JSON.parse(decodeURIComponent(encoded[1]))
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2), { flag: 'wx' })
const failures = results.filter(r => r.original !== r.reader || r.originalBox.some((value, index) => Math.abs(value - r.readerBox[index]) > 0.1))
console.log(JSON.stringify({ checked: results.length, failureCount: failures.length, failures: failures.slice(0, 10), publicFiles: publicRoot ? 3 : 0 }, null, 2))
assert.equal(failures.length, 0, 'actual content/layout differs; inspect result.json, do not waive failed samples')
