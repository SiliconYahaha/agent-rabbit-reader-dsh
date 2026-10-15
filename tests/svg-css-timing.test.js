'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { parseEasing } = require('../miniprogram/file-reader/image/svg/svg-animation')
const { cases } = require('./helpers/svg-css-timing')

function sample (id) {
  const scene = createSvgScene(cases().find(row => row.id === id).source)
  return time => scene.timeline.sample(time).get(scene.doc.byId.subject).style
}

test('CSS steps take the correct side at jumps, including start/end aliases and jump-none/both', () => {
  // CSS Easing 1 section 2.3.1, including its before-flag algorithm.
  for (const name of ['start', 'jump-start']) {
    const easing = parseEasing(`steps(4, ${name})`)
    assert.equal(easing(0), 0.25)
    assert.equal(easing(0, true), 0)
    assert.equal(easing(0.25), 0.5)
    assert.equal(easing(0.25, true), 0.25)
    assert.equal(easing(1), 1)
  }
  assert.equal(parseEasing('steps(4, end)')(1, true), 0.75)
  assert.equal(parseEasing('steps(4, jump-none)')(0.25), 1 / 3)
  assert.equal(parseEasing('steps(4, jump-none)')(0.75), 1)
  assert.equal(parseEasing('steps(4, jump-both)')(0), 1 / 5)
  assert.equal(parseEasing('steps(4, jump-both)')(1, true), 4 / 5)
  assert.equal(parseEasing('step-start')(0), 1)
  assert.equal(parseEasing('step-start')(0, true), 0)
  assert.equal(parseEasing('step-end')(1), 1)
  assert.equal(parseEasing('step-end')(1, true), 0)
})

test('easing does not move authored intermediate keyframe times', () => {
  const at = sample('ease-normal')
  assert.equal(at(1)['fill-opacity'], '1', '25% keyframe must be reached at delay + 25% of duration')
  assert.equal(at(2)['fill-opacity'], '0.2', '75% keyframe must remain at its authored time')
  // Keep the solved value after the font/stroke precision fix; serializing to
  // three decimals would reintroduce visible animation rounding errors.
  assert.equal(at(0.75)['fill-opacity'], '0.802400207696977')
})

test('keyframe-local easing controls its outgoing interval and is not painted as an animated property', () => {
  const at = sample('per-keyframe-easing')
  assert.deepEqual(at(0), { 'fill-opacity': '0.5' })
  assert.deepEqual(at(0.5), { 'fill-opacity': '1' })
  assert.deepEqual(at(1.5), { 'fill-opacity': '0.5' })
  assert.deepEqual(at(2), { 'fill-opacity': '0' })
})

test('forward delay and reverse completion sample different sides of a CSS step', () => {
  const forward = sample('steps(4,start)-normal')
  assert.equal(forward(0)['fill-opacity'], '0')
  assert.equal(forward(0.5)['fill-opacity'], '0.25')
  const reverse = sample('steps(4,start)-reverse')
  assert.equal(reverse(4.5)['fill-opacity'], '0')
  assert.equal(reverse(5)['fill-opacity'], '0')
  const reverseEnd = sample('steps(4,end)-reverse')
  assert.equal(reverseEnd(0)['fill-opacity'], '0.8')
  assert.equal(reverseEnd(0.5)['fill-opacity'], '0.8')
})

test('fractional iteration end freezes immediately, including negative delays and reverse playback', () => {
  const at = sample('fractional-reverse')
  for (const time of [2, 2.1, 2.5, 3, 20]) assert.equal(at(time)['fill-opacity'], '0.2')
})

test('invalid keyframe-local timing declarations fall back to the element timing function', () => {
  for (const row of cases().filter(row => row.id.startsWith('invalid-keyframe-'))) {
    assert.equal(sample(row.id)(0.5)['fill-opacity'], '0.25')
  }
  assert.equal(parseEasing('steps( +4 , jump-start )')(0), 0.25)
})
