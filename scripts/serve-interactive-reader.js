'use strict'
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {bundle}=require('./verify-inline-poster')
const dir=path.resolve(process.argv[2]),names=fs.readdirSync(dir).filter(n=>n.endsWith('.html'))
async function start(){
 const {createRuntime}=readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
 const {renderHtmlDomTree}=readerRequire('miniprogram/file-reader/document/document-renderer.js')
 const html=await(await fetch('/source'+location.search)).text(),root=document.getElementById('view'),map=new Map()
 const factory=cfg=>{const c=document.createElement('canvas');c.width=cfg.width;c.height=cfg.height;c.createImage=()=>new Image();return c}
 let runtime
 const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
 function patch(parent,nodes){
  const live=[]
  for(const n of nodes||[]){
   const key=n.type==='text'?null:n.nid
   let e=key?map.get(key):null
   const tag=n.type==='text'?'span':n.name==='slider'?'input':n.name
   if(!e){e=document.createElement(tag);if(key)map.set(key,e)}
   if(n.type==='text'){e.textContent=n.text;if(n.tapNid)e.dataset.nid=n.tapNid}
   else{
    e.dataset.nid=n.nid
    for(const name of e.getAttributeNames())if(name!=='data-nid'&&name!=='style'&&!Object.hasOwn(n.attrs||{},name))e.removeAttribute(name)
    for(const [k,v]of Object.entries(n.attrs||{})){if(!/^on/.test(k)&&e.getAttribute(k)!==String(v))e.setAttribute(k,String(v))}
    if(n.name==='canvas'){e.style.cssText=n.canvasStyle.replace(/position:absolute;left:0;top:0;width:100%;height:100%;/,'')+';width:100%;height:auto';if(e.width!==n.canvas.width)e.width=n.canvas.width;if(e.height!==n.canvas.height)e.height=n.canvas.height}
    else if(n.name==='img'){e.style.height='auto';e.style.maxWidth='100%'}
    if(n.name==='input')e.value=n.attrs.value||''
    if(n.name!=='canvas'&&n.name!=='img')patch(e,n.children)
   }
   live.push(e)
  }
  for(let i=0;i<live.length;i++)if(parent.childNodes[i]!==live[i])parent.insertBefore(live[i],parent.childNodes[i]||null)
  for(const e of [...parent.childNodes])if(!live.includes(e))e.remove()
 }
 function paint(items){for(const item of items||[]){const e=map.get(item.nid),source=runtime.nativeCanvas(item.nid);if(e&&source&&source.width&&source.height){if(e.width!==source.width)e.width=source.width;if(e.height!==source.height)e.height=source.height;const c=e.getContext('2d');c.clearRect(0,0,e.width,e.height);c.drawImage(source,0,0)}}}
 function render(state){const view=renderHtmlDomTree({document:runtime.document,styles:state.styles},{viewportWidth:390});root.style.cssText=view.wrapperStyle;patch(root,view.nodes);paint(state.canvases)}
 runtime=createRuntime(html,{viewportWidth:390,viewportHeight:844,directCanvasFrames:true,createOffscreenCanvas:factory,onRender:state=>render(state),onCanvas:paint})
 window.readerRuntime=runtime
 const target=e=>{const host=e.target.closest('[data-nid]');if(!host)return null;const nid=Number(host.dataset.nid),n=runtime.getNode(nid);return n?.localName==='svg'?runtime.pointTarget(nid,{clientX:e.clientX,clientY:e.clientY},host.getBoundingClientRect()):nid}
 root.addEventListener('click',e=>{const nid=target(e);if(nid)runtime.dispatchTap(nid)})
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])root.addEventListener(type,e=>{const nid=target(e);if(!nid)return;e.preventDefault();if(type==='pointerdown')e.target.closest('[data-nid]').setPointerCapture(e.pointerId);runtime.dispatchEvent(nid,type,{pointerId:e.pointerId,pointerType:'touch',button:e.button,buttons:e.buttons,clientX:e.clientX,clientY:e.clientY})})
 window.addEventListener('pagehide',()=>runtime.destroy());runtime.run()
}
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1')
 if(u.pathname==='/bundle'){res.setHeader('Content-Type','text/javascript');res.end(bundle());return}
 if(u.pathname==='/source'){const n=u.searchParams.get('name');if(!names.includes(n)){res.writeHead(404);res.end();return}res.setHeader('Content-Type','text/plain;charset=utf-8');res.end(fs.readFileSync(path.join(dir,n)));return}
 if(u.pathname!=='/'){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:390px;overflow-x:hidden}#view{width:390px}img{display:block}*{box-sizing:border-box}</style><div id="view"></div><script src="/bundle"></script><script>('+start.toString()+')().catch(e=>document.body.textContent=e.stack)</script>')
}).listen(18725,'127.0.0.1',()=>console.log('http://127.0.0.1:18725/'))
