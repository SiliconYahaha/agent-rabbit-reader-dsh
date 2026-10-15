'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events')
// Drive the CDP boundary with a deterministic clock. The second poll is in
// flight at the overall deadline, rather than ending between two polls.
function runner(failure){
 let now=0,next=0,polls=0,killed=false,closed=false
 const timers=new Map(),child=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.kill=()=>{killed=true}
 const enqueue=fn=>queueMicrotask(fn)
 class Socket {
  constructor(){this.events={};enqueue(()=>this.events.open?.({}))}
  addEventListener(name,fn){this.events[name]=fn}
  close(){closed=true}
  send(raw){const q=JSON.parse(raw);let result={}
   if(q.method==='Target.createTarget')result={targetId:'target'}
   if(q.method==='Target.attachToTarget')result={sessionId:'session'}
   if(q.method==='Runtime.evaluate'){
    if(++polls===2){
     if(failure==='deadline'){const id=next;enqueue(()=>{now=1000;const fn=timers.get(id);timers.delete(id);fn?.()})}
     else enqueue(()=>this.events.message({data:JSON.stringify({id:q.id,error:{message:'Unexpected protocol failure'}})}))
     return
    }
    result={result:{value:{done:false,html:'<output data-progress="expected never-ready fixture"></output>'}}}
   }
   enqueue(()=>this.events.message({data:JSON.stringify({id:q.id,result})}))
  }
 }
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/chrome-test-result'),'utf8'),{
  module,URL,WebSocket:Socket,Date:{now:()=>now},process:{env:{}},
  setTimeout(fn,delay){const id=++next;timers.set(id,fn);if(delay===50||delay===100)enqueue(()=>{if(timers.has(id)){timers.delete(id);now+=delay;fn()}});return id},clearTimeout:id=>timers.delete(id),
  require:id=>id==='node:fs'?{mkdtempSync:()=>'/fixture-profile'}:id==='node:os'?{tmpdir:()=>'/tmp'}:id==='node:path'?require(id):{spawn(){enqueue(()=>child.stderr.emit('data','DevTools listening on ws://127.0.0.1:1234/devtools/browser/fixture'));return child}}
 })
 return {run:()=>module.exports.chromeTestResult('http://127.0.0.1:1234/runner-hang',{timeoutMs:1000}),state:()=>({polls,killed,closed,timers:timers.size})}
}
test('in-flight deadline retains result-timeout diagnostics and closes only its test browser',async()=>{
 const r=runner('deadline')
 await assert.rejects(r.run(),error=>/Test Chrome result timed out: expected never-ready fixture/.test(error.message)&&error.dom.includes('data-progress')&&error.cause.message==='Test Chrome command timed out: Runtime.evaluate')
 assert.deepEqual(r.state(),{polls:2,killed:true,closed:true,timers:0})
})
test('unrelated evaluation errors remain failures and are never accepted as fixture timeout',async()=>{
 const r=runner('protocol')
 await assert.rejects(r.run(),error=>error.message==='Unexpected protocol failure'&&error.dom===undefined)
 assert.deepEqual(r.state(),{polls:2,killed:true,closed:true,timers:0})
})
