'use strict'
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { cases } = require('../tests/fixtures/markdown-code-containers.json')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { chromeTestResult } = require('./chrome-test-result')
const out = path.resolve(process.argv[2] || 'outputs/markdown-code-containers/browser')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => n.type === 'text' ? escape(n.text) : `<${n.name} data-reader-tag="${n.name}" ${Object.entries(n.attrs || {}).map(([k,v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${n.name}>`
async function inspect (views) {
  const rows = []
  for (const view of views) {
    const row = { name: view.name }
    for (const key of ['actual', 'reference']) {
      const f = document.createElement('iframe'); f.style.cssText = 'width:390px;height:600px'; f.setAttribute('sandbox','allow-same-origin'); document.body.append(f)
      await new Promise(resolve => { f.onload = resolve; f.srcdoc = '<body>' + view[key] + '</body>' })
      const d = f.contentDocument, marks = [], walker = d.createTreeWalker(d.body, 4)
      let node
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('style,script')) continue
        for (const match of node.data.matchAll(/TAIL(?:_ONE|_TWO)?|AFTER/g)) {
          const parents = []
          for (let p = node.parentElement; p; p = p.parentElement) {
            const tag = p.getAttribute('data-reader-tag') || p.localName
            if (['blockquote','ul','ol','li','p','h1','h2'].includes(tag)) parents.push(tag)
          }
          const range = d.createRange(); range.setStart(node,match.index); range.setEnd(node,match.index+match[0].length)
          const box = range.getBoundingClientRect()
          marks.push({ text:match[0], parents, visible:box.width>0&&box.height>0 })
        }
      }
      row[key] = { body:d.body.innerText.trim().replace(/\s+/g,' '), marks, code:[...d.querySelectorAll('pre')].map(n=>n.textContent), headings:[...d.querySelectorAll('h1,h2')].map(n=>({name:n.localName,text:n.textContent.trim().replace(/\s+/g,' ')})) }
      f.remove()
    }
    rows.push(row)
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  fs.mkdirSync(out,{recursive:true})
  let bytes
  const host = readerPage({getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),getFileSystemManager:()=>({readFile:o=>o.success({data:bytes})})}), views=[]
  try {
    for (const c of cases.filter((c,i)=>!c.baselineExact||i%48===0)) {
      bytes=Buffer.from(c.source);host.openSelectedFile({name:c.name+'.md',path:'/fixture/code.md',size:bytes.length});await new Promise(setImmediate);assert.equal(host.data.error,'',c.name)
      const r=host._htmlRuntime,tree=renderHtmlDomTree(r.document,{styles:r.renderState().styles,viewportWidth:390})
      views.push({name:c.name,actual:tree.nodes.map(serialize).join(''),reference:c.referenceHtml})
    }
  } finally {host.disposeHtmlRuntime()}
  const html='<!doctype html><meta charset="utf-8"><output></output><script>('+inspect+')('+JSON.stringify(views).replace(/</g,'\\u003c')+').catch(e=>document.querySelector("output").setAttribute("data-error",e.stack))</script>'
  fs.writeFileSync(path.join(out,'views.html'),html)
  const server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html; charset=utf-8');s.end(html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const dom=await chromeTestResult('http://127.0.0.1:'+server.address().port,{timeoutMs:60000}),match=dom.match(/data-result="([^"]*)"/)
    assert.ok(match,'native browser must return all views')
    const rows=JSON.parse(decodeURIComponent(match[1])),failures=rows.filter(r=>JSON.stringify(r.actual)!==JSON.stringify(r.reference))
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({cases:rows.length,failures,rows},null,2)+'\n')
    console.log(JSON.stringify({cases:rows.length,failures:failures.map(r=>r.name)}));assert.deepEqual(failures,[])
  } finally {server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
