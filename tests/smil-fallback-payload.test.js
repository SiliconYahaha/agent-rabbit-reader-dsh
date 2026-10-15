'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {readerPage, flush} = require('./helpers/reader-host')
const {payloadBytes, DEFAULT_DOM_CHUNK_BYTES} = require('../miniprogram/file-reader/document/view-payload')
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children || [])])
const visibleText = n => n.textFragments ? n.textFragments.map(f => f.text).join('') : n.text

test('SMIL downgrade preserves all long source text and only changes the SVG resource', async () => {
  const text = '正文中文😀\n'.repeat(80000), p = readerPage(), patches = [], native = p.setData
  p.setData = function (patch, callback) { patches.push(structuredClone(patch)); return native.call(this, patch, callback) }
  p.parseContent('<pre id="source">'+text+'</pre><svg width="20" height="20"><circle cx="10" cy="10" r="8"><animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite"/></circle></svg><button id="action">继续</button><script>document.getElementById("action").addEventListener("click",function(){this.textContent="已点击"})</script>', 'smil.html')
  const runtime = p._htmlRuntime, before = flatten(p.data.domTree), svg = before.find(n => n.svgHasSmil), button = runtime.document.getElementById('action'), start = patches.length
  assert.ok(svg); assert.notEqual(svg.attrs.src, svg.svgFallbackSrc)
  p.rememberSmilSupport('unsupported'); p.downgradeSmilImages(); await flush()
  const after = flatten(p.data.domTree)
  assert.equal(after.find(n => n.nid === svg.nid).attrs.src, svg.svgFallbackSrc)
  assert.equal(after.filter(n => n.type === 'text').map(visibleText).join(''), text+'继续')
  assert.equal(runtime.document.getElementById('source').textContent, text)
  assert.equal(runtime.document.getElementById('action'), button)
  assert.ok(patches.slice(start).length > 0)
  assert.ok(patches.slice(start).every(p => !Object.hasOwn(p, 'domTree') && payloadBytes(p) <= DEFAULT_DOM_CHUNK_BYTES))
  p.onDomTap({currentTarget:{dataset:{nid:button._nid}}}); await flush()
  assert.equal(button.textContent, '已点击'); assert.deepEqual(runtime.errors, [])
  p.detached()
})

test('static SVG decode failure cannot resend identical source or lose the next button', async () => {
  const body = '静态正文🙂\n'.repeat(40000), p = readerPage(), patches = [], native = p.setData
  p.setData = function (patch, callback) { patches.push(structuredClone(patch)); return native.call(this, patch, callback) }
  p.parseContent('<pre>'+body+'</pre><svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg><button id="next">继续</button><script>window.mediaErrors=0;document.querySelector("svg").addEventListener("error",function(){window.mediaErrors++});document.getElementById("next").onclick=function(){this.textContent="继续可用"}</script>', 'static.html')
  const svg = flatten(p.data.domTree).find(n => n.svgFallbackSrc), runtime = p._htmlRuntime
  assert.ok(svg)
  assert.equal(svg.attrs.src, svg.svgFallbackSrc)
  assert.equal(p._svgFallbackByNid[svg.nid], undefined)
  const start = patches.length
  p.onDomMediaError({ currentTarget: { dataset: { nid: svg.nid } }, detail: { errMsg: 'decode failed' } }); await flush()
  assert.equal(runtime.window.mediaErrors, 1)
  assert.equal(patches.length, start)
  assert.equal(flatten(p.data.domTree).filter(n => n.type === 'text').map(visibleText).join(''), body+'继续')
  p.onDomTap({ currentTarget: { dataset: { nid: runtime.document.getElementById('next')._nid } } }); await flush()
  assert.equal(runtime.document.getElementById('next').textContent, '继续可用')
  p.detached()
})

for (const event of ['load', 'error']) test(`old SVG ${event} callback cannot change the newly opened file`, async () => {
  const p = readerPage(), svgHtml = '<svg width="20" height="20"><circle cx="10" cy="10" r="8"><animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite"/></circle></svg>'
  p.parseContent('<p>旧正文</p>'+svgHtml, 'old.html')
  const oldRuntime = p._htmlRuntime, oldSvg = flatten(p.data.domTree).find(n => n.svgHasSmil)
  assert.ok(oldSvg)
  const oldToken = oldSvg.mediaToken
  const dispatch = oldRuntime.dispatchEvent
  oldRuntime.dispatchEvent = function (...args) {
    const result = dispatch.apply(this, args)
    p.openSelectedFile({ name: 'next.html', inlineHtml: '<p id="next">新正文</p>'+svgHtml })
    return result
  }
  const call = event === 'load' ? p.onDomMediaLoad : p.onDomMediaError
  call.call(p, { currentTarget: { dataset: { nid: oldSvg.nid } }, detail: { errMsg: 'old image callback' } }); await flush()
  assert.notEqual(p._htmlRuntime, oldRuntime)
  assert.equal(p._htmlRuntime.document.getElementById('next').textContent, '新正文')
  assert.equal(p._smilSupport, undefined)
  assert.notEqual(flatten(p.data.domTree).find(n => n.svgHasSmil).attrs.src, oldSvg.svgFallbackSrc)
  const nextRuntime = p._htmlRuntime, nextSvg = flatten(p.data.domTree).find(n => n.svgHasSmil)
  assert.notEqual(nextSvg.mediaToken, oldToken)
  let newDispatches = 0
  const nextDispatch = nextRuntime.dispatchEvent
  nextRuntime.dispatchEvent = function (...args) { newDispatches++; return nextDispatch.apply(this, args) }
  call.call(p, { currentTarget: { dataset: { nid: oldSvg.nid, mediaToken: oldToken } }, detail: { errMsg: 'late old image' } }); await flush()
  assert.equal(newDispatches, 0)
  assert.equal(p._smilSupport, undefined)
  assert.equal(p._htmlRuntime, nextRuntime)
  p.detached()
})

test('late image error from the previous source cannot affect a new source in the same file', async () => {
  const p = readerPage()
  p.parseContent('<svg width="20" height="20"><circle id="shape" cx="10" cy="10" r="6"><animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite"/></circle></svg>', 'changing-svg.html')
  const runtime = p._htmlRuntime, old = flatten(p.data.domTree).find(n => n.svgHasSmil)
  const oldSource = old.attrs.src, oldToken = old.mediaToken
  runtime.document.getElementById('shape').setAttribute('fill', '#ef4444'); await flush()
  const current = flatten(p.data.domTree).find(n => n.svgHasSmil)
  assert.notEqual(current.attrs.src, oldSource)
  assert.notEqual(current.mediaToken, oldToken)
  let dispatched = 0
  const dispatch = runtime.dispatchEvent
  runtime.dispatchEvent = function (...args) { dispatched++; return dispatch.apply(this, args) }
  p.onDomMediaError({ currentTarget: { dataset: { nid: old.nid, mediaToken: oldToken } }, detail: { errMsg: 'late source error' } }); await flush()
  assert.equal(dispatched, 0)
  assert.equal(flatten(p.data.domTree).find(n => n.svgHasSmil).attrs.src, current.attrs.src)
  assert.notEqual(p._smilSupport, 'unsupported')
  p.detached()
})
