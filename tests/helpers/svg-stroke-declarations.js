'use strict'
// Original declarations and separately specified numeric reference images.
// Every expected fallback is independently checked against native SVG pixels.
const cases = []
const wrap = body => '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><g fill="none" stroke="black" stroke-width="4">' + body + '</g></svg>'
const line = attrs => `<path id="line" class="line" ${attrs} d="M20 64H236 M20 128H236 M20 192H236"/>`
function add (name, body, expected) {
  cases.push({ name, source: wrap(body), referenceSource: wrap(line(`stroke-dasharray="${expected}"`)) })
}
for (const [name, value] of [
  ['negative', '4 -2'], ['double-comma', '12,,6'], ['leading-comma', ',12 6'],
  ['trailing-comma', '12 6,'], ['unknown-token', '12 wrong 6'],
  ['trailing-dot', '12. 6'], ['empty', ''], ['mixed-keyword', 'none 6']
]) {
  add(name + '-attribute-inherits', `<g stroke-dasharray="18 9">${line(`stroke-dasharray="${value}"`)}</g>`, '18 9')
  add(name + '-inline-keeps-attribute', line(`stroke-dasharray="18 9" style="stroke-dasharray:${value}"`), '18 9')
  add(name + '-repeated-inline', line(`style="stroke-dasharray:18 9;stroke-dasharray:${value}"`), '18 9')
  add(name + '-css-specificity', `<style>.line{stroke-dasharray:18 9}#line{stroke-dasharray:${value}}</style>${line('')}`, '18 9')
  add(name + '-repeated-rule', `<style>.line{stroke-dasharray:18 9;stroke-dasharray:${value}}</style>${line('')}`, '18 9')
}
for (const [name, value, expected] of [
  ['plus', '+12 +6', '12 6'], ['joined-signs', '12+6', '12 6'], ['joined-decimals', '12.6.3', '12.6 .3'], ['exponent', '+1.2e1,+6e0', '12 6'],
  ['mixed-separators', ' 12 , 6 3, 9 ', '12 6 3 9'], ['odd', '12,6,3', '12 6 3'],
  ['units', '+9pt +.0625in', '12 6'], ['negative-zero', '-0 6', '0 6'],
  ['zero', '0 0', 'none'], ['none', 'none', 'none'], ['upper-none', 'NONE', 'none']
]) {
  add(name + '-attribute', line(`stroke-dasharray="${value}"`), expected)
  add(name + '-css', `<style>.line{stroke-dasharray:${value}}</style>${line('')}`, expected)
}
// Unsupported function-valued lengths are discovery cases, not certified here.
module.exports = { cases }
