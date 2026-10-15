'use strict'
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {automationPortForProject,installAutomatorVersionCompatibility}=require('./miniprogram-automator-compat')
const {cases,publicSamples,compact}=require('../tests/helpers/svg-path-grammar')
const output=path.resolve(process.argv[2]||'/tmp/html-reader-svg-path-grammar-wechat')
const escape=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const animate='<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/>'
const inputs=[]
for(const kind of ['compact-arc','invalid-prefix']) for(const index of [1,8,16,32]) {
 const sample=cases.find(c=>c.name===`${kind}-${index}`)
 inputs.push({name:sample.name,versions:['expected','input'].map(key=>({variant:key,source:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 140 140"><path fill="none" stroke="black" stroke-width="2" d="${escape(sample[key])}"/>${animate}</svg>`}))})
}
for(const sample of publicSamples) inputs.push({name:sample.name,versions:['original','compact','invalid-tail'].map(variant=>({variant,source:sample.sourceText.replace(/\bd="([^"]+)"/g,(_,d)=>`d="${escape(variant==='compact'?compact(d):variant==='invalid-tail'?d+'X M30 30L40 40':d)}"`).replace('</svg>',animate+'</svg>')}))})
installAutomatorVersionCompatibility()
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const watchdog=setTimeout(()=>{console.error('WeChat path grammar verification exceeded 180 seconds');process.exit(2)},180000)
async function main(){
 const mini=await require('miniprogram-automator').connect({wsEndpoint:`ws://127.0.0.1:${automationPortForProject(process.cwd())}`})
 fs.mkdirSync(output,{recursive:true});const results=[]
 try{
  await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];if(p&&p.loadSample)setTimeout(()=>p.loadSample(),100)})
  for(let i=0;i<60;i++){if(await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];return !!(p&&p.selectComponent('#reader'))}))break;await delay(100)}
  for(const input of inputs){
   const frames=[]
   for(const {variant,source} of input.versions){
    const name=input.name+'-'+variant+'.svg'
    await mini.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(file,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:file,size:bytes.byteLength})},{name,base64:Buffer.from(source).toString('base64')})
    let frame
    for(let i=0;i<80;i++){
     frame=await mini.evaluate(({name,source})=>{
      const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),v=r&&r.selectComponent('#standalone-svg-player')
      if(!v||!v.data.ready||!v._ctx||r.data.isLoading||r.data.sourceName!==name||v.data.source!==source)return null
      v.cancel();v.drawFrame(0);const pixels=v._ctx.getImageData(0,0,v._canvas.width,v._canvas.height).data
      let hash=2166136261,ink=0;for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619)>>>0;if(i%4===3&&pixels[i])ink++}
      return {hash,ink,width:v._canvas.width,height:v._canvas.height,error:r.data.error,animated:v._scene.animated}
     },{name,source})
     if(frame)break;await delay(100)
    }
    assert.ok(frame,name+': Canvas not ready');assert.equal(frame.error,'');assert.ok(frame.ink>0,name+': blank');assert.equal(frame.animated,true)
    frames.push({variant,...frame})
   }
   for(const f of frames){assert.equal(f.hash,frames[0].hash,input.name+': content differs');assert.equal(f.ink,frames[0].ink,input.name+': ink differs')}
   if(input.name.endsWith('.svg'))await saveSvgCanvasSnapshot(mini, path.join(output,input.name+'.png'))
   results.push({name:input.name,frames});console.log(JSON.stringify({name:input.name,frames:frames.length,hash:frames[0].hash}))
  }
  const system=await mini.evaluate(()=>{const i=wx.getSystemInfoSync();return {platform:i.platform,SDKVersion:i.SDKVersion}})
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),scope:'Actual WX file read; static paths inside an animated SVG exercise reader Canvas. Paired pixels compare syntax variants with explicit expected paths, not physical devices or complete native pixel fidelity.',system,results},null,2)+'\n')
 }finally{await mini.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(watchdog))
