'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {createSvgScene}=require('../miniprogram/file-reader/image'),{parsePath,pathBounds}=require('../miniprogram/file-reader/image/svg/svg-path')
function context(){const state={depth:0,clips:0,fills:[]};return new Proxy({state,save(){state.depth++},restore(){state.depth--},clip(){state.clips++},fill(){state.fills.push(this.fillStyle)},fillRect(){state.fills.push(this.fillStyle)}},{get(t,k){return k in t?t[k]:()=>{}}})}
test('cubic and quadratic extrema exclude controls, and arcs retain analytic geometry',()=>{
 assert.deepEqual(pathBounds(parsePath('M0 0C0 100 100 100 100 0')),{x:0,y:0,width:100,height:75})
 assert.ok(Math.abs(pathBounds(parsePath('M0 0Q50 100 100 0')).height-50)<1e-10)
 const arc=pathBounds(parsePath('M0 50A50 50 0 0 1 100 50',true));assert.ok(Math.abs(arc.x)<1e-10);assert.ok(Math.abs(arc.y)<1e-10);assert.equal(arc.width,100);assert.ok(Math.abs(arc.height-50)<1e-10)
 const reflected=pathBounds(parsePath('M0 0C0 100 100 100 100 0'),[-1,0,0,1,100,0]);assert.deepEqual(reflected,{x:0,y:0,width:100,height:75})
})
test('container bounds include hidden/transparent/unfilled shapes but exclude display none, defs and strokes',()=>{
 const scene=createSvgScene('<svg><g id="g"><rect width="20" height="20"/><rect x="30" width="20" height="20" opacity="0"/><rect x="60" width="20" height="20" visibility="hidden"/><rect x="90" width="20" height="20" fill="none" stroke="red" stroke-width="100"/><rect width="999" height="999" display="none"/><defs><rect width="999" height="999"/></defs></g></svg>')
 assert.deepEqual(scene.renderer.getBounds(scene.doc.byId.g),{x:0,y:0,width:110,height:20})
})
test('nested transforms and use aggregate local rectangles with per-instance inherited paint',()=>{
 const scene=createSvgScene('<svg><defs><g id="part"><rect width="20" height="30"/></g></defs><g id="g" fill="green"><use href="#part" x="10" y="20"/><use href="#part" x="40" y="20" fill="red"/></g></svg>'),ctx=context()
 assert.deepEqual(scene.renderer.getBounds(scene.doc.byId.g),{x:10,y:20,width:50,height:30});scene.draw(ctx,100,100,0);assert.deepEqual(ctx.state.fills,['rgba(0,128,0,1)','rgba(255,0,0,1)']);assert.equal(ctx.state.depth,0)
})
test('animated child geometry recomputes bounding boxes from the current sampled frame',()=>{
 const scene=createSvgScene('<svg><g id="g"><rect width="20" height="20"><animate attributeName="width" from="20" to="100" dur="2s" repeatCount="indefinite"/></rect></g></svg>')
 for(const [time,width] of [[0,20],[1,60],[0,20]])assert.equal(scene.renderer.getBounds(scene.doc.byId.g,scene.timeline.sample(time)).width,width)
})
test('container reference cycles terminate; traversal and depth caps restore Canvas before the next file',()=>{
 const ctx=context(),clip='<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width=".5" height=".5"/></clipPath>',end='<rect width="2" height="2"/>'
 const cycle=createSvgScene('<svg>'+clip+'<g id="g" clip-path="url(#c)"><use href="#g"/></g></svg>');assert.doesNotThrow(()=>cycle.draw(ctx,100,100));assert.equal(ctx.state.depth,0)
 const deep=createSvgScene('<svg>'+clip+'<g clip-path="url(#c)">'+'<g>'.repeat(70)+end+'</g>'.repeat(70)+'</g></svg>');assert.throws(()=>deep.draw(ctx,100,100),/bounding box nesting/);assert.equal(ctx.state.depth,0)
 const many=createSvgScene('<svg>'+clip+'<g clip-path="url(#c)">'+end.repeat(10001)+'</g></svg>');assert.throws(()=>many.draw(ctx,100,100),/10000 nodes/);assert.equal(ctx.state.depth,0)
 assert.doesNotThrow(()=>createSvgScene('<svg>'+end+'</svg>').draw(ctx,100,100));assert.equal(ctx.state.depth,0)
})
test('unsupported text bounds and rejected ellipse methods do not silently produce partial bounds',()=>{
 const ctx=context(),text=createSvgScene('<svg><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width=".5" height=".5"/></clipPath><g clip-path="url(#c)"><text>hello</text></g></svg>');assert.throws(()=>text.draw(ctx,100,100),/text bounding boxes/);assert.equal(ctx.state.depth,0)
 let calls=0,curves=0;ctx.ellipse=()=>{calls++;throw Error('unsupported ellipse')};ctx.getTransform=()=>({a:1,b:0,c:0,d:1,e:0,f:0});ctx.isPointInPath=()=>true;ctx.bezierCurveTo=()=>curves++
 const circle=createSvgScene('<svg><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath><rect width="40" height="40" clip-path="url(#c)"/></svg>',{nativePaths:false});circle.draw(ctx,100,100);circle.draw(ctx,100,100);assert.equal(calls,1);assert.ok(curves>=8);assert.equal(ctx.state.depth,0)
})
test('four upstream originals and references retain their pinned hashes and license',()=>{
 const root=path.join(__dirname,'fixtures/svg-container-bounds');for(const row of require('./fixtures/svg-container-bounds/sources.json'))for(const [name,hash] of [[row.name,row.sha256],[row.reference,row.referenceSha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash);assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/3-Clause BSD/)
})
