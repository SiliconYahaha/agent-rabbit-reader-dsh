'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process')
const { cases } = require('../tests/helpers/rtf-special-characters')
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
    for (const id of ['emspace-plain','enspace-extra-space','qmspace-plain','zwj-plain','zwnj-plain','zwbo-plain','zwnbo-plain','ltrmark-plain','rtlmark-plain','page-plain','column-plain','emoji-joiner','arabic-nonjoiner','mixed-direction','zwj-hidden','page-fallback-one']) {
      const c=cases.find(c=>c.id===id),name=c.id+'.rtf'
      await mp.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),filePath=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(filePath,bytes);getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({name,path:filePath,size:bytes.byteLength})},{name,base64:Buffer.from(c.source).toString('base64')})
      let state
      for(let i=0;i<100;i++){state=await mp.evaluate(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');return {name:r.data.sourceName,error:r.data.error,ready:r.data.hasContent&&!r.data.isLoading}});if(state.error||(state.ready&&state.name===name))break;await delay(100)}
      assert.equal(state.error,'',name);assert.equal(state.name,name);assert.ok(state.ready,name)
      const result=await mp.evaluate(()=>{
        const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),d=r._htmlRuntime.document
        const pre=d.querySelector('pre')
        return {nid:pre._nid,text:pre.textContent,errors:r._htmlRuntime.errors}
      })
      assert.equal(result.text,c.expected,name+': exact content')
      assert.deepEqual(result.errors,[],name)
      const element=await page.$('#reader >>> #dom-nid-'+result.nid)
      assert.ok(element,name+': real WXML view');const rendered=await element.text(),size=await element.size()
      assert.equal(rendered,result.text,name+': exact visible text')
      assert.ok(size.width>0&&size.height>0,name+': visible geometry')
      rows.push({name,actualView:true,text:rendered,size});console.log('RTF special characters: '+name+' native view passed')
    }
    const out=path.join(root,'outputs/rtf-special-characters');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'wechat.json'),JSON.stringify({at:new Date().toISOString(),cases:rows.length,rows,physicalDevices:'not run'},null,2)+'\n')
  } finally {mp.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
