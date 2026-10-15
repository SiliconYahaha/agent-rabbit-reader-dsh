'use strict'
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { renderTextData, formatJson } = require('../miniprogram/file-reader/document/text-data')
const { chromeTestResult } = require('./chrome-test-result')
const references = require('../tests/fixtures/text-data/references.json')
async function main () {
  const out = path.resolve('outputs/text-data/browser'); fs.mkdirSync(out, { recursive: true })
  const samples = [
    ...references.json.map(s => ({ id: s.id, html: renderTextData(s.source, { format: 'json', labels: { original: '查看原文', formatted: '查看排版' } }).html, expected: formatJson(s.source), original: s.source })),
    ...references.csv.map(s => ({ id: s.id, html: renderTextData(s.source, { format: 'csv', labels: { original: '查看原文', formatted: '查看排版' } }).html, cells: s.rows.flat(), original: s.source }))
  ]
  const fixture = `<!doctype html><meta charset="utf-8"><main></main><output></output><script>
  (async()=>{try{const rows=[];for(const s of await(await fetch('/samples')).json()){
    const frame=document.createElement('iframe');frame.style='width:390px;height:600px';document.querySelector('main').append(frame);
    const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc='<meta charset="utf-8">'+s.html;await loaded;
    const d=frame.contentDocument;if(s.cells){const cells=Array.from(d.querySelectorAll('td')).map(e=>e.textContent);if(JSON.stringify(cells)!==JSON.stringify(s.cells.map(c=>c.replace(/\\r\\n?/g,'\\n'))))throw Error(s.id+' cells');}
    else if(d.querySelector('pre').textContent!==s.expected)throw Error(s.id+' JSON');
    d.getElementById('text-data-toggle').click();if(d.getElementById('text-data-original').querySelector('pre').textContent!==s.original.replace(/\\r\\n?/g,'\\n'))throw Error(s.id+' original');
    if(!d.getElementById('text-data-original').getBoundingClientRect().height)throw Error(s.id+' not visible');
    d.getElementById('text-data-toggle').click();if(d.getElementById('text-data-original').getBoundingClientRect().height)throw Error(s.id+' not hidden');
    if(frame.contentWindow.poison!==undefined)throw Error('author code executed');rows.push({id:s.id,content:true,originalToggle:true});frame.remove();
  }document.querySelector('output').setAttribute('data-result',btoa(JSON.stringify(rows)))}catch(e){document.querySelector('output').setAttribute('data-error',e.stack)}})();</script>`
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/samples' ? 'application/json' : 'text/html'); res.end(req.url === '/samples' ? JSON.stringify(samples) : fixture) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const dom = await chromeTestResult('http://127.0.0.1:' + server.address().port)
    fs.writeFileSync(path.join(out, 'result.html'), dom)
    const match = dom.match(/data-result="([^"]+)"/); assert.ok(match, dom)
    const rows = JSON.parse(Buffer.from(match[1], 'base64').toString()); assert.equal(rows.length, samples.length)
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'isolated native Chrome frames, own files', rows }, null, 2))
    console.log(JSON.stringify({ files: rows.length, nativeContentExact: rows.length, toggles: rows.length * 2 }))
  } finally { server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
