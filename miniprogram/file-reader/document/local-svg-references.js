'use strict'
const { _internals: { parseAttributes } } = require('./html-compat')
const { bytesToBase64, utf8Encode } = require('./kernel').textCodec
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// Read only explicitly selected siblings. Never resolve arbitrary filesystem
// paths, URLs, parent directories, or ambiguous duplicate filenames.
function resolveLocalSvgReferences(html,siblings,fs,isCurrent=()=>true) {
 const matches=[]
 const tags=/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<(img|object|embed)\b((?:"[^"]*"|'[^']*'|[^'">])*)>(?:([\s\S]*?)<\/\1\s*>)?/gi
 let m
 while((m=tags.exec(html))){
  if(!m[1])continue
  const attrs=parseAttributes(m[1]+' '+m[2]);let ref=String(attrs.src||attrs.data||'').split(/[?#]/)[0]
  try{ref=decodeURIComponent(ref)}catch(_){continue}
  ref=ref.replace(/^\.\//,'')
  if(!/^[^/\\:]+\.svg$/i.test(ref))continue
  matches.push({start:m.index,end:tags.lastIndex,ref,attrs})
 }
 if(!matches.length)return null
 return (async()=>{
  const cache=new Map();let total=0
  for(const match of matches){
   if(!isCurrent())return null
   if(cache.has(match.ref)){match.content=cache.get(match.ref);continue}
   const candidates=(siblings||[]).filter(f=>f.name===match.ref)
   let content
   if(candidates.length!==1)content='<p>此网页需要 '+escape(match.ref)+'，请把对应 SVG 与网页一起选择后打开。</p>'
   else {
    try{
     const file=candidates[0],path=file.path||file.tempFilePath
     const info=await new Promise((resolve,reject)=>fs.stat({path,success:r=>resolve(r.stats),fail:reject}))
     if(!isCurrent())return null
     if(!info.size||info.size>512*1024||total+info.size>2*1024*1024)throw Error('SVG 资源过大')
     total+=info.size
     const raw=await new Promise((resolve,reject)=>fs.readFile({filePath:path,encoding:'utf8',success:r=>resolve(r.data),fail:reject}))
     if(!isCurrent())return null
     // Keep each referenced SVG as its own image document: CSS and duplicate
     // IDs must not leak into the HTML page or another selected SVG.
     content={src:'data:image/svg+xml;base64,'+bytesToBase64(utf8Encode(raw))}
    }catch(_){content='<p>暂时无法读取 '+escape(match.ref)+'，请重新选择对应 SVG 文件。</p>'}
   }
   cache.set(match.ref,content);match.content=content
  }
  let result=html
  for(const match of matches.reverse()){
   const attrs=['id','class','style','width','height','alt'].filter(k=>match.attrs[k]).map(k=>' '+k+'="'+escape(match.attrs[k])+'"').join('')
   const replacement=match.content.src?'<img'+attrs+' src="'+match.content.src+'"/>':'<div'+attrs+'>'+match.content+'</div>'
   result=result.slice(0,match.start)+replacement+result.slice(match.end)
  }
  return result
 })()
}
module.exports={resolveLocalSvgReferences}
