'use strict'
const fs=require('node:fs'),path=require('node:path')
const compat=require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility()
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-materials/ai-html'),out=path.join(root,'outputs/reliability'),sleep=ms=>new Promise(r=>setTimeout(r,ms))
;(async()=>{
 const mini=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(root)}),results=[]
 try{
  await mini.reLaunch('/pages/index/index');await sleep(300)
  let healthy=false
  for(let retry=0;retry<60;retry++){healthy=await mini.evaluate(()=>!!getCurrentPages().slice(-1)[0]?.openMaterial);if(healthy)break;await sleep(100)}
  if(!healthy)throw new Error('DevTools page did not compile; this is an environment failure, not 30 fixture failures')
  const cases=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).cases
  for(const item of cases){
   const start=Date.now(),result={id:item.id,name:item.name,category:item.category},html=fs.readFileSync(path.join(dir,item.file),'utf8')
   try{
    await mini.evaluate((html,name)=>{const page=getCurrentPages().slice(-1)[0],file={name,inlineHtml:html};Object.assign(getApp().globalData,{fileQueue:[file],fileQueueIndex:0,fileQueueScroll:{},recentSessionId:null,pendingMaterial:null});page.openMaterial(file);wx.pageScrollTo({scrollTop:0,duration:0})},html,item.file)
    let state
    for(let i=0;i<100;i++){
     state=await mini.evaluate(()=>{const c=getCurrentPages().slice(-1)[0].selectComponent('#reader');return {source:c.data.sourceName,error:c.data.error,loading:c.data.isLoading,content:c.data.hasContent,errors:c._htmlRuntime?c._htmlRuntime.errors.map(e=>e.message):[]}})
     if(state.source===item.file&&!state.loading)break
     await sleep(100)
    }
    result.state=state;result.readyMs=Date.now()-start
    if(state.loading||state.error||!state.content)throw new Error(state.error||'native content not ready')
    if(item.action){
     const nid=await mini.evaluate(selector=>getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector(selector)._nid,item.action)
     const page=await mini.currentPage(),component=await page.$('#reader'),button=await component.$('#dom-nid-'+nid)
     await button.tap();await sleep(100)
     if(item.expect){const value=await mini.evaluate(selector=>getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector(selector).textContent,item.expect.selector);result.interaction={expected:item.expect.text,actual:value};if(value!==item.expect.text)throw new Error('interaction mismatch')}
    }
    if(item.category==='depth-limit'){
     const nid=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector('p')._nid),page=await mini.currentPage(),component=await page.$('#reader');if(!await component.$('#dom-nid-'+nid))throw new Error('deepest content not present in native template')
    }
    if(item.category==='table'){
     const page=await mini.currentPage(),component=await page.$('#reader'),scroll=await component.$('.dom-table-scroll');if(!scroll)throw new Error('horizontal table scroll missing');await scroll.scrollTo(900,0);await sleep(100);result.tableScrollLeft=await scroll.property('scrollLeft');if(Number(result.tableScrollLeft)<500)throw new Error('table cannot scroll horizontally')
    }
    if(item.category==='canvas'){
     const page=await mini.currentPage(),component=await page.$('#reader'),node=await component.$('.dom-canvas'),size=await node.size();result.canvasSize=size;if(Math.abs(size.width-size.height)>1)throw new Error('square canvas stretched')
    }
    result.status=state.errors.length?'script-boundary':'checks-passed'
    if([1,3,4,8,10,15].includes(item.id))await mini.screenshot({path:path.join(out,'wechat-ai-'+item.id+'.png')})
   }catch(e){result.status='needs-review';result.error=e.message}
   results.push(result);fs.writeFileSync(path.join(out,'wechat-ai-30.json'),JSON.stringify({scope:'WeChat DevTools readiness and actual taps; six screenshots; not physical-device testing',results},null,2));console.log(item.id,item.name,result.status,result.readyMs)
  }
 }finally{await mini.disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1})
