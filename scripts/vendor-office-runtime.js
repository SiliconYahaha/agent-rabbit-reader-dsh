'use strict'
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
const deps = path.join(root, 'tools/office-runtime/node_modules')
const esbuild = require(path.join(deps, 'esbuild'))
const xmlAdapter = `const x=require('@xmldom/xmldom');exports.Node=require('@xmldom/xmldom/lib/dom').Node;exports.parseFromString=function(s){if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('不支持文档实体声明');return new x.DOMParser({onError:(level,m)=>{if(level!=='warning')throw Error(m)}}).parseFromString(s,'text/xml')}`
async function main(){
 if(process.argv.includes('--fetch')){
  const vendor=path.join(root,'miniprogram/file-reader/office/vendor'),sources=JSON.parse(fs.readFileSync(path.join(vendor,'SOURCES.json')))
  for(const item of sources.files){const response=await fetch(item.url);if(!response.ok)throw Error('Download failed: '+item.file);const bytes=Buffer.from(await response.arrayBuffer());if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Source checksum mismatch: '+item.file);fs.writeFileSync(path.join(vendor,item.file),bytes)}
 }

 const out = path.join(root,'miniprogram/file-reader/office-word/vendor');fs.mkdirSync(out,{recursive:true})
 await esbuild.build({entryPoints:[path.join(deps,'mammoth/lib/index.js')],outfile:path.join(out,'mammoth.js'),bundle:true,minify:true,platform:'browser',format:'cjs',target:'es2020',supported:{'template-literal':false},banner:{js:'var setImmediate = function(fn){var args=Array.prototype.slice.call(arguments,1);return setTimeout(function(){fn.apply(null,args)},0)};var clearImmediate = clearTimeout;'},plugins:[{name:'xml-adapter',setup(b){b.onLoad({filter:/mammoth\/lib\/xml\/xmldom\.js$/},()=>({contents:xmlAdapter,resolveDir:deps}))}}],legalComments:'eof'})
 await esbuild.build({entryPoints:[path.join(deps,'@xmldom/xmldom/lib/index.js')],outfile:path.join(root,'miniprogram/file-reader/office/vendor/xml.js'),bundle:true,minify:true,platform:'browser',format:'cjs',target:'es2020',legalComments:'eof'})
 for(const name of ['mammoth','@xmldom/xmldom','jszip','underscore','duck','option','setimmediate','base64-js','dingbat-to-unicode','lop','xmlbuilder','pako','lie','immediate','readable-stream','core-util-is','inherits','isarray','process-nextick-args','safe-buffer','string_decoder','util-deprecate']){const dir=path.join(deps,name);for(const file of fs.readdirSync(dir).filter(f=>/^licen[sc]e/i.test(f)))fs.writeFileSync(path.join(out,`LICENSE-${name.replace(/\W/g,'-')}-${file}`),fs.readFileSync(path.join(dir,file),'utf8').split(/\r?\n/).map(line=>line.trimEnd()).join('\n').trimEnd()+'\n')}
 const bundled=path.join(out,'mammoth.js');fs.writeFileSync(bundled,fs.readFileSync(bundled,'utf8').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n')
}
main().catch(e=>{console.error(e);process.exitCode=1})
