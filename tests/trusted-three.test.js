'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto'), acorn = require('acorn')
const base = '../miniprogram/file-reader/document/html-runtime/'
const { sha256 } = require(base + 'trusted-source-sha256')
const { substituteTrustedThree } = require(base + 'trusted-three')
const { createRuntime } = require(base + 'html-script-runtime')
const vendor = fs.readFileSync(require.resolve(base + 'vendor/three169'), 'utf8')
const official = vendor.slice(vendor.indexOf('const t="169"'), vendor.lastIndexOf('\n}'))
const source = 'const THREE=(()=>{' + official + '})();'
test('fingerprint matches independent SHA256 vectors', () => {
  for (const text of ['', 'abc', '中文🐇', 'a'.repeat(1000000)]) assert.equal(sha256(text), crypto.createHash('sha256').update(text).digest('hex'))
})
test('only exact official body and exports use the trusted library', () => {
  for (const [text, count] of [[source,1], [source.replace('const t="169"','const t="168"'),0], [source.replace('LEFT:0','LEFT:1'),0], [source.replace('ACESFilmicToneMapping:et','ACESFilmicToneMapping:t'),0], [source.replace('return {','return {extra: t,'),0]]) {
    assert.equal(substituteTrustedThree(acorn.parse(text,{ecmaVersion:'latest'}),text,()=>{}),count)
  }
})
test('trusted graphics primitives work but user code retains constructor and execution guards', () => {
 const r=createRuntime('<script>'+source+'window.answer=new THREE.Vector3(3,4,0).length();try{THREE.Vector3.constructor("return process")();window.escaped=true}catch(e){window.blocked=true}</script><script>while(true){}</script>')
 r.run();assert.equal(r.window.answer,5);assert.equal(r.window.blocked,true);assert.equal(r.window.escaped,undefined);assert.equal(r.errors.length,1);assert.match(r.errors[0].message,/initialization budget/);r.destroy()
})

test('first animation frame restores the ordinary execution limit after trusted initialization',()=>{
 const tasks=new Map();let next=0
 const r=createRuntime('<script>'+source+'for(let i=0;i<60000;i++){}requestAnimationFrame(()=>{for(let i=0;i<60000;i++){}window.unbounded=true})</script>',{setTimeout:(fn,ms)=>{tasks.set(++next,{fn,ms});return next},clearTimeout:id=>tasks.delete(id)})
 r.run();assert.deepEqual(r.errors,[]);const [id,t]=[...tasks].find(([,t])=>t.ms===16);tasks.delete(id);t.fn();assert.equal(r.window.unbounded,undefined);assert.match(r.errors[0].message,/execution budget/);r.destroy()
})

test('explicit host taps can initialize bounded geometry without raising animation or synthetic-click budgets',()=>{
 const tasks=new Map();let next=0
 const r=createRuntime('<button id="go">Go</button><script>'+source+'document.getElementById("go").onclick=()=>{for(let i=0;i<90000;i++){}window.clicked=true};requestAnimationFrame(()=>{})</script>',{setTimeout:(fn,ms)=>{tasks.set(++next,{fn,ms});return next},clearTimeout:id=>tasks.delete(id)})
 r.run();const frame=[...tasks].find(([,t])=>t.ms===16);tasks.delete(frame[0]);frame[1].fn();const n=r.document.getElementById('go')
 r.dispatchTap(n._nid);assert.equal(r.window.clicked,true);assert.deepEqual(r.errors,[])
 r.window.clicked=false;r.dispatchEvent(n._nid,'click',{});assert.equal(r.window.clicked,false);assert.match(r.errors.at(-1).message,/execution budget/)
 n.onclick=()=>{};r.destroy()
})
