'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {inspectFileBytes}=require('../miniprogram/file-reader/engine/core/file-inspector')
const rows=require('./fixtures/step-rational-weights/before.json').rows
const inspect=source=>inspectFileBytes(Buffer.from(source),{name:'patch.step'})
const {referenceModel,assertModel}=require('../scripts/step-rational-reference')
test('original STEP rational surfaces preserve shape across common weight scales and mixed endpoints',()=>{
 for(const row of rows){assert.equal(crypto.createHash('sha256').update(row.source).digest('hex'),row.sha256);assertModel(inspect(row.source).interactiveModel,referenceModel(row),row.name)}
})
test('independent native and Decimal surface references agree; homogeneous overflow remains recorded',()=>{
 for(const row of rows){if(row.name==='scale-1e307'){assert.match(row.nativeError,/nonfinite/);continue}assert.equal(row.nativeError,'');assert.ok(row.nativeMaxAbsError<1e-11)}
})
test('invalid rational weights fail clearly instead of displaying a fake planar face',()=>{
 const source=rows[0].source
 for(const weights of ['((0.,1.,1.),(1.,4.,1.),(1.,1.,1.))','((-1.,1.,1.),(1.,4.,1.),(1.,1.,1.))','((1E309,1.,1.),(1.,4.,1.),(1.,1.,1.))','((1.,1.),(1.,1.))']){
  const bad=source.replace(/RATIONAL_B_SPLINE_SURFACE\(.*?\) REPRESENTATION_ITEM/,`RATIONAL_B_SPLINE_SURFACE(${weights}) REPRESENTATION_ITEM`)
  assert.throws(()=>inspect(bad),/权重/)
 }
})
test('a curved face boundary does not create a planar duplicate, but explicit sibling planar faces remain',()=>{
 const source=rows[0].source
 const withPlane=source.replace('ENDSEC;END-ISO',"#61=FACE('',(#41));ENDSEC;END-ISO")
 assert.equal(inspect(source).interactiveModel.faces.length,288)
 assert.equal(inspect(withPlane).interactiveModel.faces.length,290)
 const invalidKnots=source.replace('B_SPLINE_SURFACE_WITH_KNOTS((3,3)', 'B_SPLINE_SURFACE_WITH_KNOTS((1,1)')
 assert.throws(()=>inspect(invalidKnots),/曲面节点参数无效/)
})
