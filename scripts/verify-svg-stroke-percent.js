'use strict'
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const os = require('node:os')
const { chromeTestResult } = require('./chrome-test-result')
const fixtures = require(process.argv.includes('--ellipse-paint') ? '../tests/helpers/svg-ellipse-paint' : process.argv.includes('--path-length') ? '../tests/helpers/svg-path-length' : process.argv.includes('--font-strokes') ? '../tests/helpers/svg-font-strokes' : process.argv.includes('--declarations') ? '../tests/helpers/svg-stroke-declarations' : '../tests/helpers/svg-stroke-percent')
const cases = process.argv.includes('--explore') ? fixtures.exploration : fixtures.cases
const { readerPage } = require('../tests/helpers/reader-host')
const out = path.resolve(process.argv[2] || 'outputs/svg-stroke-percent/verified')
const root = path.resolve(__dirname, '../miniprogram/file-reader/image'), modules = {}
function include (id) {
  if (modules[id]) return
  const source = modules[id] = fs.readFileSync(path.join(root, id), 'utf8')
  for (const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), m[1])) + (m[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
const baseline = process.argv.indexOf('--baseline-ref')
if (baseline >= 0) for (const id of ['svg/svg-rasterizer.js', 'svg/svg-style.js', 'svg/svg-document.js', 'svg/svg-animation.js']) {
  modules[id] = execFileSync('git', ['show', process.argv[baseline + 1] + ':miniprogram/file-reader/image/' + id], { encoding: 'utf8' })
}
async function browserRun (inputs, modules, componentSource) {
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts = id.split('/'); parts.pop(); for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x) } let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'; return load(target) }, m, m.exports)
    return m.exports
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
  document.body.append(canvas)
  const ctx = canvas.getContext('2d')
  const pixels = () => new Uint8ClampedArray(ctx.getImageData(0, 0, 256, 256).data)
  async function native (source, time = 0) {
    if (source.includes('<animate')) {
      const host = document.createElement('div'); host.innerHTML = source; document.body.append(host)
      const svg = host.querySelector('svg')
      // Let the native SMIL timeline attach before seeking its sampled frame.
      await new Promise(requestAnimationFrame)
      svg.pauseAnimations(); svg.setCurrentTime(time)
      await new Promise(requestAnimationFrame)
      const frozen = svg.cloneNode(true), originalNodes = [...svg.querySelectorAll('*')], frozenNodes = [...frozen.querySelectorAll('*')]
      for (const animation of svg.querySelectorAll('animate')) {
        const parent = animation.parentElement, property = animation.getAttribute('attributeName')
        const target = parent === svg ? frozen : frozenNodes[originalNodes.indexOf(parent)]
        if (property === 'pathLength') target.setAttribute(property, parent.pathLength.animVal)
        else if (property === 'x2') target.setAttribute(property, parent.x2.animVal.value)
        else target.style.setProperty(property, getComputedStyle(parent).getPropertyValue(property))
      }
      frozen.querySelectorAll('animate').forEach(node => node.remove()); host.remove()
      source = new XMLSerializer().serializeToString(frozen)
    }
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source); await image.decode(); ctx.reset(); ctx.drawImage(image, 0, 0, 256, 256); return pixels()
  }
  const difference = (a, b) => { let sum = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; max = Math.max(max, d) } return { sum, max } }
  let definition
  Function('require', 'Component', 'wx', componentSource)(id => {
    if (id === '../../index') return load('index.js')
    if (id === '../../svg/svg-clip-runtime') return { loadClipUnion: () => Promise.reject(Error('Unexpected clip union')) }
    throw Error('Unexpected dependency ' + id)
  }, value => { definition = value }, { getWindowInfo: () => ({ pixelRatio: 1 }) })
  const player = { ...definition.methods, data: { ...definition.data, playing: false }, _viewReady: true, _images: new Map(), events: [],
    setData (patch) { Object.assign(this.data, patch) }, triggerEvent (name, detail) { this.events.push({ name, detail }) },
    createSelectorQuery () { const q = { select: () => q, boundingClientRect: () => q, fields: () => q, exec: cb => cb([{ width: 256 }, { node: canvas, width: 256 }]) }; return q }
  }
  const results = []
  for (const input of inputs) {
    if (input.referenceGeometry) {
      const host = document.createElement('div'); host.innerHTML = input.referenceGeometry; document.body.append(host)
      const svg = host.querySelector('svg'), geometry = svg.querySelector('path[pathLength],line[pathLength],rect[pathLength],circle[pathLength],ellipse[pathLength],polyline[pathLength],polygon[pathLength]')
      const length = geometry.getTotalLength(), author = geometry.pathLength.baseVal
      const valid = /^\s*[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(geometry.getAttribute('pathLength'))
      const scale = valid && author > 0 ? length / author : 1
      const computed = getComputedStyle(geometry)
      const font = parseFloat(computed.fontSize)
      const resolve = token => parseFloat(token) * (token.endsWith('%') ? 2.56 : token.endsWith('em') ? font : 1)
      const dash = computed.strokeDasharray === 'none' ? 'none' : computed.strokeDasharray.split(/[ ,]+/).map(token => resolve(token) * scale).join(' ')
      const offset = resolve(computed.strokeDashoffset) * scale
      geometry.removeAttribute('pathLength'); geometry.style.strokeDasharray = valid && author === 0 ? 'none' : dash; geometry.style.strokeDashoffset = valid && author === 0 ? '0' : String(offset)
      input.referenceSource = new XMLSerializer().serializeToString(svg); input.nativeLength = length
      host.remove()
    }
    const reference = await native(input.referenceSource), original = await native(input.source, input.time || 0), variants = []
    for (const nativePaths of [true, false]) {
      ctx.reset()
      const scene = load('index.js').createSvgScene(input.source, { nativePaths, createPath2D: d => new Path2D(d) })
      scene.draw(ctx, 256, 256, input.time || 0)
      const actual = pixels()
      const numericScene = load('index.js').createSvgScene(input.referenceSource, { nativePaths, createPath2D: d => new Path2D(d) })
      ctx.reset(); numericScene.draw(ctx, 256, 256, 0)
      variants.push({ nativePaths, ...difference(actual, reference), nativeOriginal: difference(actual, original), numericReference: difference(actual, pixels()) })
    }
    player.events = []; player.load(input.entrySource); player.drawFrame(input.time || 0)
    results.push({ name: input.name, nativeLength: input.nativeLength, nativeInk: original.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0), reference: difference(original, reference), variants, component: { ...difference(pixels(), reference), nativeOriginal: difference(pixels(), original), ready: player.data.ready, errors: player.events.filter(e => e.name === 'error') } })
    if (input.ellipseFallback) {
      const originalEllipse = ctx.ellipse, fallbacks = []
      try {
        for (const mode of ['missing', 'noop', 'throws']) {
          ctx.ellipse = mode === 'missing' ? undefined : mode === 'noop' ? () => {} : (...args) => {
            if (args[0] === 0 && args[1] === 0 && args[2] === 2 && args[3] === 1) return originalEllipse.apply(ctx, args)
            ctx.moveTo(0, 0); ctx.lineTo(256, 256); throw Error('Host ellipse rejected after writing part of path')
          }
          player.events = []; player.load(input.entrySource); player.drawFrame(input.time || 0)
          const actual = pixels(), bytes = await crypto.subtle.digest('SHA-256', actual)
          fallbacks.push({ mode, ...difference(actual, reference), sha256: [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join(''), ready: player.data.ready, errors: player.events.filter(e=>e.name==='error') })
        }
      } finally { ctx.ellipse = originalEllipse }
      results[results.length-1].ellipseFallbacks = fallbacks
    }
  }
  const seeking = []
  for (const prefix of ['animated-font-', 'animated-root-rem-', 'animated-percent-font-', 'animated-length-', 'animated-geometry-', 'animated-ellipse-']) {
    const first = inputs.find(input => input.name === prefix + '0')
    if (!first) continue
    player.load(first.entrySource)
    for (const time of [0, 1.5, .5, 0]) {
      const reference = inputs.find(input => input.name === prefix + time)
      player.drawFrame(time)
      const actual = pixels()
      seeking.push({ name: prefix + time, ...difference(actual, await native(reference.referenceSource)) })
    }
  }
  player.dispose(); player.events = []; player.load('not svg')
  const rejected = player.events.some(e => e.name === 'error')
  player.events = []; player.load(inputs[0].entrySource); player.drawFrame(0)
  const recoveredPixels = pixels()
  const recovery = { rejected, ready: player.data.ready, errors: player.events.filter(e => e.name === 'error'), ...difference(recoveredPixels, await native(inputs[0].referenceSource)) }
  let complexity
  if (inputs.some(input => input.referenceGeometry)) {
    player.events = []
    player.load('<svg width="256" height="256"><path fill="none" stroke="black" pathLength="100" stroke-dasharray="10 5" d="' + 'M30 128C230 128 -30 128 210 128 '.repeat(6000) + '"/></svg>')
    const rejected = player.events.some(e => e.name === 'error' && /pathLength measurement/.test(e.detail.message))
    player.events = []; player.load(inputs[0].entrySource); player.drawFrame(0)
    const recovered = pixels()
    complexity = { rejected, ready: player.data.ready, errors: player.events.filter(e=>e.name==='error'), ...difference(recovered, await native(inputs[0].source)) }
  }
  player.dispose()
  document.querySelector('output').setAttribute('data-result', btoa(JSON.stringify({ results, recovery, seeking, complexity, userAgent: navigator.userAgent })))
}
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const reads = [], page = readerPage({ getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  let inputs
  try {
    inputs = cases.map(c => {
      const source = c.source.replace('</svg>', '<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>')
      page.openSelectedFile({ name: c.name + '.svg', path: '/fixture/' + c.name + '.svg' })
      reads.shift().success({ data: source })
      assert.equal(page.data.error, ''); assert.equal(page.data.standaloneSvgAnimatedSource, source)
      return { ...c, entrySource: source, ellipseFallback: process.argv.includes('--ellipse-paint') }
    })
  } finally { page.detached() }
  const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
  const component = fs.readFileSync(path.join(root, 'components/svg-view/svg-view.js'), 'utf8')
  const html = '<!doctype html><meta charset="utf-8"><output></output><script>(' + browserRun.toString() + ')(' + JSON.stringify(inputs).replace(/</g, '\\u003c') + ',' + bundle + ',' + JSON.stringify(component).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").setAttribute("data-error",e.stack))</script>'
  let receive
  const posted = new Promise(resolve => { receive = resolve })
  const callback = `<script>new MutationObserver(()=>{const o=document.querySelector('output');if(o.hasAttribute('data-result')||o.hasAttribute('data-error'))fetch('/result',{method:'POST',body:document.documentElement.outerHTML})}).observe(document.querySelector('output'),{attributes:true})</script>`
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => { receive(body); res.end('ok') })
    } else { res.setHeader('Content-Type', 'text/html'); res.end(html.replace('<output></output>', '<output></output>' + callback)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let report, firefox, timeout
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    let dom
    if (process.env.HTML_READER_FIREFOX) {
      firefox = spawn(process.env.HTML_READER_FIREFOX, ['-headless', '-no-remote', '-profile', fs.mkdtempSync(path.join(os.tmpdir(), 'reader-strokes-firefox-')), '-url', url], { stdio: 'ignore' })
      dom = await Promise.race([posted, new Promise((resolve, reject) => { firefox.on('error', reject); timeout = setTimeout(() => reject(Error('Firefox stroke result timeout')), 45000) })])
    } else dom = await chromeTestResult(url)
    fs.writeFileSync(path.join(out, 'browser.html'), dom)
    const match = dom.match(/data-result="([^"]+)"/)
    assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Browser did not finish')
    report = JSON.parse(Buffer.from(match[1], 'base64').toString())
  } finally { clearTimeout(timeout); server.close(); if (firefox && firefox.exitCode == null) firefox.kill('SIGTERM') }
  report.originalSummary = {
    cases: report.results.length,
    componentExact: report.results.filter(r => r.component.ready && !r.component.errors.length && r.component.nativeOriginal.sum === 0).length,
    nativePathExact: report.results.filter(r => r.variants.find(v => v.nativePaths).nativeOriginal.sum === 0).length,
    fallbackExact: report.results.filter(r => r.variants.find(v => !v.nativePaths).nativeOriginal.sum === 0).length,
    rewrittenReferenceDifferences: report.results.filter(r => r.reference.sum !== 0).length
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const failed = report.results.filter(r => r.reference.sum || r.variants.some(v => v.sum || v.numericReference.sum) || r.component.sum || !r.component.ready || r.component.errors.length)
  console.log(JSON.stringify({ originalSummary: report.originalSummary, cases: cases.length, exact: cases.length - failed.length, failed: failed.map(r => ({ name: r.name, reference: r.reference, variants: r.variants, component: r.component.sum })), recovery: report.recovery, seeking: report.seeking }))
  if (!process.argv.includes('--record')) { assert.equal(report.seeking.filter(frame => frame.sum).length, 0); assert.equal(failed.length, 0); assert.equal(report.recovery.rejected, true); assert.equal(report.recovery.ready, true); assert.equal(report.recovery.sum, 0); assert.deepEqual(report.recovery.errors, []) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
