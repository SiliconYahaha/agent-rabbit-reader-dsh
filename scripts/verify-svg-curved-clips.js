'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {execFileSync,spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const unionMode=process.argv.includes('--unions')
let {cases:inputs}=require(unionMode?'../tests/helpers/svg-clip-unions':'../tests/helpers/svg-curved-clips')
const external=process.argv.indexOf('--input-file')
if(external>=0)inputs=JSON.parse(fs.readFileSync(process.argv[external+1],'utf8'))
const discovery=process.argv.includes('--discover')
const output=path.resolve(process.argv[2]||'outputs/svg-curved-clips')
const root = path.resolve('miniprogram/file-reader/image')
const modules = {}
function include (id) {
  if (modules[id]) return
  const source = fs.readFileSync(path.join(root, id), 'utf8'); modules[id] = source
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[1])) + (match[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
include('svg/svg-clip-union.js')
if(process.argv.includes('--baseline'))modules['svg/svg-rasterizer.js']=execFileSync('git',['show','v1.4.102:miniprogram/file-reader/image/svg/svg-rasterizer.js'],{encoding:'utf8'})
async function run(inputs,modules,wasm){
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts = id.split('/'); parts.pop(); for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x) } let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'; return load(target) }, m, m.exports)
    return m.exports
  }

 document.querySelector('#result').setAttribute('data-phase','kernel')
 const wasmBinary=Uint8Array.from(atob(wasm),c=>c.charCodeAt(0))
 // Headless virtual time can finish while background WASM compilation is still
 // pending. Compile this same packaged kernel synchronously before the oracle;
 // production WX initialization remains asynchronous and separately tested.
 const kernel=await PathKitInit({instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(new WebAssembly.Module(wasmBinary),imports);receive(instance);return instance.exports}})
 document.querySelector('#result').setAttribute('data-phase','pixels')
 const clipUnion=load('svg/svg-clip-union.js').createClipUnion(kernel)
 const results=[]
 for(const input of inputs){
  const source=input.source || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(256/input.scale)+' '+(256/input.scale)+'"><path d="'+input.input.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" fill="black" stroke="black" stroke-width="'+(1/input.scale)+'" stroke-miterlimit="4"/></svg>'
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')
  let native
  if(input.source){
   const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);await image.decode();ctx.drawImage(image,0,0,256,256);native=ctx.getImageData(0,0,256,256).data
  }else{
   ctx.scale(input.scale,input.scale);ctx.lineWidth=1/input.scale;ctx.miterLimit=4
   const reference=new Path2D(input.input);ctx.fill(reference);ctx.stroke(reference);native=ctx.getImageData(0,0,256,256).data
  }
  const svgPixels=new Uint8ClampedArray(native)
  if(input.expected){
   ctx.reset();ctx.scale(256/input.expected.units,256/input.expected.units)
   for(const clip of input.expected.clips){
    let p=new Path2D(clip.d)
    if(clip.matrix){const m=clip.matrix,q=new Path2D();q.addPath(p,{a:m[0],b:m[1],c:m[2],d:m[3],e:m[4],f:m[5]});p=q}
    ctx.clip(p,clip.rule||'nonzero')
   }
   ctx.fillStyle=input.expected.fill;ctx.fill(new Path2D(input.expected.target));native=ctx.getImageData(0,0,256,256).data
  }else if(input.referenceSource){
   ctx.reset();const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(input.referenceSource);await image.decode();ctx.drawImage(image,0,0,256,256);native=ctx.getImageData(0,0,256,256).data
  }
  const variants=[]
  let fallbackPixels
  for(const mode of ['fallback','native','factory-throws','factory-ignores-string','paint-throws','transform-ignored','clip-throws']){
   const enabled=mode!=='fallback'
   let factoryCalls=0
   const scene=load('index.js').createSvgScene(source,{clipUnion,nativePaths:enabled,createPath2D:d=>{factoryCalls++;if(mode==='factory-throws')throw Error('unsupported');const p=new Path2D(mode==='factory-ignores-string'?'':d);if(mode==='transform-ignored')p.addPath=function(other){Path2D.prototype.addPath.call(this,other)};return p}})
   ctx.reset();let caught=null;const target=(mode==='paint-throws'||mode==='clip-throws')?new Proxy(ctx,{get(target,key){if((mode==='paint-throws'&&(key==='fill'||key==='stroke'))||(mode==='clip-throws'&&key==='clip'))return (...args)=>{if(args[0] instanceof Path2D)throw Error('overload unsupported');return target[key](...args)};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value},set(target,key,value){return Reflect.set(target,key,value,target)}}):ctx;try{scene.draw(target,256,256,0)}catch(e){caught=e.message;ctx.reset()}const pixels=ctx.getImageData(0,0,256,256).data
   if(mode==='fallback')fallbackPixels=new Uint8ClampedArray(pixels)
   let svgRGBAError=0,svgAlphaError=0,svgChangedChannels=0;for(let i=0;i<pixels.length;i++){const d=Math.abs(pixels[i]-svgPixels[i]);svgRGBAError+=d;if(d)svgChangedChannels++;if(i%4===3)svgAlphaError+=d}
   let error=0,ink=0,rgbaError=0,maxChannelError=0,changedChannels=0,fallbackError=0;for(let i=0;i<pixels.length;i++){const delta=Math.abs(pixels[i]-native[i]);rgbaError+=delta;maxChannelError=Math.max(maxChannelError,delta);if(delta)changedChannels++;fallbackError+=Math.abs(pixels[i]-fallbackPixels[i]);if(i%4===3){error+=Math.abs(pixels[i]-native[i]);if(pixels[i])ink++}}
   variants.push({svgRGBAError,svgAlphaError,svgChangedChannels,error:caught,mode,nativePaths:enabled,factoryCalls,alphaError:error,rgbaError,maxChannelError,changedChannels,fallbackError,ink})
  }
  results.push({name:input.name,reference:input.expected?'Independent explicit Canvas clip geometry':'WPT published SVG reference',variants})
 }
 document.querySelector('#result').setAttribute('data-result',btoa(JSON.stringify(results)))
}
fs.mkdirSync(output, { recursive: true })
const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
const file = path.join(output, 'oracle.html')
fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><div id="result"></div><script src="'+pathToFileURL(path.resolve('miniprogram/file-reader/image/svg/vendor/pathkit/pathkit.js')).href+'"></script><script>window.onerror=(m)=>document.querySelector("#result").setAttribute("data-error",m);(' + run.toString() + ')(' + JSON.stringify(inputs).replace(/</g, '\\u003c') + ',' + bundle + ',' + JSON.stringify(fs.readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm')).toString('base64')) + ').catch(e=>document.querySelector("#result").setAttribute("data-error",String(e&&e.stack||e)))</script>')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const processResult = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=5000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
const dump = processResult.stdout || ''
const diagnostics={status:processResult.status,signal:processResult.signal,error:processResult.error&&processResult.error.message,phase:(dump.match(/data-phase="([^"]+)"/)||[])[1],browserError:(dump.match(/data-error="([^"]+)"/)||[])[1],stderr:(processResult.stderr||'').slice(-8192)}
fs.writeFileSync(path.join(output,'browser-diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n')
const match = dump.match(/data-result="([^"]+)"/)
assert.ok(!processResult.error&&processResult.status===0&&match, 'Chrome oracle did not finish: '+JSON.stringify(diagnostics))
const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
// Require exact independent clip geometry and failure fallback. Direct SVG
// image differences are recorded separately; the original curved-clip suite
// must never increase its v1.4.102 baseline differences.
const knownOpen=new Set()
const failures=results.filter(r=>r.variants.some(v=>v.error)||(!knownOpen.has(r.name)&&r.variants[1].rgbaError!==0)||[2,3,6].some(i=>r.variants[i].fallbackError!==0))
const report={knownOpen:Array.from(knownOpen),nativeSVGImageDifferenceCases:results.filter(r=>r.variants[1].svgRGBAError>0).length,mode:discovery?'discovery':'regression',inputs:discovery?inputs:undefined,testedAt:new Date().toISOString(),cases:results.length,exactNativeCases:results.filter(r=>!r.variants[1].error&&r.variants[1].rgbaError===0).length,pending:results.filter(r=>knownOpen.has(r.name)).map(r=>({name:r.name,rgbaError:r.variants[1].rgbaError})),failures:failures.map(r=>r.name),results}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({cases:results.length,exactNativeCases:results.filter(r=>!r.variants[1].error&&r.variants[1].rgbaError===0).length,failures:failures.map(r=>({name:r.name,...r.variants[1]}))},null,2))
if(!discovery){
 assert.equal(failures.length,0,'Clip geometry and fallback must meet the documented gates')
 if(unionMode)process.exit(0)
 const baseline=require('../compatibility/runs/2026-09-05-svg-clips-baseline.json')
 for(const row of results){const before=baseline.results.find(r=>r.name===row.name);assert.ok(before,row.name+': missing baseline');assert.ok(row.variants[1].svgRGBAError<=before.variants[1].svgRGBAError,row.name+': native SVG image difference increased')}
}
