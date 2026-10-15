'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const inputAt=process.argv.indexOf('--input-file')
const cases=inputAt<0?require(process.argv.includes('--viewports')?'../tests/helpers/svg-viewports':'../tests/helpers/svg-container-bounds').cases:JSON.parse(fs.readFileSync(process.argv[inputAt+1],'utf8'))
const output=path.resolve(process.argv[2]||'outputs/svg-container-bounds'),root=path.resolve('miniprogram/file-reader/image'),modules={}
function include(id){if(modules[id])return;const s=modules[id]=fs.readFileSync(path.join(root,id),'utf8');for(const m of s.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))include(path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))+(m[1].endsWith('.js')?'':'.js'))}
include('index.js');include('svg/svg-clip-union.js')
const baselineAt=process.argv.indexOf('--baseline-ref'),baselineRef=baselineAt>=0?process.argv[baselineAt+1]:process.argv.includes('--baseline')?'v1.4.104':null
if(baselineRef)for(const id of ['svg/svg-document.js','svg/svg-style.js','svg/svg-path.js','svg/svg-rasterizer.js'])modules[id]=execFileSync('git',['show',baselineRef+':miniprogram/file-reader/image/'+id],{encoding:'utf8'})
async function run(inputs,modules,wasm){
 const cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](p=>{const parts=id.split('/');parts.pop();for(const x of p.split('/')){if(x==='..')parts.pop();else if(x!=='.')parts.push(x)}let target=parts.join('/');if(!target.endsWith('.js'))target+='.js';return load(target)},m,m.exports);return m.exports}
 const bytes=Uint8Array.from(atob(wasm),c=>c.charCodeAt(0)),k=await PathKitInit({instantiateWasm(imports,receive){const i=new WebAssembly.Instance(new WebAssembly.Module(bytes),imports);receive(i);return i.exports}}),clipUnion=load('svg/svg-clip-union.js').createClipUnion(k)
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d'),results=[]
 for(const input of inputs){
  document.querySelector('#result').setAttribute('data-case',input.name)
  const width=input.width||256,height=input.height||256;canvas.width=width;canvas.height=height
  const host=document.createElement('div');host.innerHTML=input.source;document.body.append(host);if(input.source.includes('<animate'))await new Promise(resolve=>setTimeout(resolve,1));const svg=host.querySelector('svg');for(const viewport of [svg,...svg.querySelectorAll('svg')]){viewport.pauseAnimations&&viewport.pauseAnimations();viewport.setCurrentTime&&viewport.setCurrentTime(input.time||0)}
  const measureId=input.measureId||(input.oracle&&input.oracle.measureId)
  const frozen=svg.cloneNode(true)
  for(const node of svg.querySelectorAll('animate')){
   const parent=node.parentElement,attribute=node.getAttribute('attributeName'),index=Array.from(svg.querySelectorAll('*')).indexOf(parent),target=parent===svg?frozen:frozen.querySelectorAll('*')[index],value=parent[attribute]&&parent[attribute].animVal
   if(value&&typeof value.value==='number')target.setAttribute(attribute,value.value)
   else if(attribute==='viewBox'&&value)target.setAttribute(attribute,[value.x,value.y,value.width,value.height].join(' '))
  }
  for(const node of frozen.querySelectorAll('animate,animateTransform,set'))node.remove()
  const frozenSource=new XMLSerializer().serializeToString(frozen)
  // Shadow-tree animations can leave getBBox stale until a compositor frame.
  // Measure the same frozen native frame used for pixel comparison instead.
  host.replaceChildren(frozen)
  const probe=measureId&&host.querySelector('#'+measureId),b=probe&&probe.getBBox(),bbox=b&&{x:b.x,y:b.y,width:b.width,height:b.height}
  ctx.reset();const nativeImage=new Image();nativeImage.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(frozenSource);await nativeImage.decode();ctx.drawImage(nativeImage,0,0,width,height);const svgPixels=new Uint8ClampedArray(ctx.getImageData(0,0,width,height).data)
  ctx.reset()
  if(input.oracle){
   const o=input.oracle;ctx.fillStyle='red';ctx.fillRect(0,0,256,256);ctx.save();if(o.matrix)ctx.transform(...o.matrix)
   ctx.beginPath();ctx.rect(bbox.x+bbox.width*o.clip[0],bbox.y+bbox.height*o.clip[1],bbox.width*o.clip[2],bbox.height*o.clip[3]);ctx.clip()
   for(const p of o.paints){ctx.save();if(p.matrix)ctx.transform(...p.matrix);if(p.clip)ctx.clip(new Path2D(p.clip));if(p.stroke){ctx.strokeStyle=p.stroke;ctx.lineWidth=p.width;ctx.stroke(new Path2D(p.d))}else{ctx.fillStyle=p.fill||'green';ctx.fill(new Path2D(p.d))}ctx.restore()}ctx.restore()
  }else{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(input.referenceSource);await img.decode();ctx.drawImage(img,0,0,width,height)}
  let referenceCanvas=null
  if(input.referenceSource&&input.rectReference){
   const holder=document.createElement('div');holder.innerHTML=input.referenceSource;document.body.append(holder);const reference=holder.querySelector('svg')
   const operations=[]
   for(const rect of reference.querySelectorAll('rect')){
    if(rect.closest('defs,clipPath'))continue
    const clips=[]
    for(let parent=rect.parentElement;parent&&parent!==reference;parent=parent.parentElement){const value=parent.getAttribute('clip-path');if(value){const id=value.match(/^url\(#([^)]*)\)$/)[1],clip=holder.querySelector('[id="'+id+'"] rect'),m=clip.getCTM();if(![m.a,m.b,m.c,m.d,m.e,m.f].every((x,i)=>x===[1,0,0,1,0,0][i]))throw Error('Reference clip must use root coordinates');clips.push({x:clip.x.baseVal.value,y:clip.y.baseVal.value,width:clip.width.baseVal.value,height:clip.height.baseVal.value})}}
    const m=rect.getCTM();operations.push({x:rect.x.baseVal.value,y:rect.y.baseVal.value,width:rect.width.baseVal.value,height:rect.height.baseVal.value,fill:getComputedStyle(rect).fill,matrix:[m.a,m.b,m.c,m.d,m.e,m.f],clips})
   }
   referenceCanvas={width:reference.width.baseVal.value,height:reference.height.baseVal.value,operations};holder.remove()
  }
  const expected=new Uint8ClampedArray(ctx.getImageData(0,0,width,height).data),variants=[];let fallback
  for(const mode of ['native','fallback','factory-throws']){
   const scene=load('index.js').createSvgScene(input.source,{clipUnion,nativePaths:mode!=='fallback',createPath2D:d=>{if(mode==='factory-throws')throw Error('unsupported');return new Path2D(d)}})
   ctx.reset();let error=null,actualBox=null;try{scene.draw(ctx,width,height,input.time||0);if(bbox&&scene.renderer.getBounds)actualBox=scene.renderer.getBounds(scene.doc.byId[measureId],scene.timeline.sample(input.time||0))}catch(e){error=e.message}
   const pixels=ctx.getImageData(0,0,width,height).data;if(mode==='fallback')fallback=new Uint8ClampedArray(pixels)
   let rgbaError=0,maxChannelError=0,svgRGBAError=0,fallbackError=0,maxAlphaError=0,maxPremultipliedError=0;for(let i=0;i<pixels.length;i++){const d=Math.abs(pixels[i]-expected[i]);rgbaError+=d;maxChannelError=Math.max(maxChannelError,d);svgRGBAError+=Math.abs(pixels[i]-svgPixels[i]);if(fallback)fallbackError+=Math.abs(pixels[i]-fallback[i])}
   for(let i=0;i<pixels.length;i+=4){maxAlphaError=Math.max(maxAlphaError,Math.abs(pixels[i+3]-expected[i+3]));for(let j=0;j<3;j++)maxPremultipliedError=Math.max(maxPremultipliedError,Math.abs(pixels[i+j]*pixels[i+3]/255-expected[i+j]*expected[i+3]/255))}
   const boundsError=bbox?Math.max(...Object.keys(bbox).map(key=>Math.abs(bbox[key]-(actualBox?actualBox[key]:0)))):null
   variants.push({mode,error,bounds:bbox,actualBox,boundsError,rgbaError,maxChannelError,maxAlphaError,maxPremultipliedError,svgRGBAError,fallbackError})
  }
  results.push({name:input.name,nativeReferenceError:expected.reduce((sum,value,i)=>sum+Math.abs(value-svgPixels[i]),0),variants,referenceCanvas,...(input.time?{frozenSource}: {})});host.remove()
 }
 document.querySelector('#result').setAttribute('data-result',btoa(JSON.stringify(results)))
}
fs.mkdirSync(output,{recursive:true});const bundle='{'+Object.entries(modules).map(([id,s])=>JSON.stringify(id)+':function(require,module,exports){\n'+s+'\n}').join(',')+'}',file=path.join(output,'oracle.html')
fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><div id="result"></div><script src="'+pathToFileURL(path.join(root,'svg/vendor/pathkit/pathkit.js')).href+'"></script><script>window.onerror=m=>document.querySelector("#result").setAttribute("data-error",m);('+run.toString()+')('+JSON.stringify(cases).replace(/</g,'\\u003c')+','+bundle+','+JSON.stringify(fs.readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm')).toString('base64'))+').catch(e=>document.querySelector("#result").setAttribute("data-error",String(e.stack||e)))</script>')
const chrome=process.env.HTML_READER_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome'),result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=5000',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024}),match=(result.stdout||'').match(/data-result="([^"]+)"/)
const diagnostics={case:((result.stdout||'').match(/data-case="([^"]+)"/)||[])[1],status:result.status,error:result.error&&result.error.message,browserError:((result.stdout||'').match(/data-error="([^"]+)"/)||[])[1],stderr:(result.stderr||'').slice(-8192)};fs.writeFileSync(path.join(output,'diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n');assert.ok(!result.error&&result.status===0&&match,JSON.stringify(diagnostics))
const requireNativeSvg=true
const results=JSON.parse(Buffer.from(match[1],'base64').toString()),failures=require('./svg-pixel-verdict').svgPixelFailures(results)
const report={testedAt:new Date().toISOString(),reference:'Native Chrome DOM getBBox plus independent Canvas Path2D paints; pinned WPT reference SVGs',cases:results.length,exactPixels:results.filter(r=>r.variants[0].rgbaError===0).length,nativeSvgExactPixels:results.filter(r=>r.variants[0].svgRGBAError===0).length,requireNativeSvg,failures:failures.map(r=>r.name),results};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,exactPixels:report.exactPixels,failures:failures.map(r=>({name:r.name,...r.variants[0]}))},null,2));if(!process.argv.includes('--discover'))assert.equal(failures.length,0)
