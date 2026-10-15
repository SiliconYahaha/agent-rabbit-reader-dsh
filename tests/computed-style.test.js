'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {parseHtmlDocument}=require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const {createComputedStyleReader,colorValue}=require('../miniprogram/file-reader/document/css-computed-style')
const {cases,htmlFor,visualHtml}=require('./helpers/computed-style')
const find=(nodes,id)=>{for(const n of nodes){if(n.attrs?.id===id)return n;const c=find(n.children||[],id);if(c)return c}}
test('computed-style loads named colors with a JS-only WeChat-style module loader', () => {
  const filename = path.join(__dirname, '../miniprogram/file-reader/document/css-computed-style.js')
  const realRequire = require('node:module').createRequire(filename)
  const module = { exports: {} }
  require('node:vm').runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require (id) {
      const resolved = realRequire.resolve(id)
      assert.equal(path.extname(resolved), '.js', `WeChat runtime cannot require ${id}`)
      return realRequire(id)
    }
  }, { filename })
  assert.equal(module.exports.colorValue('rebeccapurple'), 'rgb(102, 51, 153)')
  assert.equal(module.exports.colorValue('lightgoldenrodyellow'), 'rgb(250, 250, 210)')
})
test('all generated and extracted public computed-style interactions return exact content',()=>{
  for(const c of cases){const rt=createRuntime(htmlFor(c));try{rt.run();assert.deepEqual(rt.errors,[],c.name);assert.equal(rt.document.getElementById('result').textContent,c.expected,c.name)}finally{rt.destroy()}}
})
test('upstream CSSOM sources and licenses keep their fixed original bytes',()=>{
  const hashes={'computed-style-001.html':'6462a55380ecb5bfa2a727f98b1ae8bdf1e684e5678e863f3abcfeabd4089605','computed-style-set-property.html':'510a1df70e7f51d7563853c277710de7aa63f2073f31b3313ffd5e6fc9ba46ea','getComputedStyle-detached-subtree.html':'84dfc9e089cf67bf6652c78b475628daea128d09ac94ae7fcbcdf8e6381b6a88','LICENSE.md':'5fac07febb0e2a97fb0d7b0def149ec08b642e1ba4b9c345283ab1cbd2af6570'}
  for(const [name,hash]of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/computed-style',name))).digest('hex'),hash,name)
})
test('real sandbox tap reads stylesheet state then updates visible width and color',()=>{
  const rt=createRuntime(visualHtml)
  try{rt.run();assert.equal(rt.document.getElementById('result').textContent,'green / 200px');assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid),true);assert.equal(rt.document.getElementById('result').textContent,'blue / 240px');const state=rt.renderState(),node=find(renderHtmlDomTree(rt.document,{styles:state.styles}).nodes,'probe');assert.match(node.attrs.style,/color:blue/);assert.match(node.attrs.style,/width:240px/);assert.deepEqual(rt.errors,[])}finally{rt.destroy()}
})
test('head style edits change render keys and output, not only getComputedStyle return values',()=>{
  const rt=createRuntime('<head><style id="sheet">#probe{color:green}</style></head><body><p id="probe">正文</p></body>')
  try{rt.run();const before=rt.renderState();rt.document.getElementById('sheet').textContent='#probe{color:blue}';const after=rt.renderState();assert.notEqual(before.key,after.key);assert.match(find(renderHtmlDomTree(rt.document,{styles:after.styles}).nodes,'probe').attrs.style,/color:blue/);assert.doesNotMatch(JSON.stringify(renderHtmlDomTree(rt.document,{styles:after.styles}).nodes),/style.*#probe/)}finally{rt.destroy()}
})
test('styles outside an explicit body remain in source order and script-addressable',()=>{
  const p=parseHtmlDocument('<style id="first">p{color:red}</style><body><p id="probe">正文</p></body><style id="last">p{color:green}</style>')
  assert.equal(p.document.getElementById('first').parentNode,p.document.head);assert.equal(p.document.getElementById('last').parentNode,p.document.body)
  assert.deepEqual(p.styles,['p{color:red}','p{color:green}']);const read=createComputedStyleReader(p.document,()=>p.styles);assert.equal(read(p.document.getElementById('probe')).color,'rgb(0, 128, 0)')
})
test('computed declarations are read-only, live and enumerate custom properties without invalid entries',()=>{
  const p=parseHtmlDocument('<style>#p{--valid:green;--invalid:var(--invalid);color:green}</style><p id="p"></p>'),read=createComputedStyleReader(p.document,()=>p.styles),el=p.document.getElementById('p'),s=read(el)
  assert.ok([...s].includes('--valid'));assert.ok(![...s].includes('--invalid'));assert.equal(s.item(-1),'');assert.equal(s.getPropertyPriority('color'),'');assert.equal(s.cssText,'');assert.equal(s.parentRule,null)
  for(const action of [()=>{s.color='red'},()=>s.setProperty('color','red'),()=>s.removeProperty('color'),()=>{s.cssText='color:red'}])assert.throws(action,{name:'NoModificationAllowedError',code:7})
  assert.equal(el.getAttribute('style'),null);assert.equal(s.color,'rgb(0, 128, 0)');el.remove();assert.equal(s.length,0);assert.equal(s.color,'')
})
test('computed style resource policy blocks remote URLs and executable CSS',()=>{
  const p=parseHtmlDocument('<style>#p{color:expression(alert(1));background-image:url(https://invalid.example/private);--url:url(https://invalid.example/private)}</style><p id="p"></p>'),s=createComputedStyleReader(p.document,()=>p.styles)(p.document.getElementById('p'))
  assert.equal(s.color,'rgb(0, 0, 0)');assert.doesNotMatch(s.getPropertyValue('background-image')+s.getPropertyValue('--url'),/https|expression/)
})
test('color serialization covers named colors, alpha, HSL and rejects non-CSS extra names',()=>{
  assert.equal(colorValue('rebeccapurple'),'rgb(102, 51, 153)');assert.equal(colorValue('#0000'),'rgba(0, 0, 0, 0)');assert.equal(colorValue('hsl(.5turn 100% 50% / 25%)'),'rgba(0, 255, 255, 0.25)');assert.equal(colorValue('burntsienna'),null)
})
test('repeated style reads are cached; excessive ancestor depth fails within an isolated budget',()=>{
  const {execFileSync}=require('node:child_process')
  const code=`const a=require('node:assert/strict'),{parseHtmlDocument}=require('./miniprogram/file-reader/document/html-runtime/html-dom-shim'),{createComputedStyleReader}=require('./miniprogram/file-reader/document/css-computed-style');const p=parseHtmlDocument('<style>p{color:green}</style>'+'<p>正文</p>'.repeat(10000));let reads=0;const read=createComputedStyleReader(p.document,()=>{reads++;return p.styles}),el=p.document.querySelector('p'),s=read(el);for(let i=0;i<20000;i++)a.equal(s.color,'rgb(0, 128, 0)');a.equal(reads,1);el.style.color='blue';a.equal(s.color,'rgb(0, 0, 255)');a.equal(reads,2);const deep=parseHtmlDocument('<div>'.repeat(300)+'<p id="p">正文</p>'+'</div>'.repeat(300));a.throws(()=>createComputedStyleReader(deep.document,()=>deep.styles)(deep.document.getElementById('p')).color,/depth/);`
  execFileSync(process.execPath,['-e',code],{cwd:path.join(__dirname,'..'),timeout:5000})
})
