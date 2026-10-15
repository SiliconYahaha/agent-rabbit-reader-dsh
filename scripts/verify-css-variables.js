'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict'), { execFile } = require('node:child_process'), { promisify } = require('node:util')
const { cases, htmlFor, visualHtml } = require('../tests/helpers/css-variables')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { computeCustomProperties } = require('../miniprogram/file-reader/document/css-variables')
const { cycles, root: publicRoot } = require('../tests/helpers/css-variable-public')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-css-variables-'))
const escape = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
const inputs = cases.map(c => { const original = htmlFor(c), r = renderHtmlDomTree(original); return { ...c, original, reader: `<body style="${escape(r.wrapperStyle)}">${r.nodes.map(serialize).join('')}</body>` } })
for (const [name, selector, property, text] of [
  ['css-vars-custom-property-inheritance.html', '.color1', 'background-color', ''],
  ['css-vars-custom-property-inheritance.html', '.color2', 'background-color', ''],
  ['variable-declaration-48.html', 'p', 'color', 'This text must be green.']
]) {
  const original = fs.readFileSync(path.join(publicRoot, name), 'utf8'), r = renderHtmlDomTree(original)
  inputs.push({ name: name + selector, selector, property, text, expected: 'green', original, reader: `<body style="${escape(r.wrapperStyle)}">${r.nodes.map(serialize).join('')}</body>` })
}
const cycleInputs = cycles.map(c => {
  const raw = Object.fromEntries(c.declarations.map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)] }))
  return { ...c, reader: computeCustomProperties({ ...raw, '--sanity': 'valid' }) }
})
const run = data => {
  const f = document.querySelector('iframe'), d = f.contentDocument
  const measure = (html, property, selector = '#probe') => { d.open(); d.write(html); d.close(); const p = d.querySelector(selector); return { value: f.contentWindow.getComputedStyle(p).getPropertyValue(property), text: p.textContent } }
  const results = data.inputs.map(c => ({ name: c.name, original: measure(c.original, c.property, c.selector), reader: measure(c.reader, c.property, c.selector), expected: measure(`<p id="probe" style="${c.property}:${c.expected}">${c.text == null ? '变量正文保留' : c.text}</p>`, c.property) }))
  for (const c of data.cycles) {
    d.open(); d.write('<div></div>'); d.close(); const el = d.querySelector('div'); el.style.cssText = c.declarations.concat('--sanity:valid').join(';')
    const cs = f.contentWindow.getComputedStyle(el)
    for (const name of c.invalid.concat(c.valid, '--sanity')) {
      const expected = !c.invalid.includes(name)
      results.push({ name: c.name + '/' + name, original: cs.getPropertyValue(name) !== '', reader: c.reader[name] != null && c.reader[name] !== '', expected })
    }
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
const html = `<!doctype html><meta charset="utf-8"><output></output><iframe sandbox="allow-same-origin"></iframe><script>(${run.toString()})(${JSON.stringify({ inputs, cycles: cycleInputs }).replace(/</g, '\\u003c')})</script>`
fs.writeFileSync(path.join(out, 'oracle.html'), html, { flag: 'wx' })
fs.writeFileSync(path.join(out, 'visual.html'), visualHtml, { flag: 'wx' })
async function verify () {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let stdout
  try { ({ stdout } = await promisify(execFile)(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--virtual-time-budget=3000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { encoding: 'utf8', timeout: 60000, maxBuffer: 6 * 1024 * 1024 })) } finally { server.close() }
  const encoded = stdout.match(/data-results="([^"]+)"/); assert.ok(encoded, 'No Chrome result')
  const results = JSON.parse(decodeURIComponent(encoded[1])); assert.equal(results.length, inputs.length + cycles.reduce((n, c) => n + c.invalid.length + c.valid.length + 1, 0))
  const failures = results.filter(r => JSON.stringify(r.original) !== JSON.stringify(r.expected) || JSON.stringify(r.reader) !== JSON.stringify(r.expected))
  const report = { checked: results.length, failureCount: failures.length, failures, results }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ checked: results.length, failureCount: failures.length, failures }, null, 2)); assert.equal(failures.length, 0)
}
verify().catch(e => { console.error(e); process.exitCode = 1 })
