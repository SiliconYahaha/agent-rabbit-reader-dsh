'use strict'

const fs = require('node:fs')
const path = require('node:path')
const cases = []
for (const close of ['Z', 'z']) {
  for (const separator of ['', ' ', ',', '\n']) {
    for (const number of ['1', '-1', '.5', '1e2', '+1', '0 0']) {
      const prefix = `M2 2L14 2L8 14${close}`
      cases.push({ name: `${close}/${JSON.stringify(separator)}/${number}`, input: `${prefix}${separator}${number} M20 20L30 30`, expected: prefix })
    }
  }
}
const publicSamples = ['x-square.svg', 'check-square.svg'].map(name => ({
  name,
  source: fs.readFileSync(path.join(__dirname, '../fixtures/svg-closepath', name), 'utf8')
}))
for (const sample of publicSamples) {
  for (const [index, match] of [...sample.source.matchAll(/ d="([^"]+)"/g)].entries()) {
    const original = match[1]
    cases.push({ name: `${sample.name}/${index}/original`, input: original, expected: original })
    const end = /[zZ]$/.test(original) ? original : `${original}z`
    cases.push({ name: `${sample.name}/${index}/corrupt`, input: `${end}1 M20 20L30 30`, expected: end })
  }
}
module.exports = { cases, publicSamples }
