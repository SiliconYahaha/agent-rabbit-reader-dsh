'use strict'
// Independent Chrome source rendering versus the production reader. Never uploads.
const fs=require('node:fs'),path=require('node:path')
const {readerPage,flush}=require('../tests/helpers/reader-host')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-materials/public-html'),out=path.join(root,'outputs/reliability')
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
let currentCase = null
process.on('unhandledRejection', error => { if(currentCase)currentCase.issues.push({type:'async-script-error',detail:String(error.message || error)}) })
const normalize=s=>String(s||'').replace(/\s+/g,' ').trim()
;(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
 const results=[]
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}})
  page.on('pageerror',error=>{if(currentCase)(currentCase.chromeErrors||(currentCase.chromeErrors=[])).push(error.message)})
  await page.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue())
  for(const entry of manifest.cases){
   if(entry.status!=='downloaded')continue
   const html=fs.readFileSync(path.join(dir,entry.prepared||entry.file),'utf8'),started=Date.now()
   const result={id:entry.id,path:entry.path,url:entry.url,dependencies:entry.dependencies||[],assertions:[],issues:[]}
   currentCase=result
   const reader=readerPage()
   try{
    reader.openSelectedFile({name:'case-'+entry.id+'.html',inlineHtml:html});await flush()
    result.readerError=reader.data.error||'';result.report=reader.data.report;result.notes=reader.data.notes
    result.runtimeErrors=reader._htmlRuntime ? reader._htmlRuntime.errors.slice() : []
    if(result.runtimeErrors.length) result.issues.push({type:'runtime-errors',detail:result.runtimeErrors})
    const rendered=renderHtmlDomTree(html,{viewportWidth:390,viewportHeight:844})
    result.nodeCount=rendered.nodes.length
    const all=[];const visit=nodes=>{for(const n of nodes||[]){all.push(n);visit(n.children)}};visit(rendered.nodes)
    result.assertions.push({check:'nonempty production render',pass:all.length>0&&!result.readerError})
    // A fresh document also resets lexical globals; setContent alone leaks
    // previous fixtures' top-level const/let declarations.
    await page.goto('about:blank')
    await page.setContent(html,{waitUntil:'domcontentloaded',timeout:2500});await page.waitForTimeout(60)
    const expected=await page.evaluate(()=>Array.from(document.querySelectorAll('h1,h2,h3,p,li,button,blockquote')).slice(0,30).map(el=>({tag:el.localName,text:el.textContent.replace(/\s+/g,' ').trim(),color:getComputedStyle(el).color,display:getComputedStyle(el).display,fontSize:getComputedStyle(el).fontSize,letterSpacing:getComputedStyle(el).letterSpacing,lineHeight:getComputedStyle(el).lineHeight})))
    const doc=reader._htmlRuntime?reader._htmlRuntime.document:rendered.document
    const actual=doc.querySelectorAll('h1,h2,h3,p,li,button,blockquote').slice(0,30)
    for(let i=0;i<expected.length;i++){
      const e=expected[i],a=actual[i]
      const equal=!!a&&a.localName===e.tag&&normalize(a.textContent)===e.text
      result.assertions.push({check:'text and order '+i,pass:equal})
      if(equal && reader._htmlRuntime){
       const css=reader._htmlRuntime.window.getComputedStyle(a)
       for(const property of ['display','fontSize','letterSpacing','lineHeight']) {
        if(String(css[property])!==e[property])result.issues.push({type:'computed-style-difference',index:i,property,expected:e[property],actual:css[property]})
       }
      }
      if(!equal)result.issues.push({type:'content-difference',tag:e.tag,index:i,expected:e.text.slice(0,100),actual:a?normalize(a.textContent).slice(0,100):null})
    }
    if(entry.id<=5)await page.screenshot({path:path.join(out,'public-'+entry.id+'-chrome.png')})
    // Inspect real serialized host nodes, not just whether parsing returned.
    for(const n of all.filter(n=>n.name==='img'&&n.attrs&&/^data:image\/svg/.test(n.attrs.src||''))){result.assertions.push({check:'SVG has serializable image',pass:n.attrs.src.length>30})}
    if((result.notes||[]).length)result.issues.push({type:'reader-notes',detail:result.notes})
    if((entry.dependencies||[]).some(d=>d.status!=='inlined'))result.issues.push({type:'external-or-missing-dependency'})
    result.basicChecksPassed=result.assertions.every(a=>a.pass)&&!result.readerError&&!result.runtimeErrors.length
    result.status=result.basicChecksPassed&&!result.issues.some(i=>['computed-style-difference','external-or-missing-dependency'].includes(i.type))?'checks-passed':'needs-review'
   }catch(error){result.status='needs-fix';result.issues.push({type:'exception',detail:error.message})}
   finally{reader.host.onUnload();reader.detached()}
   if(result.issues.some(i=>i.type==='async-script-error'))result.status='needs-fix'
   result.elapsedMs=Date.now()-started;results.push(result)
   fs.writeFileSync(path.join(out,'public-html-progress.json'),JSON.stringify(results,null,2))
   if(results.length%10===0)console.log('Audited '+results.length+'/100; flagged '+results.filter(r=>r.status!=='checks-passed').length)
  }
 }finally{await browser.close()}
 const report={scope:'100 distinct upstream MDN HTML files; Node production reader plus independent Chrome text/order oracle. This is not 100 physical-device visual passes.',commit:manifest.commit,completed:results.length,basicChecksPassed:results.filter(r=>r.basicChecksPassed&&!r.issues.some(i=>i.type==='async-script-error')).length,passed:results.filter(r=>r.status==='checks-passed').length,flagged:results.filter(r=>r.status!=='checks-passed').length,results}
 fs.writeFileSync(path.join(out,'public-html-100.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,passed:report.passed,flagged:report.flagged}))
})().catch(e=>{console.error(e);process.exitCode=1})
