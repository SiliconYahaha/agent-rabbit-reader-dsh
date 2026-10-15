'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createInlineImageStore } = require('../miniprogram/file-reader/document/inline-image-store')
const { readerPage, flush } = require('./helpers/reader-page')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { compactDomTreeForView, payloadBytes } = require('../miniprogram/file-reader/document/view-payload')
const { mediaQueryMatches } = require('../miniprogram/file-reader/document/media-query')
const { transformHtml } = require('../miniprogram/file-reader/document/html-compat')
const large = 'data:image/png;base64,' + Buffer.alloc(2400 * 1024, 17).toString('base64')
const find = (nodes, id) => nodes.flatMap(n => [n, ...flatten(n.children || [])]).find(n => n.attrs?.id === id)
const flatten = ns => ns.flatMap(n => [n, ...flatten(n.children || [])])

test('large inline image is deduplicated across presentation HTML and CSS; bytes remain exact', async () => {
  const writes = [], removed = []
  const store = createInlineImageStore({ writeFile: o => { writes.push(o); o.success() }, unlink: o => removed.push(o.filePath) }, '/local')
  const html = await store.rewriteStaticHtml(`<img src="${large}"><style>.bg{background:url('${large}')}</style>`)
  assert.equal(writes.length, 1)
  assert.deepEqual(Buffer.from(writes[0].data, writes[0].encoding), Buffer.alloc(2400 * 1024, 17))
  assert.equal(html.split(writes[0].filePath).length, 3)
  assert.ok(html.length < 600)
  await store.resource(large)
  assert.equal(writes.length, 1)
  store.dispose(); await flush()
  assert.deepEqual(removed, [writes[0].filePath])
  await assert.rejects(store.resource(large), /关闭/)
})

test('page opens multi-megabyte inline HTML with real script, small setData and changing image', async () => {
  const files = new Map()
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { files.set(o.filePath, o.data); o.success() }, unlink: o => files.delete(o.filePath) }) })
  const html = `<style>.modal{position:fixed;inset:0;display:grid}.modal[hidden]{display:none}</style><img id="poster" src="${large}"><button id="change">5</button><div id="modal" class="modal" hidden>不可见</div><script>const asset="${large}";document.getElementById('change').onclick=()=>{document.getElementById('poster').src=asset;document.getElementById('change').textContent='切换成功'}</script>`
  page.openSelectedFile({ name: 'large.html', inlineHtml: html })
  await flush()
  assert.equal(page.data.error, '')
  assert.equal(page.data.domMode, true)
  assert.deepEqual(page._htmlRuntime.errors, [])
  assert.equal(files.size, 1)
  const button = page._htmlRuntime.document.getElementById('change')
  page.onDomTap({ currentTarget: { dataset: { nid: button._nid } } }); await flush()
  assert.equal(button.textContent, '切换成功')
  assert.ok(page.patches.every(p => payloadBytes(p) < 160 * 1024))
  page.disposeHtmlRuntime(); await flush(); assert.equal(files.size, 0)
})

test('late image success/failure cannot replace a newly selected file', async () => {
  for (const fail of [false, true]) {
    let pending; const removed = []
    const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { pending = o }, unlink: o => removed.push(o.filePath) }) })
    page.openSelectedFile({ name: 'old.html', inlineHtml: `<img src="${large}">` })
    page.openSelectedFile({ name: 'new.html', inlineHtml: '<h1>新的文件</h1>' })
    if (fail) pending.fail({ errMsg: 'disk full' }); else pending.success()
    await flush()
    assert.equal(page.data.sourceName, 'new.html'); assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.body.textContent, '新的文件')
    assert.deepEqual(removed, [pending.filePath]); page.disposeHtmlRuntime()
  }
})

test('write failure is visible and never reports successful empty image content', async () => {
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => o.fail({ errMsg: 'disk full' }) }) })
  page.openSelectedFile({ name: 'large.html', inlineHtml: `<img src="${large}">` }); await flush()
  assert.match(page.data.error, /图片保存失败/); assert.equal(page.data.domMode, false)
  page.disposeHtmlRuntime()
})

test('dynamic export image is materialized too, without replacing script DOM identity', async () => {
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => o.success(), unlink () {} }) })
  page.openSelectedFile({ name: 'dynamic.html', inlineHtml: '<img id="out">' }); await flush()
  const image = page._htmlRuntime.document.getElementById('out')
  image.src = large; page._htmlRuntime.flush(true); await flush()
  assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true)
  assert.equal(image.src, large)
  assert.match(page.data.domTree[0].attrs.src, /^\/local\/reader-inline-/)
  assert.ok(page.patches.every(p => payloadBytes(p) < 160 * 1024))
  page.disposeHtmlRuntime()
})

test('portrait/landscape conjunctions select the correct full-width layout', () => {
  const html = '<style>.board{width:100%}.shell{display:flex;flex-direction:column}@media (orientation:landscape) and (max-width:1100px){.shell{flex-direction:row}.board{width:190px}}@media (orientation:portrait){.hint{display:block}}</style><main id="shell" class="shell"><div id="board" class="board"></div></main>'
  for (const [w, h] of [[390, 844], [844, 390], [600, 600]]) {
    const r = renderHtmlDomTree(html, { viewportWidth: w, viewportHeight: h })
    assert.match(find(r.nodes, 'shell').attrs.style, w > h ? /flex-direction:row/ : /flex-direction:column/)
    assert.equal(mediaQueryMatches('(orientation:portrait)', w, { viewportHeight: h }), w <= h)
  }
})

