import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const output = path.resolve(process.argv[2] || 'outputs/psd-bitmap')
fs.mkdirSync(output, {recursive:true})
const modulePath = process.env.PSD_MAGICK_MODULE
if (!modulePath) throw Error('Set PSD_MAGICK_MODULE to pinned @imagemagick/magick-wasm dist/index.js')
const { initializeImageMagick, ImageMagick, Magick } = await import(pathToFileURL(modulePath).href)
await initializeImageMagick(fs.readFileSync(path.join(path.dirname(modulePath),'x86/magick.wasm')))
const samples = require('../tests/helpers/psd-bitmap').cases()
for (const filename of process.argv.slice(3)) samples.push({name:path.basename(filename),bytes:fs.readFileSync(filename),publicOriginal:true})
const inputs = samples.map(c => {const file=path.join(output,c.name+'.psd');fs.writeFileSync(file,c.bytes);return file})
fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify(inputs))
const py = `import json,sys,hashlib,importlib.metadata\nfrom psd_tools import PSDImage\nfrom pathlib import Path\nrows=[]\nfor name in json.load(open(sys.argv[1])):\n try:\n  image=PSDImage.open(name).topil().convert('RGBA');rows.append({'name':Path(name).stem,'width':image.width,'height':image.height,'rgbaBase64':__import__('base64').b64encode(image.tobytes()).decode()})\n except Exception as e:rows.append({'name':Path(name).stem,'error':str(e)})\nprint(json.dumps({'version':importlib.metadata.version('psd-tools'),'results':rows}))\n`
fs.writeFileSync(path.join(output,'oracle.py'),py)
const psdTools = JSON.parse(execFileSync(process.env.PSD_ORACLE_PYTHON || 'python3',[path.join(output,'oracle.py'),path.join(output,'inputs.json')],{encoding:'utf8',maxBuffer:16*1024*1024}))
const {extractPsdComposite} = require('../miniprogram/file-reader/engine/core/design-file')
const results = []
for (const input of samples) {
  const row = {name:input.name,sourceSha256:crypto.createHash('sha256').update(input.bytes).digest('hex'),publicOriginal:!!input.publicOriginal}
  const other = psdTools.results.find(r=>r.name===input.name)
  row.psdTools = other
  try {row.magick=ImageMagick.read(input.bytes,image=>({width:image.width,height:image.height,rgbaBase64:Buffer.from(image.getPixels(p=>p.toByteArray(0,0,image.width,image.height,'RGBA'))).toString('base64')}))}
  catch(e){row.magick={error:e.message}}
  const reference = row.magick.rgbaBase64 ? row.magick : other
  assert.ok(reference.rgbaBase64,input.name)
  if(row.magick.rgbaBase64 && other.rgbaBase64)assert.equal(row.magick.rgbaBase64,other.rgbaBase64,input.name)
  if(input.compression===2) {
    // Independent zlib reconstruction: rewrap its decoded bytes as Raw and
    // have ImageMagick read that image, bypassing its unsupported ZIP entry.
    const raw=Buffer.concat([input.bytes.subarray(0,input.version===2?42:38),Buffer.from([0,0]),require('node:zlib').inflateSync(input.bytes.subarray(input.version===2?44:40))])
    const decoded=ImageMagick.read(raw,image=>Buffer.from(image.getPixels(p=>p.toByteArray(0,0,image.width,image.height,'RGBA'))).toString('base64'))
    assert.equal(decoded,reference.rgbaBase64,input.name+' ZIP/Raw reference')
    row.zipRawExact=true
  }
  const actual=extractPsdComposite(input.bytes)
  assert.deepEqual(Buffer.from(actual.rgba),Buffer.from(reference.rgbaBase64,'base64'),input.name)
  row.width=actual.width;row.height=actual.height;row.rgbaBase64=reference.rgbaBase64;row.exact=true
  results.push(row)
}
const {designPreview} = require('../tests/helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const page = designPreview({env:{USER_DATA_PATH:output},getFileSystemManager:()=>({
  readFile(o){const b=fs.readFileSync(o.filePath).subarray(o.position||0,(o.position||0)+o.length);o.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})},
  writeFile(o){fs.writeFileSync(o.filePath,Buffer.from(o.data));o.success()}
})})
const previews=[]
for (const [i,input] of samples.entries()) {
  page.open({name:input.name+'.psd',path:inputs[i],size:input.bytes.length})
  for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.data.loading,false);assert.equal(page.data.error,'');assert.match(page.data.previewPath,/psd-composite-/)
  const ref=results[i],rgba=Buffer.from(ref.rgbaBase64,'base64'),jpeg=fs.readFileSync(page.data.previewPath)
  assert.deepEqual(jpeg,Buffer.from(encode({width:ref.width,height:ref.height,data:rgba},82).data),input.name)
  const decoded=ImageMagick.read(jpeg,image=>({width:image.width,height:image.height,rgba:Buffer.from(image.getPixels(p=>p.toByteArray(0,0,image.width,image.height,'RGBA')))}))
  assert.equal(decoded.width,ref.width);assert.equal(decoded.height,ref.height)
  let max=0,different=0
  for(let n=0;n<rgba.length;n++)if(n%4!==3){const d=Math.abs(decoded.rgba[n]-rgba[n]);if(d)different++;max=Math.max(max,d)}
  // JPEG is intentionally lossy. Report measured error without claiming that
  // the exported JPEG is lossless or weakening the exact source RGBA check.
  fs.copyFileSync(page.data.previewPath,path.join(output,input.name+'.jpg'))
  previews.push({name:input.name,jpegInputExact:true,width:ref.width,height:ref.height,lossyRGBChannels:different,maximumJpegDifference:max})
}
const report={oracleVersions:{psdTools:psdTools.version,magick:Magick.imageMagickVersion},cases:results.length,exact:results.filter(r=>r.exact).length,previews,results}
fs.writeFileSync(path.join(output,'oracle-report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({cases:report.cases,exact:report.exact,magickDirect:results.filter(r=>r.magick.rgbaBase64).length,zipRaw:results.filter(r=>r.zipRawExact).length}))
