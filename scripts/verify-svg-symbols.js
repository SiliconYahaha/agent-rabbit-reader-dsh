'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { cases } = require('../tests/helpers/svg-symbols')
// These are native interoperability disagreements, NOT passing native results.
// SVG2 UseLayout specifies computed dimensions/auto and symbol instance display.
// Firefox independently agrees on auto; both browsers disagree on the other two.
const interop = Object.fromEntries([
  ['symbol-auto-target-size', 'SVG2 auto retains referenced dimensions; Firefox agrees'],
  ['svg-auto-target-size', 'SVG2 auto retains referenced dimensions; Firefox agrees'],
  ['symbol-css-size-overrides', 'SVG2 computed geometry overrides attributes; Chrome/Firefox disagree'],
  ['svg-css-size-overrides', 'SVG2 computed geometry overrides attributes; Chrome/Firefox disagree'],
  ['symbol-instance-ignores-display-none', 'SVG2 symbol instance UA display rule; Chrome/Firefox disagree']
])
function failures (report) {
  const found = new Set(report.results.map(r => r.name))
  const errors = cases.filter(c => !found.has(c.name)).map(c => c.name + ': missing result')
  if (found.size !== report.results.length || found.size !== cases.length) errors.push('Incorrect case inventory')
  for (const row of report.results) {
    if (row.variants.length !== 3 || !row.variants.every((v,i) => v.mode === ['native','fallback','factory-throws'][i])) errors.push(row.name + ': missing host variant')
    // Even audited native disagreements require exact independent reference
    // pixels on EVERY host, with no runtime error or fallback discrepancy.
    if (row.variants.some(v => v.error || v.rgbaError !== 0 || v.fallbackError !== 0)) errors.push(row.name + ': product/reference mismatch')
    if (!interop[row.name] && (row.nativeReferenceError !== 0 || row.variants.some(v => v.svgRGBAError !== 0 || v.boundsError > 1e-4))) errors.push(row.name + ': native mismatch')
  }
  return errors
}
async function componentRun (inputs, modules, componentSource) {
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts=id.split('/'); parts.pop(); for(const x of p.split('/')) {if(x==='..')parts.pop();else if(x!=='.')parts.push(x)} let target=parts.join('/');if(!target.endsWith('.js'))target+='.js';return load(target) },m,m.exports)
    return m.exports
  }
  const canvas = document.createElement('canvas'); canvas.width=canvas.height=256
  const ctx=canvas.getContext('2d'), frames=new Map(), queries=[]; let serial=0, deferred=false, definition
  canvas.requestAnimationFrame = callback => {frames.set(++serial,callback);return serial}
  canvas.cancelAnimationFrame = id => frames.delete(id)
  const check = (condition,message) => {if(!condition)throw Error(message)}
  Function('require','Component','wx',componentSource)(id => {
    if(id==='../../index')return load('index.js')
    if(id==='../../svg/svg-clip-runtime')return {loadClipUnion:()=>Promise.reject(Error('Unexpected union request'))}
    throw Error('Unexpected dependency '+id)
  },value=>{definition=value},{getWindowInfo:()=>({pixelRatio:1})})
  const player={...definition.methods,data:{...definition.data,playing:false},_viewReady:true,_images:new Map(),events:[],
    setData(patch,callback){Object.assign(this.data,patch);if(callback)callback()},triggerEvent(name,detail){this.events.push({name,detail})},
    createSelectorQuery(){const q={select:()=>q,boundingClientRect:()=>q,fields:()=>q,exec:callback=>{if(deferred)queries.push(callback);else callback([{width:256},{node:canvas,width:256}])}};return q}
  }
  const difference=(a,b)=>a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)
  const read=()=>new Uint8ClampedArray(ctx.getImageData(0,0,256,256).data)
  async function expected(input){const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(input.referenceSource);await image.decode();const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,256,256).data}
  const results=[]
  for(const input of inputs){
    const reference=await expected(input);player.events=[];player.load(input.entrySource)
    check(player.drawFrame(input.time||0),input.name+': draw failed')
    results.push({name:input.name,ready:player.data.ready,animated:player.data.animated,errors:player.events.filter(e=>e.name==='error'),rgbaError:difference(read(),reference)})
  }
  const timeline=inputs.find(i=>i.name==='use-width-animation-0'),half=inputs.find(i=>i.name==='use-width-animation-0.5'),full=inputs.find(i=>i.name==='use-width-animation-1')
  const refs=[await expected(timeline),await expected(half),await expected(full)]
  player.data.playing=true;player.load(timeline.entrySource)
  const frame=time=>{check(frames.size===1,'Expected exactly one scheduled frame');const [id,callback]=[...frames][0];frames.delete(id);callback(time)}
  frame(1000);check(!difference(read(),refs[0]),'Initial frame pixels');frame(1500);check(!difference(read(),refs[1]),'Animated viewport half-frame pixels')
  const staleFrame=[...frames.values()][0];player.onTap();check(!frames.size&&player.data.paused,'Tap must pause');staleFrame(2000);check(!frames.size&&!difference(read(),refs[1]),'Stale paused callback')
  player.onTap();frame(5000);check(!difference(read(),refs[1]),'Resume must retain elapsed time');frame(5500);check(!difference(read(),refs[2]),'Resumed viewport frame')
  definition.pageLifetimes.hide.call(player);check(!frames.size,'Hide cancels');definition.pageLifetimes.show.call(player);frame(9000);check(!difference(read(),refs[2]),'Foreground retains elapsed time')
  const oldFrame=[...frames.values()][0];deferred=true;player.load(timeline.entrySource);const oldQuery=queries.shift()
  const next=inputs.find(i=>i.name==='svg-nested-use-percent'),nextPixels=await expected(next);player.data.playing=false;player.load(next.entrySource)
  oldQuery([{width:999},{node:canvas,width:999}]);check(!player.data.ready,'Old query cannot mount new source');queries.shift()([{width:256},{node:canvas,width:256}]);oldFrame(9999)
  check(!difference(read(),nextPixels)&&!frames.size,'Old frame cannot overwrite new source')
  deferred=false;player.events=[];player.load('not svg');check(player.events.some(e=>e.name==='error'),'Malformed SVG explicit error')
  player.events=[];player.load(next.entrySource);check(player.data.ready&&!player.events.some(e=>e.name==='error')&&!difference(read(),nextPixels),'Recovery pixels')
  definition.lifetimes.detached.call(player);oldFrame(10000);check(!frames.size&&!player._scene&&!player._canvas,'Detach releases scene and frames')
  document.querySelector('#result').setAttribute('data-result',btoa(JSON.stringify({results,lifecycle:{pause:true,resume:true,hideShow:true,staleFrame:true,staleQuery:true,errorRecovery:true,detach:true}})))
}
function main () {
  const output=path.resolve(process.argv[2]||'outputs/svg-symbols'),root=path.resolve('miniprogram/file-reader/image')
  fs.mkdirSync(output,{recursive:true});const inputFile=path.join(output,'inputs.json');fs.writeFileSync(inputFile,JSON.stringify(cases,null,2)+'\n')
  execFileSync(process.execPath,['scripts/verify-svg-container-bounds.js',path.join(output,'geometry'),'--input-file',inputFile,'--discover',...process.argv.slice(3)],{stdio:['ignore',fs.openSync(path.join(output,'geometry.log'),'w'),'inherit']})
  const geometry=JSON.parse(fs.readFileSync(path.join(output,'geometry/report.json'),'utf8'))
  // Route complete SVG files through the real reader host before giving the
  // selected animated source to the actual SVG component. Inert animation makes
  // static geometry exercise the Canvas route too; original sources stay intact.
  const {readerPage}=require('../tests/helpers/reader-host');const files=new Map(),pending=[]
  const page=readerPage({env:{USER_DATA_PATH:'/fixture'},getWindowInfo:()=>({windowWidth:256,windowHeight:256,pixelRatio:1}),getFileSystemManager:()=>({readFile:o=>pending.push(o),writeFile:()=>{throw Error('Unexpected fixture write')}})})
  const inputs=cases.map(c=>{
    const source=/<animate/.test(c.source)?c.source:c.source.replace('</svg>','<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>')
    files.set('/'+c.name+'.svg',source);page.openSelectedFile({name:c.name+'.svg',path:'/'+c.name+'.svg',size:Buffer.byteLength(source)})
    const read=pending.shift();assert.ok(read);read.success({data:files.get(read.filePath)});assert.equal(page.data.error,'');assert.equal(page.data.hasContent,true);assert.equal(page.data.standaloneSvgAnimatedSource,source)
    return {...c,entrySource:page.data.standaloneSvgAnimatedSource}
  })
  const modules={};function include(id){if(modules[id])return;const source=modules[id]=fs.readFileSync(path.join(root,id),'utf8');for(const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))include(path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))+(m[1].endsWith('.js')?'':'.js'))}include('index.js')
  const bundle='{'+Object.entries(modules).map(([id,s])=>JSON.stringify(id)+':function(require,module,exports){\n'+s+'\n}').join(',')+'}'
  const file=path.join(output,'component.html'),component=fs.readFileSync(path.join(root,'components/svg-view/svg-view.js'),'utf8')
  fs.writeFileSync(file,'<!doctype html><div id="result"></div><script>('+componentRun.toString()+')('+JSON.stringify(inputs).replace(/</g,'\\u003c')+','+bundle+','+JSON.stringify(component).replace(/</g,'\\u003c')+').catch(e=>document.querySelector("#result").setAttribute("data-error",e.stack))</script>')
  const chrome=process.env.HTML_READER_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome')
  const dump=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=10000',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']})
  const match=dump.match(/data-result="([^"]+)"/);fs.writeFileSync(path.join(output,'component-dom.html'),dump);assert.ok(match,(dump.match(/data-error="([^"]+)"/)||[])[1])
  const componentResult=JSON.parse(Buffer.from(match[1],'base64').toString()),errors=failures(geometry)
  for(const row of componentResult.results)if(!row.ready||!row.animated||row.errors.length||row.rgbaError)errors.push(row.name+': component failure')
  const report={testedAt:new Date().toISOString(),chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),scope:'Node reader file entry and actual SVG component with Chrome Canvas/platform harness; not WeChat or physical devices',cases:cases.length,independentExact:geometry.exactPixels,nativeExact:geometry.nativeSvgExactPixels,nativeDisagreements:geometry.failures,interop,errors,component:componentResult}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,independentExact:report.independentExact,nativeExact:report.nativeExact,nativeDisagreements:report.nativeDisagreements,errors,lifecycle:componentResult.lifecycle}));assert.equal(errors.length,0)
}
if(require.main===module)main()
module.exports={failures,interop}
