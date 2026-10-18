'use strict'
const MAX_BYTES=25*1024*1024
const readerError=message=>Object.assign(new Error(message),{userMessage:message})
Component({
 properties:{file:Object},
 observers:{file(file){if(this._attached&&file)this.open(file)}},
 data:{diagnostic:'',busy:true,error:'',pageNumber:1,pageCount:0,width:1,height:1,zoomed:false,imagePath:'',canvasFallback:false,needsPassword:false,passwordMessage:''},
 lifetimes:{attached(){this._attached=true;if(this.properties.file)this.open(this.properties.file)},detached(){this._attached=false;this.dispose()}},
 methods:{
  dispose(){this._updatePassword=null;this._passwordDraft='';this._generation=(this._generation||0)+1;try{this._render?.cancel()}catch(_){};this._render=null;const task=this._task;this._task=null;this._pdf=null;for(const path of this._pageImages||[])wx.getFileSystemManager().unlink({filePath:path,fail(){}});this._pageImages=new Set();if(task)Promise.resolve(task.destroy()).catch(()=>{});if(this._canvas){this._canvas.width=this._canvas.height=1;this._canvas=null}},
  async open(file){
   this.dispose();const generation=this._generation;this._phase='read';this.setData({diagnostic:'',busy:true,error:'',pageCount:0,pageNumber:1,zoomed:false,imagePath:'',canvasFallback:false,needsPassword:false,passwordMessage:''})
   try{
    const fs=wx.getFileSystemManager(),path=file.path||file.tempFilePath
    const stats=await new Promise((resolve,reject)=>fs.stat({path,success:r=>resolve(r.stats),fail:reject}))
    if(generation!==this._generation)return
    if(!Number.isFinite(Number(stats.size))||Number(stats.size)<=0||Number(stats.size)>MAX_BYTES)throw readerError('文件为空或超过 25 MB，暂不能在页内显示。')
    const data=await new Promise((resolve,reject)=>fs.readFile({filePath:path,success:r=>resolve(r.data),fail:reject}))
    if(generation!==this._generation)return
    if(Object.prototype.toString.call(data)!=='[object ArrayBuffer]'||data.byteLength!==Number(stats.size))throw readerError('文件读取不完整，请重新选择。')
    this._phase='parse';this._engine=require('../../index');this._task=this._engine.open(new Uint8Array(data));const task=this._task;this._task.onPassword=(update,reason)=>{if(generation!==this._generation)return;this._updatePassword=update;this.setData({busy:false,needsPassword:true,passwordMessage:reason===2?'密码不正确，请重试':'请输入文档密码'});this.triggerEvent('ready',{password:true})}
    const pdf=await task.promise
    if(generation!==this._generation){await task.destroy();return}
    this._pdf=pdf;this.setData({pageCount:pdf.numPages});await this.render(1,generation)
   }catch(error){this.fail(error,generation)}
  },
  fail(error,generation){if(generation!==this._generation||!this._attached)return;this._pdfDiagnostic=String(error.stack||error.errMsg||error);const diagnostic=(this._phase||'open')+' · '+String(error.message||error.errMsg||error).replace(/(?:https?:|wxfile:)[^\s]+/g,'[本机路径]').slice(0,200);this.setData({diagnostic,busy:false,error:this.data.error||error.userMessage||'暂时无法在小程序内显示，请重试或提交反馈。'});this.triggerEvent('error',{message:String(error.message||error)})},
  async waitForCanvas(generation){
   // Async component mounting and phone layout can finish after setData.
   for(let attempt=0;attempt<16;attempt++){
    if(generation!==this._generation||!this._attached)return null
    const canvas=await new Promise(resolve=>this.createSelectorQuery().select('#pdf-canvas').fields({node:true}).exec(r=>resolve(r[0]?.node)))
    if(generation!==this._generation||!this._attached)return null
    if(canvas)return canvas
    if(attempt<15)await new Promise(resolve=>setTimeout(resolve,64))
   }
   return null
  },
  async render(number,generation=this._generation){
   if(!this._pdf||generation!==this._generation)return
   const changedPage=number!==this.data.pageNumber
   this.setData({busy:true,error:'',canvasFallback:false})
   try{
    this._phase='page';const page=await this._pdf.getPage(number);if(generation!==this._generation)return
    // Some design exports have a valid but entirely empty PDF compatibility page.
    // Surface this to the design host so its saved author preview can be used.
    if(this._pdf.numPages===1&&/\.(ai|ait)$/i.test(this.properties?.file?.name||'')){
     const operators=await page.getOperatorList();if(generation!==this._generation)return
     if(!this._engine.hasPaint(operators))throw readerError('文件没有可显示的兼容画面。')
    }
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync()
    const measured=await new Promise(resolve=>this.createSelectorQuery().select('.pdf-view').boundingClientRect().exec(r=>resolve(r[0]?.width)))
    if(generation!==this._generation)return
    const cssWidth=Math.min(info.windowWidth,measured>0?measured:info.windowWidth)*(this.data.zoomed?1.5:1),base=page.getViewport({scale:1}),ratio=Math.min(info.pixelRatio||1,2)
    const scale=Math.min(cssWidth/base.width,Math.sqrt(8*1024*1024/(base.width*base.height))/ratio)
    const viewport=page.getViewport({scale:scale*ratio}),width=viewport.width/ratio,height=viewport.height/ratio
    await new Promise(resolve=>this.setData({width,height,pageNumber:number},resolve))
    if(generation!==this._generation)return
    this._phase='canvas';const canvas=await this.waitForCanvas(generation)
    if(generation!==this._generation)return
    if(!canvas)throw new Error('PDF 画布未就绪')
    this._canvas=canvas;canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
    const ctx=this._engine.context(canvas);ctx._pdfResetTransform()
    this._phase='render';this._render=page.render({canvasContext:ctx,viewport,annotationMode:this._engine.annotationMode})
    await this._render.promise;if(generation!==this._generation)return
    let exported
    try{exported=await this.exportPage(canvas)}catch(error){
     // The page has rendered successfully. Some phones cannot export a hidden
     // Canvas: retain its actual pixels in-page instead of replacing them with an error.
     if(generation!==this._generation)return
     this._pdfExportDiagnostic=String(error.errMsg||error.message||error)
    }
    if(generation!==this._generation){if(exported)wx.getFileSystemManager().unlink({filePath:exported.tempFilePath,fail(){}});return}
    for(const path of this._pageImages)wx.getFileSystemManager().unlink({filePath:path,fail(){}});this._pageImages.clear();
    if(exported)this._pageImages.add(exported.tempFilePath)
    this.setData({imagePath:exported?exported.tempFilePath:'',canvasFallback:!exported});
    page.cleanup();if(changedPage&&wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:0});this._render=null;this.setData({busy:false});this.triggerEvent('ready',{page:number,pages:this._pdf.numPages})
   }catch(error){this.fail(error,generation)}
  },
  async exportPage(canvas){
   try{return await new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvas,fileType:'png',destWidth:canvas.width,destHeight:canvas.height,success:resolve,fail:reject},this))}catch(error){
    if(typeof canvas.toDataURL!=='function')throw error
    const url=canvas.toDataURL('image/png'),prefix='data:image/png;base64,'
    if(typeof url!=='string'||!url.startsWith(prefix)||url.length===prefix.length)throw error
    const tempFilePath=wx.env.USER_DATA_PATH+'/pdf-page-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.png'
    await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:tempFilePath,data:url.slice(prefix.length),encoding:'base64',success:resolve,fail:reject}))
    return {tempFilePath}
   }
  },
  previous(){if(!this.data.busy&&this.data.pageNumber>1)this.render(this.data.pageNumber-1)},
  next(){if(!this.data.busy&&this.data.pageNumber<this.data.pageCount)this.render(this.data.pageNumber+1)},
  zoom(){if(this.data.busy)return;this.setData({zoomed:!this.data.zoomed});this.render(this.data.pageNumber)},
  retry(){this.open(this.properties.file)},
  passwordInput(event){this._passwordDraft=event.detail.value},
  unlock(){if(!this._updatePassword||!this._passwordDraft)return;const update=this._updatePassword;this._updatePassword=null;this.setData({needsPassword:false,busy:true});update(this._passwordDraft);this._passwordDraft=''}
 }
})
