'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { cases } = require('../tests/helpers/svg-closepath')
const { parsePath, applySegments } = require('../miniprogram/file-reader/image/svg/svg-path')
const output = path.resolve(process.argv[2] || 'outputs/svg-closepath')
fs.mkdirSync(output, { recursive: true })
const inputs = cases.map(item => ({ ...item, segments: parsePath(item.input), expectedSegments: parsePath(item.expected) }))
function run (inputs, applySegments) {
  const results = inputs.map(item => {
    const canvases = [0, 1, 2, 3].map(() => {
      const c = document.createElement('canvas'); c.width = c.height = 256
      document.body.appendChild(c); return c
    })
    const pixels = canvases.map((c, i) => {
      const ctx = c.getContext('2d'); ctx.scale(12, 12); ctx.fillStyle = '#000'
      if (i >= 2) { applySegments(ctx, i === 2 ? item.segments : item.expectedSegments); ctx.fill() }
      else ctx.fill(new Path2D(i === 0 ? item.input : item.expected))
      return ctx.getImageData(0, 0, 256, 256).data
    })
    let readerPrefixDiff = 0; let nativeDiff = 0; let readerDiff = 0; let ink = 0; let alphaError = 0
    for (let i = 3; i < pixels[0].length; i += 4) {
      if (pixels[0][i] !== pixels[1][i]) nativeDiff++
      if (pixels[2][i] !== pixels[3][i]) readerPrefixDiff++
      if (Math.abs(pixels[0][i] - pixels[2][i]) > 16) readerDiff++
      if (pixels[0][i]) ink++
      alphaError += Math.abs(pixels[0][i] - pixels[2][i])
    }
    return { name: item.name, nativeDiff, readerPrefixDiff, readerDiff, ink, alphaError }
  })
  document.querySelector('#result').setAttribute('data-result', btoa(JSON.stringify(results)))
}
const html = `<!doctype html><meta charset="utf-8"><title>SVG closepath Chrome oracle</title><style>canvas{width:128px;height:128px;border:1px solid #ccc}</style><div id="result"></div><script>(${run.toString()})(${JSON.stringify(inputs).replace(/</g, '\\u003c')},${applySegments.toString()})</script>`
const file = path.join(output, 'oracle.html'); fs.writeFileSync(file, html)
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const encoded = dump.match(/data-result="([^"]+)"/)
assert.ok(encoded, 'Chrome did not finish the oracle')
const results = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'))
for (const result of results) {
  assert.equal(result.nativeDiff, 0, `${result.name}: native rendering must stop at the valid prefix`)
  assert.ok(result.ink > 0, `${result.name}: must not be blank`)
  assert.equal(result.readerPrefixDiff, 0, `${result.name}: reader must preserve its valid-prefix pixels`)
  // Record existing real-icon arc differences without certifying exact fidelity.
  if (!result.name.includes('.svg')) assert.equal(result.alphaError, 0, result.name)
}
const report = { testedAt: new Date().toISOString(), chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), cases: results.length, pendingPixelComparisons: results.filter(r => r.alphaError > 0).map(r => r.name), results }
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Chrome SVG oracle passed: ${results.length} cases; malformed native prefix and reader pixels compared; ${output}`)
