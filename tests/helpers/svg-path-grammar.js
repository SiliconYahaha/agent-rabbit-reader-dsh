'use strict'
const fs = require('node:fs'), path = require('node:path')
const previous = require('../../compatibility/runs/2026-09-05-svg-path-next-mutations.json')
const cases = previous.results.map(r => ({ name: r.id, input: r.input, expected: r.expected, scale: 1, kind: r.kind }))
const minimal = [
  ['relative-compact-arc', 'M10 10a10 10 0 0110 10', 'M10 10a10 10 0 0 1 10 10'],
  ['compact-fractional-endpoint', 'M10 10A10 10 0 01.5.5', 'M10 10A10 10 0 0 1 .5 .5'],
  ['signed-exponent', 'M+1e1.5L+2e1-.5', 'M10 .5L20 -.5'],
  ['implicit-lineto', 'm10 10 20 0 0 20', 'M10 10L30 10L30 30'],
  ['post-close-relative', 'M10 10l20 0z m5 5l10 10', 'M10 10L30 10z M15 15L25 25'],
  ['invalid-comma', 'M10 10L20 10,,30 30L40 40', 'M10 10L20 10'],
  ['comma-after-command', 'M10 10L,20 20', 'M10 10'],
  ['comma-before-command', 'M10 10L20 20,L30 30', 'M10 10L20 20L30 30'],
  ['comma-before-close', 'M10 10L20 20,z', 'M10 10L20 20z'],
  ['comma-after-close', 'M10 10L20 20z,L30 30', 'M10 10L20 20z'],
  ['double-comma-before-command', 'M10 10L20 20,,L30 30', 'M10 10L20 20'],
  ['trailing-comma', 'M10 10L20 20,', 'M10 10L20 20'],
  ['truncated-line', 'M10 10L20 20 30', 'M10 10L20 20'],
  ['truncated-cubic', 'M10 10L20 20C30 30 40 40', 'M10 10L20 20'],
  ['invalid-arc-flag', 'M10 10L20 20A10 10 0 2 1 30 30', 'M10 10L20 20'],
  ['fractional-arc-flag', 'M10 10L20 20A10 10 0 .5 1 30 30', 'M10 10L20 20'],
  ['nonfinite-tail', 'M10 10L20 20L1e999 30L40 40', 'M10 10L20 20'],
  ['unicode-space', 'M10 10L20 20\u00a0L40 40', 'M10 10L20 20'],
  ['invalid-exponent', 'M10 10L20 20L3e+ 40L50 50', 'M10 10L20 20'],
  ['non-moveto-start', 'L10 10L20 20', ''],
  ['invalid-moveto', 'M,10 10L20 20', ''],
  ['empty', '', '']
]
for (const [name,input,expected] of minimal) cases.push({name,input,expected,scale:4,kind:'grammar-boundary'})
const number = '[+-]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?'
const arc = new RegExp('([aA]\\s*'+number+'[\\s,]*'+number+'[\\s,]*'+number+'[\\s,]+)([01])[\\s,]+([01])[\\s,]*','g')
const compact = d => d.replace(arc, (_,head,large,sweep) => head + large + sweep)
const root = path.join(__dirname,'../fixtures/svg-path-grammar')
const publicSamples = require('../fixtures/svg-path-grammar/sources.json').map(info => ({...info,sourceText:fs.readFileSync(path.join(root,info.name),'utf8')}))
for(const sample of publicSamples) for(const [i,m] of [...sample.sourceText.matchAll(/\bd="([^"]+)"/g)].entries()) {
  for(const [variant,input] of [['original',m[1]],['compact',compact(m[1])],['invalid-tail',m[1]+'X M30 30L40 40']]) {
    cases.push({name:sample.name+'/'+i+'/'+variant,input,expected:m[1],scale:12,kind:'public-path',public:sample.name})
  }
}
module.exports={cases,publicSamples,compact}
