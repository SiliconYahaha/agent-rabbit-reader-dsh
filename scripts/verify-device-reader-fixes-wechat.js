'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),compat=require('./miniprogram-automator-compat')
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/device-reader-fixes'),sleep=ms=>new Promise(r=>setTimeout(r,ms))
compat.installAutomatorVersionCompatibility()
const XLSX=require('../miniprogram/file-reader/office/vendor/xlsx'),book=XLSX.utils.book_new()
const rows=[['参展商信息汇总'],['序号','公司名称','展馆','展位','行业分类','细分领域','主营业务','投资信息','融资轮次','注册地点','网站','备注'],...Array.from({length:963},(_,i)=>[i+1,'参展商 '+(i+1),'6号馆','A'+i,'人工智能','机器人','具身智能机器人产品及相关技术','公开资料','A轮','北京','example.test','测试数据'])]
const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:11}}];XLSX.utils.book_append_sheet(book,sheet,'全部汇总');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['第二表','正常显示']]),'第二表')
const svg=fs.readFileSync(path.join(root,'tests/fixtures/svg-animated/partridge-bike.svg'),'utf8')
;(async()=>{fs.mkdirSync(out,{recursive:true});const mini=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(root)});let saved
try{
 saved=await mini.evaluate(()=>JSON.parse(JSON.stringify(getApp().globalData)))
 await mini.reLaunch('/pages/index/index');await sleep(1500)
 const queue=await mini.evaluate(({book,svg})=>{
  const root=wx.env.USER_DATA_PATH,fs=wx.getFileSystemManager();fs.writeFileSync(root+'/device-sheet.xlsx',wx.base64ToArrayBuffer(book));fs.writeFileSync(root+'/device-bike.svg',svg,'utf8');fs.writeFileSync(root+'/device-bike.html','<html><body><object data="device-bike.svg"></object><p>同批选择的 SVG 网页</p></body></html>','utf8')
  const files=[{name:'device-sheet.xlsx',path:root+'/device-sheet.xlsx'},{name:'device-bike.svg',path:root+'/device-bike.svg'},{name:'device-bike.html',path:root+'/device-bike.html'},{name:'next.html',inlineHtml:'<h1>连续切换正常</h1>'}];getApp().globalData.fileQueue=files;getApp().globalData.fileQueueIndex=0;getCurrentPages().slice(-1)[0].openMaterial(files[0]);return files.map(f=>f.name)
 },{book:XLSX.write(book,{type:'base64',bookType:'xlsx'}),svg})
 async function waitFor(fn,label){for(let i=0;i<50;i++){const r=await mini.evaluate(fn);if(r)return r;await sleep(300)}console.log('TIMEOUT',label,await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],r=p.selectComponent('#reader'),s=r?.selectComponent('#standalone-svg-player');function flat(n){return(n||[]).flatMap(x=>[x,...flat(x.children)])}return {file:p.data.file?.name,diagnostics:r?.getReaderDiagnostics(),svg:s?{ready:s.data.ready,viewReady:s._viewReady,attached:s._attached,source:s.data.source?.length,scene:!!s._scene}:null,html:flat(r?.data.domTree).filter(n=>n.svgCanvasSource).map(n=>({nid:n.nid,len:n.svgCanvasSource.length,component:!!r.selectComponent('#dom-nid-'+n.nid)}))}}));throw Error(label+' timed out')}
 const spreadsheet=await waitFor(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');return r?.data.spreadsheet||null},'spreadsheet')
 assert.equal(spreadsheet.pageCount,39);await sleep(600);await mini.screenshot({path:path.join(out,'spreadsheet.png')})
 const second=await mini.evaluate(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');r.nextSpreadsheetPage();return {state:r.data.spreadsheet,html:r.data.renderedHtml,error:r.data.error,domMode:r.data.domMode}});assert.equal(second.state.pageIndex,1);assert.equal(second.error,'');assert.equal(second.domMode,false);assert.match(second.html,/参展商 24/)
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').showSpreadsheetPage(0,38));await sleep(300);const last=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').data.renderedHtml);assert.match(last,/参展商 963/)
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').selectSpreadsheet({detail:{value:1}}));await sleep(300);assert.match(await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').data.renderedHtml),/正常显示/)
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openNextFile())
 const standalone=await waitFor(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');return r?.data.standaloneSvgAnimationReady?{ready:true,error:r.data.error,spreadsheet:r.data.spreadsheet}:null},'standalone SVG')
 assert.equal(standalone.error,'');assert.equal(standalone.spreadsheet,null);await mini.screenshot({path:path.join(out,'svg.png')})
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').selectComponent('#standalone-svg-player').onTap());assert.equal(await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').selectComponent('#standalone-svg-player').data.paused),true)
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#reader').selectComponent('#standalone-svg-player').onTap())
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openNextFile())
 const html=await waitFor(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');function flat(n){return(n||[]).flatMap(x=>[x,...flat(x.children)])}const players=flat(r?.data.domTree).filter(n=>n.svgCanvasSource).map(n=>r.selectComponent('#dom-nid-'+n.nid)).filter(Boolean);return players.some(p=>p.data.ready)?{players:players.map(p=>({ready:p.data.ready,height:p.data.height,animated:p.data.animated,time:p._pausedAt})),error:r.data.error,text:r._htmlRuntime.document.body.textContent.slice(-80)}:null},'HTML embedded SVG')
 assert.equal(html.error,'');await sleep(600);await mini.screenshot({path:path.join(out,'svg-html.png')})
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openNextFile());await sleep(600);const next=await mini.evaluate(()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');return {error:r.data.error,text:r._htmlRuntime.document.body.textContent,players:r.selectAllComponents('svg-view').length}});assert.equal(next.error,'');assert.match(next.text,/连续切换正常/);assert.equal(next.players,0)
 const repeated=[]
 for(const index of [0,1,2,3,1,2]){
  await mini.evaluate(i=>getCurrentPages().slice(-1)[0].openQueueIndex(i),index)
  const state=await waitFor(()=>{const p=getCurrentPages().slice(-1)[0],r=p.selectComponent('#reader');if(!r||r.data.isLoading||r.data.error)return null;const name=p.data.file.name;if(name.endsWith('.xlsx'))return r.data.spreadsheet?{name,kind:'sheet'}:null;if(name.endsWith('.svg'))return r.data.standaloneSvgAnimationReady?{name,kind:'svg'}:null;if(name==='device-bike.html'){function flat(n){return(n||[]).flatMap(x=>[x,...flat(x.children)])}const n=flat(r.data.domTree).find(n=>n.svgCanvasSource),c=n&&r.selectComponent('#dom-nid-'+n.nid);return c?.data.ready?{name,kind:'html-svg'}:null}return r._htmlRuntime?{name,kind:'html'}:null},'repeat '+index)
  repeated.push(state)
 }
 const animationHash=()=>{const r=getCurrentPages().slice(-1)[0].selectComponent('#reader');function flat(n){return(n||[]).flatMap(x=>[x,...flat(x.children)])}const n=flat(r.data.domTree).find(n=>n.svgCanvasSource),p=r.selectComponent('#dom-nid-'+n.nid),c=p._canvas,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0;for(let i=0;i<d.length;i+=16)hash=(Math.imul(hash,31)+d[i]+d[i+1]+d[i+2])|0;return {hash,time:p._pausedAt}}
 const firstFrame=await mini.evaluate(animationHash);await sleep(350);const secondFrame=await mini.evaluate(animationHash);assert.notEqual(firstFrame.hash,secondFrame.hash,'HTML SVG animation must change visible pixels')
 fs.writeFileSync(path.join(out,'wechat.json'),JSON.stringify({environment:'WeChat DevTools; synthetic workbook, repository SVG fixture; not user originals or physical device',queue,spreadsheet,second:second.state,standalone,html,next,repeated,firstFrame,secondFrame},null,2));console.log('PASS',JSON.stringify({spreadsheet,standalone,html,next}))
}finally{await mini.reLaunch('/pages/home/home').catch(()=>{});if(saved)await mini.evaluate(data=>Object.assign(getApp().globalData,data),saved).catch(()=>{});await mini.disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1})
