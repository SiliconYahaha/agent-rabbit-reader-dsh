'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {readerPage,flush}=require('../tests/helpers/reader-page'),{chromeTestResult}=require('./chrome-test-result')
const out=process.argv[3]||fs.mkdtempSync(path.join(os.tmpdir(),'reader-stability-'))
const flatten=nodes=>nodes.flatMap(n=>[n,...flatten(n.children||[])])
const waitFrame=()=>new Promise(resolve=>setTimeout(resolve,35))
async function main(){
  fs.mkdirSync(out,{recursive:true})
  const samples=[]
  for(const fill of ['#db3820','#256f9c','#79608e']){
    const source=`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="${fill}"/><circle cx="70" cy="40" r="25" fill="#efd985"/><text x="8" y="28" font-size="18" font-family="sans-serif" fill="black">牛来 SVG</text></svg>`
    const p=readerPage();try{p.openSelectedFile({name:'poster.html',inlineHtml:source});assert.equal(p.data.error,'');const image=flatten(p.data.domTree).find(n=>n.name==='img');assert.match(image.attrs.src,/^data:image\/svg\+xml;base64,/);samples.push({native:'data:image/svg+xml,'+encodeURIComponent(source),reader:image.attrs.src})}finally{p.host.onUnload()}
  }
  const originals=[]
  if(process.argv[2])for(const name of ['牛来宇宙-Vol.01.html','牛来-glm 5.2.html']){
    const source=fs.readFileSync(path.join(process.argv[2],name),'utf8'),scrollRequests=[],p=readerPage({getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),pageScrollTo:request=>scrollRequests.push(request)})
    try{
      p.openSelectedFile({name,inlineHtml:source});await flush();await waitFrame();await flush();assert.equal(p.data.error,'');const d=p._htmlRuntime.document,before=d.querySelectorAll('*').map(n=>n._nid),button=d.querySelectorAll('button').find(n=>/随机/.test(n.textContent));assert.ok(button)
      p.onDomTap({currentTarget:{dataset:{nid:button._nid}}});await flush();await waitFrame();await flush();const retained=d.querySelectorAll('*').filter(n=>before.includes(n._nid)).length;assert.equal(retained,before.length,'unchanged original nodes must survive opening an overlay')
      assert.deepEqual(p._htmlRuntime.errors,[]);const images=flatten(p.data.domTree).filter(n=>n.name==='img');assert.ok(images.length>=50);assert.ok(images.every(n=>/^data:image\/svg\+xml;base64,/.test(n.attrs.src)))
      let originalSvgComparisons=0,inlineSvgDecodeChecks=0
      for(const image of images){const node=p._htmlRuntime.getNode(image.nid),original=node&&node.getAttribute('src');if(/^data:image\/svg\+xml,/i.test(original||'')){samples.push({native:original,reader:image.attrs.src});originalSvgComparisons++}else{assert.equal(node.tagName,'SVG');samples.push({native:null,reader:image.attrs.src});inlineSvgDecodeChecks++}}
      assert.equal(originalSvgComparisons+inlineSvgDecodeChecks,images.length)
      assert.ok(name.includes('Vol.01')?originalSvgComparisons>=40:inlineSvgDecodeChecks>=40)
      ;['home','wall','archive','universe','timeline','fun','submit'].forEach((id,index)=>{const section=d.getElementById(id);if(section)section._layoutDocumentTop=index*700})
      for(const scrollTop of [0,720,1420,2120,2820,3520,4220,3520,2820,2120,1420,720,0]){p.onPageScroll({scrollTop});await waitFrame();await flush()}
      assert.deepEqual(scrollRequests,[],'native scrolling must not trigger a scripted jump');assert.deepEqual(p._htmlRuntime.errors,[])
      const retainedAfterScroll=d.querySelectorAll('*').filter(n=>before.includes(n._nid)).length;assert.equal(retainedAfterScroll,before.length)
      originals.push({name,sha256:crypto.createHash('sha256').update(source).digest('hex'),nodes:before.length,retained,retainedAfterScroll,images:images.length,originalSvgComparisons,inlineSvgDecodeChecks,scrollRequests:scrollRequests.length,errors:[],wholeTreePatches:p.patches.filter(x=>x.domTree).length})
    }finally{p.host.onUnload()}
  }
  const queueStyles=['index/index','file-preview/file-preview'].map(name=>fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name+'.wxss'),'utf8'))
  async function browserRun(samples,styles){
    const results=[]
    const pixels=async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data,colors=new Set();let visible=0;for(let j=0;j<data.length;j+=4){if(data[j+3]){visible++;if(colors.size<100)colors.add(data[j]+','+data[j+1]+','+data[j+2])}}return{width:c.width,height:c.height,visible,colors:colors.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('')}}
    for(const s of samples)results.push({native:s.native?await pixels(s.native):null,reader:await pixels(s.reader)})
    const queues=[]
    for(let route=0;route<styles.length;route++)for(const width of [320,360,390,430]){
      const frame=document.createElement('iframe');frame.style=`width:${width}px;height:250px;border:0`;
      const css=styles[route].replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px')
      frame.srcdoc=`<style>body{margin:0}button{width:100%;padding:8px;box-sizing:border-box}button[size=mini]{display:inline-block;width:auto}${css}</style><view class="file-queue"><button size="mini" class="queue-button">上一份</button><text class="queue-position">10/10</text><button size="mini" class="queue-button">下一份</button></view>`
      await new Promise(resolve=>{frame.onload=resolve;document.body.appendChild(frame)})
      const d=frame.contentDocument,bar=d.querySelector('.file-queue'),counter=d.querySelector('.queue-position'),buttons=Array.from(d.querySelectorAll('button')),rect=counter.getBoundingClientRect(),font=parseFloat(frame.contentWindow.getComputedStyle(counter).fontSize)
      queues.push({route,width,oneLine:rect.height<=font*1.2,noOverflow:bar.scrollWidth<=bar.clientWidth,compact:buttons.every(b=>b.getBoundingClientRect().width<width*.25),counterWidth:rect.width});frame.remove()
    }
    document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify({pixels:results,queues})))
  }
  const html=`<!doctype html><output></output><script>(${browserRun})(${JSON.stringify(samples)},${JSON.stringify(queueStyles)}).catch(e=>document.querySelector('output').setAttribute('data-error',e.message))</script>`
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'");res.end(html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}/`);fs.writeFileSync(path.join(out,'browser-dom.html'),dom);const encoded=dom.match(/data-result="([^"]+)"/);assert.ok(encoded,(dom.match(/data-error="([^"]+)"/)||[])[1]);const browser=JSON.parse(decodeURIComponent(encoded[1]));for(const row of browser.pixels){if(row.native)assert.deepEqual(row.reader,row.native);else assert.ok(row.reader.visible>0,'inline SVG, including monochrome icons, must decode to visible pixels; not an original-page pixel comparison')}assert.equal(browser.queues.length,8);assert.ok(browser.queues.every(r=>r.oneLine&&r.noOverflow&&r.compact));const report={checkedAt:new Date().toISOString(),originals,browser,wechat:'not verified; queue browser check uses native-button CSS approximation, not WXML'};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
  }finally{server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
