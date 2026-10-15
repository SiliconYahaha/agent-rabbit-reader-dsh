'use strict'
// Local-only diagnostic host. Real Chrome graphics support is not WeChat proof.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { bundle } = require('./verify-inline-poster')
const { testMaterialRoot } = require('./local-test-materials')
const dir = path.resolve(process.argv[2] || testMaterialRoot())
const names = fs.readdirSync(dir).filter(n => n.endsWith('.html'))
const code = () => bundle()
async function probe () {
  const result = { asyncErrors: [], host: 'Chrome canvas and image decoder; not WeChat' }
  window.addEventListener('unhandledrejection', e => result.asyncErrors.push(String(e.reason?.stack || e.reason).slice(0, 1000)))
  const { createRuntime } = readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
  const { renderHtmlDomTree } = readerRequire('miniprogram/file-reader/document/document-renderer.js')
  const html = await (await fetch('/source' + location.search)).text()
  let r
  try {
    r = createRuntime(html, { viewportWidth: 390, viewportHeight: 844, maxExecutionSteps: Number(new URLSearchParams(location.search).get('steps')) || undefined, createOffscreenCanvas: config => {
      const canvas = document.createElement('canvas')
      canvas.width = config.width; canvas.height = config.height; canvas.createImage = () => new Image()
      return canvas
    } })
    r.run()
    await new Promise(resolve => setTimeout(resolve, 2500))
    const state = r.renderState(), view = renderHtmlDomTree({ document: r.document, styles: state.styles }, { viewportWidth: 390, viewportHeight: 844 })
    const flat = ns => (ns || []).flatMap(n => [n, ...flat(n.children)])
    const rendered = flat(view.nodes)
    result.errors = r.errors.map(e => ({ phase: e.phase, message: e.message }))
    result.loadText = r.document.getElementById('loadText')?.textContent
    result.loadingClass = r.document.getElementById('loading')?.className
    result.backend = r.document.getElementById('backendText')?.textContent
    result.buttons = r.document.querySelectorAll('button,[data-action]').map(n => ({ id: n.id, action: n.getAttribute('data-action'), text: n.textContent.slice(0, 60), inView: rendered.some(v => v.nid === n._nid), disabled: n.disabled }))
    result.canvas = r.document.querySelectorAll('canvas').map(n => ({ id: n.id, realWebGl: !!n._captureWebGlPixels }))
  } catch (error) { result.failure = String(error.stack || error).slice(0, 2000) } finally { r?.destroy() }
  window.probeResult = result
  document.querySelector('pre').textContent = JSON.stringify(result, null, 2)
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(code()); return }
  if (url.pathname === '/source') {
    const name = url.searchParams.get('name')
    if (!names.includes(name)) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, name))); return
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><pre>Inspecting…</pre><script src="/bundle.js"></script><script>(' + probe.toString() + ')()</script>')
}).listen(18724, '127.0.0.1', () => console.log('Local probe: http://127.0.0.1:18724/?name=' + encodeURIComponent(names[0])))
