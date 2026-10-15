'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { cases } = require('../tests/helpers/svg-rounded-rect')
const output = path.resolve(process.argv[2] || 'outputs/svg-rounded-rect')
const root = path.resolve('miniprogram/file-reader/image'), modules = {}
function include (id) {
  if (modules[id]) return
  const source = modules[id] = fs.readFileSync(path.join(root, id), 'utf8')
  for (const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), m[1])) + (m[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
const baselineAt = process.argv.indexOf('--baseline-ref')
if (baselineAt >= 0) modules['svg/svg-rasterizer.js'] = execFileSync('git', ['show', process.argv[baselineAt + 1] + ':miniprogram/file-reader/image/svg/svg-rasterizer.js'], { encoding: 'utf8' })
async function run (inputs, modules, componentSource) {
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts = id.split('/'); parts.pop(); for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x) } let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'; return load(target) }, m, m.exports)
    return m.exports
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d'), results = []
  async function pixels (source, time) {
    const host = document.createElement('div'); host.innerHTML = source; document.body.append(host)
    const svg = host.querySelector('svg')
    if (svg.querySelector('animate')) await new Promise(resolve => setTimeout(resolve, 1))
    svg.pauseAnimations(); svg.setCurrentTime(time || 0)
    const frozen = svg.cloneNode(true)
    for (const animate of svg.querySelectorAll('animate')) {
      const parent = animate.parentElement, name = animate.getAttribute('attributeName'), value = parent[name].animVal.value
      frozen.querySelectorAll('*')[Array.from(svg.querySelectorAll('*')).indexOf(parent)].setAttribute(name, value)
    }
    frozen.querySelectorAll('animate').forEach(node => node.remove()); host.remove()
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(frozen)); await image.decode()
    ctx.reset(); ctx.drawImage(image, 0, 0, 256, 256); return new Uint8ClampedArray(ctx.getImageData(0, 0, 256, 256).data)
  }
  const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0)
  let definition
  // Execute the real component with browser Canvas and only platform plumbing
  // supplied by this harness. No production parsing/geometry/paint is replaced.
  Function('require', 'Component', 'wx', componentSource)(id => {
    if (id === '../../index') return load('index.js')
    if (id === '../../svg/svg-clip-runtime') return { loadClipUnion: () => Promise.reject(Error('Unexpected clip-union request')) }
    throw Error('Unexpected component dependency ' + id)
  }, value => { definition = value }, { getWindowInfo: () => ({ pixelRatio: 1 }) })
  const player = { ...definition.methods, data: { ...definition.data, playing: false }, _viewReady: true, _images: new Map(), events: [],
    setData (patch) { Object.assign(this.data, patch) }, triggerEvent (name, detail) { this.events.push({ name, detail }) },
    createSelectorQuery () { const q = { select: () => q, boundingClientRect: () => q, fields: () => q, exec: callback => callback([{ width: 256 }, { node: canvas, width: 256 }]) }; return q }
  }
  for (const input of inputs) {
    const reference = await pixels(input.referenceSource, 0), native = await pixels(input.source, input.time)
    const variants = []; let fallback
    for (const mode of ['missing', 'native', 'noop', 'probe-throws', 'partial-throws']) {
      let calls = 0
      const target = new Proxy(ctx, {
        get (target, key) {
          if (key === 'roundRect') {
            if (mode === 'missing') return undefined
            return (...args) => {
              calls++
              if (mode === 'noop') return
              if (mode === 'probe-throws') throw Error('Unavailable host primitive')
              if (mode === 'partial-throws' && calls > 1) { target.moveTo(0, 0); target.lineTo(256, 256); throw Error('Partially implemented host primitive') }
              return target.roundRect(...args)
            }
          }
          const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value
        }, set: (target, key, value) => Reflect.set(target, key, value, target)
      })
      const scene = load('index.js').createSvgScene(input.source); let error = null
      ctx.reset()
      try { for (let repeat = 0; repeat < 2; repeat++) scene.draw(target, 256, 256, input.time || 0) } catch (e) { error = e.message }
      const actual = new Uint8ClampedArray(ctx.getImageData(0, 0, 256, 256).data)
      if (mode === 'missing') fallback = actual
      variants.push({ mode, error, calls, rgbaError: difference(actual, reference), fallbackError: difference(actual, fallback) })
    }
    player.events = []; player.load(input.source); player.drawFrame(input.time || 0)
    const actual = ctx.getImageData(0, 0, 256, 256).data
    results.push({ name: input.name, nativeReferenceError: difference(native, reference), variants, component: { ready: player.data.ready, animated: player.data.animated, errors: player.events.filter(e => e.name === 'error'), rgbaError: difference(actual, reference) } })
  }
  player.dispose(); player.events = []; player.load('not svg'); const malformedErrors = player.events.filter(e => e.name === 'error').length
  player.events = []; player.load(inputs[0].source); const recovery = { malformedErrors, ready: player.data.ready, errors: player.events.filter(e => e.name === 'error') }; player.dispose()
  document.querySelector('#result').setAttribute('data-result', btoa(JSON.stringify({ results, recovery })))
}
fs.mkdirSync(output, { recursive: true })
const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
const html = path.join(output, 'oracle.html'), componentSource = fs.readFileSync(path.join(root, 'components/svg-view/svg-view.js'), 'utf8')
fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><div id="result"></div><script>(' + run.toString() + ')(' + JSON.stringify(cases).replace(/</g, '\\u003c') + ',' + bundle + ',' + JSON.stringify(componentSource).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("#result").setAttribute("data-error",String(e.stack||e)))</script>')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=10000', pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Rounded rect browser run failed: ' + (dump.match(/data-error="([^"]+)"/) || [])[1])
const result = JSON.parse(Buffer.from(match[1], 'base64').toString())
function hostFailure (r) {
  return r.nativeReferenceError || !r.component.ready || r.component.errors.length || r.variants.some(v =>
    v.error || (v.mode !== 'native' && v.fallbackError) ||
    (v.mode === 'partial-throws' && v.calls > 2) ||
    (['noop', 'probe-throws'].includes(v.mode) && v.calls > 1))
}
const failures = result.results.filter(r => hostFailure(r) || r.component.rgbaError || r.variants.find(v => v.mode === 'native').rgbaError)
const unexpected = failures.filter(r => hostFailure(r) || !cases.find(c => c.name === r.name).knownGap)
const report = { testedAt: new Date().toISOString(), chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), scope: 'Real SVG component with browser Canvas/platform harness; not WeChat DevTools or physical devices', cases: cases.length, nativeExact: result.results.filter(r => !r.variants.find(v => v.mode === 'native').rgbaError).length, componentExact: result.results.filter(r => !r.component.rgbaError).length, failures: failures.map(r => r.name), unexpected: unexpected.map(r => r.name), ...result }
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ cases: report.cases, nativeExact: report.nativeExact, componentExact: report.componentExact, failures: report.failures, recovery: report.recovery }))
if (!process.argv.includes('--discover')) { assert.equal(unexpected.length, 0); assert.ok(report.recovery.malformedErrors > 0); assert.equal(report.recovery.ready, true); assert.equal(report.recovery.errors.length, 0) }
