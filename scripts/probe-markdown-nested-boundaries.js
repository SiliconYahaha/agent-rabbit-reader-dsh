'use strict'
const path = require('node:path'), crypto = require('node:crypto')
const { probe } = require('./probe-markdown-html-boundaries')
function documents () {
  const bodies = { div: '<div>\nBODY\n</div>', pre: '<pre>\nCODE\tBODY\n</pre>', paragraph: 'START', fence: '```\nCODE\tBODY\n```', heading: '# START', span: '<span>\nBODY\n</span>' }
  const endings = { immediate: '', blank: '\n', newParagraph: '\n\nparagraph', lazy: '\nparagraph\nlazy', heading: '\nparagraph\n# HEADING' }
  const contexts = ['LLQ','QLLQ','LQL','QLQLQ','OQ','LQQ']
  const mark = { L: '- ', O: '3. ', Q: '> ' }, indent = { L: '  ', O: '   ', Q: '> ' }
  function wrap (source, context) {
    for (const type of [...context].reverse()) source = source.split('\n').map((line, i) => (i ? indent[type] : mark[type]) + line).join('\n')
    return source
  }
  const rows = []
  for (const [body, text] of Object.entries(bodies)) for (const [ending, tail] of Object.entries(endings)) for (const context of contexts) for (const keep of new Set([0, 1, context.length - 1])) {
    const prefix = [...context.slice(0, keep)].map(t => indent[t]).join('')
    const source = wrap(text + tail, context) + '\n' + prefix + 'TAIL_ONE **bold**\nTAIL_TWO\n\n# AFTER\n'
    rows.push({ name: `${body}-${ending}-${context}-keep${keep}`, body, ending, container: context, keep, source, sha256: crypto.createHash('sha256').update(source).digest('hex') })
  }
  return rows
}
if (require.main === module) probe(path.resolve(process.argv[2]), path.resolve(process.argv[3] || 'outputs/markdown-html-boundaries/nested'), documents(), process.argv[4] && path.resolve(process.argv[4]))
function transitions () {
  const rows = []
  for (const middle of ['lazy','2. second','1. first','- next','<span>','<div>','    indented','===']) for (const follow of ['<span>','ordinary','---','```']) {
    const source = '- > FIRST\n  ' + middle + '\n  > ' + follow + '\n  > LAST\nTAIL\n\nAFTER\n'
    rows.push({ name: middle + '/' + follow, body: 'lazy-transition', source, sha256: crypto.createHash('sha256').update(source).digest('hex') })
  }
  return rows
}
module.exports = { documents, transitions }
