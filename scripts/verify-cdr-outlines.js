'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { cdrOutlineFixture } = require('../tests/helpers/cdr-outline')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const output = path.resolve(process.argv[2] || '')
assert.ok(process.argv[2] && fs.statSync(output).isDirectory(), 'provide an existing dedicated output directory')
const native = process.env.CDR_RAW_ORACLE_BIN || 'cdr2raw'
const cases = []
for (const type of [1, 2, 4, 5]) for (const caps of [0, 1, 2]) for (const join of [0, 1, 2]) {
  cases.push({ type, caps, join, stretch: 125, dashes: [4, 2] })
}
cases.push({ type: 2, stretch: 50 }, { type: 2, stretch: 0 }, { type: 0 })
const results = []
for (let i = 0; i < cases.length; i++) {
  const bytes = cdrOutlineFixture(cases[i]), file = path.join(output, `outline-reference-${i}.cdr`)
  if (fs.existsSync(file)) assert.deepEqual(fs.readFileSync(file), bytes, 'refusing overwrite of different sample')
  else fs.writeFileSync(file, bytes, { flag: 'wx' })
  const raw = execFileSync(native, [file], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  const styles = raw.split('\n').filter(line => line.trim().startsWith('setStyle('))
  assert.equal(styles.length, 1)
  const style = styles[0], svg = inspectFileBytes(bytes, { name: 'reference.cdr' }).previewSvg
  const visiblePath = svg.match(/<path\b[^>]+>/)?.[0]
  assert.ok(visiblePath && raw.includes('drawPath'))
  const attr = name => visiblePath.match(new RegExp(`${name}="([^"]*)"`))?.[1]
  const prop = name => style.match(new RegExp(`${name}: ([^,)]+)`))?.[1]
  const hidden = prop('draw:stroke') === 'none'
  assert.equal(attr('stroke'), hidden ? 'none' : prop('svg:stroke-color'))
  if (!hidden) {
    // cdr2raw prints four decimal inches, so compare within its print precision.
    assert.ok(Math.abs(Number(attr('stroke-width')) - parseFloat(prop('svg:stroke-width'))) <= 0.000051)
    if (prop('svg:stroke-linecap')) assert.equal(attr('stroke-linecap'), prop('svg:stroke-linecap'))
    if (prop('svg:stroke-linejoin')) assert.equal(attr('stroke-linejoin'), prop('svg:stroke-linejoin'))
    if (prop('draw:stroke') === 'dash') {
      const dash = attr('stroke-dasharray').split(' ').map(Number)
      assert.ok(Math.abs(dash[0] * 72 - parseFloat(prop('draw:dots1-length'))) < 0.000051)
      assert.ok(Math.abs(dash[1] * 72 - parseFloat(prop('draw:distance'))) < 0.000051)
    }
  }
  results.push({ case: i, options: cases[i], nativeStyle: style.trim(), matched: true })
}
console.log(JSON.stringify({ native: execFileSync(native, ['--version'], { encoding: 'utf8' }).trim(), cases: results.length, results }, null, 2))
