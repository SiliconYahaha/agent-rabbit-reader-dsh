'use strict'

// Independent Chrome executes the original generated scripts. The comparison
// uses the actual Page/setData output, not a second run of the same parser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto')
const assert=require('node:assert/strict'),{chromeTestResult}=require('./chrome-test-result')
const {readerPage,flush}=require('../tests/helpers/reader-page')
const {variants,htmlFor,image}=require('../tests/helpers/image-data-identity')
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-image-identity-'))
async function main(){
  fs.mkdirSync(out,{recursive:true})
  const cases=[],files=new Map(),pages=[]
  for(const name of variants){
    const page=readerPage({env:{USER_DATA_PATH:'/assets'},getFileSystemManager:()=>({writeFile:o=>{files.set(o.filePath,Buffer.from(o.data,o.encoding));o.success()},unlink(){}})})
    pages.push(page);const html=htmlFor(name)
    page.openSelectedFile({name:name+'.html',inlineHtml:html});await flush()
    assert.equal(page.data.error,'');assert.deepEqual(page._htmlRuntime.errors,[])
    const d=page._htmlRuntime.document,before=d.getElementById('result').textContent
    page.onDomTap({currentTarget:{dataset:{nid:d.getElementById('check')._nid}}});await flush()
    const after=d.getElementById('result').textContent
    const nodeHtml=n=>{
      if(n.type==='text')return escape(n.textFragments?n.textFragments.map(fragment=>fragment.text).join(''):n.text)
      const style=page.data.domStyles[n.styleId||0]||''
      const attrs=Object.entries({...n.attrs,style}).map(([k,v])=>` ${k}="${escape(v)}"`).join('')
      return `<${n.name}${attrs}>${/^(img|input|hr|br)$/.test(n.name)?'':(n.children||[]).map(nodeHtml).join('')+`</${n.name}>`}`
    }
    cases.push({name,html,view:'<!doctype html><meta charset="utf-8"><body>'+page.data.domTree.map(nodeHtml).join('')+'</body>',before,after})
  }
  const run=async function(cases){
    const original=document.querySelector('#original'),view=document.querySelector('#view'),result=[]
    const load=(f,url)=>new Promise(resolve=>{f.onload=resolve;f.src=url})
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
    const decoded=async img=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return{width:canvas.width,height:canvas.height,hash:await hash(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)}}
    for(let i=0;i<cases.length;i++){
      document.querySelector('output').setAttribute('data-progress',cases[i].name+':load')
      await Promise.all([load(original,'/original/'+cases[i].index),load(view,'/view/'+cases[i].index)])
      const a=original.contentDocument,b=view.contentDocument,before=a.getElementById('result').textContent
      a.getElementById('check').click();const after=a.getElementById('result').textContent
      const images=b.querySelectorAll('img'),pre=b.querySelector('pre'),input=b.querySelector('input')
      document.querySelector('output').setAttribute('data-progress',cases[i].name+':pixels')
      result.push({name:cases[i].name,before,after,readerBefore:cases[i].before,readerAfter:cases[i].after,
        textMatches:pre.textContent===a.getElementById('literal').textContent,inputMatches:input.value===a.getElementById('field').value,
        sourcePreserved:JSON.parse(before).src,readerCached:images[0].getAttribute('src').startsWith('/assets/reader-inline-'),
        originalImage:await decoded(a.getElementById('picture')),readerImage:await decoded(images[0])})
    }
    document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify(result)))
  }
  const wrapper=index=>`<!doctype html><output></output><iframe id="original" sandbox="allow-scripts allow-same-origin"></iframe><iframe id="view" sandbox="allow-same-origin"></iframe><script>(${run})(${JSON.stringify([{name:cases[index].name,before:cases[index].before,after:cases[index].after,index}]).replace(/</g,'\\u003c')}).catch(e=>document.querySelector('output').setAttribute('data-error',e.message))</script>`
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'")
    if(files.has(req.url)){res.setHeader('Content-Type','image/png');res.end(files.get(req.url));return}
    res.setHeader('Content-Type','text/html; charset=utf-8')
    const runner=req.url.match(/^\/run\/(\d+)$/)
    if(runner&&cases[Number(runner[1])]){res.end(wrapper(Number(runner[1])));return}
    const match=req.url.match(/^\/(original|view)\/(\d+)$/),entry=match&&cases[Number(match[2])]
    if(!entry){res.statusCode=404;res.end();return}res.end(match[1]==='original'?entry.html:entry.view)
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{
    // Isolate each navigation/decode round; one virtual-time budget shared by
    // six iframe navigations can expire between native image decoder callbacks.
    // Keep every content/pixel assertion and retain the DOM on any failure.
    const result=[]
    for(let index=0;index<cases.length;index++){
      let stdout
      try{stdout=await chromeTestResult(`http://127.0.0.1:${server.address().port}/run/${index}`)}catch(error){if(error.dom)fs.writeFileSync(path.join(out,index+'-dom.html'),error.dom);throw error}
      fs.writeFileSync(path.join(out,index+'-dom.html'),stdout)
      const encoded=stdout.match(/data-result="([^"]+)"/);assert.ok(encoded,'Chrome result missing for '+cases[index].name+': '+(stdout.match(/data-error="([^"]+)"/)||[])[1]+' / '+(stdout.match(/data-progress="([^"]+)"/)||[])[1])
      const rows=JSON.parse(decodeURIComponent(encoded[1]));assert.equal(rows.length,1);result.push(...rows)
    }
    assert.equal(result.length,variants.length)
    for(const row of result){assert.equal(row.before,row.readerBefore,row.name);assert.equal(row.after,row.readerAfter,row.name);assert.ok(row.textMatches&&row.inputMatches&&row.sourcePreserved&&row.readerCached,row.name);assert.deepEqual(row.readerImage,row.originalImage,row.name)}
    const report={checkedAt:new Date().toISOString(),checked:result.length,failed:0,generatedImageSha256:crypto.createHash('sha256').update(Buffer.from(image.split(',')[1],'base64')).digest('hex'),result,wechat:'not verified'}
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
  }finally{server.close();pages.forEach(p=>p.disposeHtmlRuntime())}
}
main().catch(e=>{console.error(e);process.exitCode=1})