test('fixed-height portrait images use crop/fill, not forced widthFix aspect ratio', () => {
  const r = renderHtmlDomTree('<img id="auto" src="x"><img id="crop" style="height:100%;object-fit:cover" src="x"><img id="fill" style="width:100%;height:100%" src="x"><img id="fit" style="height:100px;object-fit:contain" src="x">')
  const c = compactDomTreeForView(r.nodes)
  assert.deepEqual(c.nodes.map(n => n.imageMode), ['widthFix', 'aspectFill', 'scaleToFill', 'aspectFit'])
})

test('static mp-html fallback keeps author-hidden overlay out of the visible tree', () => {
  global.wx = { canIUse: () => true, getWindowInfo: () => ({ windowWidth: 390 }), getDeviceInfo: () => ({ system: 'iOS' }) }
  const Parser = require('../miniprogram/file-reader/document/components/mp-html/parser')
  const Style = require('../miniprogram/file-reader/document/components/mp-html/style-plugin')
  const html = transformHtml('<style>.modal{position:fixed;inset:0;display:grid}.modal[hidden]{display:none}</style><main>正文</main><div class="modal" hidden><h2>不应弹出</h2></div><div hidden="false">也隐藏</div>').html
  const nodes = new Parser({ data: { useAnchor: true }, plugins: [new Style()] }).parse(html)
  const visible = ns => ns.filter(n => !/display:\s*none/.test(n.attrs?.style || '')).map(n => n.text || visible(n.children || [])).join('')
  assert.doesNotMatch(visible(nodes), /不应弹出|也隐藏/)
  assert.match(JSON.stringify(nodes), /正文/)
})

test('Canvas save/restore restores cached paint properties as well as recorded operations', () => {
  const { parseHtmlDocument, canvasStateForElement } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
  const canvas = parseHtmlDocument('<canvas></canvas>').document.querySelector('canvas'), context = canvas.getContext('2d')
  context.fillStyle = 'red';context.save();context.fillStyle='blue';context.restore()
  assert.equal(context.fillStyle, 'red')
  context.fillStyle='blue'
  assert.equal(canvasStateForElement(canvas).ops.filter(o=>o.name==='set:fillStyle' && o.args[0]==='blue').length,2)
})

test('unsupported image decoder and export report failure, not pending forever or empty PNG success', async () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  const runtime = createRuntime('<p id="status"></p><script>const i=new Image();i.onerror=()=>document.getElementById("status").textContent="failed";i.src="data:image/png;base64,AAAA";</script>')
  runtime.run();await flush()
  assert.equal(runtime.document.getElementById('status').textContent,'failed')
  assert.throws(()=>runtime.document.createElement('canvas').toDataURL(),/不支持/)
  runtime.destroy()
})

test('image decoder blocks network sources and suppresses late onload after runtime destruction', async () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
  let loads=0,pending
  const factory=()=>({createImage:()=>{loads++;return pending={width:2,height:2}}})
  const runtime=createRuntime('<p id="s"></p><script>const i=new Image();i.onload=()=>document.getElementById("s").textContent="loaded";i.onerror=()=>document.getElementById("s").textContent="blocked";i.src="https://example.com/private.png"</script>',{createOffscreenCanvas:factory})
  runtime.run();await flush();assert.equal(loads,0);assert.equal(runtime.document.getElementById('s').textContent,'blocked')
  const image=new runtime.window.Image();image.src='data:image/png;base64,AAAA';image.onload=()=>assert.fail('late onload')
  await flush();assert.equal(loads,1);const late=pending.onload;runtime.destroy();late();await flush()
})

test('geometry callback uses real board bounds and cannot mutate a replacement runtime', async () => {
  let geometry
  const page=readerPage({createSelectorQuery:()=>({selectAll:()=>({boundingClientRect:cb=>{geometry=cb;return{exec(){}}}})})})
  page.openSelectedFile({name:'board.html',inlineHtml:'<section id="board"></section>'});await new Promise(r=>setTimeout(r,160))
  const board=page._htmlRuntime.document.getElementById('board'), rect={id:'dom-nid-'+board._nid,left:12,top:35,width:366,height:244,right:378,bottom:279}
  geometry([rect]);assert.equal(board.getBoundingClientRect().width,366)
  const old=geometry;page.openSelectedFile({name:'next.html',inlineHtml:'<p>new</p>'});old([{...rect,width:100}])
  assert.equal(board.getBoundingClientRect().width,366);page.disposeHtmlRuntime()
})

test('limited-host PNG export preserves exact RGBA bytes, standard chunks and checksums', () => {
  const {encodeCanvasPng}=require('../miniprogram/file-reader/document/canvas-png'),{inflateSync}=require('node:zlib')
  const rgba=new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,0,100,120,140,255])
  const png=Buffer.from(encodeCanvasPng({width:2,height:2,getContext:()=>({getImageData:()=>({data:rgba})})}))
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  let offset=8;const chunks={}
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
  while(offset<png.length){const n=png.readUInt32BE(offset),name=png.toString('ascii',offset+4,offset+8);chunks[name]=png.subarray(offset+8,offset+8+n);assert.equal(crc(png.subarray(offset+4,offset+8+n)),png.readUInt32BE(offset+8+n));offset+=12+n}
  assert.deepEqual(Object.keys(chunks),['IHDR','IDAT','IEND']);assert.equal(chunks.IHDR[9],6)
  const raw=inflateSync(chunks.IDAT);assert.equal(raw[0],0);assert.equal(raw[9],0)
  assert.deepEqual(Buffer.concat([raw.subarray(1,9),raw.subarray(10)]),Buffer.from(rgba))
  assert.throws(()=>encodeCanvasPng({width:0,height:2}),/尺寸/)
})
