'use strict'

// SVG2 Units: non-axis percentage lengths use sqrt((w*w + h*h)/2).
// Keep an independent numeric SVG beside each percentage original so native
// browser agreement with that interpretation is checked as well as the reader.
const cases = []
const attributes = values => Object.entries(values).map(([key, value]) => `${key}="${value}"`).join(' ')
for (const viewport of [
  { name: 'wide', width: 320, height: 160 },
  { name: 'tall', width: 160, height: 320 },
  { name: 'square', width: 256, height: 256 },
  { name: 'nested-wide', width: 320, height: 160, nested: true },
  { name: 'nested-tall', width: 160, height: 320, nested: true },
  { name: 'symbol-wide', width: 320, height: 160, symbol: true }
]) for (const property of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset']) for (const mode of ['attribute', 'css', 'inherited']) {
  const { width, height } = viewport
  const diagonal = Math.sqrt((width * width + height * height) / 2)
  const percent = { 'stroke-width': '2%', 'stroke-dasharray': '7% 3% 2%', 'stroke-dashoffset': '-9%' }
  const paint = { fill: 'none', stroke: '#000', 'stroke-width': '4', 'stroke-dasharray': '12 7', 'stroke-dashoffset': '0', [property]: percent[property] }
  const resolved = { ...paint, [property]: percent[property].split(' ').map(v => String(parseFloat(v) / 100 * diagonal)).join(' ') }
  const shapes = `<path d="M 16 ${height / 4} H ${width - 16} M ${width / 2} 16 V ${height - 16}"/><rect x="24" y="${height / 2}" width="${width / 3}" height="${height / 4}"/>`
  function source (styles) {
    const declaration = Object.entries(styles).map(([key, value]) => `${key}:${value}`).join(';')
    let body = mode === 'inherited' ? `<g ${attributes(styles)}>${shapes}</g>` : mode === 'css' ? `<style>path, rect{${declaration}}</style>${shapes}` : shapes.replace(/<(path|rect) /g, (_, tag) => `<${tag} ${attributes(styles)} `)
    if (viewport.nested) body = `<svg x="16" y="32" width="224" height="192" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`
    if (viewport.symbol) body = `<defs><symbol id="s" viewBox="0 0 ${width} ${height}">${body}</symbol></defs><use href="#s" x="16" y="24" width="224" height="160"/>`
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 ${viewport.nested || viewport.symbol ? '256 256' : width + ' ' + height}">${body}</svg>`
  }
  cases.push({ name: `${viewport.name}-${property}-${mode}`, source: source(paint), referenceSource: source(resolved), property, viewport: viewport.name })
}
// Numeric lengths and a true geometric scale remain controls for the shared
// stroke path. The local transform must not change the percentage reference.
for (const transform of ['translate(16 12) scale(.75)', 'matrix(1 .2 .1 1 0 0)']) {
  const original = cases.find(c => c.name === 'wide-stroke-dasharray-inherited')
  const wrap = source => source.replace('<g ', `<g transform="${transform}"><g `).replace('</g>', '</g></g>')
  cases.push({ ...original, name: 'transformed-' + cases.length, source: wrap(original.source), referenceSource: wrap(original.referenceSource) })
}
for (const property of ['stroke-width', 'stroke-dashoffset']) for (const time of [0, .5, 1, 1.5]) {
  const start = property === 'stroke-width' ? 2 : -8, end = property === 'stroke-width' ? 6 : 8
  const percent = start + (end - start) * time / 2
  const prefix = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 320 160">'
  const paint = { fill: 'none', stroke: 'black', 'stroke-width': 4, 'stroke-dasharray': '12 7', [property]: start + '%' }
  const shape = `<path ${attributes(paint)} d="M20 40H300 M20 120H300">`
  cases.push({ name: `animated-${property}-${time}`, time, property, viewport: 'wide',
    source: prefix + shape + `<animate attributeName="${property}" from="${start}%" to="${end}%" dur="2s" repeatCount="indefinite"/></path></svg>`,
    referenceSource: prefix + shape.replace(`${property}="${start}%"`, `${property}="${percent / 100 * Math.sqrt(64000)}"`) + '</path></svg>' })
}

// Separate discovery cases: these test other roots and must not be silently
// counted as fixed by the viewport-percentage change.
const exploration = [
  ['font-relative', '<g font-size="32"><path stroke-width=".25em" stroke-dasharray="1em .5em" stroke-dashoffset=".125em" d="M20 128H220"/></g>', '<path stroke-width="8" stroke-dasharray="32 16" stroke-dashoffset="4" d="M20 128H220"/>'],
  ['negative-list-inherits', '<g stroke-dasharray="12 6"><path stroke-dasharray="4 -2" d="M20 128H220"/></g>', '<path stroke-dasharray="12 6" d="M20 128H220"/>'],
  ['positive-sign', '<path stroke-dasharray="+12 +6" d="M20 128H220"/>', '<path stroke-dasharray="12 6" d="M20 128H220"/>'],
  ['double-comma-inherits', '<g stroke-dasharray="18 9"><path stroke-dasharray="12,,6" d="M20 128H220"/></g>', '<path stroke-dasharray="18 9" d="M20 128H220"/>'],
  ['path-length-calibration', '<path pathLength="100" stroke-dasharray="10 5" d="M20 128H220"/>', '<path stroke-dasharray="20 10" d="M20 128H220"/>'],
  ['zero-list-control', '<path stroke-dasharray="0 0" d="M20 128H220"/>', '<path stroke-dasharray="none" d="M20 128H220"/>']
].map(([name, body, reference]) => { const wrap = content => '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><g fill="none" stroke="black" stroke-width="4">' + content + '</g></svg>'; return { name, source: wrap(body), referenceSource: wrap(reference) } })
module.exports = { cases, exploration }
