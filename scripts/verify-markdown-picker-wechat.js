'use strict'
// Metadata and the user's format choice are controlled fixtures; filesystem,
// page navigation, Markdown runtime and rendered WXML are real DevTools paths.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root = path.resolve(__dirname, '..'), port = compat.automationPortForProject(root)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const sourcePath = process.argv[2] || require('./local-test-materials').findTestMaterial('平顶山市.md')
  const bytes = fs.readFileSync(sourcePath), source = bytes.toString('utf8')
  const heading = source.match(/^#\s+(.+)$/m)[1].trim()
  const tableCount = source.split('\n').filter(line => /^\s*\|?\s*:?-{3,}:?\s*\|/.test(line)).length
  const automator = require('miniprogram-automator')
  let mp
  try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }) } catch (_) {
    execFileSync('/Applications/wechatwebdevtools.app/Contents/MacOS/cli', compat.automationCliArgs(root, port), { stdio: 'inherit', timeout: 60000 })
    let error
    for (let i=0;i<30;i++) { try { mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:'+port});break } catch(e) {error=e;await delay(500)} }
    if (!mp) throw error
  }
  try {
    let ready = false
    for(let i=0;i<100;i++){ready=await mp.evaluate(()=>getCurrentPages().length>0);if(ready)break;await delay(500)}
    assert.ok(ready)
    const filePath = await mp.evaluate(base64=>{const p=wx.env.USER_DATA_PATH+'/markdown-picker-original';wx.getFileSystemManager().writeFileSync(p,wx.base64ToArrayBuffer(base64));return p},bytes.toString('base64'))
    const rows = []
    for (const c of [
      {name:'平顶山市.md',type:'file'},
      {name:'平顶山市.md (1)',type:'file'},
      {name:'平顶山市.md\u200b',type:'file'},
      {name:'聊天中的攻略',type:'text/markdown; charset=utf-8'}
    ]) {
      await mp.reLaunch('/pages/home/home')
      await mp.mockWxMethod('chooseMessageFile',{tempFiles:[{...c,path:filePath,size:bytes.length}]})
      await mp.mockWxMethod('showActionSheet',{tapIndex:0})
      await (await mp.currentPage()).callMethod('chooseFile')
      let state
      for(let i=0;i<160;i++){
        state=await mp.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],r=p.selectComponent('#reader');return {route:p.route,error:r?r.data.error:p.data.error,ready:!!(r&&r.data.hasContent&&!r.data.isLoading),name:r&&r.data.sourceName}})
        if(state.error||state.ready)break
        await delay(100)
      }
      assert.equal(state.error,'',c.name);assert.ok(state.ready,c.name);assert.equal(state.name,c.name)
      const result=await mp.evaluate(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader'),d=r._htmlRuntime.document,h=d.querySelector('h1');return {heading:h&&h.textContent,nid:h&&h._nid,tables:d.querySelectorAll('table').length,errors:r._htmlRuntime.errors}})
      assert.equal(result.heading,heading,c.name);assert.equal(result.tables,tableCount,c.name);assert.deepEqual(result.errors,[])
      const page=await mp.currentPage(),view=await page.$('#reader >>> #dom-nid-'+result.nid)
      assert.ok(view);assert.equal((await view.text()).trim(),heading)
      const size=await view.size();assert.ok(size.width>0&&size.height>0)
      rows.push({...c,tables:result.tables,actualHeadingView:true,size})
      console.log(JSON.stringify(rows[rows.length-1]))
    }
    const out=path.join(root,'outputs/markdown-picker');fs.mkdirSync(out,{recursive:true})
    await mp.screenshot({path:path.join(out,'wechat.png')})
    fs.writeFileSync(path.join(out,'wechat.json'),JSON.stringify({at:new Date().toISOString(),rows,pickerMetadata:'mocked',formatChoice:'mocked Markdown selection',filesystemAndViews:'real DevTools',physicalDevices:'not run'},null,2)+'\n')
  } finally {await mp.restoreWxMethod('chooseMessageFile');await mp.restoreWxMethod('showActionSheet');mp.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
