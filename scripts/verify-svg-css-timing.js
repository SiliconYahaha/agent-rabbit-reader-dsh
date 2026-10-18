'use strict'

const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { chromeTestResult } = require('./chrome-test-result')
const { cases } = require('../tests/helpers/svg-css-timing')
const { readerPage } = require('../tests/helpers/reader-host')
const root = path.resolve(process.env.HTML_READER_SVG_ROOT || path.join(__dirname, '../miniprogram/file-reader/image')), modules = {}
function include (id) {
  if (modules[id]) return
  const source = modules[id] = fs.readFileSync(path.join(root, id), 'utf8')
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[1])) + (match[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
async function browserRun (cases, modules, componentSource) {
  const output = document.querySelector('output'), cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](relative => {
      const parts = id.split('/'); parts.pop()
      for (const part of relative.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part) }
      let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'
      return load(target)
    }, m, m.exports)
    return m.exports
  }
  try {
    let definition, frameId = 0
    const frames = new Map(), events = []
    const canvas = document.createElement('canvas')
    canvas.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
    canvas.cancelAnimationFrame = id => frames.delete(id)
    // Execute the shipped component. Only native node-query / wx scheduling are
    // adapted; the actual load, mountCanvas, drawFrame and disposal code runs.
    new Function('require', 'Component', 'wx', componentSource)(name => {
      if (name === '../../index') return load('index.js')
      if (name === '../../svg/svg-clip-runtime') return { loadClipUnion: () => Promise.reject(Error('No compound clips in these timing fixtures')) }
      throw Error('Unexpected component dependency: ' + name)
    }, value => { definition = value }, { nextTick: callback => queueMicrotask(callback), getWindowInfo: () => ({ pixelRatio: 1 }) })
    const player = { ...definition.methods, data: { ...definition.data, source: '', playing: true },
      setData (patch, callback) { Object.assign(this.data, patch); if (callback) callback() }, triggerEvent (name, detail) { events.push({ name, detail }) },
      createSelectorQuery () { const query = { select: () => query, boundingClientRect: () => query, fields: () => query, exec: callback => callback([{ width: 64 }, { node: canvas, width: 64 }]) }; return query }
    }
    definition.lifetimes.attached.call(player); definition.lifetimes.ready.call(player)
    const results = []
    for (const fixture of cases) {
      const svg = new DOMParser().parseFromString(fixture.source, 'image/svg+xml').documentElement
      document.body.appendChild(svg)
      const target = svg.querySelector('#subject'), animation = target.getAnimations()[0]
      if (!animation) throw Error('No native CSS animation: ' + fixture.id)
      animation.pause()
      await animation.ready
      player.data.source = fixture.source
      definition.observers.source.call(player, fixture.source)
      if (!player.data.ready || frames.size !== 1) throw Error('Component did not mount exactly one timeline')
      const scene = player._scene
      const ctx = canvas.getContext('2d'), rows = []
      for (const time of fixture.times) {
        animation.currentTime = time * 1000
        const native = Number(getComputedStyle(target).fillOpacity)
        const override = scene.timeline.sample(time).get(scene.doc.byId.subject)
        const actual = Number(override && override.style['fill-opacity'] || scene.doc.byId.subject.style['fill-opacity'])
        if (!player.drawFrame(time)) throw Error('Component frame failed')
        const pixel = [...ctx.getImageData(32, 32, 1, 1).data]
        const reference = document.createElement('canvas'); reference.width = reference.height = 64
        const rc = reference.getContext('2d'); rc.globalAlpha = native; rc.fillStyle = '#4488cc'; rc.fillRect(8, 8, 48, 48)
        const expected = [...rc.getImageData(32, 32, 1, 1).data]
        // The reader serializes numeric animation values to 0.001; permit at
        // most one 8-bit alpha level, established before observing results.
        const numericMatch = Math.abs(native - actual) <= 0.0006
        const alphaMatch = Math.abs(pixel[3] - expected[3]) <= 1
        rows.push({ time, nativeTime: animation.currentTime, nativeProgress: animation.effect.getComputedTiming().progress, native, actual, pixel, expected, numericMatch, alphaMatch })
      }
      svg.remove()
      results.push({ id: fixture.id, rows })
      player.onTap()
      if (frames.size !== 0) throw Error('Pause left an active frame')
    }
    definition.lifetimes.detached.call(player)
    if (frames.size || events.some(event => event.name === 'error')) throw Error('Component lifecycle failure')
    output.setAttribute('data-result', btoa(JSON.stringify({ userAgent: navigator.userAgent, results, component: { mounts: events.filter(event => event.name === 'ready').length, activeFramesAfterDetach: frames.size } })))
  } catch (error) { output.setAttribute('data-error', error.stack) }
}
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/svg-css-timing')
  fs.mkdirSync(out, { recursive: true })
  const fixtures = cases(), reads = []
  const host = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (const fixture of fixtures) {
      host.openSelectedFile({ name: fixture.id + '.svg', path: '/local/timing.svg', size: Buffer.byteLength(fixture.source) })
      reads.shift().success({ data: fixture.source })
      assert.equal(host.data.error, '')
      assert.equal(host.data.standaloneSvgAnimatedSource, fixture.source, 'Actual file entry must preserve the CSS animation original')
    }
  } finally { host.detached() }
  const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
  const componentSource = fs.readFileSync(path.join(root, 'components/svg-view/svg-view.js'), 'utf8')
  const callback = `<script>new MutationObserver(()=>{const o=document.querySelector('output');if(o.hasAttribute('data-result')||o.hasAttribute('data-error'))fetch('/result',{method:'POST',body:document.documentElement.outerHTML})}).observe(document.querySelector('output'),{attributes:true})</script>`
  const html = '<!doctype html><output></output>' + callback + '<script>(' + browserRun.toString() + ')(' + JSON.stringify(fixtures).replace(/</g, '\\u003c') + ',' + bundle + ',' + JSON.stringify(componentSource) + ')</script>'
  fs.writeFileSync(path.join(out, 'oracle.html'), html)
  let receive
  const posted = new Promise(resolve => { receive = resolve })
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => { receive(body); res.end('ok') })
    } else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let dom
  let firefox, timeout
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    if (process.env.HTML_READER_FIREFOX) {
      // Launch only our own isolated profile; never attach to a user's browser.
      firefox = spawn(process.env.HTML_READER_FIREFOX, ['-headless', '-no-remote', '-profile', fs.mkdtempSync(path.join(os.tmpdir(), 'reader-timing-firefox-')), '-url', url], { stdio: 'ignore' })
      dom = await Promise.race([posted, new Promise((resolve, reject) => { firefox.on('error', reject); timeout = setTimeout(() => reject(Error('Firefox timing result timeout')), 45000) })])
    } else dom = await chromeTestResult(url)
  } finally { clearTimeout(timeout); server.close(); if (firefox && firefox.exitCode == null) firefox.kill('SIGTERM') }
  const match = dom.match(/data-result="([^"]+)"/)
  assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'No browser result')
  const { results, userAgent, component } = JSON.parse(Buffer.from(match[1], 'base64').toString())
  const rows = results.flatMap(r => r.rows.map(row => ({ id: r.id, ...row })))
  const report = { testedAt: new Date().toISOString(), userAgent, component, hostOpens: fixtures.length, scope: 'Authored standalone SVG CSS animation; actual file entry/component with native CSS timeline and Canvas center alpha. Not qin-bear reproduction or WeChat/device verification.', cases: results.length, samples: rows.length, failures: rows.filter(r => !r.numericMatch || !r.alphaMatch), results }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: report.cases, samples: report.samples, failures: report.failures.length, first: report.failures.slice(0, 3), out }))
  if (!process.argv.includes('--record')) assert.equal(report.failures.length, 0)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
