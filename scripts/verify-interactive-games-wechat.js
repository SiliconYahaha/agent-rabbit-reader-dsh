'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const compat=require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const root=path.resolve(__dirname,'..'),dir=path.resolve(process.argv[2]),pause=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
 const mp=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(root)})
 await pause(5000)
 await mp.reLaunch('/pages/index/index')
 for(let i=0;i<40;i++){if(await mp.evaluate(()=>!!getCurrentPages().at(-1)?.selectComponent('#reader')))break;await pause(250)}
 const out=[]
 mp.on('console', e=>console.log('GAME CONSOLE '+JSON.stringify(e).slice(0,3000)))
 try{
  const files=fs.readdirSync(dir).filter(n=>n.endsWith('.html')).map(name=>({name,size:fs.statSync(path.join(dir,name)).size})).filter(f=>(!process.argv.includes('--svg')&&f.size===10599326)||(!process.argv.includes('--canvas')&&f.size===124675)).sort((a,b)=>a.size-b.size)
  for(const f of files){
   console.log('Open '+f.name)
   await mp.evaluate(({name,base64})=>{const data=wx.base64ToArrayBuffer(base64),p=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(p,data);getCurrentPages().at(-1).selectComponent('#reader').openSelectedFile({name,path:p,size:data.byteLength})},{name:f.name,base64:fs.readFileSync(path.join(dir,f.name)).toString('base64')})
   await pause(3000)
   const page=await mp.currentPage()
   async function state(){return mp.evaluate(()=>{const r=getCurrentPages().at(-1).selectComponent('#reader'),d=r._htmlRuntime.document;return {gameErrors:r._capturedGameErrors,error:r.data.error,errors:r._runtimeErrors,home:d.getElementById('home-screen')?.getAttribute('display'),loading:d.getElementById('loading')?.className,loadText:d.getElementById('loadText')?.textContent,hud:d.getElementById('hud')?.className,svg:d.querySelector('svg')?.outerHTML,canvas:d.querySelectorAll('canvas').map(n=>({id:n.id,nid:n._nid,rev:n._canvasState?.rev}))}})}
   await mp.evaluate(()=>{const r=getCurrentPages().at(-1).selectComponent('#reader'),c=r._htmlRuntime.window.console,original=c.error;r._capturedGameErrors=[];c.error=(...args)=>{r._capturedGameErrors.push(args.map(a=>String(a?.message||a)).join(' '));original(...args)}})
   const before=await state()
   if(f.size===124675){
    const meta=await mp.evaluate(()=>{const r=getCurrentPages().at(-1).selectComponent('#reader'),d=r._htmlRuntime.document,n=d.getElementById('arcade');return{nid:n._nid,v:n.getAttribute('viewBox')}})
    const image=await page.$('#reader >>> #dom-nid-'+meta.nid);assert.ok(image,'SVG must be a real WXML image')
    const size=await image.size(),offset=await image.offset(),[vx,vy,vw,vh]=meta.v.split(/[\s,]+/).map(Number)
    const x=Number(offset.left)+(360-vx)/vw*Number(size.width),y=Number(offset.top)+(1025-vy)/vh*Number(size.height)
    console.log(JSON.stringify({meta,size,offset,x,y}))
    await image.trigger('tap',{x,y});await pause(500)
    const started=await state();assert.equal(started.home,'none','SVG image tap must reach start control')
    const touch=(identifier,sx,sy)=>({identifier,clientX:Number(offset.left)+(sx-vx)/vw*Number(size.width),clientY:Number(offset.top)+(sy-vy)/vh*Number(size.height)})
    const move=touch(0,240,1090),fire=touch(1,607,1060)
    await image.touchstart({touches:[move],changedTouches:[move]});await image.touchstart({touches:[move,fire],changedTouches:[fire]});await pause(1500)
    await image.touchend({touches:[move],changedTouches:[fire]});await image.touchend({touches:[],changedTouches:[move]})
    const played=await state();assert.notEqual(played.svg,started.svg,'battle must update');assert.deepEqual(played.errors,[])
    out.push({name:f.name,svgTap:true,multiTouch:true,errors:played.errors})
   }else{
    for(const id of ['enterBtn','startBtn']){const nid=await mp.evaluate(id=>getCurrentPages().at(-1).selectComponent('#reader')._htmlRuntime.document.getElementById(id)._nid,id);const el=await page.$('#reader >>> #dom-nid-'+nid);assert.ok(el,id+' WXML control');console.log(id+': '+JSON.stringify(await el.size()));await el.tap();await pause(500)}
    const playing=await state();console.log(JSON.stringify({before:{load:before.loadText,loading:before.loading},playing:{error:playing.error,errors:playing.errors,canvas:playing.canvas,hud:playing.hud}}))
    assert.deepEqual(playing.errors,[]);assert.equal(playing.error,'');assert.ok(!/hidden/.test(playing.hud),'HUD should be active')
    await pause(6000);const after=await state();console.log('AFTER '+JSON.stringify(after).slice(0,500));assert.deepEqual(after.errors,[]);assert.deepEqual(after.gameErrors,[]);await pause(2000);const later=await state();assert.deepEqual(later.gameErrors,[]);assert.ok(later.canvas.find(n=>n.id==='game').rev>after.canvas.find(n=>n.id==='game').rev,'Canvas must keep changing after renderer fallback')
    const pixels=await mp.evaluate(()=>new Promise(resolve=>{const r=getCurrentPages().at(-1).selectComponent('#reader'),n=r._htmlRuntime.document.getElementById('game');r.createSelectorQuery().select('#dom-canvas-'+n._nid).fields({node:true},v=>{try{const c=v.node,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();let colored=0;for(let i=0;i<d.length;i+=400){if(d[i+3])colored++;colors.add([d[i],d[i+1],d[i+2]].join(','))}resolve({width:c.width,height:c.height,colored,colors:colors.size})}catch(e){resolve({error:e.message})}}).exec()}))
    console.log('PIXELS '+JSON.stringify(pixels));assert.ok(pixels.colored>10&&pixels.colors>4,'visible Canvas scene must be colored')
    const joyNid=await mp.evaluate(()=>getCurrentPages().at(-1).selectComponent('#reader')._htmlRuntime.document.getElementById('joystick')._nid)
    const stick=await page.$('#reader >>> #dom-nid-'+joyNid),joySize=await stick.size(),joyOffset=await stick.offset();assert.ok(joySize.width>0&&joySize.height>0,'touch joystick must be visible')
    const joy={identifier:0,clientX:Number(joyOffset.left)+Number(joySize.width)*.8,clientY:Number(joyOffset.top)+Number(joySize.height)/2}
    const transform=()=>mp.evaluate(()=>getCurrentPages().at(-1).selectComponent('#reader')._htmlRuntime.document.getElementById('joystick').firstElementChild.style.transform)
    const waitTransform=async(check)=>{for(let i=0;i<30;i++){const t=await transform();if(check(t))return t;await pause(200)}throw new Error('joystick state did not settle')}
    await stick.touchstart({touches:[joy],changedTouches:[joy]});const initialJoy=await waitTransform(t=>/translate/.test(t))
    const moved={...joy,clientY:joy.clientY+Number(joySize.height)*.25};await stick.touchmove({touches:[moved],changedTouches:[moved]});await waitTransform(t=>t!==initialJoy)
    await stick.touchend({touches:[],changedTouches:[moved]});await waitTransform(t=>t==='')
    await mp.screenshot({path:'outputs/hard-html/wechat-canvas-playing.png'})
    for(let i=0;i<(process.argv.includes('--interaction-only')?0:6);i++){await pause(10000);const steady=await state();assert.deepEqual(steady.errors,[]);assert.deepEqual(steady.gameErrors,[]);console.log('RUNNING '+(i+1)*10+'s '+JSON.stringify(steady.canvas))}
    out.push({name:f.name,startTap:true,canvasContinues:true,joystickDrag:true,observedSeconds:process.argv.includes('--interaction-only')?8:68,pixels,errors:after.errors})
   }
   fs.writeFileSync(path.join(root,'outputs/hard-html/wechat-interactive.json'),JSON.stringify(out,null,2))
   await mp.evaluate(()=>getCurrentPages().at(-1).selectComponent('#reader').disposeHtmlRuntime())
  }
 }finally{mp.disconnect()}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
