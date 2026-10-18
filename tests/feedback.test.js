'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
function host(wx){global.wx=wx;let d;global.Component=x=>{d=x};const p=require.resolve('../miniprogram/file-reader/skin/feedback/feedback');delete require.cache[p];require(p);return {...d.methods,properties:{name:'Firefox.ai',diagnostic:'render · missing canvas'},data:{...d.data},setData(x){Object.assign(this.data,x)}}}
test('feedback opens the supplied official account only on user action, without copying or sending',()=>{
 const calls=[];const h=host({openOfficialAccountChat:o=>calls.push(o)});assert.equal(calls.length,0);h.contact();assert.equal(calls[0].username,'gh_b3d8d075cdd6');assert.deepEqual(Object.keys(calls[0]).sort(),['fail','username']);assert.equal(h.data.expanded,false)
})
test('failed or unavailable official chat falls back to profile then usable search instructions',()=>{
 let profile;const h=host({openOfficialAccountChat:o=>o.fail(),openOfficialAccountProfile:o=>{profile=o;o.fail()}});h.contact();assert.equal(profile.username,'gh_b3d8d075cdd6');assert.equal(h.data.expanded,true)
 const legacy=host({});legacy.contact();assert.equal(legacy.data.expanded,true)
 const throwing=host({openOfficialAccountChat(){throw Error('unsupported')}});throwing.contact();assert.equal(throwing.data.expanded,true)
})
test('explicit copy includes the file, build environment and diagnostic without sending',()=>{
 let text;const h=host({getAccountInfoSync:()=>({miniProgram:{envVersion:'trial'}}),setClipboardData:o=>{text=o.data}});h.copy();assert.match(text,/Firefox.ai/);assert.match(text,/1\.4\.159 · 体验版/);assert.match(text,/render · missing canvas/);assert.equal(require('../miniprogram/utils/build-info').version,require('../package.json').version)
})
