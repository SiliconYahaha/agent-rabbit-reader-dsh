'use strict'
const fs=require('node:fs'),path=require('node:path')
const {cases}=require('./svg-path-grammar')
const styled = [
 ['transformed-fill','<g transform="translate(10 5) rotate(20 40 40)"><path d="M10 10A30 30 0 0 1 40 40L10 40Z" fill="red" stroke="blue" stroke-width="2"/></g>'],
 ['evenodd','<path d="M10 10H90V90H10Z M30 30H70V70H30Z" fill="red" fill-rule="evenodd"/>'],
 ['linear-bbox','<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M10 20H90V70H10Z" fill="url(#g)"/>'],
 ['radial-bbox','<defs><radialGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient></defs><path d="M10 45A40 20 0 1 0 90 45A40 20 0 1 0 10 45Z" fill="url(#g)"/>'],
 ['linear-transform','<defs><linearGradient id="g" gradientTransform="rotate(90 .5 .5)"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M10 20H90V70H10Z" fill="url(#g)"/>'],
 ['linear-user-space','<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="90" y2="0"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M10 20H90V70H10Z" fill="url(#g)"/>'],
 ['clip-rect','<defs><clipPath id="c"><rect x="10" y="10" width="40" height="60"/></clipPath></defs><path d="M10 45A40 20 0 1 0 90 45A40 20 0 1 0 10 45Z" fill="red" clip-path="url(#c)"/>'],
 ['opacity-fill','<path d="M10 45A40 20 0 1 0 90 45A40 20 0 1 0 10 45Z" fill="red" opacity=".5"/>'],
 ['dashed-stroke','<path d="M10 10A40 40 0 0 1 50 50" fill="none" stroke="red" stroke-width="3" stroke-dasharray="3 2" stroke-linecap="round"/>']
].map(([name,body])=>({name,source:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+body+'</svg>'}))
const publicSamples=require('../fixtures/svg-native-path/sources.json').map(info=>({...info,source:info.source,sourceText:fs.readFileSync(path.join(__dirname,'../fixtures/svg-native-path',info.name),'utf8')}))
const inputs=[...cases,...require('../../compatibility/runs/2026-09-05-svg-next-arc-pixels.json').inputs,...styled,...publicSamples.map(p=>({name:p.name,source:p.sourceText}))]
const nextInputs=Array.from({length:32},(_,i)=>({name:'curved-clip-'+(i+1),source:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="c"><path d="M10 50A'+(20+i)+' '+(10+i/2)+' '+(i*11)+' 0 '+(i%2)+' 90 50L50 90Z"/></clipPath></defs><path d="M0 0H100V100H0Z" fill="red" clip-path="url(#c)"/></svg>'}))
module.exports={inputs,styled,publicSamples,nextInputs}
