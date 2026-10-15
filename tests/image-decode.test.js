'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {readerPage,flush}=require('./helpers/reader-page'),{png}=require('./helpers/inline-poster')
const source=png()
function host(options={}){
  const requests=[],canvases=[]
  const factory=()=>{canvases.push(1);return{createImage:()=>{
    const image={width:options.width||2,height:options.height||3,set src(v){requests.push({image,value:v});if(!options.manual)queueMicrotask(()=>v==='data:image/png;base64,broken'||options.rejectData&&v.startsWith('data:')?image.onerror?.():image.onload?.())}}
    return image
  }}}
  return{factory,requests,canvases}
}
for(const mode of ['constructor','createElement','markup','innerHTML','clone'])test(`image ${mode} enters the actual decode chain and exposes natural dimensions`,async()=>{
  const h=host(),r=createRuntime(mode==='markup'?`<img id="picture" src="${source}">`:'<main></main>',{createOffscreenCanvas:h.factory})
  try{
    r.run();let image
    if(mode==='constructor')image=new r.window.Image(40,50)
    else if(mode==='markup')image=r.document.getElementById('picture')
    else if(mode==='innerHTML'){r.document.body.innerHTML=`<img src="${source}">`;image=r.document.querySelector('img')}
    else if(mode==='clone'){const original=r.document.createElement('img');original.src=source;image=original.cloneNode(true)}
    else image=r.document.createElement('img')
    let loaded=0;image.onload=()=>loaded++;if(!image.src)image.src=source
    const first=image.decode(),second=image.decode();assert.notEqual(first,second)
    assert.equal(image.complete,false);assert.equal(await first,undefined);await second;await flush()
    assert.equal(loaded,1);assert.equal(image.complete,true);assert.equal(image.currentSrc,source)
    assert.equal(image.naturalWidth,2);assert.equal(image.naturalHeight,3);assert.equal(image.width,mode==='constructor'?40:2)
    assert.equal(image.height,mode==='constructor'?50:3);assert.equal(h.canvases.length,1)
  }finally{r.destroy()}
})
test('source change cancels prior decode and ignores old native success/failure',async()=>{
  const h=host({manual:true}),r=createRuntime('',{createOffscreenCanvas:h.factory})
  const image=r.document.createElement('img');let loads=0;image.onload=()=>loads++
  image.src=source;const old=image.decode().catch(e=>e.name);await flush()
  const late=h.requests[0].image.onload,lateError=h.requests[0].image.onerror
  image.src=source+'AAAA';const current=image.decode();await flush()
  assert.equal(await old,'EncodingError');late();lateError();await flush();assert.equal(loads,0)
  h.requests[1].image.onload();await current;assert.equal(loads,1);assert.equal(image.currentSrc,source+'AAAA');r.destroy()
})
test('empty, corrupt, external, src removal and unavailable host settle as explicit errors',async()=>{
  for(const kind of ['empty','corrupt','external','remove','no-host']){
    const h=host({manual:kind==='remove'}),r=createRuntime('',kind==='no-host'?{}:{createOffscreenCanvas:h.factory})
    try{const image=new r.window.Image();let errors=0;image.onerror=()=>errors++
      if(kind!=='empty')image.src=kind==='corrupt'?'data:image/png;base64,broken':kind==='external'?'https://example.com/private.png':source
      const result=image.decode().catch(e=>e.name)
      if(kind==='remove')image.removeAttribute('src')
      assert.equal(await result,'EncodingError');await flush();assert.equal(image.complete,true);assert.equal(image.naturalWidth,0)
      if(kind==='external')assert.equal(h.requests.length,0)
      if(kind==='empty'||kind==='remove')assert.equal(errors,0);else assert.equal(errors,1)
    }finally{r.destroy()}
  }
})
test('document disposal rejects decode, releases handlers and blocks late event callbacks',async()=>{
  const h=host({manual:true}),r=createRuntime('',{createOffscreenCanvas:h.factory})
  const i=new r.window.Image();i.src=source;let loads=0;i.onload=()=>loads++;const pending=i.decode().catch(e=>e.name);await flush()
  const native=h.requests[0].image,late=native.onload;r.destroy();late();await flush()
  assert.equal(await pending,'EncodingError');assert.equal(loads,0);assert.equal(native.onload,null);assert.equal(i.naturalWidth,0)
})
test('hanging host and throwing onload are bounded, not silent waits or uncaught host errors',async()=>{
  const h=host({manual:true}),r=createRuntime('',{createOffscreenCanvas:h.factory,imageDecodeTimeout:10})
  const i=new r.window.Image();i.src=source;assert.equal(await i.decode().catch(e=>e.name),'EncodingError');r.destroy()
  const normal=host(),s=createRuntime(`<p></p><script>const i=document.createElement('img');i.onload=()=>{throw Error('callback sentinel')};i.src=${JSON.stringify(source)}</script>`,{createOffscreenCanvas:normal.factory})
  s.run();await flush();assert.ok(s.errors.some(e=>e.phase==='image:event'&&e.message==='callback sentinel'));s.destroy()
})
test('native host sees cached file path while author Image.src stays unchanged',async()=>{
  const h=host({rejectData:true}),writes=[]
  const page=readerPage({env:{USER_DATA_PATH:'/local'},createOffscreenCanvas:h.factory,getFileSystemManager:()=>({writeFile:o=>{writes.push(o);o.success()},unlink(){}})})
  try{page.openSelectedFile({name:'cached.html',inlineHtml:`<p id="result"></p><script>const i=document.createElement('img');i.onload=()=>document.getElementById('result').textContent=String(i.src===${JSON.stringify(source)});i.src=${JSON.stringify(source)}</script>`});await flush()
    assert.equal(page._htmlRuntime.document.getElementById('result').textContent,'true');assert.equal(writes.length,1)
    assert.ok(h.requests.every(r=>r.value.startsWith('/local/reader-inline-')))
    assert.deepEqual(Buffer.from(writes[0].data,'base64'),Buffer.from(source.split(',')[1],'base64'))
  }finally{page.disposeHtmlRuntime()}
})
test('image live pixels and repeated native allocations obey explicit limits',async()=>{
  const h=host({width:4096,height:4096}),r=createRuntime('',{createOffscreenCanvas:h.factory})
  const a=new r.window.Image(),b=new r.window.Image(),c=new r.window.Image()
  a.src=b.src=source;await Promise.all([a.decode(),b.decode()]);c.src=source
  assert.equal(await c.decode().catch(e=>e.name),'EncodingError');a.removeAttribute('src');c.removeAttribute('src');c.src=source;await c.decode()
  assert.equal(c.naturalWidth,4096);r.destroy()
  const small=host(),s=createRuntime('',{createOffscreenCanvas:small.factory})
  const outcomes=await Promise.all(Array.from({length:132},()=>{const image=new s.window.Image();image.src=source;return image.decode().then(()=>true,()=>false)}))
  assert.equal(outcomes.filter(Boolean).length,128);assert.equal(small.requests.length,128);assert.equal(small.canvases.length,1);s.destroy()
})
test('small inline images also become native local paths, and decoder waiter counts are bounded',async()=>{
  const {createInlineImageStore}=require('../miniprogram/file-reader/document/inline-image-store'),writes=[]
  const store=createInlineImageStore({writeFile:o=>{writes.push(o);o.success()},unlink(){}},'/local')
  const h=host({rejectData:true}),r=createRuntime('',{createOffscreenCanvas:h.factory,resolveImageSource:s=>store.resource(s,true)})
  const i=r.document.createElement('img');i.src='data:image/png;base64,AAAA';await i.decode()
  assert.equal(writes.length,1);assert.match(h.requests[0].value,/^\/local\/reader-inline-/);assert.equal(i.src,'data:image/png;base64,AAAA');r.destroy();store.dispose()
  const pendingHost=host({manual:true}),runtime=createRuntime('',{createOffscreenCanvas:pendingHost.factory})
  const image=new runtime.window.Image();image.src=source
  const promises=Array.from({length:128},()=>image.decode())
  assert.equal(await image.decode().catch(e=>e.name),'EncodingError');await flush();pendingHost.requests[0].image.onload()
  await Promise.all(promises);runtime.destroy()
})
