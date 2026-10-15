'use strict'
// Optional input directory is local-only: originals never enter the repository.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const input = path.resolve(process.argv[2] || 'tests/fixtures/svg-player')
const output = path.resolve(process.argv[3] || 'outputs/svg-animation')
const names = fs.readdirSync(input).filter(name => name.endsWith('.svg')).sort()
assert.ok(names.length, 'No SVG samples')
const inputs = names.map(name => { const source = fs.readFileSync(path.join(input, name), 'utf8'); return { name, source, bytes: Buffer.byteLength(source), sha256: crypto.createHash('sha256').update(source).digest('hex') } })
const root = path.resolve('miniprogram/file-reader/image')
const modules = {}
function include (id) {
  if (modules[id]) return
  const source = fs.readFileSync(path.join(root, id), 'utf8'); modules[id] = source
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[1])) + (match[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
async function run (inputs, modules) {
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts = id.split('/'); parts.pop(); for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x) } let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'; return load(target) }, m, m.exports)
    return m.exports
  }
  const results = await Promise.all(inputs.map(async ({ source, ...meta }) => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (doc.querySelector('parsererror')) throw Error(meta.name + ': invalid XML')
    const svg = document.importNode(doc.documentElement, true)
    for (const node of svg.querySelectorAll('script,foreignObject')) node.remove()
    for (const node of [svg, ...svg.querySelectorAll('*')]) for (const attr of [...node.attributes]) if (/^on/i.test(attr.name) || (/href$/.test(attr.name) && !attr.value.startsWith('#'))) node.removeAttribute(attr.name)
    document.body.appendChild(svg); await new Promise(resolve => setTimeout(resolve, 50)); svg.pauseAnimations()
    const scene = load('index.js').createSvgScene(source)
    const targets = [...svg.querySelectorAll('animateTransform')].map(node => node.parentElement)
    const frames = [0, 0.3, 0.6].map(time => {
      svg.setCurrentTime(time)
      const nativeTransforms = targets.map(node => { const m = node.getCTM(); return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null })
      const canvas = document.createElement('canvas'); canvas.width = 450; canvas.height = Math.round(450 * scene.viewBox.height / scene.viewBox.width); document.body.appendChild(canvas)
      const ctx = canvas.getContext('2d'); scene.draw(ctx, canvas.width, canvas.height, time)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let hash = 2166136261, ink = 0
      for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0; if (i % 4 === 3 && pixels[i]) ink++ }
      return { time, hash, ink, nativeTransforms }
    })
    svg.remove()
    return { ...meta, animated: scene.animated, tracks: scene.timeline.smilCount + scene.timeline.cssCount, unsupported: [...scene.renderer.unsupported], frames }
  }))
  document.querySelector('#result').setAttribute('data-result', btoa(JSON.stringify(results)))
}
fs.mkdirSync(output, { recursive: true })
const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
const file = path.join(output, 'oracle.html')
fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><div id="result"></div><script>window.onerror=(m)=>document.querySelector("#result").setAttribute("data-error",m);(' + run.toString() + ')(' + JSON.stringify(inputs).replace(/</g, '\\u003c') + ',' + bundle + ')</script>')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=3000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Chrome oracle did not finish: ' + (dump.match(/data-error="([^"]+)"/) || [])[1])
const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
for (const row of results) {
  assert.equal(row.animated, true, row.name)
  assert.ok(row.frames.every(f => f.ink > 0), row.name + ': blank Canvas')
  assert.equal(new Set(row.frames.map(f => f.hash)).size, 3, row.name + ': static reader frames')
  assert.equal(new Set(row.frames.map(f => JSON.stringify(f.nativeTransforms))).size, 3, row.name + ': native transforms static')
}
const report = { testedAt: new Date().toISOString(), scope: 'Native SMIL transform motion and reader nonblank temporal pixels; not full visual fidelity', chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), results }
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`SVG animation Chrome passed: ${results.length} files, three distinct frames each; ${output}`)
