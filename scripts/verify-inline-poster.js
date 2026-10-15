'use strict'

// Optional user original stays local. No source artwork is committed or uploaded.
// Chrome supplies real image decoding/Canvas and an independent original-page
// oracle; this is not a claim of WeChat WXML or phone validation.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const http = require('node:http'), { execFile } = require('node:child_process')
const { promisify } = require('node:util'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { readerPage, flush } = require('../tests/helpers/reader-page')
const { payloadBytes } = require('../miniprogram/file-reader/document/view-payload')

function bundle (additional = []) {
  const sources = {}, base = path.resolve(__dirname, '..')
  function add (name) {
    const absolute = require.resolve(path.join(base, name)), key = path.relative(base, absolute)
    if (sources[key]) return key
    let source = fs.readFileSync(absolute, 'utf8')
    // 族分包的 kernel.js 在小程序里由 attach() 注入、在 Node 里用变量路径同步取引擎；
    // 浏览器 bundle 两条路都走不到，改写成字面量 require 让 regex 把引擎内核一并打进来。
    if (/^miniprogram\/file-reader\/(document|archive|image)\/kernel\.js$/.test(key)) source = "module.exports = require('../engine/core/kernel-exports')"
    sources[key] = { source: key.endsWith('.json') ? `module.exports=${source}` : source, deps: {} }
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) sources[key].deps[match[1]] = add(path.join(path.dirname(key), match[1]))
    return key
  }
  add('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
  add('miniprogram/file-reader/document/document-renderer.js')
  // reader 组件按文件类型族按需加载分包；浏览器里没有 require.async，把族入口打进来后由 families.warmSync 同步装上
  add('miniprogram/file-reader/engine/core/families.js')
  for (const family of ['document', 'archive', 'image']) add(`miniprogram/file-reader/${family}/index.js`)
  additional.forEach(add)
  // require 先查 regex 收集到的字面量依赖，查不到再按相对路径归一（families.warmSync 用变量路径 require 族入口）
  return `const moduleSources=${JSON.stringify(sources)};const loaded={};function resolveId(from,name){const parts=from.split('/');parts.pop();for(const seg of name.split('/')){if(seg==='..')parts.pop();else if(seg!=='.')parts.push(seg)}let id=parts.join('/');if(!moduleSources[id]&&moduleSources[id+'.js'])id+='.js';return id}window.readerRequire=function load(id){if(loaded[id])return loaded[id].exports;const m=loaded[id]={exports:{}};const def=moduleSources[id];if(!def)throw new Error('bundle 里没有模块：'+id);new Function('require','module','exports',def.source)(name=>load(def.deps[name]||resolveId(id,name)),m,m.exports);return m.exports};window.readerRequire('miniprogram/file-reader/engine/core/families.js').warmSync(['document','archive','image']);window.readerComponentDefinition=function(c){return{...c.methods,data:c.data,createSelectorQuery(){const q=window.wx.createSelectorQuery();return q&&typeof q.in==='function'?q.in(this):q},onUnload(){if(c.lifetimes&&c.lifetimes.detached)c.lifetimes.detached.call(this)}}}`
}

async function browserRun () {
  const { createRuntime } = readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
  const { renderHtmlDomTree } = readerRequire('miniprogram/file-reader/document/document-renderer.js')
  const sourceHtml = await (await fetch('/source')).text()
  const original = document.getElementById('original'), view = document.getElementById('view')
  const wait = async test => { for (let i = 0; i < 120; i++) { if (test()) return; await new Promise(r => setTimeout(r, 25)) } throw Error('Timed out') }
  await wait(() => original.contentDocument?.querySelector('[data-dashboard-app]'))
  const originalWindow = original.contentWindow
  const result = { viewports: [], levels: [], drag: [], export: {} }
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const htmlNode = n => {
    if (n.type === 'text') return escape(n.text)
    const attrs = Object.entries(n.attrs || {}).filter(([k]) => !/^on/.test(k)).map(([k,v]) => ` ${k}="${escape(v)}"`).join('')
    return `<${n.name}${attrs} data-reader-nid="${n.nid}">${/^(img|input|br|hr)$/.test(n.name) ? '' : (n.children || []).map(htmlNode).join('')+`</${n.name}>`}`
  }
  let runtime
  for (const [width, height] of [[390, 844], [360, 800], [844, 390], [1280, 850]]) {
    original.style.width = view.style.width = width+'px'; original.style.height = view.style.height = height+'px'
    runtime?.destroy()
    runtime = createRuntime(sourceHtml, { viewportWidth: width, viewportHeight: height, createOffscreenCanvas: config => {
      const canvas = document.createElement('canvas'); canvas.width=config.width;canvas.height=config.height;canvas.createImage=()=>new Image()
      // Deliberately omit this browser convenience: verify the limited-host path.
      Object.defineProperty(canvas,'toDataURL',{value:undefined});return canvas
    } })
    runtime.run()
    if(runtime.errors.length)throw Error(JSON.stringify(runtime.errors))
    const render = () => {
      const state = runtime.renderState(), output = renderHtmlDomTree({ document: runtime.document, styles: state.styles }, { viewportWidth: width, viewportHeight: height })
      const d=view.contentDocument;d.open();d.write(`<body style="${escape(output.wrapperStyle)}">${output.nodes.map(htmlNode).join('')}</body>`);d.close()
    }
    render(); await new Promise(r=>setTimeout(r,100))
    const measure = (w, selector) => { const e=w.document.querySelector(selector),r=e.getBoundingClientRect();return { x:r.x,y:r.y,width:r.width,height:r.height,display:w.getComputedStyle(e).display } }
    const a=measure(originalWindow,'[data-dashboard-app]'), b=measure(view.contentWindow,'[data-dashboard-app]')
    const modal=measure(view.contentWindow,'[data-export-modal]')
    const image=view.contentDocument.querySelector('[data-board-image]'); await wait(()=>image.complete && image.naturalWidth>0)
    if(Math.abs(a.width-b.width)>2 || Math.abs(a.height-b.height)>2 || b.x<0 || b.x+b.width>width+1 || modal.display!=='none')throw Error('Layout differs: '+JSON.stringify({width,a,b,modal}))
    result.viewports.push({width,height,original:a,reader:b,modalHidden:true,imageWidth:image.naturalWidth,imageHeight:image.naturalHeight})
    if(width!==390)continue
    for (const level of [5,4,3,2,1]) {
      original.contentDocument.querySelector(`.scene-hotspot[data-level="${level}"]`).click()
      runtime.dispatchTap(runtime.document.querySelector(`.scene-hotspot[data-level="${level}"]`)._nid)
      runtime.flush(true)
      const expected=original.contentDocument.querySelector('[data-current-readout]').textContent,actual=runtime.document.querySelector('[data-current-readout]').textContent
      if(expected!==actual)throw Error('Level text differs')
      result.levels.push({level,text:actual})
    }
    const board=runtime.document.querySelector('[data-dashboard-app]'), slider=runtime.document.querySelector('[data-slider]')
    board._layoutRect={...b,left:b.x,top:b.y,right:b.x+b.width,bottom:b.y+b.height}
    for (const [percent,level] of [[0,5],[25,4],[50,3],[75,2],[100,1]]) {
      const clientX=b.x+b.width*(8.5+75*percent/100)/100
      runtime.dispatchEvent(slider._nid,'pointerdown',{pointerType:'touch',pointerId:1,clientX})
      runtime.dispatchEvent(slider._nid,'pointerup',{pointerType:'touch',pointerId:1,clientX})
      if(Number(board.dataset.level)!==level)throw Error('Drag position differs')
      result.drag.push({percent,level})
    }
    runtime.dispatchTap(runtime.document.querySelector('[data-export]')._nid)
    await wait(()=>runtime.document.querySelector('[data-dashboard-app]').dataset.exportReady!=null)
    if(runtime.document.querySelector('[data-dashboard-app]').dataset.exportReady!=='true')throw Error('Export failed: '+runtime.document.querySelector('[data-share-status]').textContent)
    const source=runtime.document.querySelector('[data-export-preview]').src
    const decoded=new Image();decoded.src=source;await wait(()=>decoded.complete && decoded.naturalWidth)
    if(decoded.naturalWidth!==1536 || decoded.naturalHeight!==1024)throw Error('Wrong export dimensions')
    result.export={width:decoded.naturalWidth,height:decoded.naturalHeight,dataUrlLength:source.length,hostToDataURL:false,modalOpen:!runtime.document.querySelector('[data-export-modal]').hidden}
    // Use the original page's visible export control, not a private named global.
    original.contentDocument.querySelector('[data-export]').click()
    await wait(()=>original.contentDocument.querySelector('[data-dashboard-app]').dataset.exportReady==='true')
    const originalPreview=original.contentDocument.querySelector('[data-export-preview]')
    await wait(()=>originalPreview.complete && originalPreview.naturalWidth===1536 && originalPreview.naturalHeight===1024)
    const expectedCanvas=document.createElement('canvas');expectedCanvas.width=1536;expectedCanvas.height=1024
    expectedCanvas.getContext('2d').drawImage(originalPreview,0,0)
    const actualCanvas=document.createElement('canvas');actualCanvas.width=1536;actualCanvas.height=1024
    actualCanvas.getContext('2d').drawImage(decoded,0,0)
    const hash=async canvas=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d').getImageData(0,0,1536,1024).data)),b=>b.toString(16).padStart(2,'0')).join('')
    result.export.originalPixelHash=await hash(expectedCanvas);result.export.readerPixelHash=await hash(actualCanvas)
    if(result.export.originalPixelHash!==result.export.readerPixelHash)throw Error('Export pixels differ from original: '+JSON.stringify(result.export))
    original.contentDocument.querySelector('[data-export-close]').click()
    runtime.dispatchTap(runtime.document.querySelector('[data-export-close]')._nid)
    if(!runtime.document.querySelector('[data-export-modal]').hidden)throw Error('Modal did not close')
    result.export.closed=true
  }
  runtime.destroy()
  document.getElementById('result').setAttribute('data-result',encodeURIComponent(JSON.stringify(result)))
}

async function main () {
  const source=process.argv[2] ? fs.readFileSync(process.argv[2],'utf8') : require('../tests/helpers/inline-poster').inlinePoster()
  const out=process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(),'reader-inline-poster-'))
  fs.mkdirSync(out,{recursive:true})
  const files=new Map(), fileSystem={writeFile:o=>{files.set(o.filePath,Buffer.from(o.data,o.encoding));o.success()},unlink:o=>{files.delete(o.filePath);o.success?.()}}
  const page=readerPage({env:{USER_DATA_PATH:'/reader-assets'}, getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),getFileSystemManager:()=>({...fileSystem,readFile:o=>{const bytes=Buffer.from(source),start=o.position||0;o.success({data:bytes.subarray(start,o.length==null?bytes.length:start+o.length)})}})})
  page.openSelectedFile({name:path.basename(process.argv[2] || 'synthetic-poster.html'),path:'/source.html',size:Buffer.byteLength(source)})
  for(let i=0;i<200 && page.data.isLoading;i++)await flush();assert.equal(page.data.error,'');assert.equal(page.data.domMode,true);assert.deepEqual(page._htmlRuntime.errors,[])
  const pageResult={sourceBytes:Buffer.byteLength(source),sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),sourceRewritten:false,uniqueImages:page._htmlAssets.size,imageBytes:page._htmlAssets.bytes,viewBytes:payloadBytes({domTree:page.data.domTree,domStyles:page.data.domStyles}),maxPatchBytes:Math.max(...page.patches.map(payloadBytes)),scriptErrors:page._htmlRuntime.errors}
  const script=bundle()
  const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
  const nodeHtml=n=>n.type==='text'?escape(n.text):`<${n.name}${Object.entries(n.attrs||{}).filter(([k])=>!/^on/.test(k)).map(([k,v])=>` ${k}="${escape(v)}"`).join('')}>${/^(img|input|br|hr)$/.test(n.name)?'':(n.children||[]).map(nodeHtml).join('')+`</${n.name}>`}`
  const r=renderHtmlDomTree({document:page._htmlRuntime.document,styles:page._htmlRuntime.renderState().styles},{viewportWidth:390,viewportHeight:844})
  await page._htmlAssets.rewriteView(r)
  const visual=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="${escape(r.wrapperStyle)}">${r.nodes.map(nodeHtml).join('')}</body>`
  const wrapper=`<!doctype html><meta charset="utf-8"><output id="result"></output><iframe id="original" sandbox="allow-scripts allow-same-origin" src="/original"></iframe><iframe id="view"></iframe><script src="/bundle"></script><script>(${browserRun.toString()})().catch(e=>document.getElementById('result').setAttribute('data-error',e.stack))</script>`
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src 'self'; connect-src 'self'")
    if(files.has(req.url)){res.setHeader('Content-Type','image/png');res.end(files.get(req.url));return}
    res.setHeader('Content-Type',req.url==='/bundle'?'text/javascript':'text/html; charset=utf-8')
    const routes={'/':wrapper,'/original':source,'/source':source,'/bundle':script,'/visual-content':visual,
      '/visual':'<!doctype html><style>html,body{margin:0}iframe{width:390px;height:844px;border:0;display:block}</style><iframe src="/visual-content"></iframe>'}
    if(!(req.url in routes)){res.statusCode=404;res.end();return}res.end(routes[req.url])
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const chrome=process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  try {
    const {stdout}=await promisify(execFile)(chrome,['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=15000','--dump-dom',`http://127.0.0.1:${server.address().port}/`],{timeout:60000,maxBuffer:5*1024*1024})
    fs.writeFileSync(path.join(out,'oracle-dom.html'),stdout)
    const encoded=stdout.match(/data-result="([^"]+)"/)
    assert.ok(encoded,'Chrome did not pass: '+(stdout.match(/data-error="([^"]+)"/)||[])[1])
    const result={checkedAt:new Date().toISOString(),page:pageResult,browser:JSON.parse(decodeURIComponent(encoded[1])),wechat:'not verified'}
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
    await promisify(execFile)(chrome,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=390,844','--force-device-scale-factor=1','--virtual-time-budget=1500',`--screenshot=${path.join(out,'reader-390.png')}`,`http://127.0.0.1:${server.address().port}/visual`],{timeout:30000,maxBuffer:1024*1024})
  } finally {server.close();page.disposeHtmlRuntime()}
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1})
module.exports = { bundle }
