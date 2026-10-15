'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const {createNativePaths}=require('../miniprogram/file-reader/image/svg/svg-native-path')
function context(){return {save(){},restore(){},getTransform(){return {a:1,b:0,c:0,d:1,e:0,f:0}},setTransform(){},isPointInPath(p,x,y){return p.source.includes('H8')?x===1:p.source.includes('A10')&&x===7}}}
test('native path support requires real hole and arc semantics, not just a factory method',()=>{
 const ctx=context(),key={}
 for(const broken of [()=>{throw Error('unsupported')},()=>({source:''})])assert.equal(createNativePaths({createPath2D:broken}).get(ctx,key,'M0 0L10 10'),null)
 const invalidMatrix=context();invalidMatrix.getTransform=()=>undefined
 assert.equal(createNativePaths({createPath2D:source=>({source})}).get(invalidMatrix,key,'M0 0'),null)
 assert.equal(createNativePaths({nativePaths:false,createPath2D:()=>{throw Error('must not call')}}).get(ctx,key,'M0 0'),null)
})
test('native paths cache only each element current value and recover from a failed new value',()=>{
 let calls=0;const provider=createNativePaths({createPath2D:source=>{calls++;if(source==='bad')throw Error('bad data');return {source}}}),ctx=context(),key={}
 const first=provider.get(ctx,key,'M0 0L10 10');assert.equal(calls,3)
 for(let i=0;i<60;i++)assert.equal(provider.get(ctx,key,'M0 0L10 10'),first)
 assert.equal(calls,3);assert.equal(provider.get(ctx,key,'bad'),null);assert.equal(provider.get(ctx,key,'bad'),null);assert.equal(calls,4)
 assert.equal(provider.get(ctx,key,'M1 1').source,'M1 1');assert.equal(calls,5)
 provider.disable(ctx);assert.equal(provider.get(ctx,key,'M2 2'),null);assert.equal(calls,5)
 assert.ok(provider.get(context(),key,'M3 3'));assert.equal(calls,8)
})
test('thousands of animated values release previous native path objects within a bounded heap',()=>{
 const modulePath=require.resolve('../miniprogram/file-reader/image/svg/svg-native-path')
 const r=spawnSync(process.execPath,['--expose-gc','-e',`
 const assert=require('node:assert/strict'),{createNativePaths}=require(${JSON.stringify(modulePath)});
 const ctx=(${context.toString()})();const record={};
 const provider=createNativePaths({createPath2D:source=>({source,payload:Array(2000).fill(42)})});
 provider.get(ctx,record,'M0 0');global.gc();const before=process.memoryUsage().heapUsed;
 for(let i=0;i<5000;i++)provider.get(ctx,record,'M'+i+' '+i);
 global.gc();const growth=process.memoryUsage().heapUsed-before;
 assert.ok(growth<8*1024*1024,'retained '+growth+' bytes');console.log(growth);
 `],{timeout:5000,encoding:'utf8',maxBuffer:4096})
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr)
})
test('transformed paths probe matrix semantics and retain only the current matrix',()=>{
 let calls=0
 const factory=source=>{calls++;return {source,addPath(other,matrix){this.source=other.source;this.matrix=matrix}}}
 const ctx=context(),inside=ctx.isPointInPath
 ctx.isPointInPath=(p,x,y)=>p.matrix?x===21:inside(p,x,y)
 const provider=createNativePaths({createPath2D:factory}),record={}
 const p=provider.get(ctx,record,'M0 0L10 10'),a=[1,0,0,1,2,3],b=[2,0,0,2,0,0]
 const first=provider.transform(ctx,record,p,a);assert.deepEqual(first.matrix,{a:1,b:0,c:0,d:1,e:2,f:3})
 const count=calls;assert.equal(provider.transform(ctx,record,p,a),first);assert.equal(calls,count)
 const second=provider.transform(ctx,record,p,b);assert.notEqual(second,first);assert.equal(calls,count+1)
 assert.notEqual(provider.transform(ctx,record,p,a),first)
 const changed=provider.get(ctx,record,'M1 1L9 9');assert.equal(provider.transform(ctx,record,p,a),null);assert.ok(provider.transform(ctx,record,changed,a))
 const ignored=createNativePaths({createPath2D:source=>({source,addPath(other){this.source=other.source}})}),key={}
 const original=ignored.get(ctx,key,'M0 0L10 10');assert.equal(ignored.transform(ctx,key,original,a),null)
 assert.equal(ignored.get(ctx,key,'M0 0L10 10'),original,'unsupported transform does not disable plain native paths')
})
