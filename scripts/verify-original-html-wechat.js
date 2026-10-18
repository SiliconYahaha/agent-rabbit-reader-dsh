'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const compat=require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility()
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/reliability'),sleep=ms=>new Promise(r=>setTimeout(r,ms)),flat=ns=>ns.flatMap(n=>[n,...flat(n.children||[])])
;(async()=>{
 const mini=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(root)})
 try{
 await mini.reLaunch('/pages/index/index');await sleep(300)
 await mini.evaluate(html=>{const page=getCurrentPages().slice(-1)[0],file={name:'html-css-js-local-test.html',inlineHtml:html};Object.assign(getApp().globalData,{fileQueue:[file],fileQueueIndex:0,fileQueueScroll:{},recentSessionId:null});page.openMaterial(file);wx.pageScrollTo({scrollTop:0,duration:0})},fs.readFileSync(path.join(root,'html-css-js-local-test.html'),'utf8'))
 const page=await mini.currentPage();let c
 for(let i=0;i<100;i++){c=await page.$('#reader');if(c&&typeof c.data==='function'&&!await c.data('isLoading')&&await c.data('hasContent'))break;await sleep(100)}
 const ids=await mini.evaluate(()=>{const d=getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document;return {button:d.getElementById('themeToggle')._nid,quote:d.querySelector('blockquote')._nid}})
 await(await c.$('#dom-nid-'+ids.button)).tap();await sleep(250)
 const tree=await c.data('domTree'),styles=await c.data('domStyles'),quote=flat(tree).find(n=>n.nid===ids.quote)
 assert.match(styles[quote.styleId],/color:#6f7072/)
 const el=await c.$('#dom-nid-'+ids.quote),offset=await el.offset();await mini.pageScrollTo(Math.max(0,offset.top-70));await sleep(150)
 await mini.screenshot({path:path.join(out,'wechat-original-dark.png')})
 fs.writeFileSync(path.join(out,'wechat-original-dark.json'),JSON.stringify({file:'html-css-js-local-test.html',theme:'dark',quoteStyle:styles[quote.styleId],pass:true},null,2));console.log('Original comprehensive HTML dark quote verified')
 }finally{await mini.disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1})
