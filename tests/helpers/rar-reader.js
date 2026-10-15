'use strict'
const { readerPage } = require('./reader-host')
function harness () {
  const files=new Map(), writes=[], pending=[]
  const page=readerPage({env:{USER_DATA_PATH:'/fixture'},getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),getFileSystemManager:()=>({
    readFile:o=>{const data=files.get(o.filePath);pending.push(Promise.resolve(data?o.success({data}):o.fail?.({errMsg:'missing'})))},
    writeFile:o=>{const bytes=Buffer.from(o.data);files.set(o.filePath,bytes);writes.push(bytes);o.success()}
  })})
  async function settle () { while(pending.length) await Promise.all(pending.splice(0)) }
  async function open (sample) {files.set('/input.rar',sample.bytes);page.openSelectedFile({name:sample.name+'.rar',path:'/input.rar',size:sample.bytes.length});await settle()}
  async function tap () {await page.openInspectorEntry({detail:{index:0}});await settle()}
  return {page,writes,open,tap,files,settle}
}
module.exports = { harness }
