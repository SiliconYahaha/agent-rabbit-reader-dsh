'use strict'
const fs=require('node:fs'),path=require('node:path')
const wrap=body=>'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'+body+'</svg>'
const rectangle=(x,y,w,h)=>`M${x} ${y}h${w}v${h}h${-w}Z`
const cases=[]
function add(name,content,paints,options={}){
 const clip=options.clip||[0,0,.5,.5],matrix=options.matrix
 const source=wrap('<defs>'+(options.defs||'')+'<clipPath id="c" clipPathUnits="objectBoundingBox"><rect x="'+clip[0]+'" y="'+clip[1]+'" width="'+clip[2]+'" height="'+clip[3]+'"/></clipPath></defs><rect width="256" height="256" fill="red"/><g id="target" fill="green" clip-path="url(#c)"'+(matrix?' transform="matrix('+matrix.join(' ')+')"':'')+'>'+content+'</g>')
 cases.push({name,source,oracle:{measureId:'target',clip,matrix,paints}})
}
for(let i=0;i<32;i++){const x=i%4*4,y=i%3*8,w=128+i*4,h=64+i%8*8;add('container-rect-'+i,`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`,[{d:rectangle(x,y,w,h)}],{matrix:i%2?[-1,0,0,1,256,0]:null})}
const rect='<rect width="128" height="128"/>',paint={d:rectangle(0,0,128,128)}
for(const [name,attrs] of [['hidden','visibility="hidden"'],['transparent','opacity="0"'],['no-fill','fill="none"'],['no-display','display="none"']])add(name,rect+'<rect width="256" height="256" '+attrs+'/>',[paint])
add('defs-excluded',rect+'<defs><rect width="256" height="256"/></defs>',[paint])
add('stroke-excluded',rect+'<rect x="16" y="16" width="16" height="16" fill="none" stroke="green" stroke-width="128"/>',[paint,{d:rectangle(16,16,16,16),stroke:'green',width:128}])
add('child-translation','<g transform="translate(20 12)">'+rect+'</g>',[{...paint,matrix:[1,0,0,1,20,12]}])
add('use-group','<use href="#part" x="20" y="12"/>',[{...paint,matrix:[1,0,0,1,20,12]}],{defs:'<g id="part">'+rect+'</g>'})
add('nested-viewport','<svg x="20" y="12" width="128" height="64" viewBox="0 0 128 128">'+rect+'</svg>',[{...paint,matrix:[.5,0,0,.5,52,12]}])
const paths=[['cubic','M20 20C20 180 180 180 180 20Z'],['quadratic','M20 20Q100 220 180 20Z'],['smooth','M20 40C20 200 80 200 80 40S160 -60 200 40Z'],['arc','M20 100A90 45 35 0 1 180 100Z'],['reflected-arc','M20 100A90 45 35 1 0 180 100Z']]
for(const [name,d] of paths){add(name,'<path d="'+d+'"/>',[{d}]);add(name+'-skew','<path transform="matrix(.8 .1 .2 .8 10 20)" d="'+d+'"/>',[{d,matrix:[.8,.1,.2,.8,10,20]}])}
const root=path.join(__dirname,'../fixtures/svg-container-bounds')
const normalize=(s,units)=>s.replace(/<svg\b([^>]*)>/,(_,a)=>'<svg'+a.replace(/\s(?:width|height|viewBox)="[^"]*"/g,'')+' width="256" height="256" viewBox="0 0 '+units+' '+units+'">')
for(const row of require('../fixtures/svg-container-bounds/sources.json')){const units=row.name==='clip-path-objectboundingbox-002.svg'?400:200;cases.push({name:row.name,source:normalize(fs.readFileSync(path.join(root,row.name),'utf8'),units),referenceSource:normalize(fs.readFileSync(path.join(root,row.reference),'utf8'),units)})}
module.exports={cases,add,wrap,rectangle}
