'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const {createRuntime} = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {renderHtmlDomTree} = require('../miniprogram/file-reader/document/document-renderer')
const {resolveLength} = require('../miniprogram/file-reader/document/css-length')
const find = (nodes, id) => { for (const n of nodes) { if (n.attrs?.id === id) return n; const c = find(n.children || [], id); if (c) return c } }
const render = r => renderHtmlDomTree(r.document, {styles:r.renderState().styles, viewportWidth:390, viewportHeight:673})
test('the shipped HTML sample changes both theme and toggle label on each click', () => {
  const r = createRuntime(fs.readFileSync(require.resolve('../html-css-js-local-test.html'),'utf8'), {viewportWidth:390,viewportHeight:673})
  try {
    r.run(); const toggle = r.document.getElementById('themeToggle')
    assert.ok(toggle)
    for (const dark of [true,false,true,false]) {
      r.dispatchTap(toggle._nid)
      assert.equal(r.document.documentElement.classList.contains('theme-dark'),dark)
      assert.equal(toggle.textContent, dark?'切换浅色模式':'切换深色模式')
      const page = render(r)
      assert.match(page.wrapperStyle, dark?/background:#0f172a/:/#f5f7fb/)
    }
    assert.deepEqual(r.errors,[])
  } finally {r.destroy()}
})
test('gradient text retains authored white while known light surfaces still gain readable contrast', () => {
  const page = renderHtmlDomTree('<style>body{color:#eee;background:#111}.hero{background:linear-gradient(120deg,#121433,#543a99);color:white}.glass{background:rgba(255,255,255,.1)}.paper{background:#fff;color:#eee}</style><section class="hero" id="hero"><p id="glass" class="glass">White on gradient</p></section><p id="paper" class="paper">Readable paper</p>')
  assert.match(find(page.nodes,'hero').attrs.style,/color:white/)
  assert.doesNotMatch(find(page.nodes,'glass').attrs.style,/color:rgb/)
  assert.doesNotMatch(find(page.nodes,'paper').attrs.style,/color:#eee(?:;|$)/)
})
test('percentage root heights and viewport min expressions preserve a landscape game in portrait', () => {
  const r=createRuntime('<style>html,body{height:100%}#app{width:min(100vw,177.7778vh);height:min(56.25vw,100vh);container-type:inline-size}#label{font-size:3cqw}</style><div id="app"><span id="label">Play</span></div>',{viewportWidth:390,viewportHeight:673})
  try {r.run();assert.equal(r.window.getComputedStyle(r.document.body).height,'673px');assert.equal(r.window.getComputedStyle(r.document.getElementById('app')).height,'219.375px');const page=render(r);assert.match(page.wrapperStyle,/height:673px/);assert.match(find(page.nodes,'label').attrs.style,/font-size:11\.7px/)}finally{r.destroy()}
  assert.equal(resolveLength('MIN(100vw, calc(100vh - 20px))',{vw:3.9,vh:6.73}),390)
  assert.equal(resolveLength('clamp(12px, 3vw, 18px)',{vw:5}),15)
  assert.equal(resolveLength('calc(10px + invalid)',{}),null)
})
test('canvas layout keeps fixed/absolute placement and hidden state without breaking normal canvas aspect ratio', () => {
  const result=renderHtmlDomTree('<style>#full{position:fixed;inset:0;height:100%;width:100%;z-index:1}#hidden{display:none}</style><canvas id="full"></canvas><canvas id="hidden"></canvas><canvas id="normal" width="240" height="120"></canvas>',{viewportWidth:390,viewportHeight:673})
  const full=find(result.nodes,'full'),hidden=find(result.nodes,'hidden'),normal=find(result.nodes,'normal')
  assert.match(full.canvasBoxStyle,/position:fixed/);assert.match(full.canvasBoxStyle,/inset:0/);assert.match(full.canvasBoxStyle,/height:100%/);assert.equal(full.canvasSizerStyle,'position:relative;height:100%')
  assert.match(hidden.canvasBoxStyle,/display:none/);assert.match(normal.canvasSizerStyle,/padding-top:50%/)
})
