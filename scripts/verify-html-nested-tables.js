'use strict'

// Execute shipped WXML with official glass-easel's browser backend. This checks
// content/ownership, not native WeChat gestures or pixel-identical table sizing.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { cases, snapshot } = require('../tests/helpers/html-nested-tables')
const project = path.resolve(process.env.HTML_READER_VERIFY_ROOT || path.join(__dirname, '..'))
const { parseHtmlDocument } = require(path.join(project, 'miniprogram/file-reader/document/html-runtime/html-dom-shim'))
const { readerPage, flush } = require(path.join(project, 'tests/helpers/reader-host'))
const { TmplGroup } = require('glass-easel-template-compiler')
const { chromeTestResult } = require('./chrome-test-result')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/nested-table-scope')
  fs.mkdirSync(out, { recursive: true })
  const fixtures = cases(), states = [], reads = []
  const page = readerPage({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }), getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (const fixture of fixtures) {
      const bytes = Buffer.from(fixture.source)
      page.openSelectedFile({ name: fixture.id + '.html', path: '/local/nested.html', size: bytes.length })
      reads.shift().success({ data: bytes }); await flush()
      assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true)
      states.push({ id: fixture.id, source: fixture.source, parsed: snapshot(parseHtmlDocument(fixture.source).document), host: snapshot(page._htmlRuntime.document), data: structuredClone(page.data), ids: Object.fromEntries(page._htmlRuntime.document.querySelectorAll('[id]').map(node => [node._nid, node.id])) })
    }
  } finally { page.detached() }
  const group = TmplGroup.newDev(); let compiled
  try {
    group.addTmpl('', fs.readFileSync(path.join(project, 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml'), 'utf8') + '<view class="dom-render-root" style="{{domWrapperStyle}}"><template is="dn0" data="{{nodes:domTree,styles:domStyles}}"/></view>')
    compiled = group.getTmplGenObjectGroups()
  } finally { group.free() }
  const css = fs.readFileSync(path.join(project, 'miniprogram/file-reader/engine/components/reader/reader.wxss'), 'utf8')
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px sans-serif;width:390px}root,view{display:block}text{white-space:inherit}${css}</style><div id="app"></div><output></output><script src="/framework.js"></script><script>
(async()=>{const output=document.querySelector('output');try{
 const states=await(await fetch('/states.json')).json(),groups=${compiled},snapshot=${snapshot.toString()};
 const ge=glassEasel,backend=new ge.CurrentWindowBackendContext();backend.onEvent(ge.Event.triggerBackendEvent);
 const def=ge.registerElement({template:{groupList:groups,content:groups['']},data:states[0].data}).general();
 const root=ge.Component.createWithContext('root',def,backend);ge.Element.replaceDocumentElement(root,document.body,document.querySelector('#app'));
 const results=[];
 for(const state of states){
  const native=new DOMParser().parseFromString(state.source,'text/html'),expected=snapshot(native);
  root.setData(state.data);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const idOf=node=>node?state.ids[node.getAttribute('data-nid')]||'':'';
  const painted=[...document.querySelectorAll('.dom-table')].map(table=>({
   id:idOf(table),parentCell:idOf(table.parentElement.closest('.dom-td,.dom-th')),
   cells:[...table.children].filter(x=>x.classList.contains('dom-td')||x.classList.contains('dom-th')).map(x=>({id:idOf(x),text:x.textContent})),
   visible:table.getBoundingClientRect().width>0&&table.getBoundingClientRect().height>0
  }));
  const expectedPaint=expected.map(table=>({id:table.id,parentCell:table.parentCell,cells:table.rows.flatMap(row=>row.cells.map(cell=>({id:cell.id,text:cell.text}))),visible:true}));
  results.push({id:state.id,expected,actual:state.parsed,parsedExact:JSON.stringify(expected)===JSON.stringify(state.parsed),hostExact:JSON.stringify(expected)===JSON.stringify(state.host),painted,paintedExact:JSON.stringify(expectedPaint)===JSON.stringify(painted)});
 }
 output.setAttribute('data-result',btoa(unescape(encodeURIComponent(JSON.stringify({userAgent:navigator.userAgent,results})))));
}catch(error){output.setAttribute('data-error',error.stack)}})();</script>`
  fs.writeFileSync(path.join(out, 'oracle.html'), html); fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify(states))
  const framework = fs.readFileSync(require.resolve('glass-easel').replace('glass_easel.all.js', 'glass_easel.all.global.js'))
  const server = http.createServer((req, res) => {
    if (req.url === '/framework.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(framework) }
    else if (req.url === '/states.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(states)) }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let dom
  try { dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`) } finally { server.close() }
  const match = dom.match(/data-result="([^"]+)"/); assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Browser did not complete')
  const report = { testedAt: new Date().toISOString(), scope: 'Native HTML DOM versus parser, actual file entry and production WXML in browser glass-easel; cell ownership/text and visible table boxes. No physical-device or exact geometry claim.', ...JSON.parse(Buffer.from(match[1], 'base64').toString()) }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  if (process.argv.includes('--capture')) {
    const reference = report.results.map(row => ({ id: row.id, sourceSha256: crypto.createHash('sha256').update(fixtures.find(fixture => fixture.id === row.id).source).digest('hex'), expected: row.expected }))
    fs.writeFileSync(path.join(__dirname, '../tests/fixtures/html-nested-tables-reference.json'), '{\n  "userAgent": ' + JSON.stringify(report.userAgent) + ',\n  "cases": [\n' + reference.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n')
  }
  const failures = report.results.filter(row => !row.parsedExact || !row.hostExact || !row.paintedExact)
  console.log(JSON.stringify({ cases: report.results.length, failures: failures.map(({ id, parsedExact, hostExact, paintedExact }) => ({ id, parsedExact, hostExact, paintedExact })), out }))
  if (!process.argv.includes('--record')) assert.equal(failures.length, 0)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
