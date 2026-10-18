'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),compat=require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/office-wechat'),sleep=ms=>new Promise(r=>setTimeout(r,ms))
const X=require('../miniprogram/file-reader/office/vendor/xlsx'),{unzipSync,zipSync,strFromU8,strToU8}=require('fflate')
const inputs=['word-table.docx','word-picture.docx','word-legacy.doc','slides.ppt','slides.pptx'].map(name=>({name,bytes:fs.readFileSync(path.join(root,'tests/fixtures/office',name))}))
const docm=unzipSync(inputs[0].bytes);docm['[Content_Types].xml']=strToU8(strFromU8(docm['[Content_Types].xml']).replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml','application/vnd.ms-word.document.macroEnabled.main+xml'));inputs.push({name:'word.docm',bytes:zipSync(docm)})
for(const ext of ['xls','xlsx','xlsm']){const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet([['工作报告','金额'],['收入',125.5],['支出',75],['余额',50]]);ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:1}}];X.utils.book_append_sheet(wb,ws,'本月');X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['第二张工作表','正常显示']]),'备注');inputs.push({name:'report.'+ext,bytes:X.write(wb,{type:'buffer',bookType:ext})})}
const pdf=fs.readFileSync(path.join(root,'output/pdf/兔子阅读器-小程序介绍与能力事实底稿-上线信息更新版.pdf'));inputs.push({name:'book.pdf',bytes:pdf},{name:'board.ai',bytes:pdf},{name:'broken.xlsx',bytes:Buffer.from('not a spreadsheet')},{name:'last.html',bytes:Buffer.from('<h1>最后一份正常打开</h1>')})
;(async()=>{fs.mkdirSync(out,{recursive:true});const mini=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(root)});let saved
 try{saved=await mini.evaluate(()=>JSON.parse(JSON.stringify(getApp().globalData)));await mini.reLaunch('/pages/index/index');await sleep(2000)
 for(let attempt=0;attempt<4;attempt++){if(await mini.evaluate(()=>typeof getCurrentPages().slice(-1)[0]?.openMaterial==='function'))break;await sleep(1500);await mini.reLaunch('/pages/index/index');await sleep(1500)}
 const files=inputs.map(f=>({name:f.name,base64:Buffer.from(f.bytes).toString('base64')}));await mini.evaluate(files=>{const fs=wx.getFileSystemManager(),queue=files.map((f,i)=>{const path=wx.env.USER_DATA_PATH+'/rabbit-inline-office-'+i+'.'+f.name.split('.').pop();fs.writeFileSync(path,wx.base64ToArrayBuffer(f.base64));return {name:f.name,path}});getApp().globalData.fileQueue=queue;getApp().globalData.fileQueueIndex=0;getApp().globalData.pendingMaterial=null;getCurrentPages().slice(-1)[0].openMaterial(queue[0])},files)
 const results=[]
 for(let i=0;i<files.length;i++){
 if(i)await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openNextFile())
 let state
 for(let attempt=0;attempt<80;attempt++){await sleep(250);state=await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],r=p.selectComponent('#reader'),d=r?.selectComponent('#design-preview'),pdf=r?.selectComponent('#inline-pdf')||d?.selectComponent('#design-inline-pdf');return {route:p.route,name:p.data.file?.name,index:p.data.queuePosition,loading:r?.data.isLoading,error:r?.data.error,content:r?._htmlRuntime?.document.body.textContent||'',tree:r?.data.domTree?.length,design:d?.data,pdf:pdf?.data}});if(state.pdf?!state.pdf.busy:!state.loading&&(state.content||state.error))break}
 console.log(files[i].name,JSON.stringify(state).slice(0,1400));assert.equal(state.route,'pages/index/index');assert.equal(state.name,files[i].name)
 if(files[i].name==='broken.xlsx')assert.ok(state.error);else{assert.equal(state.error,'');if(/\.(pdf|ai)$/.test(files[i].name)){assert.ok(state.pdf);assert.equal(state.pdf.error,'');assert.ok(state.pdf.imagePath)}else assert.ok(state.content.length>0)}
 await mini.screenshot({path:path.join(out,String(i+1).padStart(2,'0')+'-'+files[i].name+'.png')});results.push(state)
 if(i===1){await mini.evaluate(()=>getCurrentPages().slice(-1)[0].toggleQueue());await sleep(250);await mini.evaluate(()=>getCurrentPages().slice(-1)[0].closeQueue());await sleep(250);assert.equal(await mini.evaluate(()=>getCurrentPages().slice(-1)[0].route),'pages/index/index')}
 }
 await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openPreviousFile());await sleep(400);await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openPreviousFile());await sleep(2500);const previous=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].data.file.name);assert.equal(previous,'board.ai');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({environment:'WeChat DevTools; not physical device',results,previous},null,2));console.log('PASS mixed Office/PDF/AI/error/HTML queue')
 }finally{await mini.reLaunch('/pages/home/home').catch(()=>{});if(saved)await mini.evaluate(data=>Object.assign(getApp().globalData,data),saved).catch(()=>{});await mini.disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1})
