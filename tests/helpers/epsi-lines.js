'use strict'
function document (width, height, depth, data, eol = '\n', options = {}) {
  const lines = ['%!PS-Adobe-3.0 EPSF-3.0', `%%BoundingBox: 0 0 ${width} ${height}`, '%%EndComments', options.header || `%%BeginPreview: ${width} ${height} ${depth} ${data.length}`, ...data, options.end || '%%EndPreview', '%%EOF']
  return Buffer.from(lines.map((line,i)=>line+(Array.isArray(eol)?eol[i%eol.length]:eol)).join(''))
}
function fixture (depth, wrap, eol) {
  const width=13,height=3,stride=Math.ceil(width*depth/8),packed=Buffer.alloc(stride*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const max=(1<<depth)-1,sample=y===0?0:y===1?max:Math.floor(x*max/(width-1)),bit=x*depth
    packed[y*stride+(bit>>3)]|=sample<<(8-depth-bit%8)
  }
  const hex=packed.toString('hex'),size=wrap==='row'?stride*2:wrap==='byte'?2:hex.length,data=[]
  for(let i=0;i<hex.length;i+=size)data.push('% '+hex.slice(i,i+size))
  return {width,height,depth,packed,data,bytes:document(width,height,depth,data,eol)}
}
function cases () {
  const rows=[]
  for(const depth of [1,2,4,8])for(const wrap of ['row','byte','joined'])for(const [ending,eol] of [['lf','\n'],['cr','\r'],['crlf','\r\n'],['lfcr','\n\r']]) rows.push({name:`depth${depth}-${wrap}-${ending}`,...fixture(depth,wrap,eol)})
  for(const [name,data] of [['inline-marker','00%%EndPreviewff'],['stray-marker','0011xyz%%EndPreview aabb']]) {
    const packed=Buffer.from(data.replace(/[^0-9a-f]/gi,''),'hex'),width=packed.length
    rows.push({name,width,height:1,depth:8,packed,bytes:document(width,1,8,['% '+data])})
  }
  for(const depth of [1,2,4,8]) {
    const c=fixture(depth,'row','\n'),data=[c.data[0],'% \t xyz',...c.data.slice(1)]
    rows.push({...c,name:`depth${depth}-nonhex-line`,bytes:document(c.width,c.height,depth,data)})
    rows.push({...c,name:`depth${depth}-mixed-lines`,bytes:document(c.width,c.height,depth,c.data,['\n','\r\n','\n\r','\r'])})
  }
  for(const word of ['BEGINPREVIEW','beginpreview']) {
    const head=`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1 1\n%%EndComments\n%%${word}: 1 1 8 1\n% ff\n%%EndPreview\n`
    rows.push({name:`unknown-${word==='BEGINPREVIEW'?'upper':'lower'}`,width:1,height:1,depth:8,packed:Buffer.from([0]),bytes:Buffer.from(head+'%%BeginPreview: 1 1 8 1\n% 00\n%%EndPreview\n%%EOF\n')})
  }
  rows.push({name:'tab-header',width:2,height:1,depth:8,packed:Buffer.from([0,255]),bytes:document(2,1,8,['% 00ff'],'\n',{header:'%%BeginPreview:\t2\t1\t8\t1\t'})})
  rows.push({name:'end-tabs',width:2,height:1,depth:8,packed:Buffer.from([255,0]),bytes:document(2,1,8,['% ff00'],'\n',{end:'%%EndPreview\t \t'})})
  return rows
}
module.exports={document,fixture,cases}
