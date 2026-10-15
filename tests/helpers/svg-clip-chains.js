'use strict'
// Original, deterministic fixtures. Expected shapes are expressed directly in
// root coordinates, independently of the renderer's clipping/bounds code.
const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`
const rect = (x,y,w,h,attrs='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`
const clip = (id,body,attrs='') => `<clipPath id="${id}" ${attrs}>${body}</clipPath>`
const cases = []
function add(name,defs,expected,paint=rect(0,0,256,256,'fill="red" clip-path="url(#a)"'),extra={}) {
  cases.push({name,source:wrap(`<defs>${defs}</defs>${paint}`),referenceSource:wrap(`<g fill="red">${expected}</g>`),...extra})
}
const link = 'clip-path="url(#b)"', a = rect(16,16,160,160), b = rect(32,32,80,80)
add('own-attribute',clip('a',a,link)+clip('b',b),b)
add('own-inline-style',clip('a',a,'style="clip-path:url(#b)"')+clip('b',b),b)
add('own-stylesheet',`<style>#a{clip-path:url(#b)}</style>`+clip('a',a)+clip('b',b),b)
add('own-style-none',clip('a',a,link+' style="clip-path:none"')+clip('b',b),a)
add('nested-chain',clip('a',a,link)+clip('b',b,'clip-path="url(#c)"')+clip('c',rect(48,48,32,32)),rect(48,48,32,32))
add('union-before-intersection',clip('a',rect(0,0,64,128)+rect(128,0,64,128),link)+clip('b',rect(0,32,256,32)),rect(0,32,64,32)+rect(128,32,64,32))
add('union-on-reference',clip('a',a,link)+clip('b',rect(0,32,64,32)+rect(128,32,64,32)),rect(16,32,48,32)+rect(128,32,48,32))
add('union-both-sides',clip('a',rect(0,0,64,128)+rect(128,0,64,128),link)+clip('b',rect(0,32,160,32)+rect(0,96,160,32)),rect(0,32,64,32)+rect(128,32,32,32)+rect(0,96,64,32)+rect(128,96,32,32))
add('clip-transform',clip('a',a,link+' transform="translate(16 8)"')+clip('b',b),b)
add('both-transforms',clip('a',a,link+' transform="translate(16 8) scale(2)"')+clip('b',b,'transform="translate(8 4)"'),rect(48,40,72,76))
add('target-transform',clip('a',a,link)+clip('b',b),rect(48,40,80,80),rect(0,0,256,256,'fill="red" transform="translate(16 8)" clip-path="url(#a)"'))
add('shape-transform',clip('a',rect(0,0,80,80,'transform="translate(16 16) scale(2)"'),link)+clip('b',b),b)
add('object-box-own',clip('a',a,link)+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(64,64,112,112))
add('object-box-transformed-shape',clip('a',rect(0,0,80,80,'transform="translate(16 16) scale(2)"'),link)+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(64,64,112,112))
add('object-box-union',clip('a',rect(16,16,32,64)+rect(112,16,32,64),link)+clip('b',rect(.125,0,.75,1),'clipPathUnits="objectBoundingBox"'),rect(32,16,16,64)+rect(112,16,32,64))
add('object-box-outer',clip('a',rect(0,0,1,1),link+' clipPathUnits="objectBoundingBox"')+clip('b',rect(.25,.25,.5,.5)),'',rect(16,16,160,96,'fill="red" clip-path="url(#a)"'))
add('object-box-both',clip('a',rect(.25,.25,.5,.5),link+' clipPathUnits="objectBoundingBox"')+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(56,40,80,48),rect(16,16,160,96,'fill="red" clip-path="url(#a)"'))
add('zero-box',clip('a',rect(16,16,0,64),link)+clip('b',rect(0,0,1,1),'clipPathUnits="objectBoundingBox"'),'')
add('hidden-shape-box',clip('a',a+rect(0,0,256,256,'display="none"'),link)+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(64,64,112,112))
add('empty-own-clip',clip('a',a,link)+clip('b',''),'')
add('missing-own-reference',clip('a',a,link),a)
add('wrong-reference-type',clip('a',a,link)+rect(32,32,80,80,'id="b"'),a)
add('self-cycle',clip('a',a,'clip-path="url(#a)"'),'')
add('two-node-cycle',clip('a',a,link)+clip('b',b,'clip-path="url(#a)"'),'')
add('child-and-container',clip('a',rect(0,0,160,160,'clip-path="url(#c)"'),link)+clip('b',rect(32,0,96,160))+clip('c',rect(0,48,160,32)),rect(32,48,96,32))
add('direct-use',rect(0,0,128,128,'id="shape"')+clip('a','<use href="#shape" x="16" y="16"/>',link)+clip('b',b),b)
add('direct-use-object-box',rect(0,0,128,128,'id="shape"')+clip('a','<use href="#shape" x="16" y="16"/>',link)+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(64,64,80,80))
add('sibling-after-clip',clip('a',a,link)+clip('b',b),b+rect(192,192,32,32,'fill="blue"'),rect(0,0,256,256,'fill="red" clip-path="url(#a)"')+rect(192,192,32,32,'fill="blue"'))
// Flattening an enclosing clip leaves one silhouette. A one-level native clip
// is the independent reference; direct paint uses different edge AA coverage.
for(const [name,shape] of [['rounded',rect(32,32,80,64,'rx="8" ry="12"')],['ellipse','<ellipse cx="72" cy="64" rx="40" ry="32"/>']]) {
  const reference = `<defs>${clip('flat',shape)}</defs>${rect(0,0,256,256,'clip-path="url(#flat)"')}`
  add(name+'-inner',clip('a',a,link)+clip('b',shape),reference)
  add(name+'-outer',clip('a',shape,link)+clip('b',a),reference)
}
for(const time of [0,.5,1,1.5]) {
  const moving=rect(32,32,32,64).replace('/>','><animate attributeName="x" from="32" to="96" dur="2s" repeatCount="indefinite"/></rect>')
  add('animated-inner-'+time,clip('a',a,link)+clip('b',moving),rect(32+32*time,32,32,64),undefined,{time})
}
add('child-reference-chain-transform',clip('a',rect(0,0,128,128,'transform="translate(16 8)" clip-path="url(#b)"'))+clip('b',rect(0,0,128,128),'clip-path="url(#c)"')+clip('c',rect(32,32,32,32)),rect(48,40,32,32))
add('target-group-object-box',clip('a',rect(0,0,256,256),link)+clip('b',rect(.25,0,.5,1),'clipPathUnits="objectBoundingBox"'),rect(48,16,32,64),`<g fill="red" clip-path="url(#a)">${rect(16,16,64,64)+rect(112,16,32,64)}</g>`)
add('same-resource-different-target-boxes',clip('a',rect(0,0,256,256),link)+clip('b',rect(.25,.25,.5,.5),'clipPathUnits="objectBoundingBox"'),rect(16,16,32,32)+rect(160,96,64,64),rect(0,0,64,64,'fill="red" clip-path="url(#a)"')+rect(128,64,128,128,'fill="red" clip-path="url(#a)"'))
add('nested-svg-space',clip('a',rect(0,0,64,64),link)+clip('b',rect(16,16,32,32)),rect(64,48,64,64),`<svg x="32" y="16" width="128" height="128" viewBox="0 0 64 64">${rect(0,0,64,64,'fill="red" clip-path="url(#a)"')}</svg>`)
add('clip-ancestor-does-not-clip',clip('ignored','')+`<g clip-path="url(#ignored)">${clip('a',a,link)+clip('b',b)}</g>`,b)
add('own-clip-evenodd',clip('a',a,link)+clip('b','<path d="M32 32H128V128H32Z M64 64H96V96H64Z" clip-rule="evenodd"/>'),rect(32,32,96,32)+rect(32,64,32,32)+rect(96,64,32,32)+rect(32,96,96,32))
for(const time of [0,.5,1,1.5]) {
  const moving=rect(0,0,32,64).replace('/>','><animate attributeName="x" from="0" to="64" dur="2s" repeatCount="indefinite"/></rect>')
  add('animated-union-'+time,clip('a',rect(0,16,256,32),link)+clip('b',moving+rect(160,0,32,64)),rect(32*time,16,32,32)+rect(160,16,32,32),undefined,{time})
}
function chainSource(length){return wrap('<defs>'+Array.from({length},(_,i)=>clip('c'+i,rect(32,32,32,32),i+1<length?`clip-path="url(#c${i+1})"`:'')).join('')+'</defs>'+rect(0,0,256,256,'fill="red" clip-path="url(#c0)"'))}
// Invalid cyclic resource graphs have divergent native recovery behavior. Keep
// them as bounded-recovery checks, not valid-file native conformance claims.
const invalidCases = cases.filter(c=>c.name.endsWith('-cycle'))
module.exports={cases:cases.filter(c=>!invalidCases.includes(c)),invalidCases,chainSource,wrap,rect,clip}
