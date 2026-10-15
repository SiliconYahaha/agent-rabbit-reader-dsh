'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const {cases}=require('../tests/helpers/rtf-control-case')
const filename=require.resolve('../miniprogram/file-reader/engine/core/rtf-reader')
let parser=require(filename).rtfToText
const baselineAt=process.argv.indexOf('--baseline-ref')
if(baselineAt>=0){const Module=require('node:module'),m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(execFileSync('git',['show',process.argv[baselineAt+1]+':miniprogram/file-reader/engine/core/rtf-reader.js'],{encoding:'utf8'}),filename);parser=m.exports.rtfToText}
const output=path.resolve(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'outputs/rtf-control-case-gate');fs.mkdirSync(output,{recursive:true})
const results=cases.map(c=>{try{return {...c,actual:parser(Buffer.from(c.source))}}catch(error){return {...c,error:error.message}}})
const failures=results.filter(c=>c.actual!==c.expected),unexpected=failures.filter(c=>!c.knownGap)
const report={cases:cases.length,exact:cases.length-failures.length,certified:cases.filter(c=>!c.knownGap).length,failures:failures.map(c=>c.name),unexpected:unexpected.map(c=>c.name),results}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,exact:report.exact,certified:report.certified,failures:report.failures}))
if(!process.argv.includes('--discover'))assert.equal(unexpected.length,0)
