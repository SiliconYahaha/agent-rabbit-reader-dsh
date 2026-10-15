'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { cases } = require('../tests/fixtures/markdown-html-boundaries/cases.json')
const out = path.resolve(process.argv[2] || 'outputs/markdown-html-boundaries/browser')
fs.mkdirSync(out, { recursive: true })
const baseline = process.argv.indexOf('--baseline-ref')
if (baseline >= 0) for (const name of ['list-tokenizer', 'quote-tokenizer']) {
  const file = require.resolve('../miniprogram/file-reader/markdown/runtime/' + name), Module = require('node:module'), m = new Module(file, module)
  m.filename = file; m.paths = module.paths
  m._compile(execFileSync('git', ['show', process.argv[baseline + 1] + ':miniprogram/file-reader/markdown/runtime/' + name + '.js'], { encoding: 'utf8' }), file)
  require.cache[file] = m
}
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} data-reader-tag="${n.name}" ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function inspect (views) {
  const rows = []
  for (const view of views) {
    const row = { name: view.name }
    for (const key of ['actual', 'reference']) {
      const frame = document.createElement('iframe'); frame.style.cssText = 'width:390px;height:600px'; frame.setAttribute('sandbox', 'allow-same-origin'); document.body.append(frame)
      await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = '<body>' + view[key] + '</body>' })
      const d = frame.contentDocument, marks = [], walker = d.createTreeWalker(d.body, 4)
      let node
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('style,script')) continue
        for (const match of node.data.matchAll(/TAIL(?:_ONE|_TWO)?|lazy continuation/g)) {
          const parents = []
          for (let p = node.parentElement; p; p = p.parentElement) {
            const tag = p.getAttribute('data-reader-tag') || p.localName
            if (['blockquote','ul','ol','li','p','h1','h2'].includes(tag)) parents.push(tag)
          }
          const range = d.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length)
          const box = range.getBoundingClientRect()
          marks.push({ text: match[0], parents, visible: box.width > 0 && box.height > 0 })
        }
      }
      row[key] = { body: d.body.innerText.trim().replace(/\s+/g, ' '), marks, code: [...d.querySelectorAll('pre')].map(p => p.textContent) }
      frame.remove()
    }
    rows.push(row)
  }
  document.querySelector('output').setAttribute('data-report', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  const selected = cases.filter(c => c.oracleAgreement && (
    c.ending === 'immediate' && ['root','quote','quoteList'].includes(c.container) || c.ending === 'immediate' && c.keep === 1 ||
    c.source.includes('TAIL') && !c.beforeReaderHtml.includes('TAIL') || c.name.includes('/') || c.body === 'retained'
  ))
  let bytes
  const host = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const views = []
  try {
    for (const c of selected) {
      bytes = Buffer.from(c.source)
      host.openSelectedFile({ name: c.name + '.md', path: '/fixture/boundary.md', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '', c.name)
      const runtime = host._htmlRuntime
      const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
      views.push({ name: c.name, actual: tree.nodes.map(serialize).join(''), reference: c.referenceHtml })
    }
  } finally { host.disposeHtmlRuntime() }
  const file = path.join(out, 'views.html')
  fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><output></output><script>(' + inspect + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>')
  const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
  const dom = execFileSync(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=15000',pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore','pipe','ignore'] })
  const match = /data-report="([^"]+)"/.exec(dom); assert.ok(match, 'browser must complete all selected views')
  const rows = JSON.parse(decodeURIComponent(match[1])), failures = rows.filter(r => JSON.stringify(r.actual) !== JSON.stringify(r.reference))
  const report = { at: new Date().toISOString(), baseline: baseline >= 0 ? process.argv[baseline + 1] : null, cases: rows.length, failures, rows, scope: 'Actual Node reader rendered tree in Chrome: visible body, exact pre content, tail visibility and container ancestry. No WeChat WXML or physical-device claim.' }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const images = views.filter(v => ['div-blank-doubleQuote','lazy/---'].includes(v.name))
  fs.writeFileSync(path.join(out, 'comparison.html'), '<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:20px}.row{display:flex;gap:20px}iframe{width:420px;height:350px;border:1px solid #bbb}h2{font-size:18px}</style>' + images.map(v => '<h2>' + escape(v.name) + '</h2><div class="row"><div>Actual reader<iframe sandbox="allow-same-origin" srcdoc="' + escape(v.actual) + '"></iframe></div><div>Independent reference<iframe sandbox="allow-same-origin" srcdoc="' + escape(v.reference) + '"></iframe></div></div>').join(''))
  console.log(JSON.stringify({ cases: rows.length, failures: failures.map(r => r.name), report: path.join(out, 'report.json') }))
  if (baseline < 0) assert.deepEqual(failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 })
