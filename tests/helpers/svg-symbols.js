'use strict'
const { rect, wrap } = require('./svg-viewports')
// Keep original independent root-space rectangles; do not regenerate them from
// the production viewport helper.
const cases = require('../../compatibility/runs/2026-09-05-svg-next-symbols.json').inputs.map(c => ({ ...c, source: c.source.replace('<use ', '<use id="instance" '), measureId: 'instance' }))
const back = rect(0,0,256,256,'red')
const contents = rect(0,0,64,64)+rect(0,0,16,16,'blue')
function clip (body,x=32,y=16,width=128,height=64) { return `<defs><clipPath id="viewport">${rect(x,y,width,height)}</clipPath></defs><g clip-path="url(#viewport)">${body}</g>` }
function add (name,source,reference,options={}) {cases.push({name,source:wrap(back+source),referenceSource:wrap(back+reference),rectReference:true,...options})}
function use (kind,attrs='',useAttrs='',body=contents) {return `<defs><${kind} id="part" ${attrs}>${body}</${kind}></defs><use id="instance" href="#part" ${useAttrs}/>`}
for(const kind of ['symbol','svg']) {
  for(const horizontal of ['Min','Mid','Max'])for(const vertical of ['Min','Mid','Max'])for(const mode of ['meet','slice']) {
    const scale=mode==='meet'?1:2,x=32+(128-64*scale)*{Min:0,Mid:.5,Max:1}[horizontal],y=16+(64-64*scale)*{Min:0,Mid:.5,Max:1}[vertical]
    add(`${kind}-${horizontal}-${vertical}-${mode}`,use(kind,`viewBox="0 0 64 64" preserveAspectRatio="x${horizontal}Y${vertical} ${mode}"`,'x="32" y="16" width="128" height="64"'),clip(rect(x,y,64*scale,64*scale)+rect(x,y,16*scale,16*scale,'blue')),{measureId:'instance'})
  }
  add(`${kind}-percent-units`,use(kind,'viewBox="0 0 64 32" preserveAspectRatio="none"','x="12.5%" y="6.25%" width="50%" height="25%"','<rect width="50%" height="50%" fill="green"/>'),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-default-target-size`,use(kind,'width="128" height="64" viewBox="0 0 64 32"','x="32" y="16"',rect(0,0,32,16)),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-auto-target-size`,use(kind,'width="128" height="64" viewBox="0 0 64 32"','x="32" y="16" width="auto" height="auto"',rect(0,0,32,16)),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-css-size-overrides`,use(kind,'width="16" height="16" viewBox="0 0 64 32"','x="0" y="0" width="16" height="16" style="x:32px;y:16px;width:128px;height:64px"',rect(0,0,32,16)),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-viewbox-origin`,use(kind,'viewBox="10 20 64 32" preserveAspectRatio="none"','x="32" y="16" width="128" height="64"',rect(10,20,32,16)),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-no-viewbox`,use(kind,'','x="32" y="16" width="128" height="64"','<rect width="50%" height="50%" fill="green"/>'),clip(rect(32,16,64,32)),{measureId:'instance'})
  add(`${kind}-nested-percent`,use(kind,'viewBox="0 0 64 32"','x="32" y="16" width="128" height="64"','<svg x="25%" y="25%" width="50%" height="50%" viewBox="0 0 32 16"><rect width="50%" height="50%" fill="green"/></svg>'),clip(rect(64,32,32,16)),{measureId:'instance'})
  add(`${kind}-same-source-different-instances`,`<defs><${kind} id="part" preserveAspectRatio="none"><rect width="50%" height="50%" fill="green"/></${kind}></defs><use href="#part" width="64" height="64"/><use href="#part" x="128" width="128" height="128"/>`,rect(0,0,32,32)+rect(128,0,64,64))
  for(const overflow of ['hidden','visible','auto','scroll']) {
    const painted=rect(0,-16,96,96)
    add(`${kind}-overflow-${overflow}`,use(kind,`viewBox="0 0 64 64" overflow="${overflow}"`,'x="32" y="16" width="128" height="64"',painted),overflow==='visible'||overflow==='auto'?rect(64,0,96,96):clip(rect(64,0,96,96)),{measureId:'instance'})
  }
  for(const [name,attrs] of [['zero-width','width="0" height="64"'],['zero-height','width="128" height="0"']])add(`${kind}-${name}`,use(kind,'viewBox="0 0 64 64"',attrs),'')
  for(const vb of ['0 0 0 64','0 0 64 0','garbage','0 0 -1 64'])add(`${kind}-vb-${vb.replace(/ /g,'-')}`,use(kind,`viewBox="${vb}"`,'x="32" y="16" width="128" height="64"'),vb.startsWith('0 0 0')||vb==='0 0 64 0'?'':clip(rect(32,16,64,64)+rect(32,16,16,16,'blue')))
  add(`${kind}-source-fill`,use(kind,'viewBox="0 0 64 64" fill="blue"','x="32" y="16" width="64" height="64" fill="green"','<rect width="64" height="64"/>'),rect(32,16,64,64,'blue'))
  add(`${kind}-inherited-fill`,use(kind,'viewBox="0 0 64 64"','x="32" y="16" width="64" height="64" fill="green"','<rect width="64" height="64"/>'),rect(32,16,64,64))
}
add('group-use-dimensions-ignored',use('g','','x="32" y="16" width="0" height="0"','<rect width="50%" height="25%" fill="green"/>'),rect(32,16,128,64),{measureId:'instance'})
add('use-userspace-clip-translates','<defs><g id="part">'+rect(0,0,64,64)+'</g><clipPath id="c">'+rect(0,0,32,64)+'</clipPath></defs><use id="instance" href="#part" x="32" y="16" clip-path="url(#c)"/>',rect(32,16,32,64),{measureId:'instance'})
add('use-objectbox-clip-translates','<defs><symbol id="part" viewBox="0 0 64 64">'+contents+'</symbol><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath></defs><use id="instance" href="#part" x="32" y="16" width="128" height="64" clip-path="url(#c)"/>',rect(64,16,32,64)+rect(64,16,16,16,'blue'),{measureId:'instance'})
add('symbol-never-paints-directly','<symbol style="display:block">'+rect(0,0,256,256)+'</symbol>'+rect(32,16,64,64),rect(32,16,64,64))
add('symbol-instance-ignores-display-none',use('symbol','viewBox="0 0 64 64" display="none"','x="32" y="16" width="64" height="64"',rect(0,0,64,64)),rect(32,16,64,64))
for(const time of [0,.5,1,1.5]) {
  const width=64+32*time
  add('use-width-animation-'+time,'<defs><symbol id="part" viewBox="0 0 64 64" preserveAspectRatio="none">'+rect(0,0,64,64)+'</symbol></defs><use id="instance" href="#part" x="32" y="16" width="64" height="64"><animate attributeName="width" from="64" to="128" dur="2s" repeatCount="indefinite"/></use>',clip(rect(32,16,width,64),32,16,width,64),{time,measureId:'instance'})
  add('symbol-viewbox-animation-'+time,'<defs><symbol id="part" viewBox="0 0 64 64" preserveAspectRatio="none">'+rect(0,0,32,32)+'<animate attributeName="viewBox" from="0 0 64 64" to="0 0 128 64" dur="2s" repeatCount="indefinite"/></symbol></defs><use id="instance" href="#part" x="32" y="16" width="128" height="64"/>',clip(rect(32,16,128*32/(64+32*time),32)),{time,measureId:'instance'})
  add('use-x-animation-'+time,'<defs><symbol id="part" viewBox="0 0 64 64">'+rect(0,0,64,64)+'</symbol></defs><use id="instance" href="#part" x="32" y="16" width="64" height="64"><animate attributeName="x" from="32" to="96" dur="2s" repeatCount="indefinite"/></use>',rect(32+32*time,16,64,64),{time,measureId:'instance'})
}
for (const kind of ['symbol','svg']) {
  add(`${kind}-source-transform`,use(kind,'viewBox="0 0 64 32" transform="translate(8 4)"','x="32" y="16" width="128" height="64"',rect(0,0,32,16)),rect(40,20,64,32),{measureId:'instance'})
  add(`${kind}-use-transform`,use(kind,'viewBox="0 0 64 32"','x="16" y="8" width="64" height="32" transform="scale(2)"',rect(0,0,32,16)),rect(32,16,64,32),{measureId:'instance'})
  add(`${kind}-source-position`,use(kind,'x="8" y="4" viewBox="0 0 64 32"','x="32" y="16" width="128" height="64"',rect(0,0,32,16)),rect(40,20,64,32),{measureId:'instance'})
  add(`${kind}-nested-use-percent`,`<defs><${kind} id="leaf" viewBox="0 0 32 16"><rect width="50%" height="50%"/></${kind}><symbol id="part" viewBox="0 0 64 32"><g><use href="#leaf" x="25%" y="25%" width="50%" height="50%"/></g></symbol></defs><use id="instance" href="#part" x="32" y="16" width="128" height="64" fill="green"/>`,rect(64,32,32,16),{measureId:'instance'})
}
cases.push({name:'ancestor-cycle-translucent',source:wrap('<g id="part"><rect width="64" height="64" fill="green" opacity=".5"/><use id="instance" href="#part"/></g>'),referenceSource:wrap('<rect width="64" height="64" fill="green" opacity=".5"/>'),measureId:'instance'})
module.exports={cases}
