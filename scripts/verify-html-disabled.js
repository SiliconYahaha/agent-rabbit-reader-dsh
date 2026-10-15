'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { samples, sourceFor, selectionSource } = require('../tests/helpers/html-disabled')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const dynamicSource = require('../compatibility/runs/2026-09-05-next-html-disabled-fieldset.json').dynamic.source
const output = path.resolve(process.argv[2] || 'outputs/html-disabled')
fs.mkdirSync(output, { recursive: true })
async function native (sources) {
  const results = []
  for (const source of sources) {
    const frame = document.createElement('iframe')
    const loaded = new Promise(resolve => { frame.onload = resolve })
    frame.srcdoc = source; document.body.appendChild(frame); await loaded
    results.push(JSON.parse(frame.contentDocument.getElementById('out').textContent)); frame.remove()
  }
  document.getElementById('result').setAttribute('data-result', btoa(JSON.stringify(results)))
}
const file = path.join(output, 'oracle.html')
fs.writeFileSync(file, '<!doctype html><div id="result"></div><script>(' + native.toString() + ')(' + JSON.stringify([...samples.map(sourceFor), dynamicSource, selectionSource]).replace(/</g, '\\u003c') + ')</script>')
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Native form oracle must finish')
const expected = JSON.parse(Buffer.from(match[1], 'base64').toString())
const normalize = value => JSON.parse(JSON.stringify(value).replace(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/g, 'rgb($1,$2,$3)'))
const results = samples.map((sample, index) => {
  const runtime = createRuntime(sourceFor(sample)); runtime.run()
  const errors = runtime.errors.map(error => String(error.message || error))
  const text = runtime.document.getElementById('out').textContent
  const actual = text ? normalize(JSON.parse(text)) : null; runtime.destroy()
  return { name: sample.name, expected: normalize(expected[index]), actual, errors, exact: JSON.stringify(normalize(expected[index])) === JSON.stringify(actual) && !errors.length }
})
const dynamicRuntime = createRuntime(dynamicSource); dynamicRuntime.run()
assert.deepEqual(dynamicRuntime.errors, [])
const dynamicActual = JSON.parse(dynamicRuntime.document.getElementById('out').textContent); dynamicRuntime.destroy()
const dynamic = { expected: expected[samples.length], actual: dynamicActual, exact: JSON.stringify(expected[samples.length]) === JSON.stringify(dynamicActual) }
const selectionRuntime = createRuntime(selectionSource); selectionRuntime.run(); assert.deepEqual(selectionRuntime.errors, [])
const selectionActual = JSON.parse(selectionRuntime.document.getElementById('out').textContent); selectionRuntime.destroy()
const selection = { expected: expected[samples.length + 1], actual: selectionActual, exact: JSON.stringify(expected[samples.length + 1]) === JSON.stringify(selectionActual) }
const report = { selection, dynamic, chrome: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), cases: results.length, exact: results.filter(r => r.exact).length, results }
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (process.argv.includes('--capture')) fs.writeFileSync('tests/fixtures/html-disabled-reference.json', JSON.stringify({ chrome: report.chrome, results: results.map(r => ({ name: r.name, expected: r.expected, sourceSha256: require('node:crypto').createHash('sha256').update(sourceFor(samples.find(s => s.name === r.name))).digest('hex') })) }, null, 2) + '\n')
console.log(JSON.stringify({ cases: report.cases, exact: report.exact, dynamicExact: dynamic.exact, selectionExact: selection.exact, failures: results.filter(r => !r.exact).map(r => r.name) }))
if (!process.argv.includes('--capture')) { assert.equal(report.exact, report.cases); assert.equal(dynamic.exact, true); assert.equal(selection.exact, true) }
