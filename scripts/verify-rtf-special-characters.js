'use strict'
// RTF1.9.1 contracts plus unmodified Writer/Cocoa text exports. Actual reader
// host payload uses production WXML compiled in Chrome; physical devices and
// native WXML are separate. Preserve unsupported application controls as data.
// --record preserves every mismatch without declaring a strict oracle pass.
// Default mode checks every reader contract and independently supported controls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const oracles = require('../tests/fixtures/rtf-special-characters-oracles.json')
const { TmplGroup } = require('glass-easel-template-compiler')
const { cases } = require('../tests/helpers/rtf-special-characters')
const { readerPage, flush } = require('../tests/helpers/reader-host')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { chromeTestResult } = require('./chrome-test-result')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/rtf-special-characters/verified')
  fs.mkdirSync(out, { recursive: true })
  const writerVersion = oracles.writerVersion
  const references = new Map(oracles.rows.map(row => [row.id, row]))
  const reads = [], states = [], page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (const fixture of cases) {
      const bytes = Buffer.from(fixture.source)
      const reference = references.get(fixture.id)
      assert.equal(reference.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), fixture.id + ': independent original identity')
      page.openSelectedFile({ name: fixture.id + '.rtf', path: '/local/field.rtf', size: bytes.length })
      reads.shift().success({ data: bytes }); await flush()
      assert.equal(page.data.error, '', fixture.id)
      states.push({ ...fixture, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), actual: rtfToText(bytes), host: page._htmlRuntime.document.querySelector('pre').textContent, data: structuredClone(page.data), writer: reference.writer, cocoa: reference.cocoa })
    }
  } finally { page.detached() }
  const group = TmplGroup.newDev(); let compiled
  try { group.addTmpl('', fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/engine/components/reader/dom-tree.wxml'), 'utf8') + '<view class="dom-render-root" style="{{domWrapperStyle}}"><template is="dn0" data="{{nodes:domTree,styles:domStyles}}"/></view>'); compiled = group.getTmplGenObjectGroups() } finally { group.free() }
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/engine/components/reader/reader.wxss'), 'utf8')
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:390px}root,view{display:block}${css}</style><div id="app"></div><output></output><script src="/framework.js"></script><script>
(async()=>{const output=document.querySelector('output');try{
 const states=await(await fetch('/states.json')).json(),groups=${compiled};
 const ge=glassEasel,backend=new ge.CurrentWindowBackendContext();backend.onEvent(ge.Event.triggerBackendEvent);
 const def=ge.registerElement({template:{groupList:groups,content:groups['']},data:states[0].data}).general();
 const root=ge.Component.createWithContext('root',def,backend);ge.Element.replaceDocumentElement(root,document.body,document.querySelector('#app'));
 const results=[];
 for(const state of states){root.setData(state.data);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const pre=document.querySelector('.dom-pre'),painted=pre.textContent;
  const writer=state.writer;
  const reference=pre.cloneNode(false);reference.textContent=state.expected;pre.parentElement.append(reference);
  const box=pre.getBoundingClientRect(),refBox=reference.getBoundingClientRect();
  const sameGeometry=box.width===refBox.width&&box.height===refBox.height;reference.remove();
  const style=getComputedStyle(pre),visible=pre.getBoundingClientRect().height>0&&style.display!=='none';
  results.push({id:state.id,sha256:state.sha256,expected:state.expected,oracle:state.oracle,actual:state.actual,host:state.host,painted,visible,writer,cocoa:state.cocoa,cocoaExact:state.cocoa===state.expected,writerExact:writer===state.expected,sameGeometry,readerExact:state.actual===state.expected&&state.host===state.expected&&painted===state.expected&&visible&&sameGeometry});
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
  if (!process.argv.includes('--record')) {
    assert.ok(report.results.every(r => r.readerExact));
    // Canonical independent application controls. Other unsupported parser
    // controls remain explicit differences, never silently reclassified as pass.
    for (const word of ['emspace','enspace','zwj','zwnj']) assert.ok(report.results.find(r => r.id === word+'-plain').cocoaExact, word);
    for (const word of ['page','column']) assert.ok(report.results.find(r => r.id === word+'-plain').writerExact, word);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
