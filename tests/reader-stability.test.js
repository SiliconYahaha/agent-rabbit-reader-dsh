'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {readerPage,flush,loadDesignPreviewHost}=require('./helpers/reader-host')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const react=`const React={Fragment:Symbol.for('fragment'),StrictMode:Symbol.for('strict'),__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:{ReactCurrentDispatcher:{current:null}}};
for(const name of ['useState','useEffect','useRef'])React[name]=(...args)=>React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current[name](...args);
const h=(type,props,key)=>({type,props:props||{},key}),ReactDOM={createRoot(){throw Error('not native')}};`
function open(source){const r=createRuntime('<div id="root"></div><script>'+react+source+'ReactDOM.createRoot(document.getElementById("root")).render(h(React.StrictMode,{children:h(App)}));</script>');r.run();assert.deepEqual(r.errors,[]);return r}
function tap(r,id){r.dispatchTap(r.document.getElementById(id)._nid);r.flush();assert.deepEqual(r.errors,[])}

test('React state changes preserve host/text/image identities and do not accumulate event listeners',async()=>{
  const r=open(`function App(){const[n,set]=React.useState(0);return h('main',{children:[h('img',{id:'image',src:'data:image/png;base64,AAAA'}),h('button',{id:'count',onClick:()=>set(n+1),children:String(n)}),h('input',{id:'draft'})]})}`)
  try{const nodes=r.document.querySelectorAll('*').map(n=>n._nid),button=r.document.getElementById('count'),text=button.firstChild,draft=r.document.getElementById('draft');draft.value='unsaved';
    for(let i=0;i<5;i++)tap(r,'count');await flush();assert.equal(button.textContent,'5');assert.equal(button.firstChild,text);assert.equal(draft.value,'unsaved');assert.deepEqual(r.document.querySelectorAll('*').map(n=>n._nid),nodes)
  }finally{r.destroy()}
})
test('keyed rows keep node and hook state on reorder; removed components clean effects and reset state',()=>{
  const r=open(`window.cleanups=0;function Row({id}){const[n,set]=React.useState(0);React.useEffect(()=>()=>window.cleanups++,[]);return h('button',{id,onClick:()=>set(n+1),children:id+':'+n})}
  function App(){const[flip,F]=React.useState(false),[show,S]=React.useState(true);return h('div',{children:[h('button',{id:'flip',onClick:()=>F(!flip)}),h('button',{id:'show',onClick:()=>S(!show)}),show?(flip?['b','a']:['a','b']).map(id=>h(Row,{id},id)):null]})}`)
  try{tap(r,'a');const a=r.document.getElementById('a');tap(r,'flip');assert.equal(r.document.getElementById('a'),a);assert.equal(a.textContent,'a:1');tap(r,'show');assert.equal(r.window.cleanups,2);tap(r,'show');assert.equal(r.document.getElementById('a').textContent,'a:0')}finally{r.destroy()}
})
test('local React updates remove obsolete attributes/styles and refresh callbacks without rewriting inner HTML',()=>{
  const r=open(`function App(){const[n,set]=React.useState(0);return h('div',{children:[h('button',{id:'go',title:n?'':'old',style:n?{color:'blue'}:{color:'red',padding:12},onClick:()=>set(n+1),children:String(n)}),h('div',{id:'html',dangerouslySetInnerHTML:{__html:'<b>stable</b>'}})]})}`)
  try{const child=r.document.getElementById('html').firstChild;tap(r,'go');assert.equal(r.document.getElementById('html').firstChild,child);const b=r.document.getElementById('go');assert.equal(b.style.color,'blue');assert.equal(b.style.padding,'');tap(r,'go');assert.equal(b.textContent,'2')}finally{r.destroy()}
})

test('scroll gestures cannot activate links but a new deliberate tap still can',()=>{
  const p=readerPage(),calls=[];p._htmlRuntime={getNode:()=>({localName:'a'}),dispatchTap:n=>calls.push(n)};const point=y=>({clientX:80,clientY:y});
  p.onReaderTouchStart({touches:[point(300)]});p.onReaderTouchMove({touches:[point(100)]});p.onReaderTouchEnd({changedTouches:[point(100)]});p.onDomTap({currentTarget:{dataset:{nid:1}}});assert.deepEqual(calls,[])
  p.onReaderTouchStart({touches:[point(100)]});p.onReaderTouchEnd({changedTouches:[point(101)]});p.onDomTap({currentTarget:{dataset:{nid:1}}});assert.deepEqual(calls,[1])
})
test('bubbling native touch is bridged once and flushing a drag does not block the next drag',async()=>{
  const p=readerPage(),calls=[];p._htmlRuntime={getNode:()=>({localName:'div'}),dispatchEvent:(...args)=>calls.push(args)}
  const event={timeStamp:42,currentTarget:{dataset:{nid:1,touch:true}},changedTouches:[{identifier:0,clientX:10,clientY:20}]}
  p.dispatchDomTouch(event,'start');p.dispatchDomTouch({...event,currentTarget:{dataset:{nid:2,touch:true}}},'start');assert.equal(calls.filter(x=>x[1]==='touchstart').length,1)
  p.onDomTouchMove({...event,timeStamp:43});p.flushPendingDomMove();assert.equal(p._domMoveTimer,null);p.onDomTouchMove({...event,timeStamp:44});await flush();assert.equal(calls.filter(x=>x[1]==='touchmove').length,2)
})
test('native scroll updates geometry without requesting another scroll; measured anchor has no doubled offset',()=>{
  const actions=[],r=createRuntime('<button id="go">go</button><section id="wall"></section><script>window.seen=0;window.addEventListener("scroll",()=>window.seen=window.scrollY);go=document.getElementById("go");go.onclick=()=>window.scrollTo({top:document.getElementById("wall").offsetTop-64,behavior:"smooth"})</script>',{onHostAction:a=>actions.push(a)})
  try{r.run();const wall=r.document.getElementById('wall');wall._layoutDocumentTop=1000;wall._layoutRect={top:1000,left:0,width:100,height:200};r.syncViewportScroll(400);assert.equal(r.window.seen,400);assert.equal(wall.getBoundingClientRect().top,600);assert.deepEqual(actions,[]);r.dispatchTap(r.document.getElementById('go')._nid);assert.deepEqual(actions,[{type:'scroll-position',top:936,left:0,behavior:'smooth'}])}finally{r.destroy()}
})
function queueApp(){return{globalData:{fileQueue:[{name:'one.html',inlineHtml:'<p>one</p>'},{name:'broken.ai',path:''},{name:'three.html',inlineHtml:'<p>three</p>'}],fileQueueIndex:1,pendingFilePreview:{name:'broken.ai',path:''}}}}
test('missing design path still shows queue and allows moving to the next HTML, not home',()=>{
  const app=queueApp(),routes=[];const {host:p}=loadDesignPreviewHost({redirectTo:o=>routes.push(o.url)},app);
  p.onLoad();assert.ok(p.data.error);assert.equal(p.data.file,null);assert.equal(p.data.queueCount,3);assert.equal(p.data.queuePosition,2);assert.equal(p.data.hasNextFile,true);p.openNextFile();assert.deepEqual(routes,['/pages/index/index']);assert.equal(app.globalData.fileQueueIndex,2);assert.equal(app.globalData.pendingMaterial.name,'three.html')
})
test('reader resumes a consumed pending file from its queue; failed design navigation preserves next file',()=>{
  const app=queueApp();app.globalData.fileQueueIndex=0;app.globalData.pendingFilePreview=null;const routes=[];const p=readerPage({redirectTo:o=>{routes.push(o.url);o.fail({errMsg:'route failure'})}});global.getApp=()=>app;
  try{p.host.onLoad();p.host.onShow();assert.match(p._htmlRuntime.document.body.textContent,/one/);p.host.openNextFile();assert.ok(p.data.error);assert.equal(p.data.isLoading,false);assert.equal(p.host.data.queuePosition,2);p.host.openNextFile();assert.match(p._htmlRuntime.document.body.textContent,/three/);assert.equal(p.host.data.queuePosition,3);assert.deepEqual(routes,[])}finally{p.host.onUnload()}
})
test('late native viewer failure cannot overwrite the following HTML',()=>{
  let fail;const p=readerPage({openDocument:o=>{fail=o.fail}});try{p.openSelectedFile({name:'old.pdf',path:'/old.pdf'});p.openSelectedFile({name:'new.html',inlineHtml:'<p>new</p>'});fail({errMsg:'late'});assert.equal(p.data.error,'');assert.equal(p.data.sourceName,'new.html')}finally{p.host.onUnload()}
})
test('a broken design file error does not survive into the following queue item',()=>{
  const app=queueApp(),p=readerPage({redirectTo:()=>{throw new Error('design files must not leave the reader')}});global.getApp=()=>app;
  try{p.openSelectedFile(app.globalData.fileQueue[1]);assert.match(p.data.error,/设计文件路径/);p.host.openNextFile();assert.equal(p.data.error,'');assert.equal(p.host.data.queuePosition,3);assert.equal(p.data.sourceName,'three.html');assert.match(p._htmlRuntime.document.body.textContent,/three/)}finally{p.host.onUnload()}
})
test('both queue bars reserve a non-wrapping counter and explicit compact native buttons',()=>{
  for(const name of ['index/index','file-preview/file-preview']){const root=path.join(__dirname,'../miniprogram/pages/',name),w=fs.readFileSync(root+'.wxml','utf8'),css=require('./helpers/read-wxss')(root+'.wxss');assert.equal((w.match(/button size="mini" class="queue-button"/g)||[]).length,2);assert.match(w,/\{\{queuePosition\}\}\/\{\{queueCount\}\}/);assert.match(css,/\.queue-position\s*\{[^}]*white-space:\s*nowrap/s);assert.match(css,/\.file-queue \.queue-button\s*\{[^}]*flex:\s*0 0 152rpx/s)}
})

test('embedded SVG uses the same native-safe base64 presentation as standalone SVG, without changing author DOM',()=>{
  const p=readerPage();try{p.openSelectedFile({name:'svg.html',inlineHtml:'<div><svg viewBox="0 0 300 420"><rect width="300" height="420" fill="red"/><text y="40">牛来 海报</text><script>bad()</script></svg></div>'});assert.equal(p.data.error,'');
    const flatten=ns=>ns.flatMap(n=>[n,...flatten(n.children||[])]),image=flatten(p.data.domTree).find(n=>n.name==='img');assert.match(image.attrs.src,/^data:image\/svg\+xml;base64,/);const svg=Buffer.from(image.attrs.src.split(',')[1],'base64').toString();assert.match(svg,/牛来 海报/);assert.doesNotMatch(svg,/<script/);assert.ok(p._htmlRuntime.document.querySelector('svg'))
  }finally{p.host.onUnload()}
})

test('scaled document keeps its measured height on state updates and unchanged render does not resend the tree',()=>{
  const p=readerPage({getWindowInfo:()=>({windowWidth:390,windowHeight:844})});try{
    p.openSelectedFile({name:'wide.html',inlineHtml:'<div style="width:840px"><button id="go">0</button></div><script>document.getElementById("go").onclick=function(){this.textContent=Number(this.textContent)+1}</script>'});
    assert.match(p.data.domFrameStyle,/scale\(/);const measured=p.data.domClipStyle+';height:400px';p.data.domClipStyle=measured;
    p.onDomTap({currentTarget:{dataset:{nid:p._htmlRuntime.document.getElementById('go')._nid}}});p._htmlRuntime.flush();assert.equal(p.data.domClipStyle,measured);
    p.patches.length=0;p.renderDomState(p._htmlRuntime.renderState(),390);assert.ok(!p.patches.some(patch=>Object.keys(patch).some(key=>/^dom/.test(key))));
  }finally{p.host.onUnload()}
})

test('native media load and error stay on the resource and do not rerun page initialization', () => {
  const p = readerPage()
  try {
    p.openSelectedFile({ name: 'resource-events.html', inlineHtml: `<div id="root"></div><script>
      window.starts=0;window.resourceEvents=[];window.parentEvents=[];
      window.addEventListener('load',function(){
        window.starts++;
        document.getElementById('root').innerHTML='<img id="picture"><button id="action">ready</button>';
        const picture=document.getElementById('picture');
        for(const type of ['load','error'])picture.addEventListener(type,function(event){
          event.preventDefault();window.resourceEvents.push([type,event.bubbles,event.cancelable,event.defaultPrevented,event.target.id]);
        });
      });
      for(const type of ['load','error'])document.getElementById('root').addEventListener(type,function(){window.parentEvents.push(type)});
    </script>` })
    const r = p._htmlRuntime, image = r.document.getElementById('picture'), button = r.document.getElementById('action')
    assert.equal(r.window.starts, 1)
    p.onDomMediaLoad({ currentTarget: { dataset: { nid: image._nid } }, detail: {} })
    p.onDomMediaError({ currentTarget: { dataset: { nid: image._nid } }, detail: { errMsg: 'decode failed' } })
    assert.equal(r.window.starts, 1)
    assert.equal(r.document.getElementById('action'), button)
    assert.deepEqual(r.window.parentEvents, [])
    assert.deepEqual(r.window.resourceEvents, [['load', false, false, false, 'picture'], ['error', false, false, false, 'picture']])
    assert.deepEqual(r.errors, [])
  } finally { p.host.onUnload() }
})
