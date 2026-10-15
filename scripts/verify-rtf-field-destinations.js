'use strict'
// Writer's unmodified HTML is displayed by Chrome for the independent oracle.
// The actual reader host payload is displayed using production WXML. Neither
// substitutes for WeChat/device checks; upr interoperability differences remain.
// --record preserves every mismatch without declaring a strict oracle pass.
// Default mode intentionally fails while unexpected Writer differences remain.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { TmplGroup } = require('glass-easel-template-compiler')
const { cases } = require('../tests/helpers/rtf-field-destinations')
const { readerPage, flush } = require('../tests/helpers/reader-host')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { chromeTestResult } = require('./chrome-test-result')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/rtf-field-destinations')
  const input = path.join(out, 'input'), converted = path.join(out, 'writer'), profile = path.join(out, 'profile')
  for (const dir of [input, converted, profile]) fs.mkdirSync(dir, { recursive: true })
  const flags = ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless'], run = args => execFileSync(process.env.RTF_LIBREOFFICE || 'soffice', [...flags, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  for (const fixture of cases) fs.writeFileSync(path.join(input, fixture.id + '.rtf'), fixture.source)
  const writerVersion = run(['--version']).trim()
  fs.writeFileSync(path.join(out, 'writer.log'), run(['--convert-to', 'html', '--outdir', converted, ...cases.map(fixture => path.join(input, fixture.id + '.rtf'))]))
  const reads = [], states = [], page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (const fixture of cases) {
      const bytes = Buffer.from(fixture.source)
      page.openSelectedFile({ name: fixture.id + '.rtf', path: '/local/field.rtf', size: bytes.length })
      reads.shift().success({ data: bytes }); await flush()
      assert.equal(page.data.error, '', fixture.id)
      states.push({ ...fixture, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), actual: rtfToText(bytes), host: page._htmlRuntime.document.querySelector('pre').textContent, data: structuredClone(page.data), writer: fs.readFileSync(path.join(converted, fixture.id + '.html'), 'utf8') })
    }
  } finally { page.detached() }
  const group = TmplGroup.newDev(); let compiled
  try { group.addTmpl('', fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/engine/components/reader/dom-tree.wxml'), 'utf8') + '<view class="dom-render-root" style="{{domWrapperStyle}}"><template is="dn0" data="{{nodes:domTree,styles:domStyles}}"/></view>'); compiled = group.getTmplGenObjectGroups() } finally { group.free() }
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/engine/components/reader/reader.wxss'), 'utf8')
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:390px}root,view{display:block}${css}</style><div id="app"></div><iframe sandbox="allow-same-origin"></iframe><output></output><script src="/framework.js"></script><script>
(async()=>{const output=document.querySelector('output');try{
 const states=await(await fetch('/states.json')).json(),groups=${compiled};
 const ge=glassEasel,backend=new ge.CurrentWindowBackendContext();backend.onEvent(ge.Event.triggerBackendEvent);
 const def=ge.registerElement({template:{groupList:groups,content:groups['']},data:states[0].data}).general();
 const root=ge.Component.createWithContext('root',def,backend);ge.Element.replaceDocumentElement(root,document.body,document.querySelector('#app'));
 const frame=document.querySelector('iframe'),results=[];
 for(const state of states){root.setData(state.data);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const pre=document.querySelector('.dom-pre'),painted=pre.textContent;
  await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=state.writer});
  const writer=[...frame.contentDocument.querySelectorAll('body p')].map(p=>p.innerText.trim()).join('\\n').trim();
  const style=getComputedStyle(pre),visible=pre.getBoundingClientRect().height>0&&style.display!=='none';
  results.push({id:state.id,sha256:state.sha256,expected:state.expected,oracle:state.oracle,actual:state.actual,host:state.host,painted,visible,writer,writerExact:writer===state.expected,readerExact:state.actual===state.expected&&state.host===state.expected&&painted===state.expected&&visible});
 }
 output.setAttribute('data-result',btoa(unescape(encodeURIComponent(JSON.stringify({userAgent:navigator.userAgent,results})))));
}catch(e){output.setAttribute('data-error',e.stack)}})();</script>`
  fs.writeFileSync(path.join(out, 'preview.html'), html); fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify(states))
  const framework = fs.readFileSync(require.resolve('glass-easel').replace('glass_easel.all.js', 'glass_easel.all.global.js'))
  const server = http.createServer((req, res) => { if (req.url === '/framework.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(framework) } else if (req.url === '/states.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(states)) } else { res.setHeader('Content-Type', 'text/html'); res.end(html) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let dom
  try { dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`) } finally { server.close() }
  const match = dom.match(/data-result="([^"]+)"/); assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Missing result')
  const report = { testedAt: new Date().toISOString(), writerVersion, ...JSON.parse(Buffer.from(match[1], 'base64').toString()) }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: report.results.length, readerFailures: report.results.filter(r => !r.readerExact).map(r => r.id), writerDifferences: report.results.filter(r => !r.writerExact).map(({ id, writer, oracle }) => ({ id, writer, oracle })), out }))
  if (!process.argv.includes('--record')) { assert.ok(report.results.every(r => r.readerExact)); assert.ok(report.results.filter(r => r.oracle).every(r => r.writerExact)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
