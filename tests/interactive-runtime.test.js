'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {svgHitTest}=require('../miniprogram/file-reader/document/svg-hit-test')
test('animation runs beyond lifetime timer allowance; hide, resume, cancel and destroy stop scheduling',()=>{
 const tasks=new Map();let next=0
 const r=createRuntime('<script>window.frames=0;function tick(){frames++;requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>',{setTimeout:(fn,ms)=>{tasks.set(++next,{fn,ms});return next},clearTimeout:id=>tasks.delete(id)})
 const frame=()=>{const row=[...tasks].find(([,t])=>t.ms===16);assert.ok(row);tasks.delete(row[0]);row[1].fn()}
 r.run();for(let i=0;i<600;i++)frame();assert.equal(r.window.frames,600);assert.deepEqual(r.errors,[])
 r.setVisible(false);assert.equal([...tasks.values()].some(t=>t.ms===16),false)
 r.setVisible(true);frame();assert.equal(r.window.frames,601)
 r.destroy();assert.equal([...tasks.values()].some(t=>t.ms===16),false)
})
test('animation keeps a per-frame execution guard and bounds queued callbacks',()=>{
 const tasks=new Map();let next=0
 const r=createRuntime('<script>requestAnimationFrame(()=>{requestAnimationFrame(()=>{});while(true){}})</script>',{maxExecutionSteps:100,setTimeout:(fn,ms)=>{tasks.set(++next,{fn,ms});return next},clearTimeout:id=>tasks.delete(id)})
 r.run();const [id,t]=[...tasks].find(([,t])=>t.ms===16);tasks.delete(id);t.fn();assert.match(r.errors[0].message,/execution budget/);assert.equal([...tasks.values()].some(t=>t.ms===16),false);r.destroy()
})
test('SVG hit routing respects viewBox, translated buttons, overlap and hidden overlays',()=>{
 const r=createRuntime('<svg viewBox="0 0 400 200"><g transform="translate(100 50)"><rect id="button" width="100" height="60"/></g><g display="none"><rect id="hidden" width="400" height="200"/></g></svg>');r.run()
 const root=r.document.querySelector('svg'),rect={left:10,top:20,width:200,height:100}
 assert.equal(svgHitTest(root,85,60,rect).id,'button');assert.equal(svgHitTest(root,15,25,rect),root)
 r.document.getElementById('hidden').parentNode.removeAttribute('display');assert.equal(svgHitTest(root,85,60,rect).id,'hidden');r.destroy()
})
test('pointer capture routes simultaneous releases outside original SVG child',()=>{
 const r=createRuntime('<svg><rect id="a"/><rect id="b"/></svg><script>window.log=[];for(const n of document.querySelectorAll("rect")){n.onpointerdown=e=>n.setPointerCapture(e.pointerId);n.onpointerup=e=>log.push(n.id+e.pointerId)}</script>');r.run()
 const a=r.document.getElementById('a'),b=r.document.getElementById('b'),root=r.document.querySelector('svg')
 r.dispatchEvent(a._nid,'pointerdown',{pointerId:1});r.dispatchEvent(b._nid,'pointerdown',{pointerId:2});r.dispatchEvent(root._nid,'pointerup',{pointerId:2});r.dispatchEvent(root._nid,'pointerup',{pointerId:1})
 assert.deepEqual(r.window.log,['b2','a1']);assert.equal(a.hasPointerCapture(1),false);assert.equal(b.hasPointerCapture(2),false);r.destroy()
})
test('replaceWith supports fresh canvas, self, adjacent siblings and detached nodes',()=>{
 const r=createRuntime('<div id="box"><canvas id="a"></canvas><span id="b"></span><i id="c"></i></div>');r.run();const d=r.document,a=d.getElementById('a'),b=d.getElementById('b'),c=d.getElementById('c'),box=d.getElementById('box')
 a.replaceWith(a,b,'text');assert.deepEqual(box.childNodes.map(n=>n.id||n.textContent),['a','b','text','c']);b.replaceWith(c);assert.deepEqual(box.childNodes.map(n=>n.id||n.textContent),['a','c','text']);b.replaceWith('ignored');r.destroy()
})
test('WebGL exposes extension methods and precision fields, unwraps textures, and reports unavailable contexts honestly',()=>{
 const calls=[],resource={},gl={getExtension:()=>({UNMASKED_RENDERER_WEBGL:77,ping:x=>x+1}),getShaderPrecisionFormat:()=>({rangeMin:127,rangeMax:127,precision:23}),createTexture:()=>resource,bindTexture:(n,v)=>calls.push(v),getParameter:()=> 'test GPU'}
 const r=createRuntime('<canvas id="c"></canvas><script>const g=document.getElementById("c").getContext("webgl2");window.result=[g.getExtension("debug").ping(2),g.getShaderPrecisionFormat(1,2).precision,g.canvas.id];g.bindTexture(1,g.createTexture())</script>',{createOffscreenCanvas:config=>{assert.equal(config.type,'webgl2');return {width:300,height:150,getContext:name=>name==='webgl2'?gl:null}}});r.run();assert.deepEqual(r.errors,[]);assert.deepEqual(r.window.result,[3,23,'c']);assert.equal(calls[0],resource);r.destroy()
 const no=createRuntime('<canvas id="c"></canvas>');no.run();assert.equal(no.document.getElementById('c').getContext('webgl'),null);no.destroy()
})
test('direct native Canvas has a bounded shared 64M pixel pool including WebGL and frees it on close',()=>{
 const surfaces=[],r=createRuntime('',{directCanvasFrames:true,createOffscreenCanvas:config=>{const canvas={...config,getContext:()=>({})};surfaces.push(canvas);return canvas}});r.run()
 const make=type=>{const n=r.document.createElement('canvas');n.width=4096;n.height=4096;return {n,context:n.getContext(type)}}
 const a=make('webgl'),b=make('2d'),c=make('2d'),d=make('webgl');assert.ok(a.context&&d.context);assert.throws(()=>make('2d'),/像素/)
 a.n.width=0;assert.ok(make('webgl').context);assert.equal(make('webgl').context,null);assert.throws(()=>make('2d'),/像素/)
 r.destroy();assert.ok(surfaces.every(c=>c.width===0&&c.height===0))
})
test('script layout reads stylesheet viewport dimensions before its first canvas resize',()=>{
 const r=createRuntime('<style>#game{height:100dvh;width:100vw}</style><main id="game"></main><script>const g=document.getElementById("game");window.size=[g.clientWidth,g.clientHeight]</script>',{viewportWidth:390,viewportHeight:844});r.run();assert.deepEqual(r.window.size,[390,844]);r.destroy()
})


