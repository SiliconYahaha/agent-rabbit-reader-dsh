'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process')
const {createSvgScene}=require('../miniprogram/file-reader/image')
function context(){
 const clips=[]
 const ctx=new Proxy({clips,getTransform(){return {a:1,b:0,c:0,d:1,e:0,f:0}},isPointInPath(p,x,y){return p.matrix?x===21:p.source.includes('H8')?x===1:p.source.includes('A10')&&x===7},clip(p,rule){clips.push({source:p&&p.source,rule:rule||p})}}, {get(t,k){return k in t?t[k]:()=>{}},set(t,k,v){t[k]=v;return true}})
 return ctx
}
const factory=source=>({source,addPath(p,matrix){this.source=p.source;this.matrix=matrix}})
test('animated clip d uses current frame geometry, and child clip-rule overrides its parent',()=>{
 const source='<svg viewBox="0 0 100 100"><defs><clipPath id="c" clip-rule="nonzero"><path d="M0 0H20V20H0Z" clip-rule="evenodd"><animate attributeName="d" values="M0 0H20V20H0Z;M0 0H80V80H0Z" dur="2s" repeatCount="indefinite"/></path></clipPath></defs><path d="M0 0H100V100H0Z" clip-path="url(#c)"/></svg>'
 const ctx=context(),scene=createSvgScene(source,{createPath2D:factory})
 scene.draw(ctx,100,100,0);scene.draw(ctx,100,100,1);scene.draw(ctx,100,100,0)
 assert.deepEqual(ctx.clips.map(c=>c.rule),['evenodd','evenodd','evenodd'])
 assert.match(ctx.clips[0].source,/20/);assert.match(ctx.clips[1].source,/50/);assert.equal(ctx.clips[2].source,ctx.clips[0].source)
})
test('a rejected native clip overload falls back and the following scene remains drawable',()=>{
 const source='<svg viewBox="0 0 100 100"><clipPath id="c"><path d="M0 0H80A80 80 0 0 1 0 80Z"/></clipPath><path d="M0 0H100V100H0Z" clip-path="url(#c)"/></svg>'
 const ctx=context();let rejected=0,fallback=0;ctx.clip=(p)=>{if(p&&p.source){rejected++;throw Error('unsupported overload')}fallback++}
 assert.doesNotThrow(()=>createSvgScene(source,{createPath2D:factory}).draw(ctx,100,100,0));assert.equal(rejected,1);assert.equal(fallback,1)
 assert.doesNotThrow(()=>createSvgScene('<svg><path d="M0 0H10V10Z"/></svg>').draw(ctx,100,100,0))
})
test('clip use cycles and long indirect chains terminate in a bounded isolated process',()=>{
 const modulePath=require.resolve('../miniprogram/file-reader/image')
 const r=spawnSync(process.execPath,['-e',`
 const assert=require('node:assert/strict'),{createSvgScene}=require(${JSON.stringify(modulePath)});const ctx=(${context.toString()})();
 const rows=['<use id="self" href="#self"/>'];for(let i=0;i<5000;i++)rows.push('<use id="u'+i+'" href="#u'+(i+1)+'"/>');
 rows.push('<path id="u5000" d="M0 0H10V10Z"/>');
 for(const id of ['self','u0']){const s='<svg><defs>'+rows.join('')+'<clipPath id="c"><use href="#'+id+'"/></clipPath></defs><path d="M0 0H100V100H0Z" clip-path="url(#c)"/></svg>';assert.doesNotThrow(()=>createSvgScene(s,{nativePaths:false}).draw(ctx,100,100,0))}
 assert.equal(ctx.clips.length,2);
 `],{timeout:5000,encoding:'utf8',maxBuffer:4096})
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr)
})
test('WPT originals and published references retain pinned source hashes and license',()=>{
 const root=path.join(__dirname,'fixtures/svg-curved-clips'),rows=require('./fixtures/svg-curved-clips/sources.json')
 for(const r of rows){for(const [name,hash] of [[r.name,r.sha256],[r.reference,r.referenceSha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash);assert.match(r.source,/\/d317428a65e0312e0a199d5db69591e252431dfe\//)}
 assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/3-Clause BSD/)
})

test('nested clip cycles stop and excessive valid reference depth is an explicit error',()=>{
 const ctx=context(),target='<path d="M0 0H100V100H0Z" clip-path="url(#c0)"/>'
 const cycle='<svg><defs><clipPath id="c0"><path d="M0 0H10V10Z" clip-path="url(#c0)"/></clipPath></defs>'+target+'</svg>'
 assert.doesNotThrow(()=>createSvgScene(cycle,{nativePaths:false}).draw(ctx,100,100,0));assert.ok(ctx.clips.length<=3)
 const clips=Array.from({length:70},(_,i)=>'<clipPath id="c'+i+'"><path d="M0 0H10V10Z"'+(i<69?' clip-path="url(#c'+(i+1)+')"':'')+'/></clipPath>').join('')
 const limited=context();let depth=0;limited.save=()=>depth++;limited.restore=()=>depth--
 assert.throws(()=>createSvgScene('<svg><defs>'+clips+'</defs>'+target+'</svg>',{nativePaths:false}).draw(limited,100,100,0),/nesting exceeds 64/)
 assert.equal(depth,0,'resource rejection restores all Canvas state frames')
 assert.doesNotThrow(()=>createSvgScene('<svg><path d="M0 0H10V10Z"/></svg>').draw(limited,100,100,0));assert.equal(depth,0)
})
