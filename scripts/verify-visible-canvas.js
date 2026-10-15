'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict')
const { bundle } = require('./verify-inline-poster'), { chromeTestResult } = require('./chrome-test-result'), { png } = require('../tests/helpers/inline-poster')
const fixtures = ['transform', 'alpha', 'clip'].map(kind => ({ name: `2d.drawImage.${kind}.html`, source: fs.readFileSync(path.join(__dirname, '../tests/fixtures/visible-canvas', `2d.drawImage.${kind}.html`), 'utf8') }))
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-visible-canvas-'))
const hashes = {
  '2d.drawImage.alpha.html': '2a696834cde1abebc7cd3c0f48f65836686f91df88f35caa83c9b8f1975ee8e8',
  '2d.drawImage.clip.html': '65b85c6da9704e382cd3daa2dbfd511a7d3786ff27d83670e2c1c0969f7e399c',
  '2d.drawImage.transform.html': 'b6f8cac1d9c8d3bab2f131a08126e068f7a2280f91aa7d10cd57694d0b353599'
}
const sha256 = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex')

// This adapter executes the unmodified WPT body in native Chrome, captures its
// commands, then feeds those commands to the actual Page presenter. It is NOT
// a claim that sandbox fetch/createImageBitmap or the full WPT harness work.
function publicHarness () {
  window.publicDone = false; window.publicErrors = []; window.recordedOps = []
  const getContext = HTMLCanvasElement.prototype.getContext, contexts = new WeakMap()
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const raw = getContext.call(this, type, ...rest)
    if (this.id !== 'c' || type !== '2d') return raw
    if (contexts.has(this)) return contexts.get(this)
    const wrapped = new Proxy(raw, {
      get (target, key) {
        if (typeof target[key] !== 'function') return target[key]
        return (...args) => {
          if (key === 'drawImage') {
            const c = document.createElement('canvas'); c.width = args[0].width; c.height = args[0].height
            getContext.call(c, '2d').drawImage(args[0], 0, 0)
            window.recordedOps.push({ name: key, args: [{ __canvasImage: c.toDataURL() }, ...args.slice(1)] })
          } else if (['fillRect', 'translate', 'rect', 'clip'].includes(key)) window.recordedOps.push({ name: key, args })
          return target[key](...args)
        }
      },
      set (target, key, value) { window.recordedOps.push({ name: 'set:' + key, args: [value] }); target[key] = value; return true }
    })
    contexts.set(this, wrapped); return wrapped
  }
  window._assertPixelApprox = (canvas, x, y, ...expected) => {
    const tolerance = expected.pop(), actual = getContext.call(canvas, '2d').getImageData(x, y, 1, 1).data
    if (expected.some((n, i) => Math.abs(actual[i] - n) > tolerance)) throw Error('Original WPT pixel assertion failed')
  }
  window.promise_test = callback => Promise.resolve().then(() => callback({})).catch(e => window.publicErrors.push(e.message)).finally(() => { window.publicDone = true })
}

