'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { clockSource } = require('../miniprogram/examples/clock-source')
const template = fs.readFileSync('scripts/assets/example-art/off-work-radar.svg', 'utf8')
const now = new Date(2026, 9, 14, 17, 59, 59)
const source = clockSource(template, now)
const scene = createSvgScene(source)
const record = id => scene.doc.byId[id]
const values = time => scene.timeline.sample(0, time.getTime())
const opacity = (map, id) => Number(map.get(record(id)).attrs.opacity)
const angle = (map, id) => map.get(record(id)).transformReplace[0].args[0]

test('pure SVG hour/minute/second hands match device time independently of loading delay', () => {
  assert.doesNotMatch(source, /<script|<html|foreignObject/i)
  assert.equal(scene.timeline.hasWallclock, true)
  const date = new Date(2026, 9, 14, 9, 24, 30), frame = values(date)
  assert.equal(angle(frame, 'second'), 180)
  assert.equal(angle(frame, 'minute'), 147)
  assert.equal(angle(frame, 'hour'), 282.25)
  for (const id of ['hour', 'minute', 'second', 'party', 'waiting']) assert.deepEqual(scene.timeline.sample(500, date.getTime()).get(record(id)), frame.get(record(id)))
})
test('17:59:59 waits, 18:00 celebrates, next midnight returns to waiting', () => {
  assert.equal(opacity(values(now), 'waiting'), 1)
  assert.equal(opacity(values(now), 'party'), 0)
  const six = new Date(2026, 9, 14, 18, 0, 0)
  assert.equal(opacity(values(six), 'party'), 1)
  assert.equal(opacity(values(six), 'waiting'), 0)
  assert.equal(opacity(values(new Date(2026, 9, 15, 0, 0, 0)), 'party'), 0)
})
test('background/resume samples current time instead of replaying elapsed frames', () => {
  assert.equal(angle(values(new Date(2026, 9, 14, 9, 10, 0)), 'minute'), 60)
  assert.equal(angle(values(new Date(2026, 9, 14, 9, 20, 0)), 'minute'), 120)
})
test('ordinary animations remain document-relative; invalid wallclock expressions do not run', () => {
  for (const begin of ['wallclock(nope)', 'wallclock(18:00:00)', 'button.click', 'wallclock(2026-01-01T00:00:00+99:99)']) {
    const s = createSvgScene(`<svg><rect><animate attributeName="x" from="0" to="60" dur="60s" begin="${begin}"/></rect></svg>`)
    assert.equal(s.animated, false)
  }
  const s = createSvgScene('<svg><rect id="r"><animate attributeName="x" from="0" to="60" dur="60s"/></rect></svg>')
  assert.equal(s.timeline.hasWallclock, false)
  assert.equal(s.timeline.sample(30, 0).get(s.doc.byId.r).attrs.x, '30')
})
