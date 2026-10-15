'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {automationPortForProject,installAutomatorVersionCompatibility}=require('./miniprogram-automator-compat')
const {saveSvgCanvasSnapshot}=require('./svg-wechat-snapshot')
const {cases}=require('../tests/helpers/svg-viewports')
const output=path.resolve(process.argv[2]||'/tmp/html-reader-svg-viewports-wechat')
const chrome=JSON.parse(fs.readFileSync(process.argv[3]||'outputs/svg-viewports/report.json','utf8'))
const inputs=cases.map(c=>({...c,referenceCanvas:chrome.results.find(r=>r.name===c.name).referenceCanvas,bounds:chrome.results.find(r=>r.name===c.name).variants[0].bounds,source:c.source.replace(/<\/svg>\s*$/, '<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>')}))
installAutomatorVersionCompatibility()
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const watchdog=setTimeout(()=>{console.error('WeChat SVG viewport run exceeded 600 seconds');process.exit(2)},600000)
async function main(){
 const mini=await require('miniprogram-automator').connect({wsEndpoint:`ws://127.0.0.1:${automationPortForProject(process.cwd())}`})
 fs.mkdirSync(output,{recursive:true});const results=[]
 const open=async(name,source)=>mini.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(file,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:file,size:bytes.byteLength})},{name,base64:Buffer.from(source).toString('base64')})
 try{
  await mini.reLaunch('/pages/home/home');await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];if(p.loadSample)setTimeout(()=>p.loadSample(),100)})
  for(let i=0;i<60;i++){if(await mini.evaluate(()=>!!getCurrentPages().slice(-1)[0].selectComponent('#reader')))break;await delay(100)}
  for(const input of inputs){
   const name=input.name+'-viewport.svg';await open(name,input.source);let result
   for(let i=0;i<80;i++){
    result=await mini.evaluate(({name,input})=>{
     const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),v=r&&r.selectComponent('#standalone-svg-player')
     if(!v||!v.data.ready||!v._ctx||r.data.isLoading||r.data.sourceName!==name||v.data.source!==input.source)return null
     v.cancel();v.drawFrame(input.time||0)
     const ctx=v._ctx,width=v._canvas.width,height=v._canvas.height,base=ctx.getTransform(),actual=new Uint8ClampedArray(ctx.getImageData(0,0,width,height).data)
     const bbox=input.oracle?v._scene.renderer.getBounds(v._scene.doc.byId[input.oracle.measureId],v._scene.timeline.sample(input.time||0)):null
     ctx.save()
     try{
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.scale(base.a,base.d)
      if(input.oracle){
       ctx.scale(v._width/256,v._height/256);ctx.fillStyle='red';ctx.fillRect(0,0,256,256)
       const o=input.oracle,b=input.bounds;if(o.matrix)ctx.transform(...o.matrix);ctx.beginPath();ctx.rect(b.x+b.width*o.clip[0],b.y+b.height*o.clip[1],b.width*o.clip[2],b.height*o.clip[3]);ctx.clip()
       for(const p of o.paints){ctx.save();if(p.matrix)ctx.transform(...p.matrix);ctx.fillStyle=p.fill||'green';ctx.fill(v._canvas.createPath2D(p.d));ctx.restore()}
      }else{
       const reference=input.referenceCanvas;ctx.scale(v._width/reference.width,v._height/reference.height)
       for(const p of reference.operations){ctx.save();for(const clip of p.clips){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.width,clip.height);ctx.clip()}ctx.transform(...p.matrix);ctx.fillStyle=p.fill;ctx.fillRect(p.x,p.y,p.width,p.height);ctx.restore()}
      }
      const expected=ctx.getImageData(0,0,width,height).data;let rgbaError=0,maxChannelError=0,ink=0,changedChannels=0;const differences=[]
      for(let j=0;j<actual.length;j++){const d=Math.abs(actual[j]-expected[j]);rgbaError+=d;maxChannelError=Math.max(maxChannelError,d);if(d){changedChannels++;if(differences.length<6)differences.push({x:Math.floor(j/4)%width,y:Math.floor(j/4/width),channel:j%4,actual:actual[j],expected:expected[j]})}if(j%4===3&&actual[j])ink++}
      return {rgbaError,maxChannelError,changedChannels,differences,ink,width,height,cssWidth:v._width,cssHeight:v._height,bbox,boundsError:bbox?Math.max(...Object.keys(bbox).map(k=>Math.abs(bbox[k]-input.bounds[k]))):null,animated:v._scene.animated,error:r.data.error}
     }finally{ctx.restore();v.drawFrame(input.time||0)}
    },{name,input})
    if(result)break;await delay(100)
   }
   assert.ok(result,name+': not ready');assert.equal(result.error,'');assert.equal(result.animated,true)
   if(input.blank)assert.equal(result.ink,0,name+': zero viewBox must remain blank');else assert.ok(result.ink>0,name+': unexpected blank')
   if(input.width&&input.height)assert.ok(Math.abs(result.cssHeight/result.cssWidth-input.height/input.width)<1e-8,name+': wrong intrinsic aspect ratio')
   assert.ok(result.boundsError==null||result.boundsError<1e-4,name+': wrong bounds')
   results.push({name:input.name,...result});fs.writeFileSync(path.join(output,'partial.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({name:input.name,rgbaError:result.rgbaError,max:result.maxChannelError,ink:result.ink}))
   if(!process.argv.includes('--discover'))assert.equal(result.rgbaError,0,name+': reference mismatch')
   if(input.name==='root-wide-none'||input.name==='xMaxYMax-slice'||input.blank)await saveSvgCanvasSnapshot(mini,path.join(output,input.name+'.png'))
  }
  const recovery=[]
  for(const row of [{name:'extreme-viewport.svg',source:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1e8"><rect width="1" height="1e8"/><animate attributeName="opacity" values="1;1" dur="1s" repeatCount="indefinite"/></svg>',limited:true},{name:'after-extreme-viewport.svg',source:inputs[0].source,limited:false}]){
   await open(row.name,row.source);let state
   for(let i=0;i<80;i++){state=await mini.evaluate(name=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),v=r.selectComponent('#standalone-svg-player');if(r.data.sourceName!==name||r.data.isLoading)return null;return {ready:!!(v&&v.data.ready),notice:r.data.standaloneSvgAnimationNotice,canRetry:r.data.standaloneSvgAnimationCanRetry}},row.name);if(state&&(row.limited?state.notice:state.ready))break;await delay(100)}
   assert.ok(state,row.name);if(row.limited){assert.match(state.notice,/静态预览/);assert.equal(state.canRetry,true)}else{assert.equal(state.ready,true);assert.equal(state.notice,'')}recovery.push({name:row.name,...state})
  }
  const system=await mini.evaluate(()=>{const s=wx.getSystemInfoSync();return {platform:s.platform,SDKVersion:s.SDKVersion,version:s.version}})
  const report={testedAt:new Date().toISOString(),scope:'Actual reader file import and device-resolution Canvas, with independent Chrome reference DOM rectangle commands; DevTools only.',mode:process.argv.includes('--discover')?'discovery':'strict',system,exactCases:results.filter(r=>r.rgbaError===0).length,pendingPixels:results.filter(r=>r.rgbaError!==0).map(r=>r.name),results,recovery}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
 }finally{await mini.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(watchdog))
