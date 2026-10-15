'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
function setup (options = {}) {
  const surfaces = []
  const r = createRuntime('<canvas id="c" width="2048" height="2048"></canvas>', { createOffscreenCanvas: config => {
    if (options.failCreate?.()) throw Error('allocation refused')
    let width = config.width, height = config.height
    const context = { fillRect () {}, getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255]) }) }
    const canvas = { get width () { return width }, set width (v) { if (options.failResize?.('width', v)) throw Error('resize refused'); width = v }, get height () { return height }, set height (v) { if (options.failResize?.('height', v)) throw Error('resize refused'); height = v }, getContext: () => context }
    surfaces.push(canvas); return canvas
  } }); r.run()
  const c = r.document.getElementById('c'), ctx = c.getContext('2d')
  const create = (w = 4096, h = 4096) => { const n = r.document.createElement('canvas'); n.width = w; n.height = h; const x = n.getContext('2d'); x.getImageData(0, 0, 1, 1); return n }
  return { r, c, ctx, surfaces, create }
}
test('repeated shrinking and growing one backing charges live pixels, not historical allocations', () => {
  const x = setup()
  try { for (let i = 0; i < 80; i++) { x.c.width = 1; x.c.width = 2048; x.ctx.fillRect(0, 0, 1, 1) } assert.equal(x.surfaces.length, 1); assert.equal(x.surfaces[0].width, 2048) } finally { x.r.destroy() }
})
test('zero size releases capacity that another real backing can use', () => {
  const x = setup()
  try { x.c.width = 4096; x.c.height = 4096; const second = x.create(); x.c.width = 0; const third = x.create(); assert.equal(third.width, 4096); assert.equal(second.height, 4096); assert.throws(() => x.create(), /像素/); assert.equal(x.surfaces.length, 3) } finally { x.r.destroy() }
})
test('failed native creation does not poison later allocations in the same document', () => {
  let failing = true
  const x = setup({ failCreate: () => failing })
  try { for (let i = 0; i < 12; i++) assert.throws(() => x.create(), /allocation refused/); failing = false; assert.equal(x.create().width, 4096); assert.equal(x.surfaces.length, 1) } finally { x.r.destroy() }
})
test('failed resize preserves dimensions, styles, replay and budget for a retry', () => {
  let failing = true
  const x = setup({ failResize: () => failing })
  try {
    x.ctx.fillStyle = 'red'; const before = x.c._canvasState.rev
    for (let i = 0; i < 12; i++) assert.throws(() => { x.c.width = 4096 }, /resize refused/)
    assert.equal(x.c.width, 2048); assert.equal(x.surfaces[0].width, 2048); assert.equal(x.ctx.fillStyle, 'red'); assert.equal(x.c._canvasState.rev, before)
    failing = false; x.c.width = 4096; assert.equal(x.ctx.fillStyle, '#000000'); assert.equal(x.surfaces[0].width, 4096)
  } finally { failing = false; x.r.destroy() }
})
test('global capacity remains bounded and denied resize never corrupts author dimensions', () => {
  const x = setup()
  try { x.c.width = 4096; x.c.height = 4096; x.create(); const extra = x.r.document.createElement('canvas'); extra.width = 0; extra.height = 1; extra.getContext('2d'); assert.throws(() => { extra.width = 1 }, /像素/); assert.equal(extra.width, 0); assert.equal(x.surfaces.at(-1).width, 0) } finally { x.r.destroy() }
})
test('removeAttribute resize failure restores the original attribute including case metadata', () => {
  let failing = false
  const x = setup({ failResize: () => failing })
  try { x.c.setAttribute('WIDTH', 200); failing = true; assert.throws(() => x.c.removeAttribute('width'), /refused/); assert.equal(x.c.getAttribute('width'), '200'); assert.equal(x.c._attrCase.width, 'WIDTH') } finally { failing = false; x.r.destroy() }
})
test('same-size resets neither leak nor free the backing allocation', () => {
  const x = setup()
  try { x.c.width = 4096; x.c.height = 4096; for (let i = 0; i < 80; i++) x.c.width = 4096; x.create(); assert.throws(() => x.create(), /像素/) } finally { x.r.destroy() }
})
test('failed shrinking keeps its quota and a later height reset releases it', () => {
  let failing = false
  const x = setup({ failResize: key => failing && key === 'height' })
  try {
    x.c.width = 4096; x.c.height = 4096; x.create(); failing = true
    assert.throws(() => { x.c.height = 0 }, /refused/)
    assert.equal(x.c.height, 4096); assert.equal(x.surfaces[0].height, 4096)
    assert.throws(() => x.create(), /像素/)
    failing = false; x.c.height = 0; assert.equal(x.create().height, 4096)
  } finally { failing = false; x.r.destroy() }
})
test('native height growth failure refunds its reservation', () => {
  let failing = true
  const x = setup({ failResize: key => failing && key === 'height' })
  try {
    for (let i = 0; i < 12; i++) assert.throws(() => { x.c.height = 4096 }, /refused/)
    assert.equal(x.c.height, 2048); failing = false; x.c.height = 4096
    assert.equal(x.create().width, 4096)
  } finally { failing = false; x.r.destroy() }
})
test('shrinking one file cannot donate its released quota to another file', () => {
  const a = setup(), b = setup()
  try { a.c.width = 4096; a.c.height = 4096; a.create(); b.c.width = 0; assert.throws(() => a.create(), /像素/); a.r.destroy(); assert.equal(b.create().width, 4096) } finally { b.r.destroy() }
})