test('native touch fallback preserves two fingers and releases missing changedTouches',()=>{
 const {readerPage}=require('./helpers/reader-host'),p=readerPage(),r=createRuntime('<button id="a"></button><button id="b"></button><script>window.events=[];for(const b of document.querySelectorAll("button")){b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);events.push(b.id+"down"+e.pointerId)};b.onpointerup=e=>events.push(b.id+"up"+e.pointerId)}</script>');r.run();p._htmlRuntime=r
 const a=r.document.getElementById('a'),b=r.document.getElementById('b'),one={identifier:0,clientX:10,clientY:20},two={identifier:1,clientX:50,clientY:20}
 const send=(n,phase,touches,timeStamp,changedTouches=[])=>p.dispatchDomTouch({currentTarget:{dataset:{nid:n._nid,touch:true}},touches,changedTouches,timeStamp},phase)
 send(a,'start',[one],1);send(b,'start',[one,two],2);send(b,'start',[one,two],2);send(b,'end',[one],3);send(a,'end',[],4)
 assert.deepEqual(r.window.events,['adown1','bdown2','bup2','aup1']);assert.equal(r.document._pointerCaptures.size,0);assert.equal(p._domActiveTouches.size,0);r.destroy()
})


test('touch media queries reveal mobile controls consistently in script and rendered CSS',()=>{
 const {mediaQueryMatches}=require('../miniprogram/file-reader/document/media-query'),{renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
 assert.equal(mediaQueryMatches('(pointer:coarse) and (hover:none)',390),true)
 assert.equal(mediaQueryMatches('(pointer:fine)',390),false)
 assert.equal(mediaQueryMatches('(any-pointer:fine)',390,{pointer:'fine',hover:'hover'}),true)
 const r=createRuntime('<style>#stick{display:none}@media(pointer:coarse){#stick{display:block}}</style><div id="stick"></div><script>window.touch=matchMedia("(pointer:coarse)").matches</script>');r.run();assert.equal(r.window.touch,true)
 const view=renderHtmlDomTree({document:r.document,styles:r.renderState().styles});assert.match(view.nodes.find(n=>n.attrs?.id==='stick').attrs.style,/display:block/);r.destroy()
})
