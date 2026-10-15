'use strict'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const {zipSync}=require('fflate'),{rar4Links}=require('../tests/helpers/rar-links'),{cdrCompressedVectorFixture}=require('../tests/helpers/cdr-zlib'),{psdAlphaFixture}=require('../tests/helpers/psd-alpha')
async function main(){
 const out=path.resolve('outputs/mime-payload/originals');fs.mkdirSync(out,{recursive:true})
 const body='独立容器正文：汉字 😀\n',file='inside.txt'
 const seven=await require('../miniprogram/file-reader/sevenzip/runtime/7zz')({wasmBinary:zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')),print(){},printErr(){}})
 seven.FS.writeFile('/'+file,Buffer.from(body));assert.equal(seven.callMain(['a','-t7z','-m0=copy','-mtm=off','-mta=off','-mtc=off','/body.7z',file]),0)
 const rows=[
 {name:'zip',mime:'application/zip',bytes:zipSync({[file]:[Buffer.from(body),{mtime:new Date('2026-01-01T00:00:00Z')} ]}),body},
 {name:'rar',mime:'application/vnd.rar',bytes:rar4Links([{name:file,content:body}]),body},
 {name:'7z',mime:'application/x-7z-compressed',bytes:Buffer.from(seven.FS.readFile('/body.7z')),body},
 {name:'step',mime:'application/step',bytes:Buffer.from(require('../tests/fixtures/step-scope/originals.json').rows[0].source),model:{kind:'step-wireframe',points:[[0,0,0],[10,0,0]],edges:[[0,1]],faces:[]}},
 {name:'cdr',mime:'application/x-cdr',bytes:cdrCompressedVectorFixture()},
 {name:'psd',mime:'application/x-photoshop',bytes:psdAlphaFixture({width:2,height:1,extraChannel:false,flag:'none',colors:[[1,0],[0,1],[0,0]]}),rgba:[255,0,0,255,0,255,0,255]},
 ]
 for(const row of rows){const name=path.join(out,'body.'+row.name);fs.writeFileSync(name,row.bytes);if(row.body)assert.equal(execFileSync('/usr/bin/tar',['-xOf',name,file],{encoding:'utf8'}),row.body);row.base64=Buffer.from(row.bytes).toString('base64');delete row.bytes}
 fs.mkdirSync('tests/fixtures/mime-parameters',{recursive:true});fs.writeFileSync('tests/fixtures/mime-parameters/families.json',JSON.stringify({ownership:'Own synthetic container/design files, reused own independently checked STEP source','containerOracle':'macOS BSD tar exact extracted body for ZIP/RAR/7z',rows},null,2)+'\n');console.log(JSON.stringify({formats:rows.length,independentContainerBodies:3}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
