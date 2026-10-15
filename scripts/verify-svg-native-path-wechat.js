'use strict'
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {automationPortForProject,installAutomatorVersionCompatibility}=require('./miniprogram-automator-compat')
const {styled,publicSamples}=require('../tests/helpers/svg-native-path')
const output=path.resolve(process.argv[2]||'/tmp/html-reader-svg-native-path-wechat')
const animate='<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/>'
const inputs=[...styled,...publicSamples.map(p=>({name:p.name,source:p.sourceText}))].map(p=>({name:p.name,versions:[{variant:'native',source:p.source.replace('</svg>',animate+'</svg>')}]}))
installAutomatorVersionCompatibility()
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const watchdog=setTimeout(()=>{console.error('WeChat native path verification exceeded 180 seconds');process.exit(2)},180000)
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
      v.cancel();let nativePaints=0;const ctx=v._ctx,fill=ctx.fill,stroke=ctx.stroke
      ctx.fill=function(...args){if(args[0]&&typeof args[0]==='object')nativePaints++;return fill.apply(this,args)}
      ctx.stroke=function(...args){if(args[0]&&typeof args[0]==='object')nativePaints++;return stroke.apply(this,args)}
      try{v.drawFrame(0)}finally{ctx.fill=fill;ctx.stroke=stroke}
      const moved=v._canvas.createPath2D(''),original=v._canvas.createPath2D('M0 0H2V2H0Z')
      moved.addPath(original,{a:1,b:0,c:0,d:1,e:20,f:0});ctx.save();ctx.setTransform(1,0,0,1,0,0)
      const transformedPath=ctx.isPointInPath(moved,21,1)&&!ctx.isPointInPath(moved,1,1);ctx.restore()
      const pixels=v._ctx.getImageData(0,0,v._canvas.width,v._canvas.height).data
      let hash=2166136261,ink=0;for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619)>>>0;if(i%4===3&&pixels[i])ink++}
      return {nativePaints,transformedPath,hash,ink,width:v._canvas.width,height:v._canvas.height,error:r.data.error,animated:v._scene.animated}
     },{name,source})
     if(frame)break;await delay(100)
    }
    assert.ok(frame,name+': Canvas not ready');assert.equal(frame.error,'');assert.ok(frame.ink>0,name+': blank');assert.equal(frame.animated,true);assert.ok(frame.nativePaints>0,name+': native path not painted');assert.equal(frame.transformedPath,true,name+': transform overload rejected')
    frames.push({variant,...frame})
   }
   for(const f of frames){assert.equal(f.hash,frames[0].hash,input.name+': content differs');assert.equal(f.ink,frames[0].ink,input.name+': ink differs')}
   if(input.name.endsWith('.svg'))await saveSvgCanvasSnapshot(mini, path.join(output,input.name+'.png'))
   results.push({name:input.name,frames});console.log(JSON.stringify({name:input.name,frames:frames.length,hash:frames[0].hash}))
  }
  const system=await mini.evaluate(()=>{const i=wx.getSystemInfoSync();return {platform:i.platform,SDKVersion:i.SDKVersion}})
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),scope:'12 actual files imported through reader Canvas with neutral animation; nonblank pixels, native Path2D paint overload calls and transformed addPath geometry checked. Chrome owns independent pixel oracle; this report is DevTools, not physical devices.',system,results},null,2)+'\n')
 }finally{await mini.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(watchdog))
