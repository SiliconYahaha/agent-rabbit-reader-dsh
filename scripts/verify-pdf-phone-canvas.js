'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib')
const root=path.resolve(__dirname,'..')
const {createCanvas,Path2D}=require('../tools/pdf-runtime/node_modules/@napi-rs/canvas')
const native=process.argv[3]==='native'
// Deliberately omit Canvas.createPath2D, Canvas.createImageData and the native
// getTransform method. Pixel rendering must work through the phone adapter.
function phoneCanvas(width,height){const c=createCanvas(width,height),ctx=c.getContext('2d');if(!native)ctx.getTransform=undefined;return c}
global.wx={loadSubpackage:({success})=>success(),createOffscreenCanvas:({width,height})=>phoneCanvas(width,height),getFileSystemManager:()=>({readCompressedFile({filePath,success,fail}){try{success({data:zlib.brotliDecompressSync(fs.readFileSync(path.join(root,'miniprogram',filePath)))})}catch(e){fail(e)}}})}
if(native)require('../miniprogram/file-reader/shared/pdf-runtime/host').Path2D=Path2D
const engine=require('../miniprogram/file-reader/pdf')
;(async()=>{
 const source=process.argv[2]||path.join(root,'output/pdf/兔子阅读器-小程序介绍与能力事实底稿-上线信息更新版.pdf')
 const task=engine.open(new Uint8Array(fs.readFileSync(source))),pdf=await task.promise
 const caseName=process.argv[4]||'';assert.match(caseName,/^[a-z0-9-]*$/);const out=path.join(root,'outputs/device-reader-fixes',caseName);fs.mkdirSync(out,{recursive:true})
 const results=[]
 for(let n=1;n<=Math.min(3,pdf.numPages);n++){
  const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),canvas=phoneCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
  await page.render({canvasContext:engine.context(canvas),viewport,annotationMode:engine.annotationMode}).promise
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0
  for(let i=0;i<data.length;i+=4)if(data[i+3]&&(data[i]<230||data[i+1]<230||data[i+2]<230))ink++
  assert.ok(ink>100,`page ${n} must contain visible pixels`)
  fs.writeFileSync(path.join(out,`pdf-${native?'native-':''}page-${n}.png`),canvas.toBuffer('image/png'));results.push({page:n,ink,width:canvas.width,height:canvas.height});page.cleanup()
 }
 await task.destroy();fs.writeFileSync(path.join(out,native?'pdf-native-pixels.json':'pdf-pixels.json'),JSON.stringify({environment:'Node native raster, phone API omissions; not a physical device',source,results},null,2));console.log(results)
})().catch(e=>{console.error(e);process.exitCode=1})
