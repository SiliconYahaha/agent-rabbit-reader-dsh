'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {inspectFileBytes}=require('../miniprogram/file-reader/engine/core/file-inspector'),{referenceModel,assertModel,malformedSources}=require('../scripts/step-knot-reference')
const originals=require('./fixtures/step-knot-domains/before.json').rows
const inspect=source=>inspectFileBytes(Buffer.from(source),{name:'patch.step'})
test('STEP knot affine domains preserve all native surface points and topology',()=>{for(const row of originals){assert.equal(crypto.createHash('sha256').update(row.source).digest('hex'),row.sha256);assertModel(inspect(row.source).interactiveModel,referenceModel(row),row.name)}})
test('native affine controls agree independently, including repeated unequal-degree surfaces',()=>{
 const same=(a,b)=>assert.deepEqual(originals.find(r=>r.name===a).nativePoints,originals.find(r=>r.name===b).nativePoints)
 for(const name of ['translated','subnormal','opposite-extremes','negative-domain'])same('control',name)
 same('repeated-unequal','repeated-translated')
})
test('malformed knot lists cannot heal themselves by filtering nonfinite elements',()=>{for(const row of malformedSources(originals[0].source))assert.throws(()=>inspect(row.source),/曲面节点参数无效/,row.name)})