async function browserRun (imageSource, fixtureNames) {
  let definition, activePage
  window.Page = value => { definition = value };window.Component=c=>{definition=window.readerComponentDefinition(c)}
  window.getApp = () => ({ globalData: {} })
  const factory = config => {
    const c = document.createElement('canvas'); c.width = config.width; c.height = config.height
    c.createImage = () => new Image(); return c
  }
  window.wx = {
    setNavigationBarTitle () {}, pageScrollTo () {}, createOffscreenCanvas: factory,
    createSelectorQuery () {
      let callback, selector
      const q = { in (p) { activePage = p; return q }, select (s) { selector = s; return { fields (_options, cb) { callback = cb }, boundingClientRect (cb) { callback = cb } } }, exec () { callback?.({ node: activePage?.canvases.get(selector) }) } }
      return q
    }
  }
  readerRequire('miniprogram/file-reader/engine/components/reader/reader.js')
  function page () {
    const p = { ...definition, canvases: new Map(), data: structuredClone(definition.data), setData (updates, callback) {
      for (const [key, value] of Object.entries(updates)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let d = this.data
        for (const part of parts.slice(0, -1)) d = d[part]
        d[parts.at(-1)] = value
      }
      const visit = nodes => (nodes || []).forEach(n => {
        if (n.name === 'canvas' && !this.canvases.has('#dom-canvas-' + n.nid)) { const c = factory({width:1,height:1}); document.body.appendChild(c); this.canvases.set('#dom-canvas-' + n.nid, c) }
        visit(n.children)
      })
      visit(this.data.domTree); callback?.()
    } }
    activePage = p; return p
  }
  const wait = async condition => { for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 10)) } throw Error('Canvas fixture timed out') }
  const pixels = async canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2,'0')).join('')
  }
  const draw = (ctx, image, n) => {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#d9ebc1'; ctx.fillRect(0,0,192,128)
    ctx.save()
    switch (n % 8) {
      case 0: ctx.drawImage(image, 0, 0); break
      case 1: ctx.translate(27,11); ctx.drawImage(image, 0,0,96,64); break
      case 2: ctx.globalAlpha=.25; ctx.drawImage(image, 10,10); break
      case 3: ctx.beginPath();ctx.rect(20,20,75,62);ctx.clip();ctx.drawImage(image, 0,0);break
      case 4: ctx.globalCompositeOperation='destination-out';ctx.drawImage(image,10,20,96,64);break
      case 5: ctx.drawImage(image,13,7,110,75,3,9,180,90);break
      case 6: ctx.translate(130,5);ctx.rotate(Math.PI/2);ctx.drawImage(image,0,0,96,64);break
      case 7: ctx.imageSmoothingEnabled=false;ctx.drawImage(image,3,2,60,30,14.5,21.5,105.5,70.5);break
    }
    ctx.restore();ctx.fillStyle='#316baf';ctx.fillRect(5,5,20+n,17)
    if(n%3===0){const g=ctx.createLinearGradient(0,0,192,0);g.addColorStop(0,'#fa0011');g.addColorStop(1,'#0011fa');ctx.fillStyle=g;ctx.fillRect(0,100,192,28)}
    if(n>=12){ctx.globalAlpha=.2;ctx.save();ctx.canvas.width=ctx.canvas.width;ctx.restore();ctx.fillRect(0,0,50,50)}
  }
  const image = new Image(); image.src = imageSource; await image.decode()
  const generated = []
  for (let n=0;n<16;n++) {
    document.querySelector('output').setAttribute('data-progress','generated:'+n)
    const p = page(), native = factory({width:192,height:128}), ctx = native.getContext('2d')
    const html = `<canvas id="c" width="192" height="128"></canvas><button id="next">next</button><script>const draw=${draw};let n=${n};const image=new Image();image.src=${JSON.stringify(imageSource)};const ctx=document.getElementById('c').getContext('2d');async function run(){await image.decode();draw(ctx,image,n);window.ready=true}run();document.getElementById('next').onclick=()=>draw(ctx,image,++n)</script>`
    try {
      p.openSelectedFile({name:'generated-canvas.html',inlineHtml:html});await wait(()=>p._htmlRuntime?.window.ready);p._htmlRuntime.flush(true);await p._lastCanvasPresentation
      const target=p.canvases.get('#dom-canvas-'+p._htmlRuntime.document.getElementById('c')._nid)
      draw(ctx,image,n);const first={native:await pixels(native),reader:await pixels(target)}
      p.onDomTap({currentTarget:{dataset:{nid:p._htmlRuntime.document.getElementById('next')._nid}}});p._htmlRuntime.flush();await p._lastCanvasPresentation
      draw(ctx,image,n+1);generated.push({n,first,next:{native:await pixels(native),reader:await pixels(target)},errors:p._runtimeErrors,error:p.data.error})
    } finally { p.onUnload();p.canvases.forEach(c=>c.remove()) }
  }
  // Hold a REAL decoded image's host notification until a newer picture has
  // painted. A control-flow spy alone would not detect a pixel overwrite.
  const racePage=page(),raceCanvas=factory({width:100,height:50}),green=factory({width:100,height:50});let release
  racePage.canvases.set('#dom-canvas-1',raceCanvas)
  raceCanvas.createImage=()=>{const i=new Image();let handler;Object.defineProperty(i,'onload',{get:()=>handler,set:value=>{handler=value}});i.addEventListener('load',()=>{release=()=>handler?.()},{once:true});return i}
  let race
  try{
    const old=racePage.presentCanvasItems([{nid:1,canvas:{width:100,height:50,rev:1,ops:[{name:'drawImage',args:[{__canvasImage:imageSource},0,0]}]}}]);await wait(()=>release)
    await racePage.presentCanvasItems([{nid:1,canvas:{width:100,height:50,rev:2,ops:[{name:'set:fillStyle',args:['#0f0']},{name:'fillRect',args:[0,0,100,50]}]}}]);release();const oldResult=await old
    green.getContext('2d').fillStyle='#0f0';green.getContext('2d').fillRect(0,0,100,50)
    race={old:oldResult[0].status,native:await pixels(green),reader:await pixels(raceCanvas)}
  }finally{racePage.onUnload()}
  const publicResults=[]
  for(const name of fixtureNames){
    document.querySelector('output').setAttribute('data-progress','public:'+name)
    const iframe=document.createElement('iframe');iframe.src='/original/'+name;document.body.appendChild(iframe)
    await wait(()=>iframe.contentWindow.publicDone)
    const native=iframe.contentDocument.getElementById('c'),p=page(),target=factory({width:100,height:50})
    document.body.appendChild(target);p.canvases.set('#dom-canvas-1',target)
    try{const commands=JSON.parse(JSON.stringify(iframe.contentWindow.recordedOps));const result=await p.presentCanvasItems([{nid:1,canvas:{width:100,height:50,rev:1,ops:commands}}]);publicResults.push({name,originalErrors:iframe.contentWindow.publicErrors,originalPixels:await pixels(native),readerPixels:await pixels(target),replay:result,errors:p._runtimeErrors||[]})}finally{p.onUnload();target.remove();iframe.remove()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({generated,publicResults,race})))
}

