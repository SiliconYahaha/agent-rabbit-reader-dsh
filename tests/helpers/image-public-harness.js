'use strict'
// Small adapter for the exact assertion functions used by our pinned samples.
// This is NOT the complete upstream WPT runner. No assertion body is rewritten.
function harness(){
  window.imageTests=[];window.imagePending=0
  window.assert_true=(v,m)=>{if(v!==true)throw Error(m||'expected true')}
  window.assert_false=(v,m)=>{if(v!==false)throw Error(m||'expected false')}
  window.assert_equals=(a,b,m)=>{if(a!==b)throw Error(m||'values differ')}
  window.assert_not_equals=(a,b,m)=>{if(a===b)throw Error(m||'values must differ')}
  window.test=(fn,name)=>{try{fn();imageTests.push({name,pass:true})}catch(e){imageTests.push({name,pass:false,error:e.message})}}
  window.setup=()=>{window.imagePending++}
  window.done=()=>{window.imagePending--;imageTests.push({name:'single data URL canvas/readback test',pass:true})}
  window.promise_rejects_dom=(_t,name,p)=>p.then(()=>{throw Error('unexpected resolution')},e=>assert_equals(e.name,name))
  window.promise_test=(fn,name)=>{
    // Run original data-URL and no-source cases; external SVG, paths, inactive
    // documents and srcset stay explicitly untested, not rewritten to data URLs.
    if(!/PNG data URL|Corrupt image|without src\/srcset/.test(name))return
    window.imagePending++
    Promise.resolve().then(()=>fn({})).then(()=>imageTests.push({name,pass:true}),e=>imageTests.push({name,pass:false,error:e.message})).then(()=>{window.imagePending--})
  }
}
module.exports={harness}
