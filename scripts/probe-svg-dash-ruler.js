'use strict'
// Read-only Canvas capability observation. These measurements do not select a
// production algorithm and must not be treated as a browser-name detector.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { spawn } = require('node:child_process')
const { chromeTestResult } = require('./chrome-test-result')
async function observe () {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  const report = { userAgent: navigator.userAgent, rows: [] }
  for (const dash of [125,125.45,125.5,125.55,125.6,125.65,125.7,126]) {
    ctx.reset(); ctx.lineWidth = .01; ctx.setLineDash([dash,10000]); ctx.beginPath(); ctx.ellipse(128,128,80,80,0,0,Math.PI*2)
    report.rows.push({ dash, quarter: ctx.isPointInStroke(128,208), before: ctx.isPointInStroke(128.1,207.9999375), after: ctx.isPointInStroke(127.9,207.9999375) })
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(report)))
}
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/svg-curve-ruler/capability.json')
  let receive, firefox, timeout
  const posted = new Promise(resolve => { receive = resolve })
  const callback = `<script>new MutationObserver(()=>fetch('/result',{method:'POST',body:document.documentElement.outerHTML})).observe(document.querySelector('output'),{attributes:true})</script>`
  const html = '<!doctype html><output></output>' + callback + '<script>(' + observe + ')().catch(e=>document.querySelector("output").setAttribute("data-error",e.stack))</script>'
  const server = http.createServer((req,res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = ''; req.on('data',chunk => { body += chunk }); req.on('end',() => { receive(body); res.end('ok') })
    } else { res.setHeader('Content-Type','text/html'); res.end(html) }
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    let dom
    if (process.env.HTML_READER_FIREFOX) {
      firefox = spawn(process.env.HTML_READER_FIREFOX,['-headless','-no-remote','-profile',fs.mkdtempSync(path.join(os.tmpdir(),'reader-dash-ruler-')),'-url',url],{stdio:'ignore'})
      dom = await Promise.race([posted,new Promise((resolve,reject) => { firefox.on('error',reject); timeout = setTimeout(() => reject(Error('Firefox ruler observation timed out')),30000) })])
    } else dom = await chromeTestResult(url)
    const match = dom.match(/data-result="([^"]+)"/)
    if (!match) throw Error(dom.match(/data-error="([^"]*)"/)?.[1] || 'No Canvas observation returned')
    const report = JSON.parse(decodeURIComponent(match[1]))
    if (report.rows.length !== 8 || report.rows.some(r => ['quarter','before','after'].some(k => typeof r[k] !== 'boolean'))) throw Error('Incomplete Canvas measurements')
    fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report))
  } finally { clearTimeout(timeout); server.close(); if (firefox && firefox.exitCode == null) firefox.kill('SIGTERM') }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
