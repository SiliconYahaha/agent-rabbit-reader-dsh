'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSvgScene } = require('../miniprogram/file-reader/image')
const { chainSource, invalidCases, cases } = require('./helpers/svg-clip-chains')
function context () {
  const ctx = { depth: 0, clips: 0, empty: 0, points: 0,
    save () { this.depth++ }, restore () { this.depth-- },
    beginPath () { this.points = 0 }, moveTo () { this.points++ }, lineTo () { this.points++ },
    clip () { this.clips++; if (!this.points) this.empty++ }
  }
  return new Proxy(ctx,{get:(o,k)=>k in o?o[k]:['getTransform','roundRect','ellipse'].includes(k)?undefined:()=>{}})
}
test('64 clip references complete; 65 fail explicitly and restore shared Canvas state', () => {
  const ctx=context(), within=createSvgScene(chainSource(64)), excessive=createSvgScene(chainSource(65))
  within.draw(ctx,256,256,0);assert.equal(ctx.clips,64);assert.equal(ctx.empty,0);assert.equal(ctx.depth,0)
  for(let i=0;i<3;i++) {
    assert.throws(()=>excessive.draw(ctx,256,256,i),/clipping reference nesting exceeds 64/)
    assert.equal(ctx.depth,0)
    const before=ctx.clips;within.draw(ctx,256,256,i);assert.equal(ctx.clips-before,64);assert.equal(ctx.depth,0)
  }
})
test('invalid clipping cycles terminate with empty clips and subsequent files still draw', () => {
  for(const input of invalidCases) {
    const ctx=context(), scene=createSvgScene(input.source)
    scene.draw(ctx,256,256,0);assert.equal(ctx.empty,1);assert.ok(ctx.clips<=3);assert.equal(ctx.depth,0)
    const before=ctx.clips;createSvgScene(cases[0].source).draw(ctx,256,256,0)
    assert.equal(ctx.clips-before,2);assert.equal(ctx.empty,1);assert.equal(ctx.depth,0)
  }
})
