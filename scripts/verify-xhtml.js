'use strict'

// Independent Chrome XML documents, not HTML/CDATA-stripping test adapters.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict')
const {chromeTestResult}=require('./chrome-test-result')
const {cases,invalid,policy,visualHtml}=require('../tests/helpers/xhtml')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {parseXhtmlDocument}=require('../miniprogram/file-reader/document/xhtml-document')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-xhtml-'))
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
const serialize=n=>n.type==='text'?escape(n.text):`<${n.name} ${Object.entries(n.attrs||{}).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${(n.children||[]).map(serialize).join('')}</${n.name}>`
const rendered=rt=>{const r=renderHtmlDomTree(rt.document,{styles:rt.renderState().styles,viewportWidth:390});return `<!doctype html><meta charset="utf-8"><body style="${escape(r.wrapperStyle)}">${r.nodes.map(serialize).join('')}</body>`}
const inputs=cases.map(c=>{const rt=createRuntime(c.source,{contentType:'application/xhtml+xml',viewportWidth:390});try{rt.run();assert.deepEqual(rt.errors,[],c.name);return {...c,text:rt.document.getElementById('probe').textContent,styles:rt.renderState().styles,reader:rendered(rt)}}finally{rt.destroy()}})
const rt=createRuntime(visualHtml,{contentType:'application/xhtml+xml',viewportWidth:390})
let interaction
try{rt.run();const before=rendered(rt);assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid),true);interaction={before,after:rendered(rt)};assert.deepEqual(rt.errors,[])}finally{rt.destroy()}
for(const c of [...invalid,...policy])assert.throws(()=>parseXhtmlDocument(c.source),{code:'XHTML_PARSE_ERROR'},c.name)
async function runner(data){
  const frame=document.querySelector('iframe'),results=[],invalidResults=[],byteControls=[]
  // Preserve every original UTF-16 unit in an actual XML file, including lone
  // surrogates. Chrome 153 DOMParser replaces those with U+FFFD before parsing;
  // a string Blob would also normalize them. Neither is an exact file oracle.
  // XML 1.0 sections 2.2 and 4.3.3 require rejecting malformed UTF-16.
  function xmlBytes(source){
    const bytes=new Uint8Array(2+source.length*2);bytes[0]=255;bytes[1]=254
    for(let i=0;i<source.length;i++){const unit=source.charCodeAt(i);bytes[2+i*2]=unit&255;bytes[3+i*2]=unit>>>8}
    return bytes
  }
  async function load(source,type){const url=URL.createObjectURL(new Blob([source],{type}));await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;frame.src=url});URL.revokeObjectURL(url);return frame.contentDocument}
  for(const c of data.inputs){
    document.querySelector('output').textContent='Checking '+c.name
    let d=await load(c.source,'application/xhtml+xml'),p=d.getElementById('probe')
    if(!p)throw new Error(c.name+': original has no probe: '+d.documentElement.textContent.slice(0,400))
    const original={mime:d.contentType,text:p?.textContent,styles:[...d.querySelectorAll('style')].map(n=>n.textContent),error:!!d.querySelector('parsererror')}
    const originalColor=frame.contentWindow.getComputedStyle(p).color
    const generated=c.name==='style-entity-decoding'?'A&B':c.name==='style-close-literal'?'</style>':null
    const originalGenerated=generated==null?null:frame.contentWindow.getComputedStyle(p,'::before').content
    d=await load(c.reader,'text/html');p=d.getElementById('probe')
    if(!p)throw new Error(c.name+': reader has no probe: '+c.reader.slice(-1000))
    const readerColor=frame.contentWindow.getComputedStyle(p).color
    const readerGenerated=generated==null?null:JSON.stringify(p.querySelector('.hr-pseudo-before')?.textContent)
    results.push({name:c.name,expected:c.expected,original,reader:{text:c.text,styles:c.styles},colors:['cdata-styles','case-sensitive-tags'].includes(c.name)?[originalColor,readerColor]:null,generated:generated==null?null:[originalGenerated,readerGenerated,JSON.stringify(generated)]})
  }
  for(const c of data.invalid){
    const stringDocument=new DOMParser().parseFromString(c.source,'application/xhtml+xml')
    const d=await load(xmlBytes(c.source),'application/xhtml+xml')
    invalidResults.push({name:c.name,parsererror:!!d.querySelector('parsererror'),domParserError:!!stringDocument.querySelector('parsererror')})
  }
  for(const c of data.inputs.filter(c=>['replacement-name','supplementary-name'].includes(c.name))){
    const d=await load(xmlBytes(c.source),'application/xhtml+xml')
    byteControls.push({name:c.name,parsererror:!!d.querySelector('parsererror'),text:d.getElementById('probe')?.textContent,expected:c.expected})
  }
  const snap=()=>{const d=frame.contentDocument,p=d.getElementById('probe'),s=frame.contentWindow.getComputedStyle(p);return {text:p.textContent,color:s.color,lineHeight:s.lineHeight,width:p.getBoundingClientRect().width,boldChildren:p.querySelectorAll('b').length}}
  await load(data.visualHtml,'application/xhtml+xml');const originalBefore=snap();frame.contentDocument.getElementById('change').click();const originalAfter=snap()
  await load(data.interaction.before,'text/html');const readerBefore=snap()
  await load(data.interaction.after,'text/html');const readerAfter=snap()
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({results,invalidResults,byteControls,originalBefore,originalAfter,readerBefore,readerAfter})))
}
const html=`<!doctype html><output></output><iframe sandbox="allow-same-origin allow-scripts" style="width:390px;height:844px"></iframe><script>(${runner.toString()})(${JSON.stringify({inputs,invalid,visualHtml,interaction}).replace(/</g,'\\u003c')}).catch(e=>document.querySelector('output').setAttribute('data-error',e.stack))</script>`
for(const [name,source]of Object.entries({'oracle.html':html,'visual.xhtml':visualHtml,'reader-before.html':interaction.before,'reader-after.html':interaction.after}))fs.writeFileSync(path.join(out,name),source,{flag:'wx'})
async function main(){
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src blob:; img-src data:");res.end(html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let stdout
  try{stdout=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`,{timeoutMs:60000})}finally{server.close()}
  const match=stdout.match(/data-result="([^"]+)"/);assert.ok(match,'No Chrome XML oracle results: '+stdout.match(/<output[^>]*>([\s\S]*?)<\/output>/)?.[1]);const result=JSON.parse(decodeURIComponent(match[1]))
  assert.equal(result.results.length,inputs.length);assert.equal(result.invalidResults.length,invalid.length)
  const failures=result.results.filter(r=>r.original.mime!=='application/xhtml+xml'||r.original.error||r.original.text!==r.expected||r.reader.text!==r.expected||JSON.stringify(r.original.styles)!==JSON.stringify(r.reader.styles)||r.colors&&r.colors.some(v=>v!=='rgb(0, 128, 0)')||r.generated&&r.generated.some(v=>v!==r.generated[2]))
  failures.push(...result.invalidResults.filter(r=>!r.parsererror))
  assert.equal(result.byteControls.length,2)
  failures.push(...result.byteControls.filter(r=>r.parsererror||r.text!==r.expected))
  for(const phase of ['Before','After'])if(JSON.stringify(result['original'+phase])!==JSON.stringify(result['reader'+phase]))failures.push({phase,original:result['original'+phase],reader:result['reader'+phase]})
  const report={checked:inputs.length+invalid.length+result.byteControls.length+2,failureCount:failures.length,failures,policyRestrictions:policy.map(c=>c.name),result}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({checked:report.checked,failureCount:failures.length,failures,policyRestrictions:report.policyRestrictions},null,2));assert.equal(failures.length,0)
}
main().catch(e=>{console.error(e);process.exitCode=1})
