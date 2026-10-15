'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')

function svgLines (svg) {
  return [...svg.matchAll(/<path\b[^>]*\bdata-dxf-block="[^"]*"[^>]*>/g)].map(m => {
    const d = m[0].match(/\bd="([^"]*)"/)[1]
    const numbers = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/ig).map(Number)
    if (numbers.length !== 4) throw Error('Probe expects original straight LINE entities')
    return [[numbers[0], -numbers[1], 0], [numbers[2], -numbers[3], 0]]
  })
}
function compare (actual, expected) {
  const remaining = expected.map(line => line)
  // SVG serializes coordinates to4 decimal places. Compare in world units
  // within the half-unit quantization bound, not against a scaled screenshot.
  const point = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 0.000051)
  let exact = 0
  for (const line of actual) {
    const index = remaining.findIndex(other => (point(line[0], other[0]) && point(line[1], other[1])) || (point(line[0], other[1]) && point(line[1], other[0])))
    if (index >= 0) { exact++; remaining.splice(index, 1) }
  }
  return { exact, actual: actual.length, expected: expected.length, missing: remaining.length, unmatched: actual.length - exact, allExact: exact === actual.length && remaining.length === 0 }
}
function main () {
  const source = process.argv[2] || 'outputs/dxf-insert-grid/native/reference.json', out = path.resolve(process.argv[3] || 'outputs/dxf-insert-grid/current')
  fs.mkdirSync(out, { recursive: true })
  const report = JSON.parse(fs.readFileSync(source))
  for (const row of report.rows) {
    const bytes = Buffer.from(row.base64, 'base64'); if (sha(bytes) !== row.sha256) throw Error('Source hash mismatch')
    try {
      const info = inspectFileBytes(bytes, { name: row.name + '.dxf' })
      fs.writeFileSync(path.join(out, row.name + '.svg'), info.previewSvg)
      row.readerLines = svgLines(info.previewSvg)
      const referenceKey = process.argv[4] || 'nativeLines'
      if (!Array.isArray(row[referenceKey])) throw Error('Missing independent reference: ' + referenceKey)
      row.reader = { ...compare(row.readerLines, row[referenceKey]), referenceKey }
    } catch (error) { row.reader = { error: error.message } }
  }
  report.probedAt = new Date().toISOString()
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ sources: report.rows.length, exactDrawings: report.rows.filter(r => r.reader.allExact).length, wrongDrawings: report.rows.filter(r => !r.reader.allExact).map(r => r.name) }))
}
if (require.main === module) main()
module.exports = { svgLines, compare }
