'use strict'

// Original-file content stays in ignored outputs. The actual production WXML
// runs in official glass-easel. Browser scroll-view CSS is an explicit adapter,
// not a claim to have tested WeChat's native component or phone gestures.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { TmplGroup } = require('glass-easel-template-compiler')
const projectRoot = path.resolve(process.env.HTML_READER_VERIFY_ROOT || path.join(__dirname, '..'))
const { readerPage, flush } = require(path.join(projectRoot, 'tests/helpers/reader-host'))
const { chromeTestResult } = require('./chrome-test-result')

async function main () {
  assert.ok(process.argv[2], 'Pass a local Markdown original')
  const bytes = fs.readFileSync(process.argv[2]), out = path.resolve(process.argv[3] || 'outputs/markdown-table-scroll')
  fs.mkdirSync(out, { recursive: true })
  const states = [], reads = []
  let width = 390
  const page = readerPage({ getWindowInfo: () => ({ windowWidth: width, windowHeight: 844, pixelRatio: 3 }), getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (width of [320, 390, 430]) {
      page.openSelectedFile({ name: 'original.md', path: '/local/original.md', size: bytes.length })
      reads.shift().success({ data: bytes }); await flush()
      assert.equal(page.data.error, '')
      assert.equal(page.data.domMode, true)
      const tables = page._htmlRuntime.document.querySelectorAll('table')
      states.push({ width, data: structuredClone(page.data), expected: tables.map(table => table.querySelectorAll('th,td').map(cell => cell.textContent)) })
    }
  } finally { page.detached() }
  const group = TmplGroup.newDev()
  let compiled
  try {
    group.addTmpl('', fs.readFileSync(path.join(projectRoot, 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml'), 'utf8') + '<view class="reader-canvas"><view class="dom-render-root" style="{{domWrapperStyle}}"><template is="dn0" data="{{nodes:domTree,styles:domStyles}}"/></view></view>')
    compiled = group.getTmplGenObjectGroups()
  } finally { group.free() }
  const css = fs.readFileSync(path.join(projectRoot, 'miniprogram/file-reader/engine/components/reader/reader.wxss'), 'utf8')
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px sans-serif}root,view{display:block}text{white-space:inherit}scroll-view[scroll-x]{overflow-x:auto;overflow-y:hidden}${css}</style><div id="app"></div><output></output><script src="/framework.js"></script><script>
(async()=>{const output=document.querySelector('output');try{
 const states=await(await fetch('/states.json')).json(),groups=${compiled};
 const ge=glassEasel,backend=new ge.CurrentWindowBackendContext();backend.onEvent(ge.Event.triggerBackendEvent);
 const def=ge.registerElement({template:{groupList:groups,content:groups['']},data:states[0].data}).general();
 const root=ge.Component.createWithContext('root',def,backend);ge.Element.replaceDocumentElement(root,document.body,document.querySelector('#app'));
 const results=[];
 for(const state of states){document.body.style.width=state.width+'px';root.setData(state.data);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const scrollers=[...document.querySelectorAll('scroll-view')],tables=[...document.querySelectorAll('.dom-table')];
  const rows=[];
  for(let i=0;i<tables.length;i++){const table=tables[i],scroller=scrollers[i],cells=[...table.children].filter(x=>/dom-t[dh]/.test(x.className));
   const text=cells.map(x=>x.textContent);const rect=scroller?.getBoundingClientRect();
   const lastColumnCount=table.style.gridTemplateColumns.match(/repeat\\((\\d+)/);const last=cells[Number(lastColumnCount?.[1]||1)-1];
   const lastBefore=last.getBoundingClientRect();if(scroller)scroller.scrollLeft=scroller.scrollWidth;
   const after=last.getBoundingClientRect();
   rows.push({cellsMatch:JSON.stringify(text)===JSON.stringify(state.expected[i]),scrollX:scroller?.getAttribute('scroll-x'),viewport:scroller?.clientWidth,content:scroller?.scrollWidth,scrollLeft:scroller?.scrollLeft,lastVisible:!!rect&&after.right<=rect.right+1&&after.left>=rect.left-1,moved:after.left<lastBefore.left-1});
   if(scroller)scroller.scrollLeft=0;
  }
  results.push({width:state.width,expectedTables:state.expected.length,tables:tables.length,scrollers:scrollers.length,pageWidth:document.body.scrollWidth,rows});
 }
 output.setAttribute('data-result',btoa(JSON.stringify(results)));
}catch(e){output.setAttribute('data-error',e.stack)}})();</script>`
  fs.writeFileSync(path.join(out, 'preview.html'), html)
  fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify(states))
  const framework = fs.readFileSync(require.resolve('glass-easel').replace('glass_easel.all.js', 'glass_easel.all.global.js'))
  const server = http.createServer((req, res) => { if (req.url === '/framework.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(framework) } else if (req.url === '/states.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(states)) } else { res.setHeader('Content-Type', 'text/html'); res.end(html) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let dom
  try { dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`) } finally { server.close() }
  const match = dom.match(/data-result="([^"]+)"/)
  fs.writeFileSync(path.join(out, 'result.html'), dom)
  assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Browser did not finish')
  const results = JSON.parse(Buffer.from(match[1], 'base64').toString())
  const report = { testedAt: new Date().toISOString(), originalBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), scope: 'Actual file-open, production WXML compiled by glass-easel, browser scroll-view adapter. Native WeChat gestures and physical devices not run.', results }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(results.map(r => ({ ...r, rows: r.rows.slice(0, 2) })), null, 2))
  if (process.argv.includes('--record')) return
  for (const result of results) {
    assert.equal(result.tables, result.expectedTables)
    assert.equal(result.scrollers, result.expectedTables)
    assert.ok(result.pageWidth <= result.width + 1, 'The page must not overflow horizontally')
    for (const row of result.rows) {
      assert.equal(row.cellsMatch, true, 'Preserve every cell in source order')
      assert.equal(row.lastVisible, true, 'Rightmost header must be reachable')
      if (row.content > row.viewport + 1) { assert.ok(row.scrollLeft > 0); assert.equal(row.moved, true) }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
