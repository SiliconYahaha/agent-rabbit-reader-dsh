'use strict'
const samples = [
  { name: 'empty-from', from: '', to: 'M20 10L50 10' },
  { name: 'empty-to', from: 'M10 10L30 10', to: '' },
  { name: 'both-empty', from: '', to: '' },
  { name: 'values-trailing-semicolon', base: 'M10 10L30 10', attrs: { values: 'M10 10L30 10;M20 10L50 10;' } },
  { name: 'values-double-trailing-semicolon', base: 'M10 10L30 10', attrs: { values: 'M10 10L30 10;M20 10L50 10;;' } },
  { name: 'values-only-empty', base: 'M10 10L30 10', attrs: { values: '' } },
  { name: 'values-empty-start', base: 'M10 10L30 10', attrs: { values: ';M20 10L50 10;M30 20L60 20' } },
  { name: 'values-empty-middle', base: 'M10 10L30 10', attrs: { values: 'M10 10L30 10;;M30 20L60 20' } },
  { name: 'line', from: 'M10 10L30 10', to: 'M20 10L50 10' },
  { name: 'relative-mixed', from: 'M10 10l20 0', to: 'm20 10L50 10' },
  { name: 'implicit-lines', from: 'm10 10 10 20 20-10z', to: 'M20 20L40 50L70 30Z' },
  { name: 'horizontal-vertical', from: 'M10 10h20v30H0z', to: 'M20 20H60V70h-50Z' },
  { name: 'cubic-smooth', from: 'M10 40c10-20 20-20 30 0s20 20 30 0', to: 'M20 50C40 0 50 0 60 50S80 90 90 50' },
  { name: 'quadratic-smooth', from: 'M10 40q20-20 40 0t40 0', to: 'M10 50Q30 10 50 50T90 50' },
  { name: 'closed-subpaths', from: 'M10 10l20 0v20z m10 30q10 10 20 0', to: 'm20 20L60 20V60Z M40 80Q60 100 80 80' },
  { name: 'arc-parameters', from: 'M10 40A30 20 0 0 1 70 40', to: 'm20 50a40 30 30 0 1 60 0' },
  { name: 'arc-flags-chrome', from: 'M10 40A20 20 0 0 0 50 40', to: 'M10 40A20 20 0 1 1 50 40' },
  { name: 'compact-arc-flags', from: 'M10 40A20 20 0 0110 80', to: 'M20 30A30 30 0 0150 60' },
  { name: 'signed-exponent', from: 'M+1e1.5L+2e1-.5', to: 'm+2e1+1.5l+3e1-2.5' },
  { name: 'incompatible-h-l', from: 'M10 10H30', to: 'M20 10L50 10' },
  { name: 'incompatible-q-c', from: 'M10 40Q30 10 50 40', to: 'M20 40C30 10 40 10 60 40' },
  { name: 'incompatible-count', from: 'M10 10L30 10', to: 'M20 10L50 10L50 30' },
  { name: 'invalid-command', from: 'M10 10L30 10', to: 'M20 10L50 10X2' },
  { name: 'truncated-command', from: 'M10 10L30 10', to: 'M20 10L50' },
  { name: 'closepath-extra-number', from: 'M10 10L30 10Z', to: 'M20 10L50 10Z1' },
  { name: 'invalid-arc-flag', from: 'M10 40A20 20 0 0 0 50 40', to: 'M10 40A20 20 0 2 1 50 40' },
  { name: 'nonfinite-number', from: 'M10 10L30 10', to: 'M1e999 10L50 10' },
  { name: 'signed-arc-radius', from: 'M10 40A20 20 0 0 0 50 40', to: 'M10 40A-20 20 0 0 1 50 40' },
  { name: 'to-only-invalid-base-tail', base: 'M10 10L30 10X2', to: 'M20 10L50 10' },
  { name: 'to-only', base: 'M10 10L30 10', to: 'M20 10L50 10' },
  { name: 'spline', from: 'M10 10L30 10', to: 'M20 10L50 10', attrs: { calcMode: 'spline', keySplines: '0.42 0 0.58 1', keyTimes: '0;1' } },
  { name: 'discrete', from: 'M10 10L30 10', to: 'M20 10L50 10', attrs: { calcMode: 'discrete' } },
  { name: 'key-times', base: 'M10 10L30 10', attrs: { values: 'M10 10L30 10;M20 10L40 10;M40 10L60 10', keyTimes: '0;0.2;1' } }
]
for (let i = 1; i <= 32; i++) samples.push({ name: `generated-${i}`, from: `M${i} ${i}q${i} ${-i} ${2*i} 0t${2*i} 0z`, to: `m${i+5} ${i+3}q${i+1} ${-i-8} ${2*i} 0t${2*i} 0z`, attrs: { dur: `${1 + i / 32}s` } })
// Pinned BSD-3-Clause WPT inputs; extract literal attributes without executing
// the upstream test harness or treating source comments as instructions.
const fs = require('node:fs'), path = require('node:path')
const publicDir = path.join(__dirname, '../fixtures/svg-path-morph/public')
for (const name of fs.readdirSync(publicDir).filter(name => name.endsWith('.html')).sort()) {
  const text = fs.readFileSync(path.join(publicDir, name), 'utf8')
  const attrs = { fill: 'remove' }
  for (const match of text.matchAll(/animate\.setAttribute\("([^"\n]+)", ['"]([^'"\n]*)['"]\)/g)) if (match[1] !== 'id') attrs[match[1]] = match[2]
  const base = text.match(/path\.setAttribute\("d", ['"]([^'"\n]*)['"]\)/)[1]
  const times = [...text.matchAll(/\["animation",\s*([\d.]+),/g)].map(match => Number(match[1]))
  samples.push({ name, base, attrs, times, public: true })
}
const escape = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
function sourceFor (sample) {
  const attrs = { attributeName: 'd', dur: '1s', fill: 'freeze', ...sample.attrs }
  if (sample.from != null) attrs.from = sample.from
  if (sample.to != null) attrs.to = sample.to
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sample.public ? '-400 -400 1000 1000' : '0 0 150 150'}"><path d="${escape(sample.base || sample.from || '')}" fill="none" stroke="black"><animate ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}/></path></svg>`
}
module.exports = { samples, sourceFor, escape }
