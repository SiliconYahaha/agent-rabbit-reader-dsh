'use strict'

const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT || 'playwright')
const { readerPage } = require('../tests/helpers/reader-host')
const { tar } = require('../tests/helpers/tar-fixtures')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/tar-entry/browser')
  fs.mkdirSync(out, { recursive: true })
  const samples = require('../compatibility/runs/2026-09-08-next-tar-links.json').longLinks.rows.map(r => ({ name: r.name, bytes: Buffer.from(r.base64, 'base64'), entry: 'links/open.html', body: r.expected, reference: r.expected }))
  const source = '# TAR 中文标题\n\n**正文** & café 😀\n\n```text\nEXACT\tCODE\n```\n\n[跳转](#target)\n\n<p id="target">目标正文</p>\n'
  const reference = '<h1>TAR 中文标题</h1><p><strong>正文</strong> &amp; café 😀</p><pre><code>EXACT\tCODE\n</code></pre><p><a href="#target">跳转</a></p><p id="target">目标正文</p>'
  for (const format of ['ustar', 'gnu', 'pax']) for (const type of ['1', '2']) samples.push({ name: format + '-markdown-' + type, bytes: tar([{ name: 'docs/body.md', body: source }, { name: 'open.md', type, target: 'docs/body.md' }], format), entry: 'open.md', body: source, reference, anchor: true })
  const wasm = global.WXWebAssembly
  const wasmBinary = require('node:zlib').brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(wasmBinary, imports) }
  const reads = [], files = new Map(), views = []
  const host = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => reads.push(o), writeFile: o => { files.set(o.filePath, o.data); o.success() } }) })
  try {
    for (const sample of samples) {
      const filename = path.join(out, sample.name + '.tar'); fs.writeFileSync(filename, sample.bytes)
      const python = spawnSync('python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1]) as t: sys.stdout.buffer.write(t.extractfile(sys.argv[2]).read())', filename, sample.entry])
      assert.equal(python.status, 0); assert.equal(python.stdout.toString(), sample.body, sample.name + ' independent body')
      host.openSelectedFile({ name: sample.name + '.tar', path: '/fixture/input.tar', size: sample.bytes.length })
      await reads.shift().success({ data: sample.bytes })
      assert.equal(host.data.error, '', sample.name)
      await host.openInspectorEntry({ detail: { index: host._inspectorVisibleEntries.findIndex(e => e.name === sample.entry) } })
      const read = reads.shift(); assert.ok(read, sample.name + ' body dispatch')
      assert.equal(Buffer.from(files.get(read.filePath)).toString(), python.stdout.toString())
      await read.success({ data: files.get(read.filePath) })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '')
      assert.ok(host._htmlRuntime, sample.name + ' actual body runtime')
      const runtime = host._htmlRuntime, doc = runtime.document
      let anchorTap = null
      if (sample.anchor) {
        const anchor = doc.querySelector('a'), target = doc.getElementById('target')
        host.scrollToDomNid = nid => { anchorTap = nid === target._nid }
        host.onDomTap({ currentTarget: { dataset: { nid: anchor._nid } } })
        assert.equal(anchorTap, true, sample.name + ' anchor tap')
      }
      const tree = renderHtmlDomTree(doc, { styles: runtime.renderState().styles, viewportWidth: 390 })
      views.push({ name: sample.name, actual: tree.nodes.map(serialize).join(''), reference: sample.reference, pythonBodyExact: true, anchorTap })
    }
  } finally { host.detached(); if (wasm === undefined) delete global.WXWebAssembly; else global.WXWebAssembly = wasm }
  const browser = await chromium.launch({ executablePath: process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  let rows, chrome
  try {
    chrome = browser.version()
    const page = await browser.newPage()
    rows = await page.evaluate(async views => {
      const rows = []
      for (const view of views) {
        const row = { name: view.name, pythonBodyExact: view.pythonBodyExact, anchorTap: view.anchorTap }
        for (const key of ['actual', 'reference']) {
          const frame = document.createElement('iframe'); frame.width = '390'; frame.height = '844'; document.body.append(frame)
          await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = view[key] })
          const d = frame.contentDocument
          row[key] = [...d.querySelectorAll('h1,p,pre')].map(el => {
            const r = d.createRange(); r.selectNodeContents(el)
            const box = el.getBoundingClientRect()
            return { tag: el.tagName, text: el.textContent, selection: r.toString(), visible: box.width > 0 && box.height > 0, links: [...el.querySelectorAll('a')].map(a => a.textContent) }
          })
          frame.remove()
        }
        rows.push(row)
      }
      return rows
    }, views)
  } finally { await browser.close() }
  const failures = rows.filter(r => JSON.stringify(r.actual) !== JSON.stringify(r.reference)).map(r => r.name)
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), chrome, cases: rows.length, failures, scope: 'Node actual host TAR entry dispatch and anchor events; Chrome renders actual reader trees against independently extracted HTML or explicit Markdown semantic reference. Checks visible block text/selection; no pixel equality, WXML or device proof.', rows }, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, failures }))
  assert.deepEqual(failures, [])
}
main().catch(e => { console.error(e); process.exitCode = 1 })