async function main () {
  fs.mkdirSync(out,{recursive:true})
  const code=bundle(['miniprogram/file-reader/engine/components/reader/reader.js']),red=Buffer.from(fs.readFileSync(path.join(__dirname,'../tests/fixtures/visible-canvas/red.png.base64'),'utf8').trim(),'base64')
  for (const fixture of fixtures) assert.equal(sha256(fixture.source), hashes[fixture.name], 'Public fixture changed: ' + fixture.name)
  assert.equal(sha256(red), 'ef9ab918abed37fad8896c0fd05d597b8584acbb6a0efe855b4ed93b5a6d4604', 'Public PNG changed')
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src 'self'; connect-src 'self'")
    res.setHeader('Content-Type','text/html; charset=utf-8')
    if(req.url==='/bundle'){res.setHeader('Content-Type','text/javascript');res.end(code);return}
    if(req.url==='/resources/testharness.js'){res.setHeader('Content-Type','text/javascript');res.end(`(${publicHarness})()`);return}
    if(req.url==='/images/red.png'){res.setHeader('Content-Type','image/png');res.end(red);return}
    if(req.url==='/resources/testharnessreport.js'||req.url==='/html/canvas/resources/canvas-tests.js'){res.setHeader('Content-Type','text/javascript');res.end('');return}
    const fixture=fixtures.find(f=>req.url==='/original/'+f.name)
    if(fixture){res.end(fixture.source);return}
    if(req.url==='/'){res.end(`<!doctype html><output></output><script src="/bundle"></script><script>(${browserRun.toString().replace(/<\/script/gi,'<\\/script')})(${JSON.stringify(png())},${JSON.stringify(fixtures.map(f=>f.name))}).catch(e=>document.querySelector('output').setAttribute('data-error',e.stack||e.message))</script>`);return}
    res.statusCode=404;res.end()
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`)
    fs.writeFileSync(path.join(out,'browser-dom.html'),dom)
    const match=dom.match(/data-result="([^"]+)"/);assert.ok(match,(dom.match(/data-error="([^"]+)"/)||[])[1])
    const result=JSON.parse(decodeURIComponent(match[1]));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
    assert.equal(result.generated.length,16)
    for(const row of result.generated){assert.equal(row.first.reader,row.first.native,'first frame '+row.n);assert.equal(row.next.reader,row.next.native,'second frame '+row.n);assert.deepEqual(row.errors,[]);assert.equal(row.error,'')}
    assert.equal(result.publicResults.length,3)
    for(const row of result.publicResults){assert.deepEqual(row.originalErrors,[]);assert.equal(row.readerPixels,row.originalPixels,row.name);assert.equal(row.replay[0].status,'painted');assert.deepEqual(row.errors,[])}
    assert.equal(result.race.old,'cancelled');assert.equal(result.race.reader,result.race.native)
  }finally{server.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
