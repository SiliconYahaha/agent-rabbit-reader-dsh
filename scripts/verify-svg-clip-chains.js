'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const {cases,chainSource}=require('../tests/helpers/svg-clip-chains')
async function componentRun(inputs,modules,componentSource,wasm,excessive,names={}) {
  const cache={}
  function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](p=>{const parts=id.split('/');parts.pop();for(const x of p.split('/')){if(x==='..')parts.pop();else if(x!=='.')parts.push(x)}let target=parts.join('/');if(!target.endsWith('.js'))target+='.js';return load(target)},m,m.exports);return m.exports}
  const bytes=Uint8Array.from(atob(wasm),c=>c.charCodeAt(0)),kernel=await PathKitInit({instantiateWasm(imports,receive){const i=new WebAssembly.Instance(new WebAssembly.Module(bytes),imports);receive(i);return i.exports}})
  const union=load('svg/svg-clip-union.js').createClipUnion(kernel),unionWaiters=[]
  let delayUnion=false,delayQuery=false,definition,serial=0
  const frames=new Map(),queries=[],canvas=document.createElement('canvas');canvas.width=canvas.height=256
  canvas.createPath2D=d=>new Path2D(d)
  canvas.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial};canvas.cancelAnimationFrame=id=>frames.delete(id)
  const ctx=canvas.getContext('2d'),check=(ok,message)=>{if(!ok)throw Error(message)}
  Function('require','Component','wx',componentSource)(id=>{
    if(id==='../../index')return load('index.js')
    if(id==='../../svg/svg-clip-runtime')return {loadClipUnion:()=>delayUnion?new Promise(resolve=>unionWaiters.push(resolve)):Promise.resolve(union)}
    throw Error('Unexpected dependency '+id)
  },v=>{definition=v},{getWindowInfo:()=>({pixelRatio:1})})
  const player={...definition.methods,data:{...definition.data,playing:false},_viewReady:true,_images:new Map(),events:[],
    setData(patch){Object.assign(this.data,patch)},triggerEvent(name,detail){this.events.push({name,detail})},
    createSelectorQuery(){const q={select:()=>q,boundingClientRect:()=>q,fields:()=>q,exec:callback=>{if(delayQuery)queries.push(callback);else callback([{width:256},{node:canvas,width:256}])}};return q}}
  const pixels=()=>new Uint8ClampedArray(ctx.getImageData(0,0,256,256).data),difference=(a,b)=>a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)
  async function expected(input){const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(input.referenceSource);await image.decode();const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,256,256).data}
  async function open(source){player.events=[];player.load(source);await Promise.resolve()}
  const results=[]
  // Reuse the same real component across files to expose leaked clipping state.
  for(const input of inputs){const reference=await expected(input);await open(input.entrySource);check(player.drawFrame(input.time||0),input.name+': draw failed');results.push({name:input.name,ready:player.data.ready,animated:player.data.animated,rgbaError:difference(pixels(),reference),errors:player.events.filter(e=>e.name==='error')})}
  const find=name=>inputs.find(i=>i.name===(names[name]||name)),timeline=find('animated-inner-0'),half=find('animated-inner-0.5'),full=find('animated-inner-1'),next=find('sibling-after-clip'),merged=find('union-both-sides')
  const refs=[await expected(timeline),await expected(half),await expected(full)],nextPixels=await expected(next)
  const frame=time=>{check(frames.size===1,'One scheduled frame');const [id,callback]=[...frames][0];frames.delete(id);callback(time)}
  player.data.playing=true;await open(timeline.entrySource);frame(1000);check(!difference(pixels(),refs[0]),'Initial animation');frame(1500);check(!difference(pixels(),refs[1]),'Half frame')
  const staleFrame=[...frames.values()][0];player.onTap();staleFrame(2000);check(!frames.size&&player.data.paused&&!difference(pixels(),refs[1]),'Pause ignores stale frame')
  player.onTap();frame(5000);check(!difference(pixels(),refs[1]),'Resume elapsed');frame(5500);check(!difference(pixels(),refs[2]),'Resume next frame')
  definition.pageLifetimes.hide.call(player);check(!frames.size,'Hide cancels');definition.pageLifetimes.show.call(player);frame(9000);check(!difference(pixels(),refs[2]),'Foreground retains elapsed')
  player.data.playing=false;delayQuery=true;await open(timeline.entrySource);const oldQuery=queries.shift();await open(next.entrySource);oldQuery([{width:999},{node:canvas,width:999}]);check(!player.data.ready,'Stale query cannot mount');queries.shift()([{width:256},{node:canvas,width:256}]);delayQuery=false;staleFrame(9999);check(!frames.size&&!difference(pixels(),nextPixels),'Switch ignores old callbacks')
  delayUnion=true;await open(merged.entrySource);check(!player.data.ready&&unionWaiters.length===1,'Union load deferred');await open(next.entrySource);unionWaiters.shift()(union);await Promise.resolve();check(!difference(pixels(),nextPixels),'Stale union cannot replace new file');delayUnion=false
  await open(excessive);check(player.events.some(e=>e.name==='error'&&/64/.test(e.detail.message))&&!frames.size,'Over-depth explicit error')
  await open('not svg');check(player.events.some(e=>e.name==='error'),'Malformed source error')
  await open(next.entrySource);check(player.data.ready&&!player.events.some(e=>e.name==='error')&&!difference(pixels(),nextPixels),'Recovery pixels')
  await open(find('animated-union-0').entrySource)
  for(const time of [0,.5,1,1.5,0]){const reference=await expected(find('animated-union-'+time));check(player.drawFrame(time)&&!difference(pixels(),reference),'Animated union cache refresh '+time)}
  delayUnion=true;await open(merged.entrySource);definition.lifetimes.detached.call(player);unionWaiters.shift()(union);await Promise.resolve();staleFrame(10000);check(!player._scene&&!player._canvas&&!frames.size,'Detach releases and rejects async completion')
  document.querySelector('#result').setAttribute('data-result',btoa(JSON.stringify({results,lifecycle:{pause:true,resume:true,hideShow:true,staleFrame:true,staleQuery:true,staleUnion:true,overDepthError:true,errorRecovery:true,animatedUnionCache:true,detach:true}})))
}
function main(){
  const output=path.resolve(process.argv[2]||'outputs/svg-clip-chains/gate'),root=path.resolve('miniprogram/file-reader/image');fs.mkdirSync(output,{recursive:true})
  const inputFile=path.join(output,'inputs.json');fs.writeFileSync(inputFile,JSON.stringify(cases,null,2)+'\n')
  execFileSync(process.execPath,['scripts/verify-svg-container-bounds.js',path.join(output,'geometry'),'--input-file',inputFile,'--discover'],{stdio:['ignore',fs.openSync(path.join(output,'geometry.log'),'w'),'inherit']})
  const geometry=JSON.parse(fs.readFileSync(path.join(output,'geometry/report.json'),'utf8'))
  const {readerPage}=require('../tests/helpers/reader-host'),pending=[]
  const page=readerPage({env:{USER_DATA_PATH:'/fixture'},getWindowInfo:()=>({windowWidth:256,windowHeight:256,pixelRatio:1}),getFileSystemManager:()=>({readFile:o=>pending.push(o),writeFile:()=>{throw Error('Unexpected fixture write')}})})
  const inputs=cases.map(c=>{const source=/<animate/.test(c.source)?c.source:c.source.replace('</svg>','<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>');page.openSelectedFile({name:c.name+'.svg',path:'/'+c.name+'.svg',size:Buffer.byteLength(source)});const read=pending.shift();assert.ok(read);read.success({data:source});assert.equal(page.data.error,'');assert.equal(page.data.hasContent,true);assert.equal(page.data.standaloneSvgAnimatedSource,source);return {...c,entrySource:page.data.standaloneSvgAnimatedSource}})
  const modules={};function include(id){if(modules[id])return;const source=modules[id]=fs.readFileSync(path.join(root,id),'utf8');for(const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))include(path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))+(m[1].endsWith('.js')?'':'.js'))}include('index.js');include('svg/svg-clip-union.js')
  const bundle='{'+Object.entries(modules).map(([id,s])=>JSON.stringify(id)+':function(require,module,exports){\n'+s+'\n}').join(',')+'}',file=path.join(output,'component.html'),component=fs.readFileSync(path.join(root,'components/svg-view/svg-view.js'),'utf8'),wasm=fs.readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm')).toString('base64')
  fs.writeFileSync(file,'<!doctype html><div id="result"></div><script src="'+pathToFileURL(path.join(root,'svg/vendor/pathkit/pathkit.js')).href+'"></script><script>('+componentRun.toString()+')('+JSON.stringify(inputs).replace(/</g,'\\u003c')+','+bundle+','+JSON.stringify(component).replace(/</g,'\\u003c')+','+JSON.stringify(wasm)+','+JSON.stringify(chainSource(65)).replace(/</g,'\\u003c')+').catch(e=>document.querySelector("#result").setAttribute("data-error",e.stack))</script>')
  const chrome=process.env.HTML_READER_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome'),dump=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=10000',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']})
  fs.writeFileSync(path.join(output,'component-dom.html'),dump);const match=dump.match(/data-result="([^"]+)"/);assert.ok(match,(dump.match(/data-error="([^"]+)"/)||[])[1])
  const componentResult=JSON.parse(Buffer.from(match[1],'base64').toString()),errors=[]
  assert.deepEqual(geometry.results.map(r=>r.name),cases.map(c=>c.name));assert.deepEqual(componentResult.results.map(r=>r.name),cases.map(c=>c.name))
  for(const row of geometry.results){assert.deepEqual(row.variants.map(v=>v.mode),['native','fallback','factory-throws']);if(row.nativeReferenceError||row.variants.some(v=>v.error||v.rgbaError||v.svgRGBAError||v.fallbackError))errors.push(row.name+': geometry mismatch')}
  for(const row of componentResult.results)if(!row.ready||!row.animated||row.errors.length||row.rgbaError)errors.push(row.name+': component failure')
  const report={testedAt:new Date().toISOString(),chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),scope:'Real Node reader file entry and SVG component with Chrome Canvas and real PathKit; platform plumbing simulated; no WeChat/device claim',cases:cases.length,independentExact:geometry.exactPixels,nativeExact:geometry.nativeSvgExactPixels,errors,component:componentResult}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,independentExact:report.independentExact,nativeExact:report.nativeExact,errors,lifecycle:componentResult.lifecycle}));assert.equal(errors.length,0)
}
if(require.main===module)main()

module.exports = { componentRun }
