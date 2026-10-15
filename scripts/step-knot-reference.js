'use strict'
const assert=require('node:assert/strict')
function referenceModel(row){
 const points=row.controlPoints.concat(row.nativePoints),edges=[],faces=[],offset=row.controlPoints.length
 const id=(u,v)=>offset+u*(row.vSegments+1)+v
 for(let u=0;u<=row.uSegments;u++)for(let v=0;v<=row.vSegments;v++){
  if(u<row.uSegments)edges.push([id(u,v),id(u+1,v)])
  if(v<row.vSegments)edges.push([id(u,v),id(u,v+1)])
  if(u<row.uSegments&&v<row.vSegments)faces.push([id(u,v),id(u+1,v),id(u+1,v+1)],[id(u,v),id(u+1,v+1),id(u,v+1)])
 }
 return{kind:'step-wireframe',points,edges,faces}
}
function assertModel(actual,expected,name){assert.deepEqual(actual.edges,expected.edges,name+' edges');assert.deepEqual(actual.faces,expected.faces,name+' faces');assert.equal(actual.points.length,expected.points.length,name);for(let i=0;i<actual.points.length;i++)for(let a=0;a<3;a++)assert.ok(Math.abs(actual.points[i][a]-expected.points[i][a])<1e-11,`${name} point${i}/${a}`)}
function malformedSources(source){return [
 ['nonfinite-extra-knot',source.replace('(0,1),(0,1)', '(0,1E309,1),(0,1)')],
 ['nonfinite-extra-multiplicity',source.replace('((3,3),(3,3)', '((3,1E309,3),(3,3)')],
 ['descending',source.replace('(0,1),(0,1)', '(1,0),(0,1)')],
 ['equal-domain',source.replace('(0,1),(0,1)', '(0,0),(0,1)')],
 ['wrong-count',source.replace('((3,3),(3,3)', '((1,1),(3,3)')]
 ].map(([name,changed])=>{assert.notEqual(changed,source,name);return{name,source:changed}})}
module.exports={referenceModel,assertModel,malformedSources}
