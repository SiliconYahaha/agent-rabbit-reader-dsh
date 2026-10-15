'use strict'

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), zlib = require('node:zlib'), http = require('node:http')
const { TmplGroup } = require('glass-easel-template-compiler')
const { chromeTestResult } = require('./chrome-test-result')
const root = path.resolve(process.env.HTML_READER_VERIFY_ROOT || path.join(__dirname, '..'))
const { readerPage, flush } = require(path.join(root, 'tests/helpers/reader-host'))
const originals = path.resolve(process.argv[2] || 'outputs/archive-folder-paths/originals')
const output = path.resolve(process.argv[3] || 'outputs/archive-folder-paths/verified')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function treeErrors (entries, reference) {
  const errors = [], stack = []
  const directories = new Set(reference.directories)
  for (const entry of entries) {
    const name = entry.name.replace(/\/$/, ''), parts = name.split('/'), depth = parts.length - 1
    if (entry.depth !== depth || entry.displayName !== parts.at(-1) + (entry.isDirectory ? '/' : '')) errors.push('label/depth: ' + entry.name)
    if (depth && stack[depth - 1] !== parts.slice(0, -1).join('/')) errors.push('wrong visible parent: ' + entry.name)
    stack.length = depth
    if (entry.isDirectory) { stack.push(name); directories.delete(name) }
  }
  if (directories.size) errors.push('missing directories: ' + [...directories].join(','))
  const files = entries.filter(e => !e.isDirectory)
  if (JSON.stringify(files.map(e => e.name).sort()) !== JSON.stringify(reference.members.map(m => m.name).sort())) errors.push('lost member')
  return errors
}

async function main () {
  fs.mkdirSync(output, { recursive: true })
  const references = JSON.parse(fs.readFileSync(path.join(originals, 'references.json')))
  const wasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const oldWasm = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(wasm, imports) }
  let source, sourcePath
  const files = new Map(), states = [], results = []
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => ({
    readFile (o) { const bytes = o.filePath === sourcePath ? source : Buffer.from(files.get(o.filePath)); const start = o.position || 0, data = bytes.subarray(start, o.length == null ? undefined : start + o.length); o.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }) },
    writeFile (o) { files.set(o.filePath, Buffer.from(o.data)); o.success() }
  }) })
  try {
    for (const reference of references.results) {
      source = fs.readFileSync(path.join(originals, reference.name)); sourcePath = '/fixture/' + reference.name
      assert.equal(hash(source), reference.sha256)
      const open = async () => { page.openSelectedFile({ name: reference.name, path: sourcePath, size: source.length }); await flush(); assert.equal(page.data.error, '', reference.name) }
      await open()
      const entries = structuredClone(page.data.inspectorEntries)
      const errors = treeErrors(entries, reference)
      states.push({ name: reference.name, entries })
      let taps = 0
      for (const member of reference.members) {
        await open()
        const index = page.data.inspectorEntries.findIndex(e => !e.isDirectory && e.name === member.name)
        assert.ok(index >= 0, member.name)
        await page.openInspectorEntry({ detail: { index } }); await flush()
        assert.equal(page.data.error, '', member.name)
        assert.equal(page._htmlRuntime.document.body.textContent.trim(), member.text)
        taps++
      }
      results.push({ name: reference.name, sha256: reference.sha256, entries: entries.length, errors, actualHostTaps: taps })
    }
  } finally {
    page.detached()
    if (oldWasm === undefined) delete global.WXWebAssembly
    else global.WXWebAssembly = oldWasm
  }
  const group = TmplGroup.newDev()
  let compiled
  try { group.addTmpl('', fs.readFileSync(path.join(root, 'miniprogram/file-reader/skin/inspector/inspector.wxml'), 'utf8')); compiled = group.getTmplGenObjectGroups() } finally { group.free() }
  const css = fs.readFileSync(path.join(root, 'miniprogram/file-reader/skin/inspector/inspector.wxss'), 'utf8').replace(/([\d.]+)rpx/g, (_, n) => (Number(n) * 390 / 750) + 'px')
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:390px}view,root{display:block}${css}</style><main></main><output></output><script src="/framework.js"></script><script>
  (async()=>{const out=document.querySelector('output');try{const states=await(await fetch('/states.json')).json(),groups=${compiled},ge=glassEasel;
  const backend=new ge.CurrentWindowBackendContext();backend.onEvent(ge.Event.triggerBackendEvent);
  const def=ge.registerElement({template:{groupList:groups,content:groups['']},data:{entries:[],metadata:[],nameEncodingOptions:[]}}).general();
  const root=ge.Component.createWithContext('root',def,backend);ge.Element.replaceDocumentElement(root,document.body,document.querySelector('main'));const results=[];
  for(const s of states){root.setData({entries:s.entries});await new Promise(r=>requestAnimationFrame(r));const rows=[...document.querySelectorAll('.entry-row')];
    const actual=rows.map((row,i)=>{const raw=row.getAttribute('style')||'',match=raw.match(/margin-left:\\s*([\\d.]+)rpx/);const indent=match?Number(match[1]):0;
      row.style.marginLeft=(indent*390/750)+'px';const label=row.querySelector('.entry-name');const result={label:label.textContent,indent,index:Number(row.getAttribute('data-index')),visible:label.getBoundingClientRect().height>0&&label.getBoundingClientRect().width>0,left:label.getBoundingClientRect().left,right:row.getBoundingClientRect().right};row.setAttribute('style',raw);return result;});
    results.push({name:s.name,rows:actual});}
  out.setAttribute('data-result',btoa(unescape(encodeURIComponent(JSON.stringify(results)))));}catch(e){out.setAttribute('data-error',e.stack)}})();</script>`
  const framework = fs.readFileSync(require.resolve('glass-easel').replace('glass_easel.all.js', 'glass_easel.all.global.js'))
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/framework.js' ? 'application/javascript' : req.url === '/states.json' ? 'application/json' : 'text/html')
    res.end(req.url === '/framework.js' ? framework : req.url === '/states.json' ? JSON.stringify(states) : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let views
  try {
    const dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`)
    fs.writeFileSync(path.join(output, 'browser.html'), dom)
    const match = dom.match(/data-result="([^"]+)"/)
    assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Browser did not finish')
    views = JSON.parse(Buffer.from(match[1], 'base64').toString())
  } finally { server.close() }
  for (const [index, view] of views.entries()) {
    const expected = states[index].entries
    assert.equal(view.rows.length, expected.length)
    for (const [i, row] of view.rows.entries()) {
      assert.equal(row.label, expected[i].displayName); assert.equal(row.index, i); assert.equal(row.visible, true); assert.ok(row.right <= 391, 'Row must fit the viewport')
      if (row.indent !== expected[i].indentRpx) results[index].errors.push('WXML indentation: ' + expected[i].name)
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ producer: references.producer, results, views,
    scope: 'Real file opens and entry handlers, native WASM, compiled production inspector WXML with Chrome/glass-easel. File API and rpx conversion are explicit test adapters. Not WeChat native/device verification.' }, null, 2) + '\n')
  console.log(JSON.stringify({ archives: results.length, failedTrees: results.filter(r => r.errors.length).length, actualHostTaps: results.reduce((n, r) => n + r.actualHostTaps, 0), productionWxmlViews: views.length }))
  if (!process.argv.includes('--record')) for (const result of results) assert.deepEqual(result.errors, [], result.name)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
