'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process')
const { cases } = require('../tests/fixtures/markdown-code-containers.json')
const { signature } = require('../tests/helpers/markdown-list-tabs')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root = path.resolve(__dirname, '..'), port = compat.automationPortForProject(root)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const automator = require('miniprogram-automator')
  let mp
  try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }) } catch (_) {
    execFileSync('/Applications/wechatwebdevtools.app/Contents/MacOS/cli', compat.automationCliArgs(root, port), { stdio: 'inherit', timeout: 60000 })
    // CLI returns before its automation socket is necessarily listening.
    let connectionError
    for (let i = 0; i < 20; i++) {
      try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }); break } catch (error) { connectionError = error; await delay(500) }
    }
    if (!mp) throw connectionError
  }
  try {
    let ready = false
    for (let i=0;i<120;i++) { if (await mp.evaluate(()=>getCurrentPages().length>0)) { ready=true;break }; await delay(500) }
    assert.ok(ready, 'WeChat must finish compiling and start the actual app')
    await mp.reLaunch('/pages/index/index')
    for (let i=0;i<40;i++) { ready=await mp.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];return !!(p&&p.selectComponent('#reader'))});if(ready)break;await delay(250) }
    assert.ok(ready, 'reader must be mounted')
    const page=await mp.currentPage(),rows=[]
    for (const index of [0,1,3,113,209,337,401,693,765]) {
      const c=cases[index],name=c.name+'.md'
      await mp.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),filePath=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(filePath,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:filePath,size:bytes.byteLength})},{name,base64:Buffer.from(c.source).toString('base64')})
      let state
      for(let i=0;i<100;i++){state=await mp.evaluate(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');return {name:r.data.sourceName,error:r.data.error,ready:r.data.hasContent&&!r.data.isLoading}});if(state.error||(state.ready&&state.name===name))break;await delay(100)}
      assert.equal(state.error,'',name);assert.equal(state.name,name);assert.ok(state.ready,name)
      const result=await mp.evaluate(()=>{
        const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),d=r._htmlRuntime.document
        function walk(n){if(n.nodeType===3)return n.textContent.replace(/[ \t\r\n]+/g,' ').trim()||null;const name=n.localName;if(name==='pre')return {name,text:n.textContent};const children=(n.childNodes||[]).map(walk).filter(n=>n!==null);if(['ul','ol','li','blockquote','p','h1','h2','hr','div','span'].includes(name))return {name,...(name==='ol'?{start:n.getAttribute('start')||'1'}:{}),children};return children.length?children:null}
        const article=d.querySelector('article'),tree=article.childNodes.filter(n=>n.localName!=='style').map(walk).filter(n=>n!==null)
        const targets=d.querySelectorAll('p,h1,li').filter(n=>n.textContent.includes('TAIL')).sort((a,b)=>a.textContent.length-b.textContent.length)
        return {tree,nid:targets[0]._nid,text:targets[0].textContent,errors:r._htmlRuntime.errors}
      })
      assert.deepEqual(result.tree,signature(c.referenceHtml),name+': complete structure')
      assert.deepEqual(result.errors,[],name)
      const element=await page.$('#reader >>> #dom-nid-'+result.nid)
      assert.ok(element,name+': real WXML view');const rendered=await element.text(),size=await element.size()
      assert.equal(rendered.trim().replace(/\s+/g,' '),result.text.trim().replace(/\s+/g,' '),name+': visible text')
      assert.ok(size.width>0&&size.height>0,name+': visible geometry')
      rows.push({name,actualView:true,text:rendered,size});console.log('Markdown containers: '+name+' native view passed')
    }
    const out=path.join(root,'outputs/markdown-code-containers');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'wechat.json'),JSON.stringify({at:new Date().toISOString(),cases:rows.length,rows,physicalDevices:'not run'},null,2)+'\n')
  } finally {mp.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
