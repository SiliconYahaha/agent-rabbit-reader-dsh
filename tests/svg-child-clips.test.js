'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), zlib = require('node:zlib')
const { createClipUnion } = require('../miniprogram/file-reader/image/svg/svg-clip-union')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const root = '../miniprogram/file-reader/image/svg/vendor/pathkit/'
const kernel = require(root + 'pathkit')({ wasmBinary: zlib.brotliDecompressSync(fs.readFileSync(require.resolve(root + 'pathkit.wasm.br'))) })
const rect = (x, y, w, h) => ({ d: `M${x} ${y}h${w}v${h}h${-w}Z` })
const entries = [{ ...rect(0, 0, 80, 80), clips: [{ children: [rect(20, 0, 20, 80), rect(60, 0, 20, 80)] }] }, rect(100, 0, 20, 80)]
function context () { let depth = 0; return new Proxy({ get depth () { return depth }, save () { depth++ }, restore () { depth-- } }, { get: (t, k) => k in t ? t[k] : () => {} }) }
test('child intersections precede sibling union, with independent point membership', async () => {
  const k = await kernel, union = createClipUnion(k), result = union(entries)
  // Independent even-odd ray crossing of the output's rectangular contours.
  function contains (x, y) {
    let previous, start, inside = false
    for (const s of result.segments) {
      if (s.type === 'M') { previous = start = s; continue }
      assert.ok(s.type === 'L' || s.type === 'Z')
      const next = s.type === 'Z' ? start : s
      if ((previous.y > y) !== (next.y > y) && x < previous.x + (y - previous.y) * (next.x - previous.x) / (next.y - previous.y)) inside = !inside
      previous = next
    }
    return inside
  }
  for (let x = 5; x < 130; x += 10) assert.equal(contains(x, 40), (x >= 20 && x < 40) || (x >= 60 && x < 80) || (x >= 100 && x < 120), 'x=' + x)
  assert.equal(union([{ ...rect(0, 0, 80, 80), clips: [{ children: [] }] }, rect(100, 0, 20, 80)]).d, union([rect(100, 0, 20, 80)]).d)
})
test('nested intersections release all native paths on null and throwing operations, then recover', async () => {
  const k = await kernel
  for (const failure of ['throw', 'null']) for (let failAt = 1; failAt <= 3; failAt++) {
    let live = 0, calls = 0
    const track = p => { if (!p) return p; live++; const remove = p.delete.bind(p); p.delete = () => { live--; remove() }; return p }
    const union = createClipUnion({ FillType: k.FillType, PathOp: k.PathOp, FromSVGString: d => track(k.FromSVGString(d)), MakeFromOp: (...args) => { if (++calls === failAt) { if (failure === 'throw') throw Error('injected'); return null } return track(k.MakeFromOp(...args)) } })
    assert.throws(() => union(entries), /injected|could not resolve/); assert.equal(live, 0)
    assert.ok(union(entries).d); assert.equal(live, 0)
  }
})
test('nested geometry budgets include empty intersections and reject before native allocation', () => {
  let calls = 0
  const union = createClipUnion({ FromSVGString () { calls++; throw Error('allocated') } })
  const dense = { children: Array(64).fill(rect(0, 0, 1, 1)) }
  assert.throws(() => union([{ children: [], clips: [{ children: Array(4).fill(dense) }] }]), /256 geometry nodes/)
  assert.throws(() => union([{ children: [], clips: [{ d: 'M0 0' + 'L1 1'.repeat(2048) }] }]), /2048 segments/)
  let deep = rect(0, 0, 1, 1); for (let i = 0; i < 130; i++) deep = { children: [deep] }
  assert.throws(() => union([deep]), /128 levels/); assert.equal(calls, 0)
})
test('nested scenes bound expansion and cycles; animated clip geometry invalidates cache', async () => {
  const k = await kernel, union = createClipUnion(k), ctx = context()
  const cyclic = '<svg><defs><clipPath id="a"><rect width="80" height="80" clip-path="url(#a)"/><rect x="100" width="20" height="80"/></clipPath></defs><rect width="128" height="128" clip-path="url(#a)"/></svg>'
  let actual
  createSvgScene(cyclic, { clipUnion: e => { actual = union(e); return actual } }).draw(ctx, 128, 128, 0)
  assert.equal(actual.d, union([rect(100, 0, 20, 80)]).d); assert.equal(ctx.depth, 0)
  const source = require('./helpers/svg-child-clips').cases.find(c => c.name === 'animated-child-clip-0').source
  let calls = 0; const scene = createSvgScene(source, { clipUnion: e => { calls++; return union(e) } })
  scene.draw(ctx, 256, 256, 0); scene.draw(ctx, 256, 256, 0); assert.equal(calls, 1)
  scene.draw(ctx, 256, 256, .5); scene.draw(ctx, 256, 256, 0); assert.equal(calls, 3)
  const defs = Array.from({ length: 9 }, (_, i) => `<clipPath id="c${i}"><rect width="80" height="80" ${i < 8 ? `clip-path="url(#c${i + 1})"` : ''}/><rect width="80" height="80" ${i < 8 ? `clip-path="url(#c${i + 1})"` : ''}/></clipPath>`).join('')
  assert.throws(() => createSvgScene(`<svg>${defs}<rect width="100" height="100" clip-path="url(#c0)"/></svg>`, { clipUnion: union }).draw(ctx, 100, 100, 0), /256 geometry nodes/)
  assert.equal(ctx.depth, 0); assert.doesNotThrow(() => scene.draw(ctx, 256, 256, 0))
})
