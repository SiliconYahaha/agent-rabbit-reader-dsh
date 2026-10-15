'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { Marked } = require('marked')
const samples = require('../tests/fixtures/markdown-frontmatter-reference.json')
const output = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'outputs/markdown-frontmatter-views')
fs.mkdirSync(output,{recursive:true})
const baselineAt=process.argv.indexOf('--baseline-ref')
if(baselineAt>=0){
  const filename=require.resolve('../miniprogram/file-reader/markdown/runtime/markdown-document')
  const Module=require('node:module'), m=new Module(filename,module);m.filename=filename;m.paths=module.paths
  m._compile(execFileSync('git',['show',process.argv[baselineAt+1]+':miniprogram/file-reader/markdown/runtime/markdown-document.js'],{encoding:'utf8'}),filename)
  require.cache[filename]=m
}
const { parseFrontMatter } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
const serialize = n => n.type==='text'?escape(n.text):`<${n.name} ${Object.entries(n.attrs||{}).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${(n.children||[]).map(serialize).join('')}</${n.name}>`
async function browser(views){
  const actual=document.querySelector('#actual'),reference=document.querySelector('#reference'),results=[]
  const load=(f,html)=>new Promise(resolve=>{f.onload=resolve;f.srcdoc=html})
  const read=f=>{const d=f.contentDocument;return {text:d.body.innerText,headings:Array.from(d.querySelectorAll('h1,h2,h3,h4,h5,h6'),n=>[n.tagName,n.innerText]),rules:d.querySelectorAll('hr').length,code:Array.from(d.querySelectorAll('pre'),n=>n.innerText)}}
  for(const view of views){await Promise.all([load(actual,view.actualHtml),load(reference,view.referenceHtml)]);results.push({name:view.name,actual:read(actual),reference:read(reference)})}
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify(results)))
}
async function main(){
  let bytes
  const page=readerPage({getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),getFileSystemManager:()=>({readFile:o=>o.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})})})
  const marked=new Marked({gfm:true,breaks:false}),views=[],bodyFailures=[]
  try{
    for(const sample of samples){
      const parsed=parseFrontMatter(sample.source)
      if(parsed.body!==sample.expectedBody)bodyFailures.push(sample.name)
      bytes=Buffer.from(sample.source)
      page.openSelectedFile({name:sample.name+'.md',path:'/local/'+sample.name+'.md',size:bytes.length})
      await new Promise(setImmediate)
      assert.equal(page.data.error,'',sample.name);assert.equal(page.data.hasContent,true,sample.name)
      const runtime=page._htmlRuntime,tree=renderHtmlDomTree(runtime.document,{styles:runtime.renderState().styles,viewportWidth:390})
      const shell=html=>`<!doctype html><meta charset="utf-8"><body>${html}</body>`
      views.push({name:sample.name,actualHtml:shell(tree.nodes.map(serialize).join('')),referenceHtml:shell(marked.parse(sample.expectedBody))})
    }
  }finally{page.disposeHtmlRuntime()}
  const file=path.join(output,'oracle.html')
  fs.writeFileSync(file,`<!doctype html><output></output><iframe id="actual" style="width:390px;height:844px"></iframe><iframe id="reference" style="width:390px;height:844px"></iframe><script>(${browser})(${JSON.stringify(views).replace(/</g,'\\u003c')}).catch(e=>document.querySelector('output').textContent=e.stack)</script>`)
  const chrome=process.env.HTML_READER_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome')
  const dom=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=5000',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']})
  const match=dom.match(/data-result="([^"]+)"/);assert.ok(match,'browser did not complete')
  const results=JSON.parse(decodeURIComponent(match[1])),failures=results.filter(r=>JSON.stringify(r.actual)!==JSON.stringify(r.reference)).map(r=>r.name)
  const knownGaps=samples.filter(c=>c.knownVisibleGap).map(c=>c.name),unexpectedFailures=failures.filter(name=>!knownGaps.includes(name))
  const report={knownGaps,unexpectedFailures,testedAt:new Date().toISOString(),cases:samples.length,bodyExact:samples.length-bodyFailures.length,visibleExact:samples.length-failures.length,bodyFailures,failures,results}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,bodyExact:report.bodyExact,visibleExact:report.visibleExact,bodyFailures,failures}))
  if(!process.argv.includes('--discover')){assert.equal(bodyFailures.length,0);assert.equal(unexpectedFailures.length,0)}
}
main().catch(error=>{console.error(error);process.exitCode=1})
