'use strict'
const assert=require('node:assert/strict')
function referenceModel(row){
 const poles=[[0,0,0],[0,5,0],[0,10,0],[5,0,0],[5,5,4],[5,10,0],[10,0,0],[10,5,0],[10,10,0]]
 const points=poles.concat(row.analyticPoints),edges=[[0,2],[2,8],[8,6],[6,0]],faces=[]
 const id=(u,v)=>9+u*13+v
 for(let u=0;u<13;u++)for(let v=0;v<13;v++){
  if(u<12)edges.push([id(u,v),id(u+1,v)])
  if(v<12)edges.push([id(u,v),id(u,v+1)])
  if(u<12&&v<12)faces.push([id(u,v),id(u+1,v),id(u+1,v+1)],[id(u,v),id(u+1,v+1),id(u,v+1)])
 }
 return{kind:'step-wireframe',points,edges,faces}
}
function assertModel(actual,expected,name){
 assert.deepEqual(actual.edges,expected.edges,name+' edges');assert.deepEqual(actual.faces,expected.faces,name+' faces');assert.equal(actual.points.length,expected.points.length,name)
 for(let i=0;i<actual.points.length;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(actual.points[i][axis]-expected.points[i][axis])<1e-11,`${name} point${i}/${axis}`)
}
module.exports={referenceModel,assertModel}
