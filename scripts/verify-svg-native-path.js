'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const {inputs:regressions,nextInputs}=require('../tests/helpers/svg-native-path')
const discovery=process.argv.includes('--next'),inputs=discovery?nextInputs:regressions
const output=path.resolve(process.argv[2]||'outputs/svg-native-path')
const root = path.resolve('miniprogram/file-reader/image')
const modules = {}
function include (id) {
  if (modules[id]) return
  const source = fs.readFileSync(path.join(root, id), 'utf8'); modules[id] = source
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) include(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[1])) + (match[1].endsWith('.js') ? '' : '.js'))
}
include('index.js')
async function run(inputs,modules){
  const cache = {}
  function load (id) {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { exports: {} }
    modules[id](p => { const parts = id.split('/'); parts.pop(); for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x) } let target = parts.join('/'); if (!target.endsWith('.js')) target += '.js'; return load(target) }, m, m.exports)
    return m.exports
  }

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
  const variants=[]
  let fallbackPixels
  for(const mode of ['fallback','native','factory-throws','factory-ignores-string','paint-throws','transform-ignored']){
   const enabled=mode!=='fallback'
   let factoryCalls=0
   const scene=load('index.js').createSvgScene(source,{nativePaths:enabled,createPath2D:d=>{factoryCalls++;if(mode==='factory-throws')throw Error('unsupported');const p=new Path2D(mode==='factory-ignores-string'?'':d);if(mode==='transform-ignored')p.addPath=function(other){Path2D.prototype.addPath.call(this,other)};return p}})
   ctx.reset();const target=mode==='paint-throws'?new Proxy(ctx,{get(target,key){if(key==='fill'||key==='stroke')return (...args)=>{if(args[0] instanceof Path2D)throw Error('overload unsupported');return target[key](...args)};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value},set(target,key,value){return Reflect.set(target,key,value,target)}}):ctx;scene.draw(target,256,256,0);const pixels=ctx.getImageData(0,0,256,256).data
   if(mode==='fallback')fallbackPixels=new Uint8ClampedArray(pixels)
   let error=0,ink=0,rgbaError=0,maxChannelError=0,changedChannels=0,fallbackError=0;for(let i=0;i<pixels.length;i++){const delta=Math.abs(pixels[i]-native[i]);rgbaError+=delta;maxChannelError=Math.max(maxChannelError,delta);if(delta)changedChannels++;fallbackError+=Math.abs(pixels[i]-fallbackPixels[i]);if(i%4===3){error+=Math.abs(pixels[i]-native[i]);if(pixels[i])ink++}}
   variants.push({mode,nativePaths:enabled,factoryCalls,alphaError:error,rgbaError,maxChannelError,changedChannels,fallbackError,ink})
  }
  results.push({name:input.name,reference:input.source?'native SVG image':'native Path2D',variants})
 }
 document.querySelector('#result').setAttribute('data-result',btoa(JSON.stringify(results)))
}
fs.mkdirSync(output, { recursive: true })
const bundle = '{' + Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(require,module,exports){\n' + source + '\n}').join(',') + '}'
const file = path.join(output, 'oracle.html')
fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><div id="result"></div><script>window.onerror=(m)=>document.querySelector("#result").setAttribute("data-error",m);(' + run.toString() + ')(' + JSON.stringify(inputs).replace(/</g, '\\u003c') + ',' + bundle + ')</script>')
const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dump = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=5000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'Chrome oracle did not finish: ' + (dump.match(/data-error="([^"]+)"/) || [])[1])
const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
// Exact RGBA is required except the explicitly recorded radial-bbox residual:
// one edge alpha channel differs by 4/255 after inverse gradient path mapping.
// Keep that known gap bounded and below the existing fallback error.
const failures=results.filter(r=>{const n=r.variants[1];return (r.name==='radial-bbox'?n.changedChannels>1||n.rgbaError>4||n.rgbaError>r.variants[0].rgbaError:n.rgbaError!==0)||r.variants.slice(2,5).some(v=>v.fallbackError!==0)||(r.variants[5].rgbaError>Math.max(n.rgbaError,r.variants[0].rgbaError))})
const report={mode:discovery?'discovery':'regression',inputs:discovery?inputs:undefined,testedAt:new Date().toISOString(),cases:results.length,exactNativeCases:results.filter(r=>r.variants[1].rgbaError===0).length,failures:failures.map(r=>r.name),results}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({cases:results.length,exactNativeCases:results.filter(r=>r.variants[1].rgbaError===0).length,failures:failures.map(r=>({name:r.name,...r.variants[1]}))},null,2))
if(!discovery)assert.equal(failures.length,0,'Native SVG paths and fallback must meet the documented pixel gates')
