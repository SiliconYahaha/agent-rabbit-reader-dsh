'use strict'
// Optional third-party input stays local; only our harness is committed.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { bundle } = require('./verify-inline-poster'), { chromeTestResult } = require('./chrome-test-result')
const input = process.argv[2] || path.join(__dirname, '../test-materials/files/web-candidates/koi-pond/锦鲤唱片机-离线版.html')
const out = process.argv[3] || path.join(__dirname, '../outputs/koi-compatibility')
fs.mkdirSync(out, { recursive: true })
const original = fs.readFileSync(input, 'utf8')
assert.ok(original.includes('function buildGrain()') && original.includes('fishes.length'))
// Observation only: expose authored coordinates/state without changing drawing,
// events, initialization, audio or the original file on disk.
const source = original.replace('      })();', 'window.__koiProbe=()=>({cx,cy,R,fish:fishes.length,rain:{ready:rainEl.readyState,paused:rainEl.paused,error:rainEl.error||null},arm:{...arm},head:armHead(arm.delta),vol:{...vol},rst:{...rst},audio:audio?{state:audio.ctx.state,gain:audio.master.gain.value}:null});\n      })();')
async function check () {
  const { createRuntime } = readerRequire('miniprogram/file-reader/document/html-runtime/html-script-runtime.js')
  const source = await (await fetch('/source')).text(), rows = []
  const pause = ms => new Promise(r => setTimeout(r, ms))
  for (const [width, height] of [[390,844], [844,390]]) {
    let frames = 0
    const runtime = createRuntime(source, { directCanvasFrames: true, viewportWidth: width, viewportHeight: height, devicePixelRatio: 1,
      createAudioContext: () => new AudioContext(),
      createOffscreenCanvas: config => { const c=document.createElement('canvas');c.width=config.width;c.height=config.height;c.createImage=()=>new Image();return c },
      onCanvas: () => frames++
    })
    try {
      const start = performance.now();runtime.run();const initializationMs = Math.round(performance.now()-start)
      await pause(300)
      if (runtime.errors.length) throw Error(JSON.stringify(runtime.errors))
      const canvas=runtime.document.getElementById('c'), probe=runtime.window.__koiProbe()
      const native=runtime.nativeCanvas(canvas._nid)
      if(!native)throw Error('No native canvas')
      const data=native.getContext('2d').getImageData(0,0,native.width,native.height).data
      const colors=new Set();for(let i=0;i<data.length;i+=4)if(colors.size<1000)colors.add(data[i]+','+data[i+1]+','+data[i+2])
      if(colors.size<100)throw Error('Canvas has no varied visible artwork')
      const before=probe.fish
      const point=(type,x,y)=>runtime.dispatchEvent(canvas._nid,type,{pointerId:1,pointerType:'touch',clientX:x,clientY:y})
      point('pointerdown',probe.cx+probe.R*.6,probe.cy);point('pointerup',probe.cx+probe.R*.6,probe.cy)
      await pause(100)
      if(runtime.window.__koiProbe().fish!==before+1)throw Error('Tap did not add a fish')
      const p=runtime.window.__koiProbe(),head=p.head
      point('pointerdown',head.x,head.y)
      const target=p.arm.baseAng+p.arm.sign*(p.arm.min*.6+p.arm.rest*.4)
      point('pointermove',p.arm.px+Math.cos(target)*p.arm.len,p.arm.py+Math.sin(target)*p.arm.len)
      point('pointerup',p.arm.px+Math.cos(target)*p.arm.len,p.arm.py+Math.sin(target)*p.arm.len)
      await pause(100)
      const after=runtime.window.__koiProbe()
      if(!Number.isFinite(after.arm.delta)||Math.abs(after.arm.delta-p.arm.delta)<.001)throw Error('Tonearm did not move')
      const snapshot=native.toDataURL()
      runtime.setVisible(false);await pause(50);const pausedFrames=frames;await pause(100)
      if(frames!==pausedFrames)throw Error('Background frame loop did not stop')
      runtime.setVisible(true);await pause(100)
      if(runtime.errors.length)throw Error(JSON.stringify(runtime.errors))
      rows.push({width,height,initializationMs,colors:colors.size,fishBefore:before,fishAfter:after.fish,tonearmBefore:p.arm.delta,tonearmAfter:after.arm.delta,frames,errors:runtime.errors,snapshot})
    } finally {runtime.destroy()}
  }
  document.querySelector('output').setAttribute('data-result',encodeURIComponent(JSON.stringify(rows)))
}
const code=bundle(),server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle'?'text/javascript':'text/html; charset=utf-8');if(req.url==='/bundle')res.end(code);else if(req.url==='/source')res.end(source);else res.end(`<output></output><script src="/bundle"></script><script>(${check})().catch(e=>document.querySelector('output').setAttribute('data-error',e.stack))</script>`)})
;(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const dom=await chromeTestResult(`http://127.0.0.1:${server.address().port}`,{timeoutMs:60000});fs.writeFileSync(path.join(out,'result-dom.html'),dom);const m=dom.match(/data-result="([^"]+)"/);assert.ok(m,dom.match(/data-error="([^"]+)"/)?.[1]);const rows=JSON.parse(decodeURIComponent(m[1]));for(const row of rows){fs.writeFileSync(path.join(out,`reader-${row.width}.png`),Buffer.from(row.snapshot.split(',')[1],'base64'));delete row.snapshot}fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2))}finally{server.close()}})().catch(e=>{console.error(e.message);process.exitCode=1})
