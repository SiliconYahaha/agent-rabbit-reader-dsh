'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {compactDomTreeForView,buildProgressiveDomPlan,buildDomPatchPlan,payloadBytes,DEFAULT_DOM_CHUNK_BYTES}=require('../miniprogram/file-reader/document/view-payload')
const {readerPage,applyUpdates,flush}=require('./helpers/reader-host')
function replay(initial,chunks){const state=structuredClone(initial);for(const patch of chunks){for(const a of Object.keys(patch))for(const b of Object.keys(patch))if(a!==b)assert.ok(!b.startsWith(a+'.')&&!b.startsWith(a+'['));applyUpdates(state,structuredClone(patch))}return state}
const contents=nodes=>(nodes||[]).map(n=>n.type==='text'?(n.textFragments?n.textFragments.map(p=>p.text).join(''):n.text):contents(n.children)).join('')
function nodes(text){return [{type:'element',name:'pre',nid:1,attrs:{style:'white-space:pre-wrap'},children:[{type:'text',nid:2,text}]}]}
for(const text of ['中文😀"\\\n\t'.repeat(20000),'Á 👩‍💻 🏳️‍🌈 🇨🇳 مرحبا\n'.repeat(10000),'x'.repeat(1300000)])test('text fragments preserve whole code points, quoted bytes and bounded delivery '+text.length,()=>{
 const c=compactDomTreeForView(nodes(text)),plan=buildProgressiveDomPlan(c.nodes)
 assert.equal(contents(c.nodes),text);assert.ok(plan.maxChunkBytes<=DEFAULT_DOM_CHUNK_BYTES)
 assert.deepEqual(replay({domTree:plan.initial},plan.chunks).domTree,c.nodes)
 for(const f of c.nodes[0].children[0].textFragments)assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(f.text))
})
test('large top-level shells and top-level text remain bounded in initial and later updates',()=>{
 const root=Array.from({length:5000},(_,i)=>({type:'element',name:'p',nid:i*2,attrs:{},children:[{type:'text',nid:i*2+1,text:'第'+i+'段😀'}]}))
 for(const value of [root,[{type:'text',nid:0,text:'中文🙂'.repeat(100000)}]]){
 const c=compactDomTreeForView(value),plan=buildProgressiveDomPlan(c.nodes,16384,0)
 assert.deepEqual(plan.initial,[]);assert.ok(plan.maxChunkBytes<=16384)
 assert.deepEqual(replay({domTree:plan.initial},plan.chunks).domTree,c.nodes)
 const next=buildDomPatchPlan({domTree:c.nodes},16384)
 assert.ok(next.maxChunkBytes<=16384);assert.deepEqual(next.oversizedFields,[])
 assert.deepEqual(replay({domTree:[]},next.chunks).domTree,c.nodes)
 }
})
test('long text cache reuses immutable pieces, prunes removed nodes and clears on close',()=>{
 const cache=new Map(),text='中文😀'.repeat(30000),original=nodes(text)
 const first=compactDomTreeForView(original,cache),second=compactDomTreeForView(original,cache)
 assert.equal(first.nodes[0].children[0].textFragments,second.nodes[0].children[0].textFragments)
 compactDomTreeForView(nodes('small'),cache);assert.equal(cache.size,0)
 const p=readerPage();p.parseContent('<pre>'+text+'</pre><script>window.ready=true</script>','cache.html')
 assert.ok(p._viewTextFragments.size>0);const ownerCache=p._viewTextFragments;p.detached();assert.equal(ownerCache.size,0);assert.equal(p._viewTextFragments,null)
})
test('actual long text updates stay bounded without replacing the outer tree or source identity',async()=>{
 const old='OLD 中文😀\n'.repeat(35000),next='NEXT Á 👩‍💻\n'.repeat(45000),p=readerPage()
 const snapshots=[],setData=p.setData
 p.setData=function(patch,callback){snapshots.push(structuredClone(patch));return setData.call(this,patch,callback)}
 p.parseContent('<pre id="source">'+old+'</pre><button id="update">更换</button><script>document.getElementById("update").addEventListener("click",function(){document.getElementById("source").textContent="NEXT Á 👩‍💻\\n".repeat(45000)})</script>','updates.html')
 assert.equal(p.data.error,'');const d=p._htmlRuntime.document,nid=d.getElementById('source')._nid,button=d.getElementById('update')
 const start=snapshots.length;p.onDomTap({currentTarget:{dataset:{nid:button._nid}}});await flush()
 assert.equal(d.getElementById('source')._nid,nid);assert.equal(d.getElementById('source').textContent,next)
 assert.equal(d.getElementById('update'),button);assert.deepEqual(p._runtimeErrors,[])
 assert.equal(contents(p.data.domTree).includes(next),true)
 for(const patch of snapshots){assert.ok(payloadBytes(patch)<=DEFAULT_DOM_CHUNK_BYTES,'oversized patch: '+payloadBytes(patch))}
 assert.ok(!snapshots.slice(start).some(patch=>Object.hasOwn(patch,'domTree')),'text updates should not replace control/Canvas siblings')
 p.detached()
})
test('a late old progressive callback cannot clear the new file rendering flag or replace its text',async()=>{
 let bytes;const fs={stat:o=>o.success({stats:{size:bytes.length}}),readFile:o=>o.success({data:bytes.subarray(o.position||0,o.length==null?bytes.length:(o.position||0)+o.length)})}
 const p=readerPage({getFileSystemManager:()=>fs}),callbacks=[],native=p.setData
 p.setData=function(updates,callback){native.call(this,updates);if(callback)callbacks.push(callback)}
 const open=(name,text)=>{bytes=Buffer.from('<pre>'+text+'</pre><script>window.ready=true</script>');p.openSelectedFile({name,path:'/fixture/'+name,size:bytes.length})}
 const startRender=async()=>{for(let i=0;i<200&&!p._progressiveDomRendering;i++){while(!p._progressiveDomRendering&&callbacks.length)callbacks.shift()();if(!p._progressiveDomRendering)await new Promise(r=>setTimeout(r,2))}}
 open('old.html','OLD\n'.repeat(120000));await startRender()
 assert.equal(p._progressiveDomRendering,true);const late=callbacks.shift();assert.ok(late)
 open('new.html','NEW 中文😀\n'.repeat(60000));await startRender()
 assert.equal(p._progressiveDomRendering,true);late();assert.equal(p._progressiveDomRendering,true)
 while(callbacks.length)callbacks.shift()()
 assert.equal(p.data.sourceName,'new.html');assert.equal(p.data.isLoading,false);assert.equal(p.data.error,'')
 assert.equal(contents(p.data.domTree),'NEW 中文😀\n'.repeat(60000));p.detached()
})
test('unchunkable large scalar controls retain their previous transport behavior and are explicitly reported',()=>{
 const source='x'.repeat(200000),plan=buildDomPatchPlan({'domTree[0].attrs.value':source})
 assert.deepEqual(plan.oversizedFields,['domTree[0].attrs.value'])
 assert.equal(replay({domTree:[{attrs:{value:''}}]},plan.chunks).domTree[0].attrs.value,source)
})

