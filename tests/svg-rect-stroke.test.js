'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const root = body => `<svg viewBox="0 0 100 100">${body}</svg>`
function context () {
  const ctx = { depth: 0, rectangles: [], paths: 0, save () { this.depth++ }, restore () { this.depth-- }, strokeRect (...box) { this.rectangles.push({ box, width: this.lineWidth, color: this.strokeStyle }) }, stroke () { this.paths++ } }
  return new Proxy(ctx, { get: (o, k) => k in o ? o[k] : () => {} })
}
test('straight rect uses rectangle coverage while rounded rect and polygon preserve paths', () => {
  const ctx = context()
  createSvgScene(root('<g fill="none" stroke="blue"><rect x="2" y="3" width="20" height="10"/><rect width="20" height="10" rx="2"/><polygon points="0,0 20,0 20,10 0,10"/></g>')).draw(ctx,100,100)
  assert.deepEqual(ctx.rectangles.map(r=>r.box), [[2,3,20,10]])
  assert.equal(ctx.paths,2); assert.equal(ctx.depth,0)
})
test('host without strokeRect preserves current-path painting', () => {
  const ctx = context(); ctx.strokeRect = undefined
  createSvgScene(root('<rect width="20" height="10" fill="none" stroke="blue"/>')).draw(ctx,100,100)
  assert.equal(ctx.paths,1); assert.equal(ctx.depth,0)
})
test('throwing rectangle host unwinds state and permits same-scene and next-file recovery', () => {
  const scene = createSvgScene(root('<g transform="translate(2 3)"><rect width="20" height="10" stroke="blue"/></g>'))
  const ctx = context(); const paint = ctx.strokeRect
  ctx.strokeRect = () => { throw new Error('host stroke failure') }
  assert.throws(()=>scene.draw(ctx,100,100), /host stroke failure/)
  assert.equal(ctx.depth,0); assert.equal(ctx.paths,0)
  ctx.strokeRect = paint; scene.draw(ctx,100,100)
  createSvgScene(root('<rect width="5" height="6" stroke="red"/>')).draw(ctx,100,100)
  assert.equal(ctx.rectangles.length,2); assert.equal(ctx.depth,0)
})
test('repeated timeline draws update geometry and stroke width without stale rectangles', () => {
  const scene = createSvgScene(root('<rect width="20" height="10" fill="none" stroke="blue" stroke-width="2"><animate attributeName="width" from="20" to="40" dur="2s" fill="freeze"/><animate attributeName="stroke-width" from="2" to="6" dur="2s" fill="freeze"/></rect>'))
  const ctx = context()
  for (const time of [0,1,2,0]) scene.draw(ctx,100,100,time)
  assert.deepEqual(ctx.rectangles.map(r=>[r.box[2],r.width]), [[20,2],[30,4],[40,6],[20,2]])
  assert.equal(ctx.depth,0)
})
