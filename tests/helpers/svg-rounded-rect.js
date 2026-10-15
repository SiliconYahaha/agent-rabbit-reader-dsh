'use strict'
const cases=[];
for(const [rx,ry] of [[0,8],[8,0],[2,8],[8,2],[60,60],[0.25,0.75]])for(const mode of ['fill','stroke','dash','gradient'])for(const transform of ['', 'translate(35 10) rotate(11 70 65)']){
 const name='rx'+rx+'-ry'+ry+'-'+mode+'-'+(transform?'rotated':'plain');
 const paint=mode==='fill'?'fill="steelblue"':mode==='gradient'?'fill="url(#g)" stroke="darkblue" stroke-width="2.5"':'fill="none" stroke="darkblue" stroke-width="3.25"'+(mode==='dash'?' stroke-dasharray="7 3"':'');
 const source=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="30.25" y="25.75" width="91.5" height="78.5" rx="${rx}" ry="${ry}" transform="${transform}" ${paint}/></svg>`;cases.push({name,source,referenceSource:source});
}

for (const time of [0, .5, 1, 1.5]) for (const mode of ['stroke', 'gradient']) {
 const rx = [0, 4, 8, 34][[0, .5, 1, 1.5].indexOf(time)]
 const prefix = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>'
 const rect = '<rect x="30.25" y="25.75" width="91.5" height="78.5" rx="0" ry="8" transform="rotate(11 70 65)" fill="'+(mode==='gradient'?'url(#g)':'none')+'" stroke="navy" stroke-width="3.25" stroke-dasharray="7 3">'
 cases.push({name:mode+'-t'+time,time,source:prefix+rect+'<animate attributeName="rx" values="0;8;60" dur="2s" repeatCount="indefinite"/></rect></svg>',referenceSource:prefix+rect.replace('rx="0"','rx="'+rx+'"')+'</rect></svg>'})
}

for (const [rx, ry] of [[2, 8], [8, 2], [8, 8]]) for (const rotated of [false, true]) {
 const source = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><clipPath id="c"><rect x="30.25" y="25.75" width="91.5" height="78.5" rx="'+rx+'" ry="'+ry+'"'+(rotated?' transform="rotate(11 70 65)"':'')+'/></clipPath></defs><rect width="256" height="256" fill="steelblue" clip-path="url(#c)"/></svg>'
 cases.push({name:'clip-rx'+rx+'-ry'+ry+'-'+rotated,source,referenceSource:source})
}
for (const [name, body] of [
 ['clip-object-box','<defs><clipPath id="c" clipPathUnits="objectBoundingBox"><rect x=".1" y=".1" width=".8" height=".7" rx=".2" ry=".1"/></clipPath></defs><rect x="30.25" y="25.75" width="91.5" height="78.5" fill="steelblue" clip-path="url(#c)"/>'],
 ['clip-use','<defs><rect id="r" x="30.25" y="25.75" width="91.5" height="78.5" rx="8" ry="2"/><clipPath id="c"><use href="#r" x="2" y="3"/></clipPath></defs><rect width="256" height="256" fill="steelblue" clip-path="url(#c)"/>'],
 ['clip-nested','<defs><clipPath id="inner"><rect x="40" y="20" width="60" height="65" rx="12" ry="4"/></clipPath><clipPath id="c"><rect x="30.25" y="25.75" width="91.5" height="78.5" rx="8" ry="2" clip-path="url(#inner)"/></clipPath></defs><rect width="256" height="256" fill="steelblue" clip-path="url(#c)"/>'],
 ['clip-sibling-restore','<defs><clipPath id="c"><rect x="30.25" y="25.75" width="91.5" height="78.5" rx="8" ry="2"/></clipPath></defs><g transform="translate(5 8) rotate(11 70 65)"><rect width="256" height="256" fill="steelblue" clip-path="url(#c)"/></g><rect x="180" y="150" width="40" height="60" fill="red"/>']
]) { const source='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">'+body+'</svg>'; cases.push({name,source,referenceSource:source}) }
// Nested clip alpha now agrees exactly; edge RGB still differs due to the
// separate clip compositing path. Retain the failed native comparison.
cases.find(c => c.name === 'clip-nested').knownGap = 'Nested clip edge RGB differs while alpha is exact; separate compositing investigation.'
module.exports = { cases }
