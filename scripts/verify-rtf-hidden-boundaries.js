'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { contracts } = require('../tests/helpers/rtf-hidden-boundaries')
const native = require('../tests/fixtures/rtf-hidden-boundaries/expanded-before.json').cases
const out = path.resolve(process.argv[2] || 'outputs/rtf-hidden-tables/browser-after')
fs.mkdirSync(out, { recursive: true })
const baseline = process.argv.indexOf('--baseline-ref')
if (baseline >= 0) {
  const file = require.resolve('../miniprogram/file-reader/engine/core/rtf-reader'), Module = require('node:module'), m = new Module(file, module)
  m.filename = file; m.paths = module.paths
  m._compile(execFileSync('git', ['show', process.argv[baseline + 1] + ':miniprogram/file-reader/engine/core/rtf-reader.js'], { encoding: 'utf8' }), file)
  require.cache[file] = m
}
const { readerPage } = require('../tests/helpers/reader-host'), { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? esc(n.text) : `<${n.name} ${Object.entries(n.attrs || {}).map(([k,v]) => `${k}="${esc(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function inspect (views) {
  const results = []
  async function frame (html) {
    const f = document.createElement('iframe'); f.style.cssText = 'width:390px;height:600px'; f.sandbox = 'allow-same-origin'; document.body.append(f)
    await new Promise(resolve => { f.onload = resolve; f.srcdoc = html })
    return f
  }
  for (const v of views) {
    const f = await frame(v.actual), pre = f.contentDocument.querySelector('pre'), box = pre.getBoundingClientRect()
    const result = { name: v.name, text: pre.innerText, textContent: pre.textContent, visible: box.width > 0 && box.height > 0, expected: v.expected }
    f.remove()
    if (v.nativeHtml) {
      const n = await frame(v.nativeHtml), cells = [...n.contentDocument.querySelectorAll('td')]
      const inner = v.name.startsWith('nested-') ? cells.slice(1) : cells
      result.nativeCells = inner.map(td => td.innerText)
      result.nativeCellContent = inner.map(td => {
        // A Writer placeholder p/br has a layout newline but no content. Keep
        // the cell itself, so this cannot erase empty positions or real breaks.
        const text = td.innerText
        return text === '\n' && td.querySelector('p > br') && td.textContent.trim() === '' ? '' : text
      })
      const line = result.textContent.split('\n')[v.name.startsWith('nested-') ? 2 : 1]
      result.readerCells = line.endsWith('\t') ? line.slice(0, -1).split('\t') : null
      result.sameCells = JSON.stringify(result.readerCells) === JSON.stringify(result.nativeCellContent)
      n.remove()
    }
    result.pass = result.visible && result.text === v.expected && result.textContent === v.expected && result.sameCells !== false
    results.push(result)
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
let bytes
const page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
const views = []
try {
  for (const c of contracts) {
    bytes = Buffer.from(c.source); page.openSelectedFile({ name: c.name + '.rtf', path: '/fixture/table.rtf', size: bytes.length })
    assert.equal(page.data.error, '', c.name)
    const runtime = page._htmlRuntime, tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
    views.push({ name: c.name, expected: c.expected, actual: tree.nodes.map(serialize).join(''), nativeHtml: native.find(n => n.name === c.name)?.nativeHtml })
  }
} finally { page.disposeHtmlRuntime() }
const file = path.join(out, 'views.html')
fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><output></output><script>(' + inspect + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dom = execFileSync(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--virtual-time-budget=15000','--dump-dom',pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore','pipe','ignore'] })
const match = /data-results="([^"]+)"/.exec(dom); assert.ok(match, 'All views must complete')
const rows = JSON.parse(decodeURIComponent(match[1])), failures = rows.filter(r => !r.pass)
assert.equal(rows.length, contracts.length)
const report = { at: new Date().toISOString(), baseline: baseline >= 0 ? process.argv[baseline + 1] : null, views: rows.length, nativeCellViews: rows.filter(r => r.nativeCells).length, failures: failures.map(r => r.name), rows, scope: 'Actual Node reader rendered tree in Chrome: exact pre content, visibility and cell sequences compared to unmodified Writer HTML. No rich table geometry, WeChat or device certification.' }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const selected = views.filter(v => ['table-hidden-cell-mark-direct','nested-empty-hidden-middle-character-style'].includes(v.name))
fs.writeFileSync(path.join(out, 'comparison.html'), '<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:20px}.row{display:flex;gap:20px}iframe{width:420px;height:330px;border:1px solid #bbb}h2{font-size:18px}</style>' + selected.map(v => '<h2>' + esc(v.name) + '</h2><div class="row"><div>Actual reader<br><iframe sandbox="allow-same-origin" srcdoc="' + esc(v.actual) + '"></iframe></div><div>Writer reference<br><iframe sandbox="allow-same-origin" srcdoc="' + esc(v.nativeHtml) + '"></iframe></div></div>').join(''))
console.log(JSON.stringify({ views: rows.length, nativeCellViews: report.nativeCellViews, failures: report.failures, report: path.join(out,'report.json') }))
if (baseline < 0) assert.deepEqual(failures, [])
