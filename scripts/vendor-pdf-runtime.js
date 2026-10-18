'use strict'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib')
const root=path.resolve(__dirname,'..'),deps=path.join(root,'tools/pdf-runtime/node_modules'),pdf=path.join(deps,'pdfjs-dist'),dest=path.join(root,'miniprogram/file-reader/pdf/vendor')
const common=path.join(root,'miniprogram/file-reader/shared/pdf-runtime/vendor');fs.mkdirSync(common,{recursive:true})
const esbuild=require(path.join(deps,'esbuild'))
fs.mkdirSync(dest,{recursive:true})
esbuild.buildSync({entryPoints:[path.join(root,'tools/pdf-runtime/compat.js')],outfile:path.join(common,'compat.js'),bundle:true,format:'cjs',platform:'browser',target:'es2020',minify:true})
fs.copyFileSync(path.join(deps,'core-js/LICENSE'),path.join(common,'LICENSE-CORE-JS'))
for(const file of ['pdf','pdf.worker'])esbuild.buildSync({entryPoints:[path.join(pdf,'build',file+'.mjs')],outfile:path.join(file==='pdf'?common:dest,file+'.js'),bundle:true,format:'cjs',platform:'browser',target:'es2020',minify:true,external:['node:*'],define:{process:'undefined'},banner:{js:`const {Map,WeakMap,Set,TextDecoder,TextEncoder,DOMMatrix,Path2D,ImageData,AbortSignal,AbortController,structuredClone,ReadableStream}=require('${file==='pdf'?'../host':'../../shared/pdf-runtime/host'}');`}})
fs.copyFileSync(path.join(deps,'web-streams-polyfill/dist/ponyfill.js'),path.join(common,'streams.js'))
fs.copyFileSync(path.join(pdf,'LICENSE'),path.join(dest,'LICENSE-PDFJS'))
fs.copyFileSync(path.join(deps,'web-streams-polyfill/LICENSE'),path.join(common,'LICENSE-STREAMS'))
for(const folder of ['cmaps','standard_fonts']){
 const target=path.join(root,'miniprogram/pdf-assets',folder);fs.mkdirSync(target,{recursive:true})
 for(const name of fs.readdirSync(path.join(pdf,folder))){const data=fs.readFileSync(path.join(pdf,folder,name));fs.writeFileSync(path.join(target,name+'.br'),zlib.brotliCompressSync(data));if(name.startsWith('LICENSE'))fs.writeFileSync(path.join(target,name),data.toString('utf8').replace(/[ \t]+$/gm,''))}
}
fs.copyFileSync(path.join(pdf,'LICENSE'),path.join(root,'miniprogram/pdf-assets/LICENSE-PDFJS'))
console.log('Vendored pdfjs-dist 6.4.299 and local font assets; rebuild with npm ci --prefix tools/pdf-runtime && node scripts/vendor-pdf-runtime.js')

fs.copyFileSync(path.join(pdf,'LICENSE'),path.join(common,'LICENSE-PDFJS'))
