'use strict'
const wrap = body => '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><g fill="none" stroke="black" stroke-width="4">' + body + '</g></svg>'
const cases = []
function add (name, shape, paint = 'stroke-dasharray="10 5" stroke-dashoffset="3"', length = '100', extra = {}) {
  const body = shape.replace('/>', ` pathLength="${length}" ${paint}/>`)
  cases.push({ name, source: wrap(body), referenceGeometry: wrap(body), ...extra })
}
for (const [name, shape] of [
 ['line','<line x1="20" y1="128" x2="220" y2="128"/>'],
 ['path','<path d="M20 128H220"/>'],
 ['closed','<path d="M30 40H210V180H30Z"/>'],
 ['subpaths','<path d="M20 64H220 M20 160H120Z"/>'],
 ['rect','<rect x="24" y="32" width="192" height="160"/>'],
 ['rounded','<rect x="24" y="32" width="192" height="160" rx="28" ry="16"/>'],
 ['circle','<circle cx="128" cy="128" r="80"/>'],
 ['ellipse','<ellipse cx="128" cy="128" rx="90" ry="55"/>'],
 ['polyline','<polyline points="20,40 100,100 180,40 220,120"/>'],
 ['polygon','<polygon points="40,40 160,40 160,200 40,200"/>'],
 ['cubic','<path d="M20 180C40 0 180 0 220 180"/>'],
 ['quadratic','<path d="M20 160Q120 0 220 160"/>'],
 ['smooth','<path d="M20 160Q60 0 120 160T220 160"/>'],
 ['arc','<path d="M24 128A104 60 20 1 1 210 180"/>'],
 ['cusp','<path d="M30 128C230 128 -30 128 210 128"/>']
]) for (const author of ['100','400']) add(name+'-'+author,shape,undefined,author)
for (const [name, paint] of [
 ['percent','stroke-dasharray="5% 2%" stroke-dashoffset="1%"'],
 ['mixed','stroke-dasharray="5% 8" stroke-dashoffset="-2%"'],
 ['px','stroke-dasharray="10px 5px" stroke-dashoffset="-3px"'],
 ['font','font-size="20" stroke-dasharray=".5em .25em" stroke-dashoffset="-.15em"'],
 ['odd','stroke-dasharray="4 7 2" stroke-dashoffset="-5"'],
 ['zero-dash','stroke-dasharray="0 10" stroke-linecap="round"'],
 ['solid','stroke-dasharray="0 0"'],
 ['none','stroke-dasharray="none"']
]) add('units-'+name,'<path d="M20 128H220"/>',paint)
for (const length of ['-2','bad','100px','','0']) add('author-'+(length||'empty'),'<path d="M20 128H220"/>',undefined,length)
for (const [name, paint] of [['no-offset','stroke-dasharray="10 5"'],['zero-first','stroke-dasharray="0 10"'],['negative-offset','stroke-dasharray="10 5" stroke-dashoffset="-3"'],['solid','stroke-dasharray="none"'],['all-zero','stroke-dasharray="0 0"']]) add('zero-'+name,'<path d="M20 128H220"/>',paint,'0')
for (const time of [0,.5,1,1.5]) {
 const body='<path d="M20 128H220" pathLength="100" stroke-dasharray="10 5" stroke-dashoffset="3">'
 const animation='<animate attributeName="pathLength" from="100" to="300" dur="2s" repeatCount="indefinite"/>'
 cases.push({name:'animated-length-'+time,time,source:wrap(body+animation+'</path>'),referenceGeometry:wrap(body.replace('pathLength="100"',`pathLength="${100+100*time}"`)+'</path>')})
}
// The attribute belongs to each geometric element, never an ancestor or use.
for (const [name, outer, close] of [
 ['inherited-paint','<g pathLength="20" stroke-dasharray="10 5" stroke-dashoffset="3">','</g>'],
 ['transform','<g transform="translate(16 24) scale(.75)">','</g>'],
 ['nested','<svg width="220" height="160" viewBox="0 0 256 256">','</svg>']
]) {
 const body='<path d="M20 128H220" pathLength="100" stroke-dasharray="10 5" stroke-dashoffset="3"/>'
 cases.push({name,source:wrap(outer+body+close),referenceGeometry:wrap(outer+body+close)})
}
const used='<defs><path id="p" d="M20 128H220" pathLength="100"/></defs><use href="#p" stroke-dasharray="10 5" stroke-dashoffset="3"/>'
cases.push({name:'use-instance',source:wrap(used),referenceSource:wrap(used.replace(' pathLength="100"','').replace('10 5','20 10').replace('offset="3"','offset="6"'))})
for (const time of [0,.5,1,1.5]) {
 const start='<line x1="20" y1="128" x2="120" y2="128" pathLength="100" stroke-dasharray="10 5" stroke-dashoffset="3">'
 cases.push({name:'animated-geometry-'+time,time,source:wrap(start+'<animate attributeName="x2" from="120" to="220" dur="2s" repeatCount="indefinite"/></line>'),referenceGeometry:wrap(start.replace('x2="120"',`x2="${120+50*time}"`)+'</line>')})
}
module.exports = { cases }
