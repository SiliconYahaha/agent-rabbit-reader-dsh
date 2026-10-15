'use strict'
const cases = []
const wrap = body => '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">'+body+'</svg>'
const geometries = [
 ['circle','circle','cx="128.25" cy="127.75" r="79.5"'],
 ['wide','ellipse','cx="128.25" cy="127.75" rx="98.5" ry="41.25"'],
 ['tall','ellipse','cx="128.25" cy="127.75" rx="32.5" ry="103.25"'],
 ['thin','ellipse','cx="128.25" cy="127.75" rx="99.5" ry=".75"']
]
for (const [name,tag,geometry] of geometries) for (const [paint,attrs] of [
 ['fill','fill="#3379b7"'],['stroke','fill="none" stroke="#101018" stroke-width="3.5"'],
 ['dash','fill="none" stroke="#101018" stroke-width="4" stroke-dasharray="12 7" stroke-dashoffset="-3"'],
 ['caps','fill="none" stroke="#101018" stroke-width="6" stroke-dasharray="0 13" stroke-linecap="round"']
]) for (const [transform,matrix] of [['plain',''],['rotate','rotate(23 128 128)'],['skew','matrix(.8 .15 .25 .75 -5 15)']]) {
 const source=wrap(`<${tag} ${geometry} ${attrs} transform="${matrix}"/>`)
 cases.push({name:`${name}-${paint}-${transform}`,source,referenceSource:source})
}
for (const [name,body] of [
 ['gradient','<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><ellipse cx="128" cy="128" rx="95" ry="65" fill="url(#g)" stroke="black" stroke-width="2"/>'],
 ['nested-percent','<svg x="16" y="20" width="200" height="160" viewBox="0 0 320 180"><ellipse cx="50%" cy="50%" rx="35%" ry="40%" fill="none" stroke="black" stroke-width="3" stroke-dasharray="10 5"/></svg>'],
 ['use','<defs><ellipse id="e" cx="70" cy="75" rx="45" ry="65"/></defs><use href="#e" fill="none" stroke="black" stroke-width="3" stroke-dasharray="10 5"/><use href="#e" x="120" y="60" fill="#3379b7"/>'],
 ['clip','<defs><clipPath id="c"><rect x="40" y="40" width="120" height="160"/></clipPath></defs><ellipse cx="128" cy="128" rx="100" ry="70" fill="#3379b7" clip-path="url(#c)" stroke="black" stroke-width="4"/>'],
 ['fill-stroke-opacity','<ellipse cx="128" cy="128" rx="96" ry="63" fill="red" fill-opacity=".4" stroke="blue" stroke-opacity=".6" stroke-width="11"/>']
]) { const source=wrap(body);cases.push({name,source,referenceSource:source}) }
for (const time of [0,.5,1,1.5]) {
 const base='<ellipse cx="128" cy="128" rx="40" ry="70" fill="none" stroke="black" stroke-width="4" stroke-dasharray="12 7" stroke-dashoffset="-3">'
 cases.push({name:'animated-ellipse-'+time,time,source:wrap(base+'<animate attributeName="rx" from="40" to="100" dur="2s" repeatCount="indefinite"/></ellipse>'),referenceSource:wrap(base.replace('rx="40"',`rx="${40+30*time}"`)+'</ellipse>')})
}
module.exports = { cases }
