'use strict'

// The original source and the reader's emitted styles are computed independently
// by Chrome. Expected values are plain CSS literals, never reader-decoded input.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict'), { execFile } = require('node:child_process'), { promisify } = require('node:util')
const { cases, htmlFor, visualHtml } = require('../tests/helpers/css-identifiers')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-css-identifiers-'))
const find = (ns, id) => { for (const n of ns) { if (n.attrs && n.attrs.id === id) return n; const child = find(n.children || [], id); if (child) return child } }
const inputs = cases.map(c => ({ ...c, html: htmlFor(c), readerStyle: find(renderHtmlDomTree(htmlFor(c)).nodes, 'probe').attrs.style }))
const rt = createRuntime(visualHtml), ids = ['escaped', 'variable', 'inline', 'result']
const snapshot = () => {
  const r = renderHtmlDomTree(rt.document, { styles: parseHtmlDocument(visualHtml).styles })
  return ids.map(id => ({ id, text: rt.document.getElementById(id).textContent, style: find(r.nodes, id).attrs.style, wrapperStyle: r.wrapperStyle }))
}
let interaction
try { rt.run(); const before = snapshot(); rt.dispatchTap(rt.document.getElementById('change')._nid); interaction = { before, after: snapshot(), errors: rt.errors.slice() } } finally { rt.destroy() }
const runner = function (data) {
  const frame = document.querySelector('iframe'), d = frame.contentDocument, computed = p => frame.contentWindow.getComputedStyle(p)
  const results = data.inputs.map(item => {
    d.open(); d.write(item.html); d.close()
    const p = d.getElementById('probe'), original = computed(p).getPropertyValue(item.property), originalText = p.textContent
    d.querySelectorAll('style').forEach(s => s.remove()); p.setAttribute('style', item.readerStyle)
    const reader = computed(p).getPropertyValue(item.property)
    p.setAttribute('style', item.property + ':' + item.expected)
    return { name: item.name, expected: computed(p).getPropertyValue(item.property), original, reader, originalText }
  })
  d.open(); d.write(data.visualHtml); d.close()
  // Sandbox disallows page scripts; install the same user operation explicitly
  // in the independent browser realm, without invoking reader implementation.
  const snap = () => data.ids.map(id => { const p = d.getElementById(id); return { id, text: p.textContent, color: computed(p).color } })
  const before = snap()
  d.documentElement.style.setProperty('--Brand', 'blue')
  d.getElementById('variable').textContent = '大小写变量：蓝色'
  d.getElementById('inline').style.setProperty('--Brand', 'blue')
  d.getElementById('inline').textContent = '行内变量：蓝色'
  d.getElementById('result').textContent = '点击已生效'
  const after = snap()
  d.querySelectorAll('style').forEach(s => s.remove())
  const readerSnapshot = list => { d.body.style.cssText = list[0].wrapperStyle; return list.map(item => { const p = d.getElementById(item.id); p.style.cssText = item.style; return { id: item.id, text: item.text, color: computed(p).color } }) }
  const readerBefore = readerSnapshot(data.interaction.before), readerAfter = readerSnapshot(data.interaction.after)
  document.getElementById('result').setAttribute('data-results', encodeURIComponent(JSON.stringify({ results, before, after, readerBefore, readerAfter })))
}
const payload = JSON.stringify({ inputs, visualHtml, ids, interaction }).replace(/</g, '\\u003c')
const html = `<!doctype html><meta charset="utf-8"><output id="result"></output><iframe sandbox="allow-same-origin"></iframe><script>(${runner.toString()})(${payload})</script>`
fs.writeFileSync(path.join(out, 'oracle.html'), html, { flag: 'wx' })
fs.writeFileSync(path.join(out, 'visual.html'), visualHtml, { flag: 'wx' })
async function verify () {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let stdout
  try {
    const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ;({ stdout } = await promisify(execFile)(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=3000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 }))
  } finally { server.close() }
  const encoded = stdout.match(/data-results="([^"]+)"/); assert.ok(encoded, 'Chrome did not produce results')
  const browser = JSON.parse(decodeURIComponent(encoded[1]))
  assert.equal(browser.results.length, cases.length)
  const failures = browser.results.filter(c => c.original !== c.expected || c.reader !== c.expected || c.originalText !== '正文保留')
  for (const phase of ['before', 'after']) for (let i = 0; i < ids.length; i++) {
    const original = browser[phase][i], reader = browser[phase === 'before' ? 'readerBefore' : 'readerAfter'][i]
    if (JSON.stringify(original) !== JSON.stringify(reader)) failures.push({ phase, original, reader })
  }
  if (interaction.errors.length) failures.push({ errors: interaction.errors })
  const result = { checked: cases.length + ids.length * 2, failureCount: failures.length, failures, browser }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ checked: result.checked, failureCount: failures.length, failures }, null, 2))
  assert.equal(failures.length, 0, 'CSS identifiers differ from independent Chrome content/style')
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
