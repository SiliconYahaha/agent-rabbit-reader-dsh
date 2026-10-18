'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {createAudioRuntime}=require('../miniprogram/file-reader/document/html-runtime/audio-runtime')
const {decodedAudioBytes}=require('../miniprogram/file-reader/document/html-runtime/audio-size')
const pause=()=>new Promise(r=>setTimeout(r,10))
function wav(seconds=1){const rate=8000,n=rate*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b}
function fakeContext(){const events=[],nodes=[];const param=()=>({value:1,setTargetAtTime(v){this.value=v},setValueAtTime(v){this.value=v},exponentialRampToValueAtTime(v){this.value=v}})
 const node=()=>{const n={gain:param(),frequency:param(),detune:param(),buffer:null,loop:false,connect(){events.push('connect')},disconnect(){events.push('disconnect')},start(){events.push('start')},stop(){events.push('stop')}};nodes.push(n);return n}
 const ctx={state:'running',sampleRate:48000,currentTime:0,destination:node(),createGain:node,createOscillator:node,createBufferSource:node,createBiquadFilter:node,createBuffer(c,n,rate){return{length:n,numberOfChannels:c,sampleRate:rate,duration:n/rate,getChannelData:()=>new Float32Array(n)}},decodeAudioData(){events.push('decode');return Promise.resolve(this.createBuffer(1,48000,48000))},resume(){events.push('resume');this.state='running';return Promise.resolve()},suspend(){events.push('suspend');this.state='suspended';return Promise.resolve()},close(){events.push('close');this.state='closed';return Promise.resolve()}}
 return{ctx,events,nodes}
}
test('real pixel buffer grants enough work for a 256-square grain, ordinary and explicit limits remain bounded',()=>{
 const html='<canvas id="c"></canvas><script>const a=document.getElementById("c").getContext("2d").createImageData(256,256);for(let i=0;i<a.data.length;i+=4)a.data[i]=123;window.done=a.data[262140]</script>'
 for(const [options,pass]of[[{},true],[{maxExecutionSteps:50},false]]){const r=createRuntime(html,options);try{r.run();assert.equal(r.window.done===123,pass);assert.equal(r.errors.length===0,pass)}finally{r.destroy()}}
 const r=createRuntime('<canvas id="c"></canvas><script>document.getElementById("c").getContext("2d").createImageData(256,256);while(true){}</script>');try{r.run();assert.match(r.errors[0].message,/pixel processing budget/)}finally{r.destroy()}
})
test('pixel grant expires before later callbacks; parentElement follows document ownership',async()=>{
 const r=createRuntime('<main><canvas id="c"></canvas></main><script>window.parent=document.getElementById("c").parentElement.tagName;document.getElementById("c").getContext("2d").createImageData(256,256);setTimeout(()=>{while(true){}},5)</script>');try{r.run();await pause();assert.equal(r.window.parent,'MAIN');assert.match(r.errors[0].message,/execution budget/);assert.equal(r.document.documentElement.parentElement,null)}finally{r.destroy()}
})
test('embedded audio uses real graph, pauses in background and closes every context on disposal',async()=>{
 const f=fakeContext();let gesture=true
 const a=createAudioRuntime({createContext:()=>f.ctx,isGesture:()=>gesture,call:fn=>fn()});const c=new a.AudioContext(),el=new a.Audio();el.src='data:audio/wav;base64,'+wav().toString('base64');const source=c.createMediaElementSource(el),gain=c.createGain();source.connect(gain);gain.connect(c.destination);gain.gain.setTargetAtTime(.42,0,.4);assert.equal(gain.gain.value,.42)
 await el.play();assert.equal(el.readyState,4);assert.equal(el.paused,false);assert.equal(f.events.filter(x=>x==='decode').length,1);assert.ok(f.events.includes('start'))
 a.setVisible(false);assert.equal(f.ctx.state,'suspended');a.setVisible(true);assert.equal(f.ctx.state,'running');el.pause();assert.equal(el.paused,true)
 gesture=false;await assert.rejects(el.play(),/gesture/);a.destroy();assert.equal(f.ctx.state,'closed');assert.throws(()=>c.createGain(),/closed/);assert.equal(c.destination.constructor,undefined)
})
test('remote, malformed and over-budget audio never reach native decoding',async()=>{
 for(const source of ['https://example.com/a.mp3','wxfile://secret.mp3','data:audio/wav;base64,YWJj','data:audio/wav;base64,'+wav(360).toString('base64')]){const f=fakeContext(),a=createAudioRuntime({createContext:()=>f.ctx,isGesture:()=>true,call:fn=>fn()});try{const el=new a.Audio(source);await assert.rejects(el.play());assert.ok(!f.events.includes('decode'))}finally{a.destroy()}}
 assert.throws(()=>decodedAudioBytes(Buffer.alloc(10)),/Unsupported|Invalid/)
 const b=wav();b.writeUInt32LE(0xffffffff,40);assert.throws(()=>decodedAudioBytes(b),/Truncated/)
})
test('closing or changing file while decode is pending cannot restart playback',async()=>{
 const f=fakeContext();let done;f.ctx.decodeAudioData=()=>new Promise(r=>{done=r});const a=createAudioRuntime({createContext:()=>f.ctx,isGesture:()=>true}),el=new a.Audio('data:audio/wav;base64,'+wav().toString('base64'));const playing=el.play();await pause();a.destroy();done(f.ctx.createBuffer(1,48000,48000));await playing;assert.ok(!f.events.includes('start'))
})
test('native audio allocation and foreign node connections are bounded',()=>{
 const f=fakeContext(),a=createAudioRuntime({createContext:()=>f.ctx,isGesture:()=>true});try{const c=new a.AudioContext();assert.throws(()=>c.createBuffer(2,50000000,48000),/limit/);assert.throws(()=>c.createGain().connect({}),/Foreign/);assert.equal(c.constructor,undefined)}finally{a.destroy()}
})
test('game sound onended cleans whole graph across 400 shots and disposal stops disconnected sources',()=>{
 const f=fakeContext(),a=createAudioRuntime({createContext:()=>f.ctx,isGesture:()=>true,call:fn=>fn()});const c=new a.AudioContext();let ended=0
 try {
  for(let i=0;i<400;i++){
   const voice=c.createOscillator(),gain=c.createGain(),filter=c.createBiquadFilter();voice.connect(gain);gain.connect(filter);filter.connect(c.destination)
   voice.onended=()=>{ended++;gain.disconnect();filter.disconnect()};voice.start();voice.stop();f.nodes[f.nodes.length-3].onended()
  }
  assert.equal(ended,400)
  const voice=c.createOscillator(),native=f.nodes.at(-1);voice.start();voice.disconnect();voice.onended=()=>ended++
  const before=f.events.filter(x=>x==='stop').length;a.destroy();assert.ok(f.events.filter(x=>x==='stop').length>before);native.onended();assert.equal(ended,400)
 }finally{a.destroy()}
})
