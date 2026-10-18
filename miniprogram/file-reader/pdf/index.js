'use strict'
const lib = require('../shared/pdf-runtime/vendor/pdf')
const { context }=require('../shared/pdf-runtime/canvas')
const worker = require('./vendor/pdf.worker')
Object.defineProperty(lib.PDFWorker, '_setupFakeWorkerGlobal', { value: Promise.resolve(worker.WorkerMessageHandler) })
let assets
async function asset (folder, name) {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) throw new Error('PDF 字体名称无效')
  if (!assets) assets = new Promise((resolve,reject)=>wx.loadSubpackage({name:'pdf-assets',success:resolve,fail:reject})).catch(error => { assets = null;throw error })
  await assets
  return new Promise((resolve, reject) => wx.getFileSystemManager().readCompressedFile({ filePath:`/pdf-assets/${folder}/${name}.br`, compressionAlgorithm:'br', success:result=>resolve(new Uint8Array(result.data)),fail:reject }))
}
class CanvasFactory {
  create (width,height) {
    if (width*height > 8*1024*1024) throw new Error('PDF 页面图像过大')
    const canvas=wx.createOffscreenCanvas({type:'2d',width,height})
    return {canvas,context:context(canvas)}
  }
  reset (pair,width,height) { if(width*height>8*1024*1024)throw new Error('PDF 页面图像过大');pair.canvas.width=width;pair.canvas.height=height;pair.context._pdfResetTransform() }
  destroy (pair) { if(pair.canvas)pair.canvas.width=pair.canvas.height=0;pair.canvas=null;pair.context=null }
}
class FilterFactory {
  addFilter () { return 'none' } addHCMFilter () { return 'none' }
  addAlphaFilter () { return 'none' } addLuminosityFilter () { return 'none' }
  addKnockoutFilter () { return 'none' } destroy () {}
}
class BinaryDataFactory {
  fetch ({kind,filename}) {
    if(kind==='standardFontDataUrl')return asset('standard_fonts',filename)
    if(kind==='cMapUrl')return asset('cmaps',filename)
    return Promise.reject(new Error('不支持的 PDF 资源类型'))
  }
}
module.exports = {
  context,
  hasPaint(operators) {
    const stateOnly = new Set([lib.OPS.dependency, lib.OPS.transform, lib.OPS.setGState, lib.OPS.save, lib.OPS.restore])
    return operators.fnArray.some(op => !stateOnly.has(op))
  },
  annotationMode:lib.AnnotationMode.DISABLE,
  open (data) {
    return lib.getDocument({data,CanvasFactory,FilterFactory,BinaryDataFactory,
      standardFontDataUrl:'local/',cMapUrl:'local/',cMapPacked:true,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,
      isImageDecoderSupported:false,useWasm:false,isEvalSupported:false,stopAtErrors:true,
      maxImageSize:8*1024*1024,canvasMaxAreaInBytes:32*1024*1024,enableXfa:false})
  }
}
