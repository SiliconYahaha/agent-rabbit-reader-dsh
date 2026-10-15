'use strict'
const fs=require('node:fs'),path=require('node:path')
const cases=require('../../compatibility/runs/2026-09-05-svg-next-clip-unions.json').inputs.map(c=>({...c}))
const dir=path.join(__dirname,'../fixtures/svg-clip-unions')
const normalize=s=>s.replace('<svg ','<svg width="256" height="256" viewBox="0 0 200 200" ')
for(const row of require('../fixtures/svg-clip-unions/sources.json'))cases.push({name:row.name,source:normalize(fs.readFileSync(path.join(dir,row.name),'utf8')),referenceSource:normalize(fs.readFileSync(path.join(dir,row.reference),'utf8'))})
// The expected contour is derived directly from axis-aligned rectangle union,
// then transformed by Canvas. It does not use the PathKit production kernel.
for(let i=0;i<12;i++){
 const matrix=i%2?[1,0,0,1,i,0]:[-1,0,0,1,100,0]
 const original=cases[i]
 cases.push({name:'union-transform-'+i,source:original.source.replace('<clipPath id="c">','<clipPath id="c" transform="matrix('+matrix.join(' ')+')">'),expected:{...original.expected,clips:original.expected.clips.map(c=>({...c,matrix}))}})
}
module.exports={cases}
