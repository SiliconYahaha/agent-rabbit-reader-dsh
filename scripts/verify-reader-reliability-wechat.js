'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {installAutomatorVersionCompatibility,automationPortForProject}=require('./miniprogram-automator-compat');installAutomatorVersionCompatibility()
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/reliability'),sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function until(read,label){for(let i=0;i<150;i++){const v=await read();if(v)return v;await sleep(100)}throw new Error(label)}
const html=`<!doctype html><style>body{margin:16px;font:16px/1.5 sans-serif}body.dark{color:#e5e7eb;background:#111827}blockquote{background:#f5f3ff;margin:20px 0;padding:18px}button{color:#0ff;background:#111827}p{margin:16px 0}</style><body><button id="theme" onclick="document.body.classList.toggle('dark')">切换深色</button><blockquote id="quote">深色模式也要读清楚这段文字。</blockquote><p id="one">第一段</p><p id="two">第二段</p><button><svg id="icon" width="24" height="24" viewBox="0 0 24 24"><path stroke="currentColor" fill="none" d="M2 2L20 20M20 2L2 20"/></svg>小图标</button><div style="height:1400px">滚动恢复测试</div></body>`
;(async()=>{
 fs.mkdirSync(out,{recursive:true});const mini=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+automationPortForProject(root)})
 const results=[]
 try{
 await mini.reLaunch('/pages/home/home')
 await mini.evaluate(source=>{
  const fs=wx.getFileSystemManager(),base=wx.env.USER_DATA_PATH+'/reliability-'
  fs.writeFileSync(base+'first.html',source,'utf8');fs.writeFileSync(base+'note','# 无后缀笔记\n\n- [x] 自动排版','utf8');fs.writeFileSync(base+'doc.pdf','%PDF-1.7','utf8')
  fs.writeFileSync(base+'image.png','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64')
  const files=[{name:'深色与图标.html',path:base+'first.html'},{name:'无后缀笔记',path:base+'note'},{name:'图片.png',path:base+'image.png'},{name:'文档.pdf',path:base+'doc.pdf'}]
  const session=require('utils/file-session.js');session.stageMaterialRoute(getApp(),session.startFileSession(getApp(),files))
  const old={preview:wx.previewImage,document:wx.openDocument,sheet:wx.showActionSheet,calls:[]};getApp().__reliability=old
  wx.previewImage=o=>old.calls.push('image');wx.openDocument=o=>old.calls.push('document');wx.showActionSheet=o=>old.calls.push('sheet')
 },html)
 await mini.reLaunch('/pages/index/index');let page=await mini.currentPage(),component=await until(async()=>{const c=await page.$('#reader');return c&&typeof c.data==='function'?c:null},'reader missing')
 async function ready(){await until(async()=>{const d=await component.data();if(d.error)throw new Error(d.error);return d.hasContent&&!d.isLoading},'file not ready')}
 await ready()
 let nid=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('theme')._nid)
 await(await component.$('#dom-nid-'+nid)).tap();await sleep(400)
 const tree=await component.data('domTree');const flatten=n=>n.flatMap(x=>[x,...flatten(x.children||[])]);const all=flatten(tree)
 const ids=await mini.evaluate(()=>{const d=getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document;return {quote:d.getElementById('quote')._nid,icon:d.getElementById('icon')._nid}})
 const quote=all.find(n=>n.nid===ids.quote),icon=all.find(n=>n.nid===ids.icon)
 // compact styles may be held in the shared style table
 const styles=await component.data('domStyles');const style=n=>n.attrs?.style||styles[n.styleId]||''
 assert.match(style(quote),/color:#6f7072/);assert.match(style(icon),/width:24px/)
 const iconSize=await(await component.$('#dom-nid-'+icon.nid)).size();assert.ok(iconSize.width<30&&iconSize.height<30)
 await mini.screenshot({path:path.join(out,'wechat-dark-and-icon.png')});results.push({test:'dark quote readable and 24px SVG',pass:true,iconSize})
 await mini.callWxMethod('pageScrollTo',{scrollTop:650,duration:0});await sleep(250)
 await page.callMethod('openNextFile');await ready();assert.equal(await component.data('sourceName'),'无后缀笔记')
 assert.match(JSON.stringify(await component.data('domTree')),/自动排版/)
 await page.callMethod('openNextFile');await ready();assert.ok(await component.data('imagePath'))
 await page.callMethod('openNextFile');await ready();assert.equal(await component.data('nativeDocumentName'),'文档.pdf')
 assert.deepEqual(await mini.evaluate(()=>getApp().__reliability.calls),[]);results.push({test:'mixed HTML/unknown Markdown/image/PDF queue, zero automatic native popups',pass:true})
 await page.callMethod('toggleQueue');await page.callMethod('searchQueue',{detail:{value:'深色'}});assert.equal((await page.data('queueItems')).length,1)
 await page.callMethod('chooseQueueFile',{currentTarget:{dataset:{index:0}}});await ready();await sleep(300)
 const scroll=await mini.evaluate(()=>getApp().globalData.fileQueueScroll[0]);assert.ok(scroll>600);const viewport=await mini.evaluate(()=>new Promise(resolve=>wx.createSelectorQuery().selectViewport().scrollOffset().exec(r=>resolve(r[0]))));assert.ok(Math.abs(viewport.scrollTop)>600);results.push({test:'filename search and switch back preserves scroll',pass:true,scroll})
 await until(()=>mini.evaluate(()=>!!getApp().globalData.recentSessionId),'cache not saved')
 await page.callMethod('onHide')
 await mini.evaluate(()=>{getApp().globalData.fileQueue=[];getApp().globalData.fileQueueIndex=-1;getApp().globalData.recentSessionId=null})
 await mini.reLaunch('/pages/home/home');page=await mini.currentPage();assert.equal((await page.data('recent')).count,4)
 await mini.screenshot({path:path.join(out,'wechat-resume-home.png')})
 await page.callMethod('resumeReading');await until(async()=>(await mini.currentPage()).path==='pages/index/index','resume route failed')
 page=await mini.currentPage();component=await until(async()=>{const c=await page.$('#reader');return c&&typeof c.data==='function'?c:null},'restored reader missing');await ready()
 assert.equal(await page.data('queueCount'),4);assert.equal(await component.data('sourceName'),'深色与图标.html')
 results.push({test:'clear in-memory session then restore cached files from home',pass:true})
 await mini.evaluate(()=>require('utils/recent-session.js').clear())
 fs.writeFileSync(path.join(out,'wechat-reliability.json'),JSON.stringify({environment:'WeChat DevTools, not physical device',results},null,2));console.log(results)
 }finally{await mini.evaluate(()=>{const t=getApp().__reliability;if(t){wx.previewImage=t.preview;wx.openDocument=t.document;wx.showActionSheet=t.sheet;delete getApp().__reliability}}).catch(()=>{});await mini.disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1})
