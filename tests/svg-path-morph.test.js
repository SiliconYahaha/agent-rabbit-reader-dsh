'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { parseMorphPath } = require('../miniprogram/file-reader/image/svg/svg-path-morph')
const { samples, sourceFor } = require('./helpers/svg-path-morph')
function value (sample, time) {
  const scene = createSvgScene(sourceFor(sample)), target = scene.doc.elements.find(r => r.node.name === 'path')
  const override = scene.timeline.sample(time).get(target)
  return override && override.attrs.d != null ? override.attrs.d : target.node.attrs.d
}

test('path positions interpolate between keyframes instead of jumping at midpoint', () => {
  const line = samples.find(s => s.name === 'line')
  assert.equal(value(line, 0.25), 'M12.5 10 L35 10')
  assert.equal(value(line, 0.5), 'M15 10 L40 10')
  assert.equal(value(line, 0.75), 'M17.5 10 L45 10')
  assert.equal(value(line, 1), 'M20 10 L50 10')
  assert.equal(value(samples.find(s => s.name === 'to-only'), 0.25), 'M12.5 10 L35 10')
})

test('relative controls, implicit lineto and current point after Z normalize without changing command types', () => {
  assert.deepEqual(parseMorphPath('m10 10 20 0z m10 20q5 10 20 0t20 0'), [
    { type: 'M', args: [10, 10] }, { type: 'L', args: [30, 10] }, { type: 'Z', args: [] },
    { type: 'M', args: [20, 30] }, { type: 'Q', args: [25, 40, 40, 30] }, { type: 'T', args: [60, 30] }
  ])
  assert.equal(value(samples.find(s => s.name === 'relative-mixed'), 0.25), 'M12.5 10 L35 10')
  assert.equal(value(samples.find(s => s.name === 'incompatible-h-l'), 0.25), 'M10 10 H30')
  assert.equal(value(samples.find(s => s.name === 'incompatible-h-l'), 0.5), 'M20 10 L50 10')
})

test('path grammar accepts compact arc flags and signed exponent numbers without skipping invalid data', () => {
  assert.deepEqual(parseMorphPath('M+1e1.5L+2e1-.5'), [{ type: 'M', args: [10, 0.5] }, { type: 'L', args: [20, -0.5] }])
  assert.deepEqual(parseMorphPath('M10 40A20 20 0 0110 80')[1], { type: 'A', args: [20, 20, 0, 0, 1, 10, 80] })
  for (const input of ['M,0 0', 'M0,,0', 'M0 0,', 'L0 0', 'M0 0L1', 'M0 0Z1', 'M0 0X1L2 2', 'M1e999 0', 'M0 0A1 1 0 2 1 1 1']) assert.equal(parseMorphPath(input), null, input)
})

test('an invalid animated path value disables the animation and preserves the valid base path', () => {
  for (const name of ['invalid-command', 'truncated-command', 'closepath-extra-number', 'invalid-arc-flag', 'nonfinite-number']) {
    const sample = samples.find(s => s.name === name), scene = createSvgScene(sourceFor(sample))
    assert.equal(scene.animated, false, name)
    assert.equal(value(sample, 0.75), sample.from, name)
  }
})

test('discrete SMIL divides default duration by value count and honors explicit keyTimes', () => {
  assert.equal(value(samples.find(s => s.name === 'discrete'), 0.49), 'M10 10 L30 10')
  assert.equal(value(samples.find(s => s.name === 'discrete'), 0.5), 'M20 10 L50 10')
  const sample = { base: 'M0 0L10 0', attrs: { values: 'M0 0L10 0;M10 0L20 0;M20 0L30 0', calcMode: 'discrete' } }
  assert.equal(value(sample, 0.34), 'M10 0 L20 0')
  assert.equal(value(sample, 0.67), 'M20 0 L30 0')
  sample.attrs.keyTimes = '0;0.7;1'
  assert.equal(value(sample, 0.5), 'M0 0 L10 0')
})

test('32 dimension/timing variants contain true intermediate coordinates and do not mutate the source', () => {
  for (const sample of samples.filter(s => s.name.startsWith('generated-'))) {
    const source = sourceFor(sample), scene = createSvgScene(source), target = scene.doc.elements.find(r => r.node.name === 'path'), before = target.node.attrs.d
    const duration = Number.parseFloat(sample.attrs.dur)
    const frames = [0, 0.25, 0.5, 0.75].map(t => scene.timeline.sample(t * duration).get(target).attrs.d)
    assert.equal(new Set(frames).size, 4, sample.name)
    assert.equal(target.node.attrs.d, before)
    assert.deepEqual(JSON.parse(JSON.stringify(scene.timeline.sample(duration * 0.25).get(target).attrs)), { d: frames[1] })
  }
})

test('long valid morphs retain every segment and malformed tails terminate within a process budget', () => {
  const modulePath = path.resolve(__dirname, '../miniprogram/file-reader/image/svg/svg-path-morph.js')
  const result = spawnSync(process.execPath, ['-e', `
    const {parseMorphPath,interpolatePath}=require(${JSON.stringify(modulePath)});
    const a=parseMorphPath('M0 0'+'l1 1'.repeat(4000)),b=parseMorphPath('M0 0'+'l2 2'.repeat(4000));
    const mid=interpolatePath({kind:'path',value:a},{kind:'path',value:b},0.5);
    process.stdout.write(JSON.stringify({count:mid.value.length,last:mid.value.at(-1).args,bad:parseMorphPath('M0 0Z'+'1 '.repeat(100000))}));
  `], { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 })
  assert.equal(result.status, 0, String(result.error || result.stderr))
  assert.deepEqual(JSON.parse(result.stdout), { count: 4001, last: [6000, 6000], bad: null })
})


test('empty from/to paths keep discrete disappearance; empty values entries invalidate the entire animation', () => {
  assert.equal(value(samples.find(s => s.name === 'empty-from'), 0.25), '')
  assert.equal(value(samples.find(s => s.name === 'empty-to'), 0.75), '')
  assert.equal(value(samples.find(s => s.name === 'to-only-invalid-base-tail'), 0.25), 'M12.5 10 L35 10')
  for (const name of ['values-empty-start', 'values-empty-middle', 'values-double-trailing-semicolon', 'values-only-empty']) {
    const sample = samples.find(s => s.name === name)
    assert.equal(createSvgScene(sourceFor(sample)).animated, false)
    assert.equal(value(sample, 0.75), sample.base)
  }
  assert.equal(value(samples.find(s => s.name === 'values-trailing-semicolon'), 0.25), 'M12.5 10 L35 10')
})
