'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { parsePath, applySegments } = require('../miniprogram/file-reader/image/svg/svg-path')
const { samples, sourceFor, escape } = require('../tests/helpers/svg-path-morph')
const output = path.resolve(process.argv[2] || 'outputs/svg-path-morph')
const inputs = samples.map(sample => ({ name: sample.name, source: sourceFor(sample), times: sample.times, public: sample.public }))
const originals = process.argv[3]
const sourceFiles = []
if (originals) {
  for (const name of fs.readdirSync(originals).filter(name => name.endsWith('.svg')).sort()) {
    const bytes = fs.readFileSync(path.join(originals, name)), scene = createSvgScene(bytes.toString('utf8'))
    let count = 0
    for (const record of scene.doc.elements.filter(r => r.node.name === 'animate' && r.node.attrs.attributeName === 'd')) {
      const attrs = Object.entries(record.node.attrs).filter(([key]) => !['id', 'href', 'xlink:href'].includes(key)).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')
      inputs.push({ name: `${name}/path-${++count}`, original: name, source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><path d="${escape(record.parent.node.attrs.d || '')}"><animate ${attrs}/></path></svg>` })
    }
    sourceFiles.push({ name, bytes: bytes.length, sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'), pathAnimations: count })
  }
}
for (const input of inputs) {
  const scene = createSvgScene(input.source), target = scene.doc.elements.find(r => r.node.name === 'path')
  input.frames = (input.times || [0, 0.007, 0.013, 0.125, 0.25, 0.49, 0.5, 0.75, 1]).map(time => {
    const override = scene.timeline.sample(time).get(target), d = override && override.attrs.d != null ? override.attrs.d : target.node.attrs.d
    return { time, d, segments: parsePath(d) }
  })
}
async function run (inputs, applySegments) {
  const results = []
  for (const input of inputs) {
    const svg = new DOMParser().parseFromString(input.source, 'image/svg+xml').documentElement
    document.body.appendChild(svg); await new Promise(resolve => setTimeout(resolve, 1)); svg.pauseAnimations()
    const native = svg.querySelector('path'), reader = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.appendChild(reader)
    const serialized = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.appendChild(serialized)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')
    const frames = input.frames.map(frame => {
      try {
      svg.setCurrentTime(frame.time); reader.setAttribute('d', frame.d)
      const nativeD = getComputedStyle(native).d
      const match = nativeD.match(/^path\("([\s\S]*)"\)$/)
      serialized.setAttribute('d', match ? match[1] : '')
      const nativeLength = native.getTotalLength(), readerLength = reader.getTotalLength(), serializedLength = serialized.getTotalLength()
      let maxPointError = 0, serializationPointError = 0, coordinateScale = Math.max(1, nativeLength, readerLength)
      const point = (element, distance) => { try { return element.getPointAtLength(distance) } catch (_) { return null } }
      for (let i = 0; i <= 16; i++) {
        const a = point(native, nativeLength * i / 16), b = point(reader, readerLength * i / 16)
        const c = point(serialized, serializedLength * i / 16)
        if (!!a !== !!b || !!a !== !!c) throw Error('Only one path has geometry')
        if (a) { serializationPointError = Math.max(serializationPointError, Math.hypot(a.x - c.x, a.y - c.y)); maxPointError = Math.max(maxPointError, Math.hypot(a.x - b.x, a.y - b.y)); coordinateScale = Math.max(coordinateScale, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y)) }
      }
      // SVGGeometryElement exposes float lengths/distances. Use a small
      // absolute floor plus four float32 epsilons at this geometry's scale.
      const geometryTolerance = 0.0001 + coordinateScale * 2 ** -21
      // Measure native animation → computed d → native static path round-trip
      // noise separately instead of hiding serialization drift in a larger constant.
      const serializationLengthError = Math.abs(nativeLength - serializedLength)
      const lengthTolerance = geometryTolerance + serializationLengthError
      const pointTolerance = geometryTolerance + serializationPointError
      const scale = input.original || input.public ? 0.25 : 1
      const draw = isNative => {
        ctx.reset(); ctx.scale(scale, scale); if (input.public) ctx.translate(400, 400); ctx.lineWidth = 2 / scale
        if (isNative) { if (match) ctx.stroke(new Path2D(match[1])) }
        else { applySegments(ctx, frame.segments); ctx.stroke() }
        return ctx.getImageData(0, 0, 256, 256).data
      }
      const a = draw(true), b = draw(false); let alphaError = 0, ink = 0, readerInk = 0
      for (let i = 3; i < a.length; i += 4) { alphaError += Math.abs(a[i] - b[i]); if (a[i]) ink++; if (b[i]) readerInk++ }
      return { time: frame.time, nativeD, readerD: frame.d, nativeLength, readerLength, maxPointError, geometryTolerance, serializationLengthError, serializationPointError, lengthTolerance, pointTolerance, alphaError, ink, readerInk }
      } catch (error) { return { time: frame.time, error: error.message, readerD: frame.d } }
    })
    results.push({ name: input.name, frames }); svg.remove()
  }
  document.querySelector('#result').setAttribute('data-result', btoa(JSON.stringify(results)))
}
fs.mkdirSync(output, { recursive: true })
const file = path.join(output, 'oracle.html')
fs.writeFileSync(file, '<!doctype html><div id="result"></div><script>window.onerror=m=>document.querySelector("#result").setAttribute("data-error",m);(' + run.toString() + ')(' + JSON.stringify(inputs).replace(/</g, '\\u003c') + ',' + applySegments.toString() + ')</script>')
const chrome = require('./svg-path-oracle-chrome').oracleChrome(process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'))
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Chrome morph oracle did not finish: ' + (dump.match(/data-error="([^"]+)"/) || [])[1])
const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
const failures = results.filter(r => r.frames.some(f => (f.ink > 0 && !f.readerInk) || f.error || Math.abs(f.nativeLength - f.readerLength) > f.lengthTolerance || f.maxPointError > f.pointTolerance))
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), cases: results.length, samples: sourceFiles, failures: failures.map(r => r.name), results }, null, 2) + '\n')
console.log(JSON.stringify({ cases: results.length, geometryFailures: failures.map(r => ({ name: r.name, frames: r.frames.filter(f => (f.ink > 0 && !f.readerInk) || f.error || Math.abs(f.nativeLength - f.readerLength) > f.lengthTolerance || f.maxPointError > f.pointTolerance) })), output }, null, 2))
assert.equal(failures.length, 0, 'Native animated geometry mismatch; inspect report')
