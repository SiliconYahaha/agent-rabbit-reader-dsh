'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {renderHtmlDomTree,parseCssRules,cascadeForElement}=require('../miniprogram/file-reader/document/document-renderer')
const {parseHtmlDocument}=require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {cases,htmlFor,visualHtml}=require('./helpers/css-cascade-order')
const find=(nodes,id)=>{for(const n of nodes){if(n.attrs?.id===id)return n;const child=find(n.children||[],id);if(child)return child}}
test('winning declarations move to cascade order when repeated, specific or important',()=>{
  const p=parseHtmlDocument('<div id="p" style="padding:8px"></div>').document.querySelector('div')
  for(const [css,keys]of [
    ['#p{margin:1px;margin-left:2px;margin:3px}',['margin-left','margin']],
    ['#p{margin-left:2px}div{margin:3px}',['margin','margin-left']],
    ['div{margin:3px!important}#p{margin-left:2px}',['margin-left','margin']],
    ['#p{padding-left:2px!important}',['padding','padding-left']]
  ]){const styles=cascadeForElement(p,parseCssRules(css)).styles;assert.deepEqual(Object.keys(styles).filter(k=>keys.includes(k)),keys)}
})
test('generated ordinary and pseudo outputs retain all content and safely ordered declarations',()=>{
  assert.equal(cases.length,238)
  for(const c of cases){const n=find(renderHtmlDomTree(htmlFor(c)).nodes,'probe');assert.ok(n,c.name);assert.ok(JSON.stringify(n).includes('正文保留'),c.name);if(c.pseudo)assert.ok(n.children.some(child=>child.attrs?.class==='hr-pseudo-before'),c.name)}
})
test('implicit universal pseudo selectors target descendants rather than the ancestor',()=>{
  const d=parseHtmlDocument('<div id="outer"><p id="p">正文</p></div>').document
  const r=renderHtmlDomTree(d,{styles:['p:after{content:"FAILED"} div :after{content:"PASSED"}']})
  assert.ok(find(r.nodes,'p').children.some(n=>n.children?.[0]?.text==='PASSED'))
  assert.ok(!find(r.nodes,'outer').children.some(n=>n.attrs?.class==='hr-pseudo-after'))
  assert.equal(parseCssRules('::before{content:"x"}')[0].selector,'*')
  assert.equal(parseCssRules('body > ::before{content:"x"}')[0].selector,'body > *')
  assert.equal(parseCssRules('#probe\\ ::before{content:"x"}')[0].selector,'#probe\\ ')
  assert.equal(parseCssRules('#probe\\20 ::before{content:"x"}')[0].selector,'#probe\\20 ')
})
test('a real sandbox click changes high-specificity card styles in the emitted view',()=>{
  const rt=createRuntime(visualHtml)
  try{rt.run();const render=()=>find(renderHtmlDomTree(rt.document,{styles:rt.renderState().styles}).nodes,'card').attrs.style
    const before=render();assert.ok(before.indexOf('background:white')<before.indexOf('background-color:#f2ffc9'));assert.ok(before.indexOf('font:16px')<before.indexOf('font-size:24px'))
    assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid),true);const after=render();assert.ok(after.indexOf('padding:12px')<after.indexOf('padding-left:36px'));assert.match(after,/background-color:#daf0ff/);assert.equal(rt.document.getElementById('result').textContent,'切换已生效');assert.deepEqual(rt.errors,[])
  }finally{rt.destroy()}
})
test('contrast correction reads the winning background rather than a reset longhand',()=>{
  const n=find(renderHtmlDomTree('<style>#p{color:#222;background-color:#000;background:#fff}</style><p id="p">正文</p>').nodes,'p')
  assert.match(n.attrs.style,/(?:^|;)color:#222(?:;|$)/)
})
test('public CSS source originals and license retain provenance hashes',()=>{
  const hashes={'sort-by-order-001.xht':'325edd8c159b87559c554b2e029fb7ddf47a43a221a7037b549055bca3c73fd1','specificity-011.xht':'2168917e23baa7351e076305ec0fc352f2a7eeffb0789c798becd3f76b0e5937','LICENSE.md':'5fac07febb0e2a97fb0d7b0def149ec08b642e1ba4b9c345283ab1cbd2af6570'}
  for(const [name,hash]of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/css-cascade-order',name))).digest('hex'),hash)
})
test('invalid declarations and remote resources cannot gain priority by reordering',()=>{
  const n=find(renderHtmlDomTree('<style>#p{color:#222;bad;behavior:url(x)!important;color:expression(bad)!important;background:url(https://invalid.example/private)!important}</style><div id="p">正文</div>').nodes,'p')
  assert.match(n.attrs.style,/color:#222/);assert.doesNotMatch(n.attrs.style,/expression|behavior|https:/)
})
test('30,000 overlapping declarations remain bounded in an isolated process',()=>{
  const {execFileSync}=require('node:child_process')
  execFileSync(process.execPath,['-e',`const a=require('node:assert/strict'),r=require('./miniprogram/file-reader/document/document-renderer'),d=require('./miniprogram/file-reader/document/html-runtime/html-dom-shim').parseHtmlDocument('<div id="p"></div>').document;const css='#p{'+('padding:1px;padding-left:2px;padding:3px;').repeat(10000)+'}';const s=r.cascadeForElement(d.querySelector('div'),r.parseCssRules(css)).styles;a.deepEqual(Object.keys(s),['padding-left','padding']);a.equal(s.padding,'3px');`],{cwd:path.join(__dirname,'..'),timeout:5000})
})
