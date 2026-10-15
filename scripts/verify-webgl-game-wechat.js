'use strict'
// Private source remains local; this checks actual WXML controls and canvas pixels.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const compat=require('./miniprogram-automator-compat');compat.installAutomatorVersionCompatibility();require('./automator-deep-query').installAutomatorQueryCompatibility()
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
 const mp=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:'+compat.automationPortForProject(process.cwd())})
 try{
  console.log('CONNECTED');await pause(3000);console.log('RELAUNCH');await mp.reLaunch('/pages/index/index');console.log('PAGE');await pause(3000)
  const dir=path.resolve(process.argv[2]),name=fs.readdirSync(dir).find(n=>fs.statSync(path.join(dir,n)).size===10402231);assert.ok(name)
  mp.on('console',e=>console.log('CONSOLE '+JSON.stringify(e).slice(0,2000)))
  await mp.evaluate(({name,base64})=>{const bytes=wx.base64ToArrayBuffer(base64),p=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFileSync(p,bytes);getCurrentPages().at(-1).selectComponent('#reader').openSelectedFile({name,path:p,size:bytes.byteLength})},{name,base64:fs.readFileSync(path.join(dir,name)).toString('base64')})
  console.log('OPENED');const state=()=>mp.evaluate(()=>{const r=getCurrentPages().at(-1)?.selectComponent('#reader'),d=r?._htmlRuntime?.document;return {error:r?.data.error,errors:r?._runtimeErrors,ready:d?.getElementById('start-button')?.disabled===false,failure:d?.getElementById('error-screen')?.className,detail:d?.getElementById('error-message')?.textContent,hud:d?.getElementById('hud')?.className,speed:d?.getElementById('speed')?.textContent,raceTime:d?.getElementById('race-time')?.textContent,pressed:d?.querySelectorAll('[data-control]').map(n=>({action:n.dataset.control,class:n.className})),canvas:d?.querySelectorAll('canvas').map(n=>({id:n.id,nid:n._nid,rev:n._canvasState?.rev,webgl:!!n._captureWebGlPixels}))}})
  let loaded
  for(let i=0;i<60;i++){await pause(500);loaded=await state();if(loaded.ready||loaded.errors?.length||loaded.failure&&!loaded.failure.includes('hidden'))break}
  console.log('LOADED '+JSON.stringify(loaded));assert.ok(loaded.ready,'3D scene must finish initialization');assert.deepEqual(loaded.errors,[])
  await pause(1500);console.log('BEFORE PIXEL '+JSON.stringify(await state()))
  const pixel=await mp.evaluate(()=>new Promise(resolve=>{const r=getCurrentPages().at(-1).selectComponent('#reader'),n=r._htmlRuntime.document.querySelectorAll('canvas').find(n=>n._captureWebGlPixels);const native=r._htmlRuntime.nativeFrame(n._nid),raw=new Uint8ClampedArray(native.canvas.width*native.canvas.height*4);native.readPixels(raw);let nativeColored=0;for(let i=3;i<raw.length;i+=400)if(raw[i])nativeColored++;const q=r.createSelectorQuery();q.select('#dom-canvas-'+n._nid).fields({node:true},result=>{try{const c=result.node,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let colored=0;const colors=new Set();for(let i=0;i<d.length;i+=400){if(d[i+3])colored++;colors.add([d[i],d[i+1],d[i+2]].join(','))}resolve({width:c.width,height:c.height,colored,nativeColored,colors:colors.size})}catch(e){resolve({error:e.message})}});q.exec()}))
  console.log('PIXELS '+JSON.stringify(pixel));assert.ok(pixel.colored>10&&pixel.colors>4,'visible WXML canvas must contain a colored scene')
  if(process.argv.includes('--garage'))return
  const page=await mp.currentPage()
  const control=async selector=>{const nid=await mp.evaluate(s=>getCurrentPages().at(-1).selectComponent('#reader')._htmlRuntime.document.querySelector(s)._nid,selector);return page.$('#reader >>> #dom-nid-'+nid)}
  await(await control('#start-button')).tap();await pause(4000);const started=await state();console.log('STARTED '+JSON.stringify(started));assert.ok(!started.hud.includes('hidden'));assert.deepEqual(started.errors,[])
  const accelerate=await control('[data-control="accelerate"]'),turn=await control('[data-control="left"]')
  const center=async(el,id)=>{const o=await el.offset(),s=await el.size();console.log('CONTROL '+JSON.stringify({o,s,style:await el.attribute('style'),touch:await el.attribute('data-touch')}));return{identifier:id,clientX:Number(o.left)+Number(s.width)/2,clientY:Number(o.top)+Number(s.height)/2}}
  const gasPoint=await center(accelerate,0),leftPoint=await center(turn,1)
  const waitPressed=async(action,pressed)=>{for(let i=0;i<30;i++){const s=await state();if(s.pressed.find(n=>n.action===action).class.includes('pressed')===pressed)return s;await pause(200)}throw new Error(action+' touch state did not become '+pressed)}
  await accelerate.touchstart({touches:[gasPoint],changedTouches:[gasPoint]});await waitPressed('accelerate',true)
  await turn.touchstart({touches:[gasPoint,leftPoint],changedTouches:[leftPoint]});await waitPressed('left',true);await waitPressed('accelerate',true)
  await pause(1500);await turn.touchend({touches:[gasPoint],changedTouches:[leftPoint]});await waitPressed('left',false);await waitPressed('accelerate',true);await pause(4000)
  const driving=await state();console.log('DRIVING '+JSON.stringify(driving));await mp.screenshot({path:'outputs/hard-html/wechat-racing-driving.png'});assert.ok(Number(driving.speed)>0,'accelerator must move car');assert.deepEqual(driving.errors,[])
  await accelerate.touchend({touches:[],changedTouches:[gasPoint]})
  await waitPressed('accelerate',false)
  for(let i=0;i<3;i++){await pause(10000);const s=await state();assert.deepEqual(s.errors,[]);console.log('STEADY '+JSON.stringify(s))}
  fs.writeFileSync('outputs/hard-html/wechat-webgl-interactive.json',JSON.stringify({name,ready:true,multiTouch:true,speed:driving.speed,pixel,errors:[],physicalPhone:false},null,2))
 }finally{await mp.evaluate(()=>getCurrentPages().at(-1)?.selectComponent('#reader')?.disposeHtmlRuntime()).catch(()=>{});mp.disconnect()}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
