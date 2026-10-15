'use strict'
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const filename = path.resolve(__dirname, '../../miniprogram/file-reader/engine/core/design-file.js')
// Observe encoder INPUT without changing the production parser or exposing a
// large retained RGBA buffer in its public API. The real encoder still runs.
function rasterCapture (source = fs.readFileSync(filename, 'utf8')) {
  const nativeRequire=Module.createRequire(filename),loaded=new Module(filename)
  let input=null
  loaded.filename=filename
  loaded.require=id=>id==='./vendor/jpeg-encoder'?(image,quality)=>{
    input={width:image.width,height:image.height,rgba:Buffer.from(image.data),quality}
    return nativeRequire(id)(image,quality)
  }:nativeRequire(id)
  loaded._compile(source,filename)
  return (bytes,options)=>{input=null;const preview=loaded.exports.extractLegacyAiRasterPreview(bytes,options);return {preview,...input}}
}
module.exports={rasterCapture}
