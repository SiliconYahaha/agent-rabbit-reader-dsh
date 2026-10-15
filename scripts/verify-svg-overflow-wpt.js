'use strict'
// Full, unmodified public HTML documents are compared to their official references.
// The known auto disagreement is reported, never substituted with our own reference.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const root = path.resolve('tests/fixtures/svg-overflow'), rows = require('../tests/fixtures/svg-overflow/sources.json')
const output = path.resolve(process.argv[2] || 'outputs/svg-overflow-wpt')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
fs.mkdirSync(output, { recursive: true })
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=400,300']
for (const name of new Set(rows.flatMap(r => [r.name, r.reference]))) {
  execFileSync(chrome, [...args, '--screenshot=' + path.join(output, name + '.png'), pathToFileURL(path.join(root, name)).href], { timeout: 60000, stdio: 'ignore' })
}
const inputs = rows.map(r => ({ name: r.name, actual: fs.readFileSync(path.join(output, r.name + '.png')).toString('base64'), expected: fs.readFileSync(path.join(output, r.reference + '.png')).toString('base64') }))
async function compare (inputs) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), results = []
  for (const input of inputs) {
    const images = await Promise.all([input.actual, input.expected].map(async data => { const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode(); return image }))
    canvas.width = images[0].width; canvas.height = images[0].height
    const buffers = images.map(image => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height).data })
    let rgbaError = 0, maxChannelError = 0, changedPixels = 0
    for (let i = 0; i < buffers[0].length; i += 4) { let changed = false; for (let j = 0; j < 4; j++) { const d = Math.abs(buffers[0][i + j] - buffers[1][i + j]); rgbaError += d; maxChannelError = Math.max(maxChannelError, d); changed ||= d > 0 } if (changed) changedPixels++ }
    results.push({ name: input.name, width: canvas.width, height: canvas.height, rgbaError, maxChannelError, changedPixels })
  }
  document.body.setAttribute('data-result', btoa(JSON.stringify(results)))
}
const html = path.join(output, 'compare.html')
fs.writeFileSync(html, '<!doctype html><body><script>(' + compare.toString() + ')(' + JSON.stringify(inputs) + ')</script>')
const dump = execFileSync(chrome, [...args, '--dump-dom', '--virtual-time-budget=3000', pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Public screenshot comparison did not finish')
const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
const report = { mode: process.argv.includes('--discover') ? 'discovery' : 'strict', testedAt: new Date().toISOString(), chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), scope: 'Complete unmodified WPT HTML screenshots against official references; not WeChat player conformance', results }
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!process.argv.includes('--discover')) assert.ok(results.every(r => r.rgbaError === 0), 'Official WPT reference mismatch; use --discover to preserve failures')
