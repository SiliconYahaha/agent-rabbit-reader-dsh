'use strict'
const XLSX = require('./vendor/xlsx')
const { DOMParser } = require('./vendor/xml')
const docToText = require('./vendor/doc-to-text')
let kernel
const MAX_BYTES = 25 * 1024 * 1024
const escape = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
function xml(text) {
  if (text.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('文档结构过大或包含不支持的实体声明')
  let depth=0
  for(const tag of text.matchAll(/<\/?[A-Za-z_][^>]*>/g)){if(tag[0][1]==='/')depth--;else if(!tag[0].endsWith('/>')&&++depth>100)throw Error('文档嵌套过深')}
  return new DOMParser({onError:(level,message)=>{if(level!=='warning')throw Error(message)}}).parseFromString(text,'text/xml')
}
function nodes(root, local) { return Array.from(root.getElementsByTagName('*')).filter(n=>n.localName===local) }
function children(root,local){return Array.from(root.childNodes||[]).filter(n=>n.nodeType===1&&(!local||n.localName===local))}
function attr(node,local){return Array.from(node.attributes||[]).find(a=>a.localName===local)?.value||''}
function packageReader(bytes) {
 const f=kernel.fileInspector, descriptor=f.readZipDirectoryDescriptor(bytes)
 if(descriptor.zip64||descriptor.count>4096)throw Error('文档包过大，暂不能在手机中展开')
 const entries=f.inspectZip(bytes).zipIdentityEntries, names=new Map();let size=0
 for(const e of entries){if(names.has(e.name))throw Error('文档包含重名内容');names.set(e.name,e);size+=e.uncompressedSize;if(size>64*1024*1024||e.uncompressedSize>24*1024*1024||e.isLink||(!e.isDirectory&&!e.canOpen))throw Error('文档加密、展开后过大或包含不支持的条目')}
 const read=name=>{const e=names.get(name);if(!e)throw Error('文档缺少 '+name);return f.extractZipEntry(bytes,e,{maxSize:24*1024*1024})}
 const text=name=>f.decodeUtf8(read(name))
 // Validate actual streams before handing a ZIP to third-party decoders; headers alone are not a bound.
 for(const e of entries){if(e.isDirectory)continue;const data=read(e.name);if(/\.(xml|rels)$/i.test(e.name))xml(f.decodeUtf8(data))}
 return {read,text,has:name=>names.has(name),xml:name=>xml(text(name))}
}
function base64(bytes){if(typeof wx!=='undefined'&&wx.arrayBufferToBase64)return wx.arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));return Buffer.from(bytes).toString('base64')}
function safeHtml(html){
 if(html.length>3*1024*1024)throw Error('文档内容较多，超过本次排版上限')
 const dom=new DOMParser().parseFromString('<div>'+html+'</div>','text/html')
 let count=0
 const allowed=new Set('div p h1 h2 h3 h4 h5 h6 span strong b em i u s del sup sub blockquote pre code ul ol li table thead tbody tfoot tr th td a br hr img'.split(' '))
 function visit(n,depth){if(++count>40000||depth>100)throw Error('文档内容过多');if(n.nodeType===3)return escape(n.nodeValue);if(n.nodeType!==1)return '';const tag=n.localName.toLowerCase();if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style')||''))return '';if(!allowed.has(tag))return '';if(tag==='img'){const src=n.getAttribute('src')||'';return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)?'<img style="max-width:100%;height:auto" src="'+src+'"/>':''}let attrs='';for(const k of ['colspan','rowspan']){const v=n.getAttribute(k);if(/^[1-9]\d{0,2}$/.test(v||''))attrs+=' '+k+'="'+v+'"'}return '<'+tag+attrs+'>'+Array.from(n.childNodes).map(c=>visit(c,depth+1)).join('')+'</'+tag+'>'}
 return visit(dom.documentElement,0)
}
function wrap(body,note){return '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:18px;color:#243041;background:#fff;font:16px/1.65 sans-serif}img{max-width:100%;height:auto}table{border-collapse:collapse;min-width:100%}td,th{border:1px solid #ccd3da;padding:8px;white-space:pre-wrap}p{margin:0 0 12px}.note{font-size:12px;color:#697581}.slide{margin:0 0 28px;padding:16px;border:1px solid #ccd3da;border-radius:10px}h2{font-size:20px}</style></head><body>'+body+(note?'<p class="note">'+escape(note)+'</p>':'')+'</body></html>'}
const SHEET_PAGE_ROWS = 25
function openSpreadsheet(bytes) {
 if(bytes[0]===80&&bytes[1]===75){if(!packageReader(bytes).has('xl/workbook.xml'))throw Error('Excel 文档包损坏')}
 else if(![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v))throw Error('这份文件不是有效的 Excel 文档')
 const book=XLSX.read(bytes,{type:'array',cellHTML:false,cellFormula:false,bookVBA:false,dense:true})
 if(book.SheetNames.length>100)throw Error('工作表超过 100 张，暂不能完整展开')
 let cells=0
 for(const name of book.SheetNames){const ref=book.Sheets[name]?.['!ref'];if(!ref)continue;const r=XLSX.utils.decode_range(ref);cells+=(r.e.r-r.s.r+1)*(r.e.c-r.s.c+1);if(cells>200000)throw Error('表格超过 200000 个单元格，请拆分后查看')}
 return book
}
function spreadsheetPage(book,sheetIndex=0,pageIndex=0) {
 const name=book.SheetNames[sheetIndex],sheet=book.Sheets[name]
 if(!sheet)throw Error('工作表不存在')
 const range=sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']):null
 const pageCount=range?Math.ceil((range.e.r-range.s.r+1)/SHEET_PAGE_ROWS):1
 pageIndex=Math.max(0,Math.min(pageCount-1,pageIndex))
 if(!range)return {html:wrap('<h2>'+escape(name)+'</h2><p>空工作表</p>'),pageIndex,pageCount,sheetIndex,rowLabel:'空工作表'}
 const startRow=range.s.r+pageIndex*SHEET_PAGE_ROWS,endRow=Math.min(range.e.r,startRow+SHEET_PAGE_ROWS-1),columns=range.e.c-range.s.c+1
 const merged=new Map(),covered=new Set()
 for(const m of sheet['!merges']||[]){
  const sr=Math.max(m.s.r,startRow),sc=Math.max(m.s.c,range.s.c),er=Math.min(m.e.r,endRow),ec=Math.min(m.e.c,range.e.c)
  if(sr>er||sc>ec)continue
  merged.set(sr+','+sc,{rows:er-sr+1,cols:ec-sc+1,origin:m.s})
  for(let r=sr;r<=er;r++)for(let c=sc;c<=ec;c++)if(r!==sr||c!==sc)covered.add(r+','+c)
 }
 let out='<h2>'+escape(name)+'</h2><table style="table-layout:fixed;width:'+Math.max(320,columns*160)+'px;min-width:'+Math.max(320,columns*160)+'px">'
 for(let r=startRow;r<=endRow;r++){
  out+='<tr>'
  for(let c=range.s.c;c<=range.e.c;c++){
   const key=r+','+c;if(covered.has(key))continue
   const merge=merged.get(key),pos=merge?merge.origin:{r,c},cell=sheet['!data']?.[pos.r]?.[pos.c]||sheet[XLSX.utils.encode_cell(pos)]
   out+='<td style="width:'+(160*(merge?merge.cols:1))+'px;word-break:normal;overflow-wrap:break-word"'+(merge?' rowspan="'+merge.rows+'" colspan="'+merge.cols+'"':'')+'>'+escape(cell?XLSX.utils.format_cell(cell):'')+'</td>'
  }
  out+='</tr>'
 }
 out+='</table>'
 const html=wrap(out,'左右滑动查看各列；公式显示保存的结果，图表、宏不运行。')
 if(html.length>250000)throw Error('这一段表格文字过多，暂不能在手机内显示')
 return {html,pageIndex,pageCount,sheetIndex,rowLabel:'第 '+(startRow+1)+'–'+(endRow+1)+' 行 / 共 '+(range.e.r+1)+' 行'}
}
function spreadsheets(bytes){
 const book=openSpreadsheet(bytes)
 return book.SheetNames.map((_,i)=>{const first=spreadsheetPage(book,i,0);return Array.from({length:first.pageCount},(_,p)=>p?spreadsheetPage(book,i,p).html:first.html).join('')}).join('')
}
function normalize(base,target){const parts=(base+target).split('/'),out=[];for(const p of parts){if(p==='..'){if(!out.length)throw Error('文档引用越界');out.pop()}else if(p&&p!=='.')out.push(p)}return out.join('/')}
function relationships(pkg,part){const slash=part.lastIndexOf('/'),dir=part.slice(0,slash+1),path=dir+'_rels/'+part.slice(slash+1)+'.rels',out=new Map();if(pkg.has(path))for(const r of nodes(pkg.xml(path),'Relationship'))if(r.getAttribute('TargetMode')!=='External'){const target=r.getAttribute('Target')||'';if(!/^[a-z]+:/i.test(target)&&!target.startsWith('/'))out.set(r.getAttribute('Id'),normalize(dir,target))}return out}
function pptx(pkg){
 const pres=pkg.xml('ppt/presentation.xml'),rels=relationships(pkg,'ppt/presentation.xml'),ids=nodes(pres,'sldId');if(!ids.length||ids.length>200)throw Error('演示文稿没有幻灯片或超过 200 页')
 const slides=ids.map((id,i)=>{const rid=Array.from(id.attributes).find(a=>a.localName==='id'&&a.prefix==='r')?.value;const part=rels.get(rid);if(!part)throw Error('幻灯片引用损坏');const slide=pkg.xml(part),r=relationships(pkg,part),tree=nodes(slide,'spTree')[0];let body='';function shape(n){if(n.localName==='grpSp')return children(n).map(shape).join('');if(n.localName==='pic'){const blip=nodes(n,'blip')[0],path=blip&&r.get(attr(blip,'embed'));if(!path||!pkg.has(path))return '';const ext=path.split('.').pop().toLowerCase(),mime={png:'png',jpg:'jpeg',jpeg:'jpeg',gif:'gif'}[ext];if(!mime)return '<p>此页含暂不支持的矢量图片。</p>';return '<img src="data:image/'+mime+';base64,'+base64(pkg.read(path))+'"/>'}if(n.localName==='graphicFrame'){const table=nodes(n,'tbl')[0];if(!table)return '<p>此页含图表或嵌入对象。</p>';return '<table>'+children(table,'tr').map(tr=>'<tr>'+children(tr,'tc').map(tc=>'<td>'+nodes(tc,'p').map(p=>escape(nodes(p,'t').map(t=>t.textContent).join(''))).join('<br/>')+'</td>').join('')+'</tr>').join('')+'</table>'}return nodes(n,'p').map(p=>'<p>'+escape(nodes(p,'t').map(t=>t.textContent).join(''))+'</p>').join('')};if(tree)body=children(tree).map(shape).join('');return '<section class="slide"><h2>第 '+(i+1)+' 页</h2>'+body+'</section>'})
 return wrap(slides.join(''),'阅读模式按页显示文字、图片与表格；不还原演示动画、母版和精确位置。')
}
function legacyPpt(bytes){
 const cfb=XLSX.CFB.read(bytes,{type:'array'}),find=name=>{const data=XLSX.CFB.find(cfb,name)?.content;return data?new Uint8Array(data):null},stream=find('PowerPoint Document'),current=find('Current User');if(!stream||!current||current.length<24)throw Error('这份 PPT 不是可读取的演示文稿')
 const u32=(a,p)=>{if(p<0||p+4>a.length)throw Error('PPT 结构损坏');return (a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0},u16=(a,p)=>a[p]|a[p+1]<<8
 const record=p=>{const len=u32(stream,p+4),end=p+8+len;if(end>stream.length||end<p+8)throw Error('PPT 记录越界');return {p,end,type:u16(stream,p+2),version:stream[p]&15,instance:u16(stream,p)>>4}}
 let edit=u32(current,16),docId,persist=new Map(),seen=new Set()
 while(edit){if(seen.has(edit)||seen.size>1000)throw Error('PPT 编辑记录损坏');seen.add(edit);const e=record(edit);if(e.type!==4085||e.end<edit+32)throw Error('PPT 编辑记录无效');if(docId==null)docId=u32(stream,edit+24);const directory=record(u32(stream,edit+20));if(directory.type!==6002)throw Error('PPT 持久化目录无效');for(let p=directory.p+8;p<directory.end;){const header=u32(stream,p);p+=4;const start=header&0xfffff,count=header>>>20;if(p+count*4>directory.end)throw Error('PPT 目录越界');for(let j=0;j<count;j++,p+=4)if(!persist.has(start+j))persist.set(start+j,u32(stream,p))}edit=u32(stream,edit+16)}
 if(!persist.has(docId))throw Error('PPT 缺少当前文档');const doc=record(persist.get(docId));if(doc.type!==1000)throw Error('PPT 当前文档无效');let list
 for(let p=doc.p+8;p<doc.end;){const r=record(p);if(r.end>doc.end)throw Error('PPT 容器越界');if(r.type===4080&&r.instance===0)list=r;p=r.end}
 if(!list)throw Error('PPT 没有可读取的幻灯片')
 const slides=[];let slide=null
 function text(r){if(r.type===4000){let s='';for(let p=r.p+8;p+1<r.end;p+=2)s+=String.fromCharCode(u16(stream,p));return s}if(r.type===4008)return kernel.textDecoder.decodeText(stream.subarray(r.p+8,r.end),{encoding:'windows-1252'}).text;return ''}
 for(let p=list.p+8;p<list.end;){const r=record(p);if(r.end>list.end)throw Error('PPT 幻灯片目录损坏');if(r.type===1011){slide={id:u32(stream,p+8),text:[]};slides.push(slide)}else if(slide){const t=text(r);if(t)slide.text.push(t)}p=r.end}
 if(slides.length>200)throw Error('PPT 超过 200 页')
 function walk(r,depth,out){if(depth>40)throw Error('PPT 嵌套过深');if(r.type===4000||r.type===4008){out.push(text(r));return}if(r.version===15||r.type===0xf00d)for(let p=r.p+8;p<r.end;){const child=record(p);if(child.end>r.end)throw Error('PPT 子记录越界');walk(child,depth+1,out);p=child.end}}
 for(const s of slides){const offset=persist.get(s.id);if(offset==null)throw Error('PPT 缺少当前幻灯片');const out=[];walk(record(offset),0,out);for(const t of out)if(!s.text.includes(t))s.text.push(t)}
 if(!slides.some(s=>s.text.length))throw Error('这份旧版 PPT 暂未提取到可显示的正文')
 return wrap(slides.map((s,i)=>'<section class="slide"><h2>第 '+(i+1)+' 页</h2>'+s.text.map(t=>'<p>'+escape(t).replace(/[\r\n\v]/g,'<br/>')+'</p>').join('')+'</section>').join(''),'旧版 PPT 当前显示各页正文；图片、图形和原始版式暂未还原。')
}
function legacyWord(bytes){
 const model=docToText.model(bytes);if(!model||!Array.isArray(model.body))throw Error('这份 DOC 加密、损坏或版本暂不支持')
 if(model.body.length>20000)throw Error('文档段落过多')
 const color=n=>'#'+[n&255,(n>>>8)&255,(n>>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('')
 function runs(p){return p.runs.filter(r=>!r.hidden).map(r=>{let value=escape(r.text).replace(/[\r\n\v]/g,'<br/>');for(const [on,tag] of [[r.b,'b'],[r.i,'i'],[r.u,'u'],[r.strike,'s'],[r.va==='super','sup'],[r.va==='sub','sub']])if(on)value='<'+tag+'>'+value+'</'+tag+'>';let style='';if(Number.isFinite(r.color))style+='color:'+color(r.color)+';';if(Number.isFinite(r.size)&&r.size>0)style+='font-size:'+Math.min(r.size,48)+'pt;';return '<span style="'+style+'">'+value+'</span>'}).join('')}
 let out='',table=false,row=false
 const close=()=>{if(row){out+='</tr>';row=false}if(table){out+='</table>';table=false}}
 for(const p of model.body){if(p.kind==='cell'||p.kind==='rowEnd'){if(!table){out+='<table>';table=true}if(!row){out+='<tr>';row=true}out+='<td>'+runs(p)+'</td>';if(p.kind==='rowEnd'){out+='</tr>';row=false}}else{close();out+='<p>'+(p.list?escape(p.list.marker||'•')+' ':'')+runs(p)+'</p>'}}
 close();return wrap(out,'正文阅读模式；复杂表格合并、版式与部分对象可能简化。')
}

async function render(input,extension){const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(!bytes.length||bytes.length>MAX_BYTES)throw Error('文档为空或超过 25 MB');const zipped=bytes[0]===80&&bytes[1]===75,pkg=zipped?packageReader(bytes):null
 if(['xlsx','xlsm','xls'].includes(extension)){if(extension==='xls'){if(![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v))throw Error('这份 XLS 不是有效的 Excel 二进制文档')}else if(!pkg||!pkg.has('xl/workbook.xml'))throw Error('Excel 文档包损坏');return spreadsheets(bytes)}
 if(extension==='pptx'){if(!pkg)throw Error('PPTX 文档包损坏');return pptx(pkg)}
 if(extension==='ppt')return legacyPpt(bytes)
 if(extension==='doc')return legacyWord(bytes)
 if(['docx','docm'].includes(extension)){if(!pkg)throw Error('Word 文档包损坏');const word=await kernel.subpackageLoader.load('../../office-word/index.js','Word');const html=await word.render(bytes);return wrap(safeHtml(html),'正文阅读模式，保留文字、表格与内嵌图片；宏与外部链接内容不运行。')}
 throw Error('暂不支持这种文档')
}
module.exports={attach(k){kernel=k;return module.exports},render,openSpreadsheet,spreadsheetPage,packageReader,safeHtml,MAX_BYTES}
