'use strict'
// 本机 CPU 对照，不代表手机实测；每组在独立 Node 进程中跑相同原文。
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
if (process.argv[2] !== '--worker') {
  const baseline = process.argv[2]
  const run = revision => JSON.parse(execFileSync(process.execPath, [__filename, '--worker', revision || ''], { cwd: root, encoding: 'utf8' }))
  const current = run('')
  const previous = baseline ? run(baseline) : null
  if (previous) {
    const assert = require('node:assert/strict')
    assert.deepEqual(current.cases.map(c => c.hash), previous.cases.map(c => c.hash), '优化前后渲染内容必须一致')
  }
  console.log(JSON.stringify({ environment: 'Node CPU, not device latency', baseline: previous, current }, null, 2))
} else {
  if (process.argv[3]) {
    const Module = require('node:module'), compile = Module._extensions['.js']
    const relative = 'miniprogram/file-reader/document/html-runtime/html-dom-shim.js'
    const original = execFileSync('git', ['show', process.argv[3] + ':' + relative], { cwd: root, encoding: 'utf8' })
    Module._extensions['.js'] = (module, file) => file === path.join(root, relative) ? module._compile(original, file) : compile(module, file)
  }
  const { performance } = require('node:perf_hooks'), { createHash } = require('node:crypto')
  const { readerPage } = require('../tests/helpers/reader-host')
  const family = require('../miniprogram/file-reader/engine/core/families').get('document')
  let layoutMs = 0
  const render = family.renderHtmlDomTree
  family.renderHtmlDomTree = (...args) => { const t = performance.now(); try { return render(...args) } finally { layoutMs += performance.now() - t } }
  const sample = require('../miniprogram/data/sample-html').replace('new Date().toLocaleString()', '"固定基准时刻"')
  const report = '<style>body{margin:12px}.card{padding:12px;border:1px solid #ddd}.card h2{color:#354}.card p{line-height:1.5}.card:nth-child(even){background:#f5f5ed}</style>' + Array.from({length:100}, (_, i) => `<section class="card"><h2>记录 ${i}</h2><p>完整正文 ${i}</p><button>查看 ${i}</button></section>`).join('')
  const cases = []
  const log = console.log; console.log = () => {}
  for (const [name, html] of [['built-in', sample], ['100-cards', report]]) {
    const rows = []; let hash
    for (let i = 0; i < 6; i++) {
      const page = readerPage(); layoutMs = 0
      try {
        const t = performance.now()
        page.openSelectedFile({ name: name + '.html', inlineHtml: html })
        const totalMs = performance.now() - t
        if (page.data.error || !page.data.hasContent) throw new Error(page.data.error || 'missing content')
        if (page._runtimeErrors.length) throw new Error(JSON.stringify(page._runtimeErrors))
        // nid 是进程内递增标识；比较样式、结构和正文，排除标识及随机 Canvas 绘图操作。
        const stable = JSON.parse(JSON.stringify(page.data.domTree), (k,v) => /^(nid|tapNid|canvas|canvasId|canvasRev)$/.test(k) ? undefined : v)
        hash = createHash('sha256').update(JSON.stringify({ nodes: stable, styles: page.data.domStyles })).digest('hex')
        rows.push({totalMs, layoutMs})
      } finally { page.host.onUnload() }
    }
    const median = key => Number(rows.slice(1).map(r=>r[key]).sort((a,b)=>a-b)[2].toFixed(2))
    cases.push({ name, hash, coldMs: Number(rows[0].totalMs.toFixed(2)), medianTotalMs: median('totalMs'), medianLayoutMs: median('layoutMs') })
  }
  console.log = log
  process.stdout.write(JSON.stringify({ cases }))
}
