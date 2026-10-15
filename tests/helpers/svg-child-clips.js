'use strict'
// Original algebraic references: intersections are authored in root coordinates,
// independently of the scene renderer and its native boolean-operation kernel.
const { wrap, rect, clip } = require('./svg-clip-chains')
const cases = require('../../compatibility/runs/2026-09-05-svg-next-nested-unions.json').inputs.map(row => ({
  name: row.name, width: 100, height: 100,
  source: row.source.replace('<svg ', '<svg width="100" height="100" '),
  referenceSource: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="red" d="' + row.expected.clips[0].d + '"/></svg>'
}))
const link = id => 'clip-path="url(#' + id + ')"'
const box = [16, 16, 96, 96], sibling = [144, 32, 64, 80]
const intersect = (a, b) => { const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]); return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)] }
const rectangles = boxes => boxes.filter(b => b[2] > 0 && b[3] > 0).map(b => rect(...b)).join('')
function add (name, defs, expected, paint = rect(0, 0, 256, 256, 'fill="red" ' + link('a')), extra = {}) {
  cases.push({ name, source: wrap('<defs>' + defs + '</defs>' + paint), referenceSource: wrap('<g fill="red">' + expected + '</g>'), ...extra })
}
for (const [name, inner] of [['partial', [48, 0, 48, 80]], ['empty', [128, 128, 16, 16]], ['enclosing', [0, 0, 128, 128]], ['edge-touch', [112, 16, 16, 96]]]) {
  add('child-' + name, clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(...inner)), rectangles([intersect(box, inner), sibling]))
}
add('both-children', clip('a', rect(...box, link('b')) + rect(...sibling, link('c'))) + clip('b', rect(48, 0, 48, 80)) + clip('c', rect(128, 64, 64, 80)), rectangles([[48, 16, 48, 64], [144, 64, 48, 48]]))
add('parent-and-children', clip('a', rect(...box, link('b')) + rect(...sibling), link('c')) + clip('b', rect(48, 0, 48, 80)) + clip('c', rect(0, 48, 256, 32)), rectangles([[48, 48, 48, 32], [144, 48, 64, 32]]))
add('nested-resource-union', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(0, 32, 256, 16) + rect(0, 64, 256, 16)), rectangles([[16, 32, 96, 16], [16, 64, 96, 16], sibling]))
add('nested-resource-own-clip', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(0, 32, 256, 16) + rect(0, 64, 256, 16), link('c')) + clip('c', rect(48, 0, 32, 256)), rectangles([[48, 32, 32, 16], [48, 64, 32, 16], sibling]))
add('nested-child-chain', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(0, 32, 256, 48, link('c'))) + clip('c', rect(48, 0, 32, 256)), rectangles([[48, 32, 32, 48], sibling]))
add('empty-resource', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', ''), rectangles([sibling]))
add('missing-resource', clip('a', rect(...box, link('missing')) + rect(...sibling)), rectangles([box, sibling]))
add('wrong-resource', clip('a', rect(...box, link('b')) + rect(...sibling)) + rect(0, 0, 10, 10, 'id="b"'), rectangles([box, sibling]))
add('hidden-child', clip('a', rect(...box, link('b') + ' display="none"') + rect(...sibling)) + clip('b', rect(48, 0, 48, 80)), rectangles([sibling]))
add('hidden-inner-child', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(0, 0, 256, 256, 'visibility="hidden"') + rect(48, 0, 48, 80)), rectangles([[48, 16, 48, 64], sibling]))
for (const transform of ['translate(16 8)', 'scale(2 1)', 'matrix(0 1 -1 0 128 0)']) {
  const defs = clip('a', rect(...box, link('b')) + rect(...sibling), 'transform="' + transform + '"') + clip('b', rect(48, 0, 48, 80))
  add('outer-transform-' + transform, defs, '<g transform="' + transform + '">' + rectangles([[48, 16, 48, 64], sibling]) + '</g>')
  add('target-transform-' + transform, clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(48, 0, 48, 80)), '<g transform="' + transform + '">' + rectangles([[48, 16, 48, 64], sibling]) + '</g>', rect(0, 0, 256, 256, 'fill="red" transform="' + transform + '" ' + link('a')))
}
add('child-transform', clip('a', rect(0, 0, 48, 48, 'transform="translate(16 16) scale(2)" ' + link('b')) + rect(...sibling)) + clip('b', rect(16, 0, 16, 32)), rectangles([[48, 16, 32, 64], sibling]))
add('reference-transform', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(0, 0, 24, 32), 'transform="translate(48 16) scale(2)"'), rectangles([[48, 16, 48, 64], sibling]))
add('child-object-box', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(.25, .25, .5, .5), 'clipPathUnits="objectBoundingBox"'), rectangles([[40, 40, 48, 48], sibling]))
add('transformed-child-object-box', clip('a', rect(0, 0, 48, 48, 'transform="translate(16 16) scale(2)" ' + link('b')) + rect(...sibling)) + clip('b', rect(.25, .25, .5, .5), 'clipPathUnits="objectBoundingBox"'), rectangles([[40, 40, 48, 48], sibling]))
add('outer-object-box', clip('a', rect(0, 0, .5, 1, link('b')) + rect(.75, .25, .25, .5), 'clipPathUnits="objectBoundingBox"') + clip('b', rect(.25, .25, .5, .5), 'clipPathUnits="objectBoundingBox"'), rectangles([[36, 48, 24, 64], [96, 48, 24, 64]]), rect(24, 16, 96, 128, 'fill="red" ' + link('a')))
add('zero-box-child', clip('a', rect(16, 16, 0, 64, link('b')) + rect(...sibling)) + clip('b', rect(0, 0, 1, 1), 'clipPathUnits="objectBoundingBox"'), rectangles([sibling]))
add('own-object-box-with-child-clip', clip('a', rect(...box, link('b')) + rect(...sibling), link('c')) + clip('b', rect(48, 0, 48, 80)) + clip('c', rect(0, .25, 1, .25), 'clipPathUnits="objectBoundingBox"'), rectangles([[48, 64, 48, 16], [144, 64, 64, 48]]))
for (const count of [1, 2]) {
  const other = count === 2 ? rect(...sibling) : ''
  add('use-own-clip-' + count, rect(0, 0, 96, 96, 'id="shape"') + clip('a', '<use href="#shape" x="16" y="16" ' + link('b') + '/>' + other) + clip('b', rect(48, 0, 48, 80)), rectangles([[64, 16, 48, 80], ...(count === 2 ? [sibling] : [])]))
  add('use-target-clip-' + count, rect(0, 0, 96, 96, 'id="shape" ' + link('b')) + clip('a', '<use href="#shape" x="16" y="16"/>' + other) + clip('b', rect(32, 0, 48, 64)), rectangles([[48, 16, 48, 64], ...(count === 2 ? [sibling] : [])]))
}
add('use-own-object-box', rect(0, 0, 96, 96, 'id="shape"') + clip('a', '<use href="#shape" x="16" y="16" ' + link('b') + '/>' + rect(...sibling)) + clip('b', rect(.25, .25, .5, .5), 'clipPathUnits="objectBoundingBox"'), rectangles([[40, 40, 48, 48], sibling]))
add('evenodd-child', clip('a', '<path d="M16 16H112V112H16Z M32 32H96V96H32Z" clip-rule="evenodd" ' + link('b') + '/>' + rect(...sibling)) + clip('b', rect(48, 0, 32, 128)), rectangles([[48, 16, 32, 16], [48, 96, 32, 16], sibling]))
add('evenodd-nested-resource', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', '<path d="M0 0H128V128H0Z M32 32H96V96H32Z" clip-rule="evenodd"/>'), rectangles([[16, 16, 96, 16], [16, 32, 16, 64], [96, 32, 16, 64], [16, 96, 96, 16], sibling]))
for (const time of [0, .5, 1, 1.5]) {
  const moving = rect(32, 0, 32, 128).replace('/>', '><animate attributeName="x" from="32" to="64" dur="2s" repeatCount="indefinite"/></rect>')
  add('animated-child-clip-' + time, clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', moving), rectangles([[32 + time * 16, 16, 32, 96], sibling]), undefined, { time })
}
add('sibling-after-clipped-paint', clip('a', rect(...box, link('b')) + rect(...sibling)) + clip('b', rect(48, 0, 48, 80)), rectangles([[48, 16, 48, 64], sibling]) + rect(208, 208, 32, 32, 'fill="blue"'), rect(0, 0, 256, 256, 'fill="red" ' + link('a')) + rect(208, 208, 32, 32, 'fill="blue"'))
// Minimized controls retain the browser disagreement rather than changing the oracle.
add('own-user-space-with-child-clip', clip('a', rect(...box, link('b')) + rect(...sibling), link('c')) + clip('b', rect(48, 0, 48, 80)) + clip('c', rect(0, 64, 256, 64)), rectangles([[48, 64, 48, 16], [144, 64, 64, 48]]))
add('own-object-box-without-child-clip', clip('a', rect(...box) + rect(...sibling), link('c')) + clip('c', rect(0, .25, 1, .25), 'clipPathUnits="objectBoundingBox"'), rectangles([[16, 64, 96, 48], [144, 64, 64, 48]]))
add('use-explicit-translation', rect(0, 0, 96, 96, 'id="shape"') + clip('a', '<use href="#shape" transform="translate(16 16)" ' + link('b') + '/>' + rect(...sibling)) + clip('b', rect(48, 0, 48, 80)), rectangles([[64, 16, 48, 80], sibling]))
add('use-own-and-target-clips', rect(0, 0, 96, 96, 'id="shape" transform="translate(16 0)" ' + link('c')) + clip('a', '<use href="#shape" x="16" y="16" ' + link('b') + '/>' + rect(...sibling)) + clip('b', rect(48, 0, 48, 80)) + clip('c', rect(0, 32, 64, 32)), rectangles([[64, 48, 32, 32], sibling]))
module.exports = { cases }
