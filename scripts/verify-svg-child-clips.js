'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const {cases}=require('../tests/helpers/svg-child-clips')
const {cases:chainCases,chainSource}=require('../tests/helpers/svg-clip-chains')
const {componentRun}=require('./verify-svg-clip-chains')
// This exact difference is independently corroborated by Firefox and rectangle
// intersection algebra; never relax the reader-v-reference pixel requirement.
const nativeDifferences={'own-object-box-with-child-clip':391680}
const names={'animated-inner-0':'animated-child-clip-0','animated-inner-0.5':'animated-child-clip-0.5','animated-inner-1':'animated-child-clip-1','union-both-sides':'child-partial'}
for(const time of [0,.5,1,1.5])names['animated-union-'+time]='animated-child-clip-'+time
function main(){
  const output=path.resolve(process.argv[2]||'outputs/svg-child-clips/gate'),root=path.resolve('miniprogram/file-reader/image');fs.mkdirSync(output,{recursive:true})
  const inputFile=path.join(output,'inputs.json');fs.writeFileSync(inputFile,JSON.stringify(cases,null,2)+'\n')
  execFileSync(process.execPath,['scripts/verify-svg-container-bounds.js',path.join(output,'geometry'),'--input-file',inputFile,'--discover'],{stdio:['ignore',fs.openSync(path.join(output,'geometry.log'),'w'),'inherit']})
  const geometry=JSON.parse(fs.readFileSync(path.join(output,'geometry/report.json'),'utf8'))
  const {readerPage}=require('../tests/helpers/reader-host'),pending=[]
  const page=readerPage({env:{USER_DATA_PATH:'/fixture'},getWindowInfo:()=>({windowWidth:256,windowHeight:256,pixelRatio:1}),getFileSystemManager:()=>({readFile:o=>pending.push(o),writeFile:()=>{throw Error('Unexpected fixture write')}})})
  const hostCases=cases.filter(c=>!c.name.startsWith('nested-union-'));hostCases.push(chainCases.find(c=>c.name==='sibling-after-clip'));const inputs=hostCases.map(c=>{const source=/<animate/.test(c.source)?c.source:c.source.replace('</svg>','<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>');page.openSelectedFile({name:c.name+'.svg',path:'/'+c.name+'.svg',size:Buffer.byteLength(source)});const read=pending.shift();assert.ok(read);read.success({data:source});assert.equal(page.data.error,'');assert.equal(page.data.hasContent,true);assert.equal(page.data.standaloneSvgAnimatedSource,source);return {...c,entrySource:page.data.standaloneSvgAnimatedSource}})
  const modules={};function include(id){if(modules[id])return;const source=modules[id]=fs.readFileSync(path.join(root,id),'utf8');for(const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))include(path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))+(m[1].endsWith('.js')?'':'.js'))}include('index.js');include('svg/svg-clip-union.js')
  const bundle='{'+Object.entries(modules).map(([id,s])=>JSON.stringify(id)+':function(require,module,exports){\n'+s+'\n}').join(',')+'}',file=path.join(output,'component.html'),component=fs.readFileSync(path.join(root,'components/svg-view/svg-view.js'),'utf8'),wasm=fs.readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm')).toString('base64')
  fs.writeFileSync(file,'<!doctype html><div id="result"></div><script src="'+pathToFileURL(path.join(root,'svg/vendor/pathkit/pathkit.js')).href+'"></script><script>('+componentRun.toString()+')('+JSON.stringify(inputs).replace(/</g,'\\u003c')+','+bundle+','+JSON.stringify(component).replace(/</g,'\\u003c')+','+JSON.stringify(wasm)+','+JSON.stringify(chainSource(65)).replace(/</g,'\\u003c')+','+JSON.stringify(names)+').catch(e=>document.querySelector("#result").setAttribute("data-error",e.stack))</script>')
  const chrome=process.env.HTML_READER_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome'),dump=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=10000',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']})
  fs.writeFileSync(path.join(output,'component-dom.html'),dump);const match=dump.match(/data-result="([^"]+)"/);assert.ok(match,(dump.match(/data-error="([^"]+)"/)||[])[1])
  const componentResult=JSON.parse(Buffer.from(match[1],'base64').toString()),errors=[]
  assert.deepEqual(geometry.results.map(r=>r.name),cases.map(c=>c.name));assert.deepEqual(componentResult.results.map(r=>r.name),hostCases.map(c=>c.name))
  for(const row of geometry.results){assert.deepEqual(row.variants.map(v=>v.mode),['native','fallback','factory-throws']);if(row.nativeReferenceError!==(nativeDifferences[row.name]||0)||row.variants.some(v=>v.error||v.rgbaError||v.svgRGBAError!==(nativeDifferences[row.name]||0)||v.fallbackError))errors.push(row.name+': geometry mismatch')}
  for(const row of componentResult.results)if(!row.ready||!row.animated||row.errors.length||row.rgbaError)errors.push(row.name+': component failure')
  const report={testedAt:new Date().toISOString(),chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),scope:'Real Node reader file entry and SVG component with Chrome Canvas and real PathKit; platform plumbing simulated; no WeChat/device claim',cases:cases.length,hostCases:hostCases.length,retainedChromeDifferences:nativeDifferences,independentExact:geometry.exactPixels,nativeExact:geometry.nativeSvgExactPixels,errors,component:componentResult}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,independentExact:report.independentExact,nativeExact:report.nativeExact,errors,lifecycle:componentResult.lifecycle}));assert.equal(errors.length,0)
}
main()
