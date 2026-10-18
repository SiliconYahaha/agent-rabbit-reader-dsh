'use strict'
const mammoth = require('./vendor/mammoth')
exports.render = async function(bytes) {
 const result = await mammoth.convertToHtml({arrayBuffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}, {externalFileAccess:false,includeEmbeddedStyleMap:false,convertImage:mammoth.images.imgElement(async image=>{
  if(!/^image\/(png|jpeg|gif|webp)$/.test(image.contentType))return {alt:'此图片编码暂不支持'}
  const data=await image.read('base64');if(data.length>16*1024*1024)throw Error('文档图片过大');return {src:'data:'+image.contentType+';base64,'+data}
 })})
 return result.value
}
