'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {rtfToText}=require('../miniprogram/file-reader/engine/core/rtf-reader')
const {wrap,pair,cases,malformed}=require('./helpers/rtf-alternatives')
test('RTF upr selects Unicode exactly once across nesting, fonts, destinations and fallback',()=>{
  for(const c of cases){assert.equal(rtfToText(c.source),c.expected,c.name);assert.equal(rtfToText(Buffer.from(c.source)),c.expected,c.name+' bytes')}
})
test('RTF malformed Unicode alternatives stop instead of returning partial ANSI body',()=>{
  for(const c of malformed)assert.throws(()=>rtfToText(c.source),/RTF/,c.name)
})
test('RTF alternative scopes do not leak discarded global font data or hidden destinations',()=>{
  for(const c of cases.filter(c=>/hidden|font|scope/.test(c.name)))assert.equal(rtfToText(c.source),c.expected,c.name)
  assert.equal(rtfToText(wrap('A{\\*\\unknown{\\upr{one}}}Z')),'AZ')
})
test('RTF large discarded alternatives use bounded runs and existing group depth budget',()=>{
  const {spawnSync}=require('node:child_process')
  const r=spawnSync(process.execPath,['-e',`const a=require('node:assert/strict'),{rtfToText:p}=require('./miniprogram/file-reader/engine/core/rtf-reader'),{wrap:w,pair}=require('./tests/helpers/rtf-alternatives');a.equal(p(w(pair('A'.repeat(4*1024*1024),'Chosen'))),'Chosen');a.equal(p(w(pair('old','new').repeat(10000))),'new'.repeat(10000));let s='X';for(let i=0;i<600;i++)s=pair('old',s);a.throws(()=>p(w(s)),/嵌套/);console.log(JSON.stringify({rssKiB:process.resourceUsage().maxRSS}));`],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8',timeout:10000})
  assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(r.stdout).rssKiB<256*1024)
})
test('RTF public originals retain source hashes and exact independent body text',()=>{
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
  for(const sample of require('./fixtures/rtf-alternatives/samples.json')){
    const b=fs.readFileSync(path.join(__dirname,'fixtures/rtf-alternatives',sample.name))
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'),sample.sha256,sample.name)
    assert.equal(rtfToText(b),sample.expected,sample.name)
  }
})
test('RTF CP1250 high bytes agree with independent ICU; undefined bytes are explicit errors',()=>{
  const oracle=new TextDecoder('windows-1250'),undefinedBytes=new Set([0x81,0x83,0x88,0x90,0x98])
  for(let byte=128;byte<256;byte++){
    const source=wrap("\\ansicpg1250 X\\'"+byte.toString(16)+'Y')
    if(undefinedBytes.has(byte))assert.throws(()=>rtfToText(source),/代码页 1250 不匹配/)
    else{
      const expected='X'+oracle.decode(Uint8Array.of(byte))+'Y'
      assert.equal(rtfToText(source),expected,'hex '+byte)
      assert.equal(rtfToText(Buffer.concat([Buffer.from('{\\rtf1\\ansicpg1250 X'),Buffer.from([byte]),Buffer.from('Y}')])),expected,'raw '+byte)
    }
  }
  assert.equal(rtfToText(wrap("\\ansicpg1252 Caf\\'e9{\\ansicpg1250 \\'c8}\\'e9")),'CaféČé')
})
test('RTF tolerates NUL padding only after the closed root and rejects trailing payloads',()=>{
  for(const tail of ['\0','\r\n\0','\0\0\t\r\n'])assert.equal(rtfToText(wrap('Body')+tail),'Body')
  for(const tail of ['\0SECRET','\0{\\rtf1 Other}','\0\\par'])assert.throws(()=>rtfToText(wrap('Body')+tail),/根分组后/)
  assert.throws(()=>rtfToText('{\\rtf1 truncated\0'),/分组不完整/)
})
