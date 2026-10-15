'use strict'
// Capture independent application outputs for review; never overwrite pinned
// fixtures or derive expectations from the reader implementation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process')
const {cases}=require('../tests/helpers/rtf-special-characters')
const out=path.resolve(process.argv[2]||'outputs/rtf-special-characters/oracles'),input=path.join(out,'input'),converted=path.join(out,'writer'),profile=path.join(out,'profile')
for(const dir of [input,converted,profile])fs.mkdirSync(dir,{recursive:true})
const flags=['-env:UserInstallation='+pathToFileURL(profile).href,'--headless'],writer=args=>execFileSync(process.env.RTF_LIBREOFFICE||'soffice',[...flags,...args],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024})
for(const c of cases)fs.writeFileSync(path.join(input,c.id+'.rtf'),c.source)
const writerVersion=writer(['--version']).trim()
fs.writeFileSync(path.join(out,'writer.log'),writer(['--convert-to','txt:Text (encoded):UTF8','--outdir',converted,...cases.map(c=>path.join(input,c.id+'.rtf'))]))
const rows=cases.map(c=>({id:c.id,sha256:crypto.createHash('sha256').update(c.source).digest('hex'),writer:fs.readFileSync(path.join(converted,c.id+'.txt'),'utf8').replace(/^\ufeff/,'').replace(/\r?\n$/,''),cocoa:execFileSync('textutil',['-convert','txt','-stdin','-stdout','-format','rtf'],{input:c.source,encoding:'utf8'})}))
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({schemaVersion:1,writerVersion,cocoaMacOS:execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),normalization:'Writer: remove leading BOM and single terminal newline; Cocoa: raw output. No content substitutions.',rows},null,2)+'\n')
console.log(JSON.stringify({cases:rows.length,report:path.join(out,'report.json')}))
