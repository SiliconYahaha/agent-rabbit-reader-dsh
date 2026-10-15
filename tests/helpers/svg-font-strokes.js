'use strict'
const cases = []
const wrap = (body, root = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" ${root}><g fill="none" stroke="black" stroke-width="4">${body}</g></svg>`
const line = attrs => `<path ${attrs} d="M20 64H236 M20 128H236 M20 192H236"/>`
const paint = size => `stroke-width="${size / 4}" stroke-dasharray="${size} ${size / 2}" stroke-dashoffset="${size / 8}"`
const relative = 'stroke-width=".25em" stroke-dasharray="1em .5em" stroke-dashoffset=".125em"'
function add (name, body, size, root = '') { cases.push({ name, source: wrap(body, root), referenceSource: wrap(line(paint(size))) }) }
for (const [name, font, size] of [['pixels', '32px', 32], ['points', '24pt', 32], ['em', '2em', 32], ['percent', '200%', 32]]) {
  add(name + '-same-element', line(`font-size="${font}" ${relative}`), size)
  add(name + '-inherited-font', `<g font-size="${font}">${line(relative)}</g>`, size)
  add(name + '-inherited-stroke-child-font', `<g font-size="${font}" ${relative}>${line('font-size="8"')}</g>`, size)
  add(name + '-css', `<style>path{font-size:${font};stroke-width:.25em;stroke-dasharray:1em .5em;stroke-dashoffset:.125em}</style>${line('')}`, size)
}
add('nested-relative-fonts', `<g font-size="24"><g font-size="150%">${line(`font-size=".5em" ${relative}`)}</g></g>`, 18)
add('explicit-inherit', `<g font-size="32" ${relative}>${line('font-size="8" stroke-width="inherit" stroke-dasharray="inherit" stroke-dashoffset="inherit"')}</g>`, 32)
add('nested-svg', `<g font-size="32"><svg width="256" height="256">${line(relative)}</svg></g>`, 32)
add('root-em-font', line(relative), 32, 'font-size="2em"')
add('root-rem-font', line(relative), 32, 'font-size="2rem"')
add('rem-root-reference', line('font-size="8" stroke-width=".25rem" stroke-dasharray="1rem .5rem" stroke-dashoffset=".125rem"'), 32, 'font-size="32"')
add('rem-font-size', line(`font-size="1.5rem" ${relative}`), 48, 'font-size="32"')
add('use-inherits-font', `<defs><g id="s">${line(relative)}</g></defs><use href="#s" font-size="32"/>`, 32)
add('use-relative-font', `<defs><g id="s" font-size="150%">${line(relative)}</g></defs><use href="#s" font-size="24"/>`, 36)
add('use-inherits-resolved-stroke', `<defs><g id="s" font-size="8">${line('')}</g></defs><use href="#s" font-size="32" ${relative}/>`, 32)
// The parent font and its em-valued stroke both change per sampled frame.
for (const mode of ['font', 'stroke-width', 'stroke-dashoffset']) for (const time of [0, .5, 1, 1.5]) {
  const property = mode === 'font' ? 'font-size' : mode
  const from = mode === 'font' ? '16' : mode === 'stroke-width' ? '.125em' : '-.25em'
  const to = mode === 'font' ? '48' : mode === 'stroke-width' ? '.375em' : '.25em'
  const anim = `<animate attributeName="${property}" from="${from}" to="${to}" dur="2s" repeatCount="indefinite"/>`
  const size = mode === 'font' ? 16 + 16 * time : 32
  let expected = paint(size)
  if (mode === 'stroke-width') expected = expected.replace('stroke-width="8"', `stroke-width="${4 + 4 * time}"`)
  if (mode === 'stroke-dashoffset') expected = expected.replace('stroke-dashoffset="4"', `stroke-dashoffset="${-8 + 8 * time}"`)
  cases.push({ name: `animated-${mode}-${time}`, time, source: wrap(`<g font-size="32" ${relative}>${anim}${line('font-size="8"')}</g>`), referenceSource: wrap(line(expected)) })
}

for (const content of ['AB', 'A<tspan font-size="50%">B</tspan>']) {
  const original = `<g font-family="sans-serif" font-size="32" stroke-width=".0625em"><text x="24" y="128" font-size="150%">${content}</text></g>`
  const expected = `<g font-family="sans-serif" stroke-width="2"><text x="24" y="128" font-size="48">${content.replace('50%', '24')}</text></g>`
  cases.push({ name: content === 'AB' ? 'text-inherited-stroke' : 'tspan-relative-font', source: wrap(original), referenceSource: wrap(expected) })
}
for (const time of [0, .5, 1, 1.5]) {
  const size = 16 + 16 * time
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" font-size="16"><animate attributeName="font-size" from="16" to="48" dur="2s" repeatCount="indefinite"/><g fill="none" stroke="black">${line('font-size="8" stroke-width=".25rem" stroke-dasharray="1rem .5rem" stroke-dashoffset=".125rem"')}</g></svg>`
  cases.push({ name: `animated-root-rem-${time}`, time, source, referenceSource: wrap(line(paint(size))) })
  const sourcePercent = wrap(`<g font-size="32"><g font-size="50%" ${relative}><animate attributeName="font-size" from="50%" to="150%" dur="2s" repeatCount="indefinite"/>${line('font-size="8"')}</g></g>`)
  cases.push({ name: `animated-percent-font-${time}`, time, source: sourcePercent, referenceSource: wrap(line(paint(size))) })
}
const textControl = cases.find(fixture => fixture.name === 'text-inherited-stroke')
cases.push({ name: 'text-absolute-control', source: textControl.referenceSource, referenceSource: textControl.referenceSource })
cases.push({ name: 'shared-use-font-isolation',
  source: wrap(`<defs><path id="shared" d="M20 40H220" ${relative}/></defs>` + [16, 32, 8].map((font, i) => `<use href="#shared" y="${i * 80}" font-size="${font}"/>`).join('')),
  referenceSource: wrap([16, 32, 8].map((font, i) => `<path d="M20 ${40 + i * 80}H220" ${paint(font)}/>`).join('')) })

// A diagonal makes small animated em rounding errors visible in pixels.
for (const time of [.5, 1.5]) {
  const fixture = cases.find(c => c.name === 'animated-stroke-width-' + time)
  const diagonal = source => source.replace(/M20 64H236 M20 128H236 M20 192H236/g, 'M20 40L236 210')
  cases.push({ ...fixture, name: 'animated-diagonal-' + time, source: diagonal(fixture.source), referenceSource: diagonal(fixture.referenceSource) })
}

for (const [keyword, size] of [['initial', 16], ['unset', 32], ['inherit', 32]]) {
  add('font-keyword-' + keyword, `<g font-size="32">${line(`font-size="${keyword}" ${relative}`)}</g>`, size)
}

module.exports = { cases }
