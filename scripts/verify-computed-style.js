'use strict'
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { promisify } = require('node:util'), { execFile } = require('node:child_process'), assert = require('node:assert/strict')
const { cases, htmlFor, visualHtml } = require('../tests/helpers/computed-style')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-computed-style-'))
const inputs = cases.map(c => { const html = htmlFor(c), rt = createRuntime(html); try { rt.run(); return {name:c.name, expected:c.expected, html, reader:rt.document.getElementById('result').textContent, errors:rt.errors} } finally { rt.destroy() } })
const run = async inputs => {
  const results = []
  for (const c of inputs) { const f = document.createElement('iframe'); f.setAttribute('sandbox','allow-scripts allow-same-origin'); const loaded = new Promise(resolve => f.onload=resolve); f.srcdoc=c.html; document.body.appendChild(f); await loaded; results.push({name:c.name,expected:c.expected,reader:c.reader,errors:c.errors,chrome:f.contentDocument.getElementById('result').textContent}); f.remove() }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
const html = `<!doctype html><output></output><script>(${run.toString()})(${JSON.stringify(inputs).replace(/</g,'\\u003c')})</script>`
fs.writeFileSync(path.join(out,'oracle.html'),html,{flag:'wx'});fs.writeFileSync(path.join(out,'visual.html'),visualHtml,{flag:'wx'})
async function main () {
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let stdout
  try { ({stdout}=await promisify(execFile)(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--virtual-time-budget=5000','--dump-dom',`http://127.0.0.1:${server.address().port}/`],{timeout:60000,maxBuffer:8*1024*1024})) } finally { server.close() }
  const match=stdout.match(/data-results="([^"]+)"/);assert.ok(match,'No independent Chrome result')
  const results=JSON.parse(decodeURIComponent(match[1]));assert.equal(results.length,inputs.length)
  const failures=results.filter(r=>r.chrome!==r.expected || r.reader!==r.expected || r.errors.length)
  const report={checked:results.length,failureCount:failures.length,failures,results}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2),{flag:'wx'})
  console.log(JSON.stringify({checked:results.length,failureCount:failures.length,failures},null,2));assert.equal(failures.length,0)
}
main().catch(e=>{console.error(e);process.exitCode=1})
