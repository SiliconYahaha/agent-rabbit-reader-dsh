'use strict'

const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict')
const {execFile}=require('node:child_process'),{promisify}=require('node:util')
const {cases,htmlFor,visualHtml}=require('../tests/helpers/css-cascade-order')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-cascade-order-'))
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
const serialize=n=>n.type==='text'?escape(n.text):`<${n.name} ${Object.entries(n.attrs||{}).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${(n.children||[]).map(serialize).join('')}</${n.name}>`
const rendered=(source,options)=>{const r=renderHtmlDomTree(source,options);return `<!doctype html><meta charset="utf-8"><body style="${escape(r.wrapperStyle)}">${r.nodes.map(serialize).join('')}</body>`}
const inputs=cases.map(c=>({...c,html:htmlFor(c),reader:rendered(htmlFor(c))}))
const publicInputs=[
  {name:'sort-by-order-001.xht',selector:'#child',properties:['background-color','width','height'],expected:['rgb(0, 128, 0)','100px','100px']},
  {name:'specificity-011.xht',selector:'p',pseudo:'::after',properties:['content','border-top-color','border-top-style','border-bottom-color','border-bottom-style'],expected:['"PASSED"','rgb(0, 128, 128)','solid','rgb(0, 0, 255)','solid']}
].map(c=>{
  const html=fs.readFileSync(path.join(__dirname,'../tests/fixtures/css-cascade-order',c.name),'utf8')
  // Feed the original XML source through the same MIME-aware reader path.
  return {...c,html,reader:rendered(html,{contentType:'application/xhtml+xml'})}
})
const rt=createRuntime(visualHtml)
let interaction
try{rt.run();const before=rendered(rt.document,{styles:rt.renderState().styles});rt.dispatchTap(rt.document.getElementById('change')._nid);interaction={before,after:rendered(rt.document,{styles:rt.renderState().styles}),errors:rt.errors.slice()}}finally{rt.destroy()}
async function runner(data){
  const frame=document.querySelector('iframe'),d=frame.contentDocument
  const load=html=>{d.open();d.write(html);d.close()}
  const read=(c,reader)=>frame.contentWindow.getComputedStyle(reader&&c.pseudo?d.querySelector('.hr-pseudo-before'):d.getElementById('probe'),reader?'':c.pseudo||'').getPropertyValue(c.property)
  const results=data.inputs.map(c=>{load(c.html);const original=read(c,false);load(c.reader);return {name:c.name,expected:c.expected,original,reader:read(c,true),text:d.getElementById('probe').textContent}})
  const snap=html=>{load(html);const p=d.getElementById('card'),s=frame.contentWindow.getComputedStyle(p);return {color:s.backgroundColor,font:s.fontSize,padding:s.paddingLeft,text:p.textContent,result:d.getElementById('result').textContent}}
  const originalBefore=snap(data.visualHtml)
  d.getElementById('card').className='changed';d.getElementById('result').textContent='切换已生效'
  const originalAfter={color:frame.contentWindow.getComputedStyle(d.getElementById('card')).backgroundColor,font:frame.contentWindow.getComputedStyle(d.getElementById('card')).fontSize,padding:frame.contentWindow.getComputedStyle(d.getElementById('card')).paddingLeft,text:d.getElementById('card').textContent,result:d.getElementById('result').textContent}
  const readerBefore=snap(data.interaction.before),readerAfter=snap(data.interaction.after)
  const publicResults=[]
  for(const c of data.publicInputs){
    const url=URL.createObjectURL(new Blob([c.html],{type:'application/xhtml+xml'}))
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;frame.src=url})
    const doc=frame.contentDocument,p=doc.querySelector(c.selector),s=frame.contentWindow.getComputedStyle(p,c.pseudo||'')
    const original=c.properties.map(prop=>s.getPropertyValue(prop)),mime=doc.contentType
    URL.revokeObjectURL(url)
    // New HTML document, not a mutation of the original XHTML/style sheet.
    const readerUrl=URL.createObjectURL(new Blob([c.reader],{type:'text/html'}))
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;frame.src=readerUrl})
    const node=frame.contentDocument.querySelector(c.pseudo?'.hr-pseudo-after':c.selector),style=frame.contentWindow.getComputedStyle(node)
    const reader=c.properties.map(prop=>prop==='content'?JSON.stringify(node.textContent):style.getPropertyValue(prop))
    URL.revokeObjectURL(readerUrl)
    publicResults.push({name:c.name,mime,expected:c.expected,original,reader})
  }
  document.querySelector('output').setAttribute('data-results',encodeURIComponent(JSON.stringify({results,originalBefore,originalAfter,readerBefore,readerAfter,publicResults})))
}
const html=`<!doctype html><output></output><iframe sandbox="allow-same-origin" style="width:390px;height:844px"></iframe><script>(${runner.toString()})(${JSON.stringify({inputs,visualHtml,interaction,publicInputs}).replace(/</g,'\\u003c')}).catch(e=>document.querySelector('output').textContent=e.stack)</script>`
fs.writeFileSync(path.join(out,'oracle.html'),html,{flag:'wx'});fs.writeFileSync(path.join(out,'visual.html'),visualHtml,{flag:'wx'})
fs.writeFileSync(path.join(out,'reader-before.html'),interaction.before,{flag:'wx'});fs.writeFileSync(path.join(out,'reader-after.html'),interaction.after,{flag:'wx'})
async function main(){
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let stdout
  try{({stdout}=await promisify(execFile)(process.env.HTML_READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--virtual-time-budget=5000','--dump-dom',`http://127.0.0.1:${server.address().port}/`],{timeout:60000,maxBuffer:8*1024*1024}))}finally{server.close()}
  const match=stdout.match(/data-results="([^"]+)"/);assert.ok(match,'No independent Chrome results');const result=JSON.parse(decodeURIComponent(match[1]))
  assert.equal(result.results.length,cases.length)
  const failures=result.results.filter((r,i)=>r.original!==r.expected||r.reader!==r.expected||r.text!==(cases[i].pseudo?'伪元素正文':'')+'正文保留')
  for(const phase of ['Before','After'])if(JSON.stringify(result['original'+phase])!==JSON.stringify(result['reader'+phase]))failures.push({phase,original:result['original'+phase],reader:result['reader'+phase]})
  if(interaction.errors.length)failures.push({errors:interaction.errors})
  assert.equal(result.publicResults.length,publicInputs.length)
  for(const r of result.publicResults)if(r.mime!=='application/xhtml+xml'||JSON.stringify(r.original)!==JSON.stringify(r.expected)||JSON.stringify(r.reader)!==JSON.stringify(r.expected))failures.push(r)
  const knownGaps=[]
  const report={checked:cases.length+2+publicInputs.length,failureCount:failures.length,failures,knownGaps,result};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2),{flag:'wx'})
  console.log(JSON.stringify({checked:report.checked,failureCount:failures.length,failures,knownGaps},null,2));assert.equal(failures.length,0)
}
main().catch(e=>{console.error(e);process.exitCode=1})