// Table layout creates a distinct positioned style for each cell. The style
// dictionary must be bounded too, not only the tree and text fragments.
test('large CSV delivers its complete style dictionary before bounded node patches', async()=>{
 const cells=Array.from({length:4096},(_,i)=>'CELL'+String(i).padStart(4,'0')+'|中文😀'),csv=Array.from({length:64},(_,r)=>cells.slice(r*64,(r+1)*64).join(',')).join('\n'),bytes=Buffer.from(csv),p=readerPage({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:bytes.length}}),readFile:o=>o.success({data:bytes.subarray(o.position||0,o.length==null?bytes.length:(o.position||0)+o.length)})})}),snapshots=[],native=p.setData
 p.setData=function(patch,callback){snapshots.push(structuredClone(patch));return native.call(this,patch,callback)}
 p.openSelectedFile({name:'large.csv',path:'/fixture/large.csv',size:bytes.length});await flush()
 assert.equal(p.data.error,'');assert.deepEqual(p._htmlRuntime.document.querySelectorAll('td').map(c=>c.textContent),cells)
 const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children||[])]),table=flatten(p.data.domTree).find(node=>node.nid===p._htmlRuntime.document.querySelector('table')._nid)
 assert.equal(contents([table]),cells.join(''))
 assert.ok(payloadBytes(p.data.domStyles)>DEFAULT_DOM_CHUNK_BYTES)
 for(const patch of snapshots)assert.ok(payloadBytes(patch)<=DEFAULT_DOM_CHUNK_BYTES,JSON.stringify({bytes:payloadBytes(patch),keys:Object.keys(patch)}))
 const state=replay({},snapshots);assert.deepEqual(state.domTree,p.data.domTree);assert.deepEqual(state.domStyles,p.data.domStyles);p.detached()
})
