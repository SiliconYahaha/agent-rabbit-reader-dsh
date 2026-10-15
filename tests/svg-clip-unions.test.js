'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),vm=require('node:vm')
const root=path.resolve(__dirname,'../miniprogram/file-reader/image/svg')
const {createClipUnion}=require(root+'/svg-clip-union'),{createSvgScene}=require('../miniprogram/file-reader/image')
const kernel=require(root+'/vendor/pathkit/pathkit')({wasmBinary:zlib.brotliDecompressSync(fs.readFileSync(root+'/vendor/pathkit/pathkit.wasm.br'))})
const input=[{d:'M10 10H70V70H10Z',rule:'nonzero'},{d:'M30 30V90H90V30Z',rule:'nonzero'}]
function context(){let depth=0;return new Proxy({get depth(){return depth},save(){depth++},restore(){depth--}}, {get(t,k){return k in t?t[k]:()=>{}}})}
test('union preserves overlap and each child fill rule; native paths are freed on success and failure',async()=>{
 const k=await kernel;let live=0,fail=false
 const track=p=>{if(!p)return p;live++;const remove=p.delete.bind(p);p.delete=()=>{live--;remove()};return p}
 const union=createClipUnion({FillType:k.FillType,PathOp:k.PathOp,FromSVGString:d=>track(k.FromSVGString(d)),MakeFromOp:(...args)=>{if(fail)throw Error('operation failed');return track(k.MakeFromOp(...args))}})
 const result=union(input);assert.ok(result.d);assert.equal(result.rule,'evenodd');assert.equal(live,0)
 const hole=union([{d:'M0 0H100V100H0Z M20 20H80V80H20Z',rule:'evenodd'},{d:'M30 30H40V40H30Z'}]);assert.ok(hole.segments.length>8);assert.equal(live,0)
 fail=true;assert.throws(()=>union(input),/operation failed/);assert.equal(live,0)
 fail=false;assert.deepEqual(union(input),result);assert.equal(live,0)
})
test('oversize child count, commands, source and transformed coordinates are rejected before native allocation',async()=>{
 const k=await kernel;let calls=0;const union=createClipUnion({FromSVGString(){calls++;throw Error('allocated too early')}})
 assert.throws(()=>union(Array(65).fill(input[0])),/64 children/)
 assert.throws(()=>union([{d:'M0 0'+'L1 1'.repeat(2048)}]),/2048 segments/)
 assert.throws(()=>union([{d:' '.repeat(65537)}]),/64 KiB/)
 assert.throws(()=>union([{d:'M1000 1000H2000V2000Z',matrix:[1e5,0,0,1e5,0,0]}]),/transformed coordinates/)
 assert.equal(calls,0);assert.ok(createClipUnion(k)(input).d)
})
test('real scene caches one current union per clip, changes animated geometry and recovers after errors',async()=>{
 const k=await kernel;let calls=0;const union=createClipUnion(k)
 const source='<svg viewBox="0 0 100 100"><clipPath id="c"><path d="M0 0H20V20Z"><animate attributeName="d" values="M0 0H20V20Z;M0 0H80V80Z" dur="2s" repeatCount="indefinite"/></path><path d="M30 30H60V60Z"/></clipPath><path d="M0 0H100V100Z" clip-path="url(#c)"/></svg>'
 const scene=createSvgScene(source,{nativePaths:false,clipUnion:e=>{calls++;return union(e)}}),ctx=context()
 scene.draw(ctx,100,100,0);scene.draw(ctx,100,100,0);assert.equal(calls,1)
 scene.draw(ctx,100,100,1);scene.draw(ctx,100,100,0);assert.equal(calls,3);assert.equal(ctx.depth,0)
 assert.throws(()=>createSvgScene(source).draw(ctx,100,100,0),/kernel is not ready/);assert.equal(ctx.depth,0)
 assert.doesNotThrow(()=>createSvgScene('<svg><rect width="5" height="5"/></svg>').draw(ctx,100,100,0))
})
test('packaged kernel and WPT originals retain provenance, and kernel has no dynamic execution',()=>{
 const meta=require(root+'/vendor/pathkit/source.json'),wasm=zlib.brotliDecompressSync(fs.readFileSync(root+'/vendor/pathkit/pathkit.wasm.br'))
 assert.equal(crypto.createHash('sha256').update(wasm).digest('hex'),meta.wasmSha256)
 const code=fs.readFileSync(root+'/vendor/pathkit/pathkit.js','utf8');const ast=require('acorn').parse(code,{ecmaVersion:'latest'})
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='Identifier')assert.ok(!['eval','Function'].includes(n.name),n.name);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else visit(v)}visit(ast)
 assert.ok(code.includes('if(67108864<b)return!1'));assert.ok(code.includes('ma.grow(Math.min(67108864,d)'))
 for(const row of require('./fixtures/svg-clip-unions/sources.json'))for(const [name,hash] of [[row.name,row.sha256],[row.reference,row.referenceSha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/svg-clip-unions',name))).digest('hex'),hash)
})
test('many repeated native unions remain within the initial 32 MiB heap',async()=>{
 const k=await kernel,union=createClipUnion(k),start=k.HEAPU8.byteLength
 for(let i=0;i<2000;i++)union(input.map((e,j)=>({...e,matrix:[1,0,0,1,(i+j)%50,0]})))
 assert.equal(k.HEAPU8.byteLength,start);assert.equal(start,33554432)
})
test('runtime shares in-flight initialization, reports rejection, and retries successfully',async()=>{
 const module={exports:{}};let attempt=0
 let fatal=false;const fake=()=>{if(fatal)throw Error('Aborted(): out of memory');return 42}
 vm.runInNewContext(fs.readFileSync(root+'/svg-clip-runtime.js','utf8'),{module,require:id=>id.endsWith('module-root')?{modulePath:p=>'file-reader/'+p}:id.endsWith('svg-clip-union')?{createClipUnion:()=>fake}:options=>new Promise(resolve=>options.instantiateWasm({},()=>resolve({}))),WXWebAssembly:{instantiate(){if(++attempt===1)return Promise.reject(Error('failed instance'));return Promise.resolve({instance:{exports:{}}})}},Promise,setTimeout,clearTimeout,Error})
 const a=module.exports.loadClipUnion(),b=module.exports.loadClipUnion();assert.equal(a,b);await assert.rejects(a,/failed instance/);assert.equal((await module.exports.loadClipUnion())([]),42);assert.equal(attempt,2)
 fatal=true
 const active=await module.exports.loadClipUnion();assert.throws(()=>active([]),/Aborted/)
 fatal=false;assert.equal((await module.exports.loadClipUnion())([]),42);assert.equal(attempt,3)
})

test('nested union renders and changed-clip frame limits fail with balanced Canvas state',async()=>{
 const union=createClipUnion(await kernel),ctx=context(),shape='<path d="M0 0H20V20H0Z"/>'
 const nested='<svg><clipPath id="inner">'+shape+'</clipPath><clipPath id="c"><path d="M0 0H40V40Z" clip-path="url(#inner)"/>'+shape+'</clipPath><rect width="100" height="100" clip-path="url(#c)"/></svg>'
 assert.doesNotThrow(()=>createSvgScene(nested,{clipUnion:union}).draw(ctx,100,100,0));assert.equal(ctx.depth,0)
 const many='<svg>'+Array.from({length:33},(_,i)=>'<clipPath id="c'+i+'">'+shape+shape+'</clipPath><rect width="100" height="100" clip-path="url(#c'+i+')"/>').join('')+'</svg>'
 assert.throws(()=>createSvgScene(many,{clipUnion:union}).draw(ctx,100,100,0),/32 changed clips/);assert.equal(ctx.depth,0)
 assert.doesNotThrow(()=>createSvgScene('<svg><rect width="2" height="2"/></svg>').draw(ctx,100,100,0))
})

test('dense self-intersections stop at the native memory cap and a fresh kernel still renders',()=>{
 const {spawnSync}=require('node:child_process')
 const code=`const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict');
 const init=require(${JSON.stringify(root+'/vendor/pathkit/pathkit')}),{createClipUnion}=require(${JSON.stringify(root+'/svg-clip-union')});
 const wasmBinary=zlib.brotliDecompressSync(fs.readFileSync(${JSON.stringify(root+'/vendor/pathkit/pathkit.wasm.br')}));
 (async()=>{let k=await init({wasmBinary});const star=(n,o)=>'M'+Array.from({length:n},(_,i)=>{const a=(i*251+o)*Math.PI*2/n;return (50+45*Math.cos(a))+' '+(50+45*Math.sin(a))}).join('L')+'Z';
 assert.throws(()=>createClipUnion(k)([{d:star(510,0)},{d:star(510,.5)}]),/Aborted/);assert.ok(k.HEAPU8.byteLength<=67108864);k=null;
 const fresh=await init({wasmBinary});assert.ok(createClipUnion(fresh)(${JSON.stringify(input)}).d);assert.equal(fresh.HEAPU8.byteLength,33554432)})().catch(e=>{console.error(e);process.exitCode=1})`
 const r=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:5000,maxBuffer:4096});assert.ifError(r.error);assert.equal(r.status,0,r.stderr)
})
