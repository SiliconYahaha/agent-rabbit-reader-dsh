'use strict'
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {automationPortForProject,installAutomatorVersionCompatibility}=require('./miniprogram-automator-compat')
const {cases}=require('../tests/helpers/svg-clip-unions')
const output=path.resolve(process.argv[2]||'/tmp/html-reader-svg-clip-unions-wechat')
const animate='<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/>'
const inputs=cases.filter((c,i)=>i<8||c.name.endsWith('.svg')||c.name.startsWith('union-transform-')).map(c=>({name:c.name,expected:c.expected,versions:[{variant:'native',source:c.source.replace('</svg>',animate+'</svg>')}]}))
installAutomatorVersionCompatibility()
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const watchdog=setTimeout(()=>{console.error('WeChat native path verification exceeded 180 seconds');process.exit(2)},180000)
async function main(){
 const mini=await require('miniprogram-automator').connect({wsEndpoint:`ws://127.0.0.1:${automationPortForProject(process.cwd())}`})
 fs.mkdirSync(output,{recursive:true});const results=[]
 try{
  await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];if(p&&p.loadSample)setTimeout(()=>p.loadSample(),100)})
  for(let i=0;i<60;i++){if(await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];return !!(p&&p.selectComponent('#reader'))}))break;await delay(100)}
  for(const input of process.argv.includes('--resource-only')?[]:inputs){
   const frames=[]
   for(const {variant,source} of input.versions){
    const name=input.name+'-'+variant+'.svg'
    await mini.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(file,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:file,size:bytes.byteLength})},{name,base64:Buffer.from(source).toString('base64')})
    let frame
    for(let i=0;i<80;i++){
     frame=await mini.evaluate(({name,source,expected})=>{
      const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),v=r&&r.selectComponent('#standalone-svg-player')
      if(!v||!v.data.ready||!v._ctx||r.data.isLoading||r.data.sourceName!==name||v.data.source!==source)return null
      v.cancel();let nativePaints=0,nativeClips=0;const ctx=v._ctx,fill=ctx.fill,stroke=ctx.stroke,clip=ctx.clip
      ctx.fill=function(...args){if(args[0]&&typeof args[0]==='object')nativePaints++;return fill.apply(this,args)}
      ctx.stroke=function(...args){if(args[0]&&typeof args[0]==='object')nativePaints++;return stroke.apply(this,args)}
      ctx.clip=function(...args){if(args[0]&&typeof args[0]==='object')nativeClips++;return clip.apply(this,args)}
      try{v.drawFrame(0)}finally{ctx.fill=fill;ctx.stroke=stroke;ctx.clip=clip}
      const moved=v._canvas.createPath2D(''),original=v._canvas.createPath2D('M0 0H2V2H0Z')
      moved.addPath(original,{a:1,b:0,c:0,d:1,e:20,f:0});ctx.save();ctx.setTransform(1,0,0,1,0,0)
      const transformedPath=ctx.isPointInPath(moved,21,1)&&!ctx.isPointInPath(moved,1,1);ctx.restore()
      const pixels=v._ctx.getImageData(0,0,v._canvas.width,v._canvas.height).data
      let hash=2166136261,ink=0;for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619)>>>0;if(i%4===3&&pixels[i])ink++}
      let oracleError=null
      if(expected){
        const actual=new Uint8ClampedArray(pixels);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,v._canvas.width,v._canvas.height);ctx.scale(v._canvas.width/expected.units,v._canvas.height/expected.units)
        for(const clip of expected.clips){let p=v._canvas.createPath2D(clip.d);if(clip.matrix){const q=v._canvas.createPath2D(''),m=clip.matrix;q.addPath(p,{a:m[0],b:m[1],c:m[2],d:m[3],e:m[4],f:m[5]});p=q}ctx.clip(p,clip.rule||'nonzero')}
        ctx.fillStyle=expected.fill;ctx.fill(v._canvas.createPath2D(expected.target));const reference=ctx.getImageData(0,0,v._canvas.width,v._canvas.height).data;oracleError=0;for(let j=0;j<actual.length;j++)oracleError+=Math.abs(actual[j]-reference[j]);ctx.restore();v.drawFrame(0)
      }
      return {oracleError,nativeClips,nativePaints,transformedPath,hash,ink,width:v._canvas.width,height:v._canvas.height,error:r.data.error,animated:v._scene.animated}
     },{name,source,expected:input.expected})
     if(frame)break;await delay(100)
    }
    assert.ok(frame,name+': Canvas not ready');assert.equal(frame.error,'');if(input.expected)assert.equal(frame.oracleError,0,name+': differs from independent Canvas union contour');if(input.blank)assert.equal(frame.ink,0,name+': invalid use should have no silhouette');else assert.ok(frame.ink>0,name+': blank');assert.equal(frame.animated,true);if(!input.blank&&!input.name.endsWith('.svg'))assert.ok(frame.nativeClips>0,name+': native clipping not used');assert.equal(frame.transformedPath,true,name+': transform overload rejected')
    frames.push({variant,...frame})
   }
   for(const f of frames){assert.equal(f.hash,frames[0].hash,input.name+': content differs');assert.equal(f.ink,frames[0].ink,input.name+': ink differs')}
   if(input.name.endsWith('.svg'))await saveSvgCanvasSnapshot(mini, path.join(output,input.name+'.png'))
   results.push({name:input.name,frames});console.log(JSON.stringify({name:input.name,frames:frames.length,hash:frames[0].hash}))
  }
  const star=(n,offset)=>'M'+Array.from({length:n},(_,i)=>{const a=(i*251+offset)*Math.PI*2/n;return (50+45*Math.cos(a))+' '+(50+45*Math.sin(a))}).join('L')+'Z'
  const dense='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c"><path d="'+star(510,0)+'"/><path d="'+star(510,.5)+'"/></clipPath><rect width="100" height="100" clip-path="url(#c)"/>'+animate+'</svg>'
  const recovery=[]
  for(const row of [{name:'dense-budget.svg',source:dense,limited:true},{name:'after-dense.svg',source:inputs[0].versions[0].source,limited:false}]){
    await mini.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(file,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:file,size:bytes.byteLength})},{name:row.name,base64:Buffer.from(row.source).toString('base64')})
    let state
    for(let i=0;i<100;i++){
      state=await mini.evaluate(name=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),v=r.selectComponent('#standalone-svg-player');if(r.data.sourceName!==name||r.data.isLoading)return null;return {ready:!!(v&&v.data.ready),notice:r.data.standaloneSvgAnimationNotice,canRetry:r.data.standaloneSvgAnimationCanRetry}},row.name)
      if(state&&(row.limited?state.notice:state.ready))break;await delay(100)
    }
    assert.ok(state,row.name+': no terminal state')
    if(row.limited){assert.match(state.notice,/静态预览/);assert.equal(state.canRetry,true)}else{assert.equal(state.ready,true);assert.equal(state.notice,'')}
    recovery.push({name:row.name,...state})
  }
  const system=await mini.evaluate(()=>{const i=wx.getSystemInfoSync();return {platform:i.platform,SDKVersion:i.SDKVersion}})
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),scope:process.argv.includes('--resource-only')?'Dense union triggers explicit fallback; following union file recovers through a new kernel instance. DevTools only.':'23 files through reader Canvas and packaged WXWebAssembly; 20 independent expected union contours compared pixel-for-pixel; 3 WPT files have independent reference comparisons in Chrome. DevTools is not a physical device test.',system,results,recovery},null,2)+'\n')
 }finally{await mini.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(watchdog))
