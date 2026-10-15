'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
const output=path.resolve(process.argv[2]||'outputs/epsi-lines'),samples=require('../tests/helpers/epsi-lines').cases()
fs.mkdirSync(output,{recursive:true})
const inputs=samples.map(c=>{const packed=path.join(output,c.name+'.raw');fs.writeFileSync(packed,c.packed);fs.writeFileSync(path.join(output,c.name+'.ai'),c.bytes);return {name:c.name,width:c.width,height:c.height,depth:c.depth,packed}})
fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify(inputs))
const py=`import json,sys,base64,importlib.metadata\nfrom PIL import Image\nrows=[]\nfor c in json.load(open(sys.argv[1])):\n d=c['depth'];raw=open(c['packed'],'rb').read();image=Image.frombytes('1' if d==1 else 'L',(c['width'],c['height']),raw,'raw',{1:'1;I',2:'L;2I',4:'L;4I',8:'L;I'}[d],(c['width']*d+7)//8,1).convert('RGBA')\n rows.append({'name':c['name'],'width':image.width,'height':image.height,'rgbaBase64':base64.b64encode(image.tobytes()).decode()})\nprint(json.dumps({'Pillow':importlib.metadata.version('Pillow'),'results':rows}))\n`
fs.writeFileSync(path.join(output,'oracle.py'),py)
const oracle=JSON.parse(execFileSync(process.env.EPSI_ORACLE_PYTHON||'python3',[path.join(output,'oracle.py'),path.join(output,'inputs.json')],{encoding:'utf8',maxBuffer:8*1024*1024}))
const {rasterCapture}=require('../tests/helpers/capture-design-raster'),capture=rasterCapture(),baseline=rasterCapture(execFileSync('git',['show','v1.4.119:miniprogram/file-reader/engine/core/design-file.js'],{encoding:'utf8'}))
const {designPreview}=require('../tests/helpers/reader-host')
const page=designPreview({env:{USER_DATA_PATH:output},getFileSystemManager:()=>({readFile(o){const b=fs.readFileSync(o.filePath).subarray(o.position||0,(o.position||0)+o.length);o.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})},writeFile(o){fs.writeFileSync(o.filePath,Buffer.from(o.data));o.success()}})})
;(async()=>{
const results=[]
for(const c of samples){
 const ref=oracle.results.find(r=>r.name===c.name),pixels=Buffer.from(ref.rgbaBase64,'base64'),actual=capture(c.bytes)
 assert.deepEqual(actual.rgba,pixels,c.name)
 const row={name:c.name,sourceSha256:crypto.createHash('sha256').update(c.bytes).digest('hex'),width:c.width,height:c.height,depth:c.depth,rgbaBase64:ref.rgbaBase64,exact:true}
 try{row.baselineExact=baseline(c.bytes).rgba.equals(pixels)}catch(e){row.baselineExact=false;row.baselineError=e.message}
 page.open({name:c.name+'.ai',path:path.join(output,c.name+'.ai'),size:c.bytes.length})
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))
 assert.equal(page.data.loading,false);assert.equal(page.data.error,'');assert.match(page.data.previewPath,/illustrator-epsi-preview-/)
 assert.deepEqual(fs.readFileSync(page.data.previewPath),Buffer.from(actual.preview.jpeg),c.name+' component')
 fs.copyFileSync(page.data.previewPath,path.join(output,c.name+'.jpg'));row.componentJpegExact=true;results.push(row)
}
const report={cases:results.length,exact:results.length,baselineExact:results.filter(r=>r.baselineExact).length,oracleVersion:oracle.Pillow,results}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log({cases:report.cases,exact:report.exact,baselineExact:report.baselineExact})
})().catch(e=>{console.error(e);process.exitCode=1})
