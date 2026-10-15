'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { extractLegacyAiPreview, extractLegacyAiRasterPreview } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview } = require('../tests/helpers/reader-host')
const out = path.resolve(process.argv[2] || 'outputs/ai-lexical/exploration-current')
fs.mkdirSync(out, { recursive: true })
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const markers = { eof: '%%EOF', endDocument: '%%EndDocument', beginDocument: '%%BeginDocument: string-data.eps', binary: '%%BeginBinary: 999999', preview: '%%BeginPreview: 1 1 8 1\n% ff\n%%EndPreview', hires: '%%HiResBoundingBox: 0 0 1 1' }
const contexts = { literal: p => '(\n' + p + '\n) pop', nested: p => '(outer (\n' + p + '\n)) pop', procedure: p => '/unused { (\n' + p + '\n) pop } bind def', dictionary: p => '<< /text (\n' + p + '\n) >> pop', resource: p => '%%BeginResource: procset Example 1 0\n/text (\n' + p + '\n) def\n%%EndResource' }
const rect = (x, color) => color + ' setrgbcolor\n' + x + ' 0 moveto\n' + (x + 20) + ' 0 lineto\n' + (x + 20) + ' 20 lineto\n' + x + ' 20 lineto\nclosepath fill\n'
const rows = []
for (const [ending,eol] of [['lf','\n'],['cr','\r'],['crlf','\r\n']]) for (const [context,wrap] of Object.entries(contexts)) for (const [marker,payload] of Object.entries(markers)) {
  const source = ('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n' + rect(0,'1 0 0') + wrap(payload) + '\n' + rect(20,'0 0 1') + '%%EOF\n').replace(/\n/g,eol)
  const name = `${marker}-${context}-${ending}`, bytes = Buffer.from(source), input = path.join(out,name+'.eps')
  fs.writeFileSync(input, bytes)
  const row = { name,marker,context,ending,source,sha256:hash(bytes),expected:{width:40,height:20,paths:2,rasterPreview:false} }
  try { const v=extractLegacyAiPreview(bytes); row.vector={width:v.width,height:v.height,paths:v.paths,svg:v.svg} } catch(e) { row.vectorError=e.message }
  try { const v=extractLegacyAiRasterPreview(bytes);row.raster={width:v.width,height:v.height} } catch(e) { row.rasterError=e.message }
  row.vectorCorrect = row.vector?.width===40 && row.vector?.height===20 && row.vector?.paths===2
  row.rasterCorrect = !row.raster && /没有 DSC\/EPSI/.test(row.rasterError||'')
  if (process.env.HTML_READER_GHOSTSCRIPT && (ending==='lf'||context==='literal')) {
    const output=path.join(out,name+'.png')
    const r=spawnSync(process.execPath,[path.resolve('scripts/probe-ai-dsc-ghostscript.js'),'--worker',input,output],{timeout:15000,maxBuffer:1024*1024})
    row.native={status:r.status,signal:r.signal,stdout:r.stdout?.toString(),stderr:r.stderr?.toString()}
    if (r.status===0 && fs.existsSync(output)) { const p=fs.readFileSync(output);row.native.png={file:path.basename(output),width:p.readUInt32BE(16),height:p.readUInt32BE(20),sha256:hash(p)} }
  }
  rows.push(row)
}
async function main () {
  let input,writes=[]
  const host=designPreview({env:{USER_DATA_PATH:'/fixture'},getFileSystemManager:()=>({readFile:o=>o.success({data:input.subarray(o.position||0,(o.position||0)+(o.length||input.length))}),writeFile:o=>{writes.push(o);o.success()},copyFile:o=>o.success()})})
  try { for(const row of rows) {input=Buffer.from(row.source);writes=[];host.open({name:row.name+'.ai',path:'/fixture/input.ai',size:input.length});for(let i=0;i<8;i++)await new Promise(setImmediate);row.host={loading:host.data.loading,message:host.data.message,preview:!!host.data.previewPath,writes:writes.length};if(writes.length){const b=Buffer.from(writes[0].data);const ext=b.subarray(0,50).toString().includes('<svg')?'svg':'jpg';const file=row.name+'-host.'+ext;fs.writeFileSync(path.join(out,file),b);row.host.file=file;row.host.sha256=hash(b)}} } finally {host.detached()}
  const report={at:new Date().toISOString(),sources:rows.length,nativeCases:rows.filter(r=>r.native).length,nativeFailures:rows.filter(r=>r.native&&r.native.status!==0).map(r=>r.name),wrongVectors:rows.filter(r=>!r.vectorCorrect).length,unexpectedRaster:rows.filter(r=>r.raster).length,hostOpens:rows.length,rows,scope:'Authored valid PostScript literal strings between supported red/blue rectangles; five nesting contexts and three line endings. Independent Ghostscript executes selected original bytes. Model and host captures only; pixels still need independent browser verification.'}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sources:report.sources,nativeCases:report.nativeCases,nativeFailures:report.nativeFailures,wrongVectors:report.wrongVectors,unexpectedRaster:report.unexpectedRaster,report:path.join(out,'report.json')}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
