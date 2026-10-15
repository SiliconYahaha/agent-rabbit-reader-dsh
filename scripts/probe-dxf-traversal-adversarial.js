'use strict'
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
function drawing (kind) {
  const block = (name, content) => `0\nBLOCK\n2\n${name}\n10\n0\n20\n0\n${content}0\nENDBLK\n`
  const insert = (name, count = 1, spacing = 1) => `0\nINSERT\n2\n${name}\n70\n${count}\n71\n${count}\n44\n${spacing}\n45\n${spacing}\n`
  const line = '0\nLINE\n10\n0\n20\n0\n11\n4\n21\n2\n'
  let blocks, entities
  if (kind === 'cycle') { blocks = block('LOOP', insert('LOOP', 20)); entities = insert('LOOP') }
  else if (kind === 'empty-tree') { blocks = block('B0', ''); for (let n=1;n<=6;n++) blocks += block('B'+n, insert('B'+(n-1),20)); entities=insert('B6',20) }
  else if (kind === 'unsupported-tree') { blocks=block('B0','0\nPOINT\n10\n0\n20\n0\n'); for(let n=1;n<=6;n++) blocks+=block('B'+n,insert('B'+(n-1),20)); entities=insert('B6',20) }
  else if (kind === 'empty-huge') { blocks=block('UNIT',''); entities=insert('UNIT',32767)+line }
  else if (kind === 'reuse') { blocks=block('UNIT',line); entities=insert('UNIT')+insert('UNIT') }
  else if (kind === 'huge') { blocks=block('UNIT',line); entities=insert('UNIT',32767) }
  else throw Error('unknown case')
  return Buffer.from('0\nSECTION\n2\nBLOCKS\n'+blocks+'0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'+entities+'0\nENDSEC\n0\nEOF\n')
}
if (require.main === module) {
  const output = path.resolve(process.argv[2] || 'outputs/dxf-grid-traversal/adversarial-before.json')
  const results=[]
  for (const kind of ['cycle','empty-tree','unsupported-tree','empty-huge','reuse','huge']) {
    const raw=drawing(kind), start=Date.now()
    const code=`const {inspectFileBytes}=require('./miniprogram/file-reader/engine/core/file-inspector');try{const i=inspectFileBytes(Buffer.from(${JSON.stringify(raw.toString('base64'))},'base64'),{name:'x.dxf'});console.log(JSON.stringify({preview:!!i.previewSvg,metadata:i.metadata}))}catch(e){console.log(JSON.stringify({error:e.message}))}`
    const r=spawnSync(process.execPath,['-e',code],{timeout:2000,encoding:'utf8'})
    results.push({kind,base64:raw.toString('base64'),elapsedMs:Date.now()-start,timedOut:r.error?.code==='ETIMEDOUT',status:r.status,signal:r.signal,result:r.stdout.trim()?JSON.parse(r.stdout):null})
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');console.log(results.map(({kind,timedOut,result})=>({kind,timedOut,error:result?.error,preview:result?.preview})))
}
module.exports={drawing}
