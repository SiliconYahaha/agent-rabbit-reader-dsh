'use strict'
const wrap=(defs,body)=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>'+defs+'</defs>'+body+'</svg>'
const target='<path d="M0 0H100V100H0Z" fill="red" clip-path="url(#c)"/>'
const arc='M10 50A40 40 0 0 1 90 50L50 90Z'
const make=(name,content,attrs='',body=target,defs='')=>({name,source:wrap(defs+'<clipPath id="c" '+attrs+'>'+content+'</clipPath>',body)})
const cases=[...require('../../compatibility/runs/2026-09-05-svg-next-curved-clips.json').inputs,
 make('minimal-quarter','<path d="M0 0H90A90 90 0 0 1 0 90Z"/>'),
 make('child-evenodd','<path clip-rule="evenodd" d="M10 10H90V90H10Z M30 30H70V70H30Z"/>'),
 make('inherited-evenodd','<path d="M10 10H90V90H10Z M30 30H70V70H30Z"/>','clip-rule="evenodd"'),
 make('child-nonzero-override','<path clip-rule="nonzero" d="M10 10H90V90H10Z M30 30H70V70H30Z"/>','clip-rule="evenodd"'),
 make('child-transform','<path d="'+arc+'" transform="translate(5 2) scale(.8)"/>'),
 make('reference-transform','<path d="'+arc+'"/>','transform="translate(5 2) scale(.8)"'),
 make('direct-use','<use href="#p" x="5" y="2" transform="scale(.8)"/>','',target,'<path id="p" d="'+arc+'"/>'),
 make('missing-use','<use href="#missing"/>'),
 make('self-use','<use id="u" href="#u"/>'),
 make('mutual-use','<use id="u" href="#v"/>','',target,'<use id="v" href="#u"/>'),
 make('indirect-use','<use href="#u"/>','',target,'<use id="u" href="#p"/><path id="p" d="'+arc+'"/>'),
 make('empty-clip',''),
 make('hidden-child','<path d="'+arc+'" visibility="hidden"/>'),
 make('hidden-one-of-two','<path d="'+arc+'" visibility="hidden"/><path d="M0 0H40V40H0Z"/>'),
 make('zero-opacity-child','<path d="'+arc+'" opacity="0"/>'),
 make('bounds-units','<path d="M0 0H1A1 1 0 0 1 0 1Z"/>','clipPathUnits="objectBoundingBox"','<path d="M10 20H80V70H10Z" fill="red" clip-path="url(#c)"/>'),
 make('multi-child-union','<path d="M10 10H70V70H10Z"/><path d="M30 30V90H90V30Z"/>'),
 make('nested-clip','<path d="'+arc+'" clip-path="url(#inner)"/>','',target,'<clipPath id="inner"><rect width="50" height="100"/></clipPath>')
]
const rectangle='M0 0H100V100H0Z', hole='M10 10H90V90H10Z M30 30H70V70H30Z'
for(const c of cases){
 c.expected={clips:[{d:arc}],target:rectangle,fill:'red',units:100}
 if(c.name.startsWith('curved-clip-'))c.expected.clips[0].d=c.source.match(/<clipPath[^>]*><path d="([^"]+)"/)[1]
}
const set=(name,data)=>Object.assign(cases.find(c=>c.name===name).expected,data)
set('minimal-quarter',{clips:[{d:'M0 0H90A90 90 0 0 1 0 90Z'}]})
for(const name of ['child-evenodd','inherited-evenodd'])set(name,{clips:[{d:hole,rule:'evenodd'}]})
set('child-nonzero-override',{clips:[{d:hole,rule:'nonzero'}]})
for(const name of ['child-transform','reference-transform'])set(name,{clips:[{d:arc,matrix:[.8,0,0,.8,5,2]}]})
set('direct-use',{clips:[{d:arc,matrix:[.8,0,0,.8,4,1.6]}]})
for(const name of ['missing-use','self-use','mutual-use','indirect-use','empty-clip','hidden-child'])set(name,{clips:[{d:''}]})
set('hidden-one-of-two',{clips:[{d:'M0 0H40V40H0Z'}]})
set('bounds-units',{clips:[{d:'M0 0H1A1 1 0 0 1 0 1Z',matrix:[70,0,0,50,10,20]}],target:'M10 20H80V70H10Z'})
set('multi-child-union',{clips:[{d:'M10 10H70V30H90V90H30V70H10Z'}]})
set('nested-clip',{clips:[{d:'M0 0H50V100H0Z'},{d:arc}]})
const fs=require('node:fs'),path=require('node:path'),manifest=require('../fixtures/svg-curved-clips/sources.json')
const normalize=s=>s.replace('<svg ','<svg width="256" height="256" viewBox="0 0 200 200" ')
const publicSamples=manifest.map(info=>({...info,sourceText:fs.readFileSync(path.join(__dirname,'../fixtures/svg-curved-clips',info.name),'utf8'),referenceText:fs.readFileSync(path.join(__dirname,'../fixtures/svg-curved-clips',info.reference),'utf8')}))
for(const p of publicSamples)cases.push({name:p.name,source:normalize(p.sourceText),referenceSource:normalize(p.referenceText)})
module.exports={cases,publicSamples,wrap,make,arc,target}
