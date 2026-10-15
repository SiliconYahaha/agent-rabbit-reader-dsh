'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const root = body => `<svg viewBox="0 0 256 256">${body}</svg>`
const nested = (body, attrs = '') => `<svg x="20" y="20" width="96" height="48" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice" ${attrs}>${body}</svg>`
const rect = '<rect width="64" height="16"/>'
function context () {
  const ctx = { depth: 0, fills: 0, strokes: 0, save () { this.depth++ }, restore () { this.depth-- }, fill () { this.fills++ }, fillRect () { this.fills++ }, stroke () { this.strokes++ }, strokeRect () { this.strokes++ } }
  return new Proxy(ctx, { get: (o, k) => k in o ? o[k] : () => {} })
}
function count (source, time = 0) { const ctx = context(); createSvgScene(source).draw(ctx, 1170, 1170, time); assert.equal(ctx.depth, 0); return ctx }
test('exact viewport edge contact is culled but a positive-area sliver remains', () => {
  for (const [y, fills] of [[0, 0], [-.1, 0], [.1, 1]]) assert.equal(count(root(nested(`<rect y="${y}" width="64" height="16"/>`))).fills, fills)
})
test('stroke extending across a clipped fill keeps both paint operations', () => {
  const ctx = count(root(nested('<rect width="64" height="16" stroke="blue" stroke-width="2"/>')))
  assert.equal(ctx.fills, 1); assert.equal(ctx.strokes, 1)
})
test('use translation and group reflection preserve visible and fully clipped instances', () => {
  const source = root('<defs><rect id="tile" width="64" height="16"/></defs>' + nested('<use href="#tile"/><use href="#tile" y="8"/><g transform="translate(64 64) scale(-1 -1)"><use href="#tile"/></g>'))
  assert.equal(count(source).fills, 1)
})
test('visible inner overflow respects ancestor clips while root siblings restore clip state', () => {
  assert.equal(count(root(nested(rect, 'overflow="visible"'))).fills, 1)
  assert.equal(count(root(nested('<svg overflow="visible" width="64" height="64">'+rect+'</svg>') + '<rect x="160" y="160" width="50" height="50"/>')).fills, 1)
})
test('a timeline can repeatedly enter and leave the viewport without stale culling', () => {
  const scene = createSvgScene(root(nested('<rect width="64" height="16"><animate attributeName="y" from="0" to="32" dur="2s" fill="freeze"/></rect>')))
  for (const [time, fills] of [[0,0],[.5,1],[2,1],[0,0]]) { const ctx = context(); scene.draw(ctx,1170,1170,time); assert.equal(ctx.fills,fills); assert.equal(ctx.depth,0) }
})
test('host painting failure restores viewport state for the next draw', () => {
  const scene = createSvgScene(root(nested('<rect width="64" height="64"/>') + '<rect x="160" y="160" width="50" height="50"/>'))
  const ctx = context(); ctx.fillRect = () => { throw new Error('paint failure') }
  assert.throws(() => scene.draw(ctx,1170,1170), /paint failure/); assert.equal(ctx.depth,0)
  const next = context(); scene.draw(next,1170,1170); assert.equal(next.fills,2); assert.equal(next.depth,0)
})
