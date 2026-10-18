'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {readerPage,flush}=require('../tests/helpers/reader-host')
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-materials/ai-html'),out=path.join(root,'outputs/reliability')
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),normal=s=>String(s||'').replace(/\s+/g,' ').trim()
const flat=ns=>ns.flatMap(n=>[n,...flat(n.children||[])])
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),results=[]
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 await page.route('**/*',r=>/^https?:/.test(r.request().url())?r.abort():r.continue())
 for(const entry of manifest.cases){
  const p=readerPage(),r={...entry,checks:[],issues:[]},html=fs.readFileSync(path.join(dir,entry.file),'utf8'),start=Date.now()
  try{
   p.openSelectedFile({name:entry.file,inlineHtml:html});await flush();r.readerMs=Date.now()-start
   await page.goto('about:blank')
   await page.setContent(html,{waitUntil:'domcontentloaded',timeout:3000})
   const runtime=p._htmlRuntime
   r.readerError=p.data.error||'';r.runtimeErrors=runtime?runtime.errors:[]
   if(entry.action){
    await page.click(entry.action,{timeout:1500})
    if(!runtime)throw new Error('interactive runtime missing')
    runtime.dispatchEvent(runtime.document.querySelector(entry.action)._nid,'click',{});await flush()
   }
   const expected=await page.locator('h1,h2,h3,p,li,output,dt,dd').allTextContents()
   const actual=runtime.document.querySelectorAll('h1,h2,h3,p,li,output,dt,dd').map(n=>n.textContent)
   r.checks.push({name:'all semantic text and order',pass:JSON.stringify(expected.map(normal))===JSON.stringify(actual.map(normal)),count:expected.length})
   if(entry.expect){const actualText=normal(runtime.document.querySelector(entry.expect.selector).textContent);r.checks.push({name:'interaction result',pass:actualText===entry.expect.text,actual:actualText})}
   if(entry.category==='typography'){
    const e=await page.$eval('#small',n=>getComputedStyle(n).fontSize),a=runtime.window.getComputedStyle(runtime.document.getElementById('small')).fontSize
    r.checks.push({name:'decimal font equals Chrome',pass:a===e,expected:e,actual:a})
   }
   if(entry.category==='theme'){
    const quote=flat(p.data.domTree).find(n=>n.name==='blockquote');r.checks.push({name:'host near-white contrast repaired',pass:/color:#6f7072/.test(quote?.attrs?.style||p.data.domStyles[quote?.styleId]||'')})
   }
   if(entry.category==='svg-icon'){
    const icon=flat(p.data.domTree).find(n=>n.nid===runtime.document.getElementById('speaker')._nid);r.checks.push({name:'24px icon dimensions',pass:/width:24px/.test(icon?.attrs?.style||p.data.domStyles[icon?.styleId]||'')})
   }
   r.status=r.checks.every(c=>c.pass)&&!r.readerError&&!r.runtimeErrors.length?'checks-passed':'needs-review'
   if(entry.id<=3)await page.screenshot({path:path.join(out,'ai-'+entry.id+'-chrome.png')})
  }catch(e){r.status='needs-review';r.issues.push(e.message)}finally{p.host.onUnload();p.detached()}
  results.push(r);console.log(entry.id,entry.name,r.status)
 }
 }finally{await browser.close()}
 const report={scope:'30 distinct AI-authored synthetic cases; Node reader and Chrome source oracle, not native screenshot acceptance',completed:results.length,passed:results.filter(x=>x.status==='checks-passed').length,results}
 fs.writeFileSync(path.join(out,'ai-html-30.json'),JSON.stringify(report,null,2))
})().catch(e=>{console.error(e);process.exitCode=1})
