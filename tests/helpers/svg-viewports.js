'use strict'
const fs = require('node:fs'), path = require('node:path')
const cases = require('../../compatibility/runs/2026-09-05-svg-next-viewports.json').inputs.map(c => ({ ...c }))
const rect = (x, y, width, height, fill = 'green') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`
const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`
function add (name, source, reference, options = {}) { cases.push({ name, source: wrap(source), referenceSource: wrap(reference), ...options }) }
const back = rect(0, 0, 256, 256, 'red')
const clip = (body, x = 32, y = 32, w = 128, h = 64, id = 'viewport') => `<defs><clipPath id="${id}">${rect(x, y, w, h)}</clipPath></defs><g clip-path="url(#${id})">${body}</g>`
for (const horizontal of ['Min', 'Mid', 'Max']) for (const vertical of ['Min', 'Mid', 'Max']) for (const mode of ['meet', 'slice']) {
  const align = `x${horizontal}Y${vertical}`, scale = mode === 'meet' ? 1 : 2
  const x = 32 + (128 - 64 * scale) * { Min: 0, Mid: .5, Max: 1 }[horizontal]
  const y = 32 + (64 - 64 * scale) * { Min: 0, Mid: .5, Max: 1 }[vertical]
  add(`${align}-${mode}`, back + `<svg x="32" y="32" width="128" height="64" viewBox="0 0 64 64" preserveAspectRatio="${align} ${mode}">${rect(0, 0, 64, 64)}${rect(0, 0, 16, 16, 'blue')}</svg>`, back + clip(rect(x, y, 64 * scale, 64 * scale) + rect(x, y, 16 * scale, 16 * scale, 'blue')))
}
for (const overflow of ['hidden', 'visible', 'scroll', 'auto']) {
  const body = rect(-16, -16, 96, 96)
  add(`overflow-${overflow}`, back + `<svg x="32" y="32" width="64" height="64" viewBox="0 0 64 64" overflow="${overflow}">${body}</svg>`, back + ((overflow === 'visible' || overflow === 'auto') ? rect(16, 16, 96, 96) : clip(rect(16, 16, 96, 96), 32, 32, 64, 64)))
}
add('nearest-viewport-percent', back + '<svg x="16" y="16" width="128" height="64" viewBox="0 0 64 32" preserveAspectRatio="none"><rect width="50%" height="50%" fill="green"/></svg>', back + clip(rect(16, 16, 64, 32),16,16,128,64))
add('nearest-viewport-percent-meet', back + '<svg x="16" y="16" width="128" height="64" viewBox="0 0 64 64"><rect width="50%" height="50%" fill="green"/></svg>', back + clip(rect(48, 16, 32, 32),16,16,128,64))
add('twice-nested-percent', back + '<svg x="16" y="16" width="128" height="64" viewBox="0 0 64 32"><svg x="25%" y="25%" width="50%" height="50%" viewBox="0 0 32 16"><rect width="50%" height="50%" fill="green"/></svg></svg>', back + clip(clip(rect(48,32,32,16),48,32,64,32,'inner'),16,16,128,64))
add('default-nested-size', back + '<svg x="16" y="16"><rect width="50%" height="25%" fill="green"/></svg>', back + clip(rect(16,16,128,64),16,16,256,256))
add('nested-viewbox-origin', back + '<svg x="32" y="32" width="128" height="64" viewBox="10 20 64 32" preserveAspectRatio="none">'+rect(10, 20, 32, 16)+'</svg>', back + clip(rect(32,32,64,32)))
add('viewport-percentage-cache', back + '<defs><g id="part"><rect width="50%" height="50%" fill="green"/></g></defs><svg width="64" height="64" viewBox="0 0 64 64"><use href="#part"/></svg><svg x="128" width="128" height="128" viewBox="0 0 128 128"><use href="#part"/></svg>', back + rect(0, 0, 32, 32) + rect(128, 0, 64, 64))
for (const value of ['0 0 0 64', '0 0 64 0', '0 0 0 0']) add('zero-viewbox-'+value.replace(/ /g,'-'), back + `<svg x="32" y="32" width="128" height="64" viewBox="${value}">${rect(0,0,64,64)}</svg>`, back)
for (const value of ['0 0 -1 64', '0 0 64 -1', '0 0 64', 'garbage']) add('invalid-viewbox-'+value.replace(/ /g,'-'), back + `<svg x="32" y="32" width="128" height="64" viewBox="${value}">${rect(0,0,64,64)}</svg>`, back + clip(rect(32,32,64,64)))
for (const attr of ['width="0" height="64"', 'width="64" height="0"', 'width="-1" height="64"']) add('disabled-size-'+cases.length, back + `<svg x="32" y="32" ${attr}>${rect(0,0,64,64)}</svg>`, back)
for (const time of [0,.5,1]) {
  add('animated-width-'+time, back + '<svg x="32" y="32" width="64" height="64" viewBox="0 0 64 64" preserveAspectRatio="none">'+rect(0,0,64,64)+'<animate attributeName="width" from="64" to="128" dur="2s" repeatCount="indefinite"/></svg>', back + clip(rect(32,32,64+32*time,64),32,32,64+32*time,64), { time })
  add('animated-viewbox-'+time, back + '<svg x="32" y="32" width="128" height="64" viewBox="0 0 64 64" preserveAspectRatio="none">'+rect(0,0,32,32)+'<animate attributeName="viewBox" from="0 0 64 64" to="0 0 128 64" dur="2s" repeatCount="indefinite"/></svg>', back + clip(rect(32,32,128*32/(64+32*time),32)), { time })
}
for (const [aspect, x, w] of [['xMidYMid meet',96,64],['xMinYMin meet',0,64],['xMaxYMax meet',192,64],['none',0,256]]) cases.push({name:'root-wide-'+aspect.replace(/ /g,'-'),width:256,height:64,source:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 100 100" preserveAspectRatio="${aspect}">${rect(0,0,100,100)}</svg>`,referenceSource:`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="64">${rect(x,0,w,64)}</svg>`})
cases.push({name:'root-tall-meet',width:64,height:256,source:`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400" viewBox="0 0 100 100">${rect(0,0,100,100)}</svg>`,referenceSource:`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="256">${rect(0,96,64,64)}</svg>`})
const root = path.join(__dirname, '../fixtures/svg-viewports')
for (const row of require('../fixtures/svg-viewports/sources.json')) cases.push({ name: row.name, source: fs.readFileSync(path.join(root,row.name),'utf8'), referenceSource: fs.readFileSync(path.join(root,row.reference),'utf8'), blank: true })
// Auto exposes overflow because the player has no viewport scrolling mechanism.
// Independent root-space rectangles retain both visible overhang and inner detail.
for (let i = 0; i < 32; i++) {
  const x = 16 + (i % 4) * 4, y = 16 + (i % 3) * 4, width = 48 + i * 4, height = 32 + (i % 4) * 4
  const none = i % 2 === 0, sx = none ? width / 64 : Math.min(width, height) / 64, sy = none ? height / 64 : sx
  const ox = x + (none ? 0 : (width - 64 * sx) / 2), oy = y + (none ? 0 : (height - 64 * sy) / 2)
  const overflow = i % 3 === 0 ? 'style="overflow:auto"' : 'overflow="auto"'
  add('auto-viewport-'+i, back + `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 64 64" preserveAspectRatio="${none ? 'none' : 'xMidYMid meet'}" ${overflow}>${rect(-16,-16,96,96)}${rect(0,0,16,16,'blue')}</svg>`, back + rect(ox-16*sx,oy-16*sy,96*sx,96*sy) + rect(ox,oy,16*sx,16*sy,'blue'))
}
for (const input of cases) if (input.referenceSource) input.rectReference = true
module.exports = { cases, add, rect, wrap }
