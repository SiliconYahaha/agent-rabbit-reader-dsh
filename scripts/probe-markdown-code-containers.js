'use strict'
// Authored nested-container sources; oracle dependencies stay outside product code.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { probe } = require('./probe-markdown-html-boundaries')
function documents () {
  const rows = [], seen = new Set()
  const contexts = ['LQ', 'LL', 'OQ', 'OL', 'QLQ', 'QLL', 'LQL', 'LLQ', 'LQQ', 'OQL', 'L', 'Q']
  const wrap = (source, context) => {
    for (const type of [...context].reverse()) source = source.split('\n').map((line, i) => (type === 'Q' ? '> ' : type === 'L' ? (i ? '  ' : '- ') : (i ? '   ' : '1. ')) + line).join('\n')
    return source
  }
  for (const context of contexts) for (const body of ['    CODE\tKEEP', '\tCODE\tKEEP', '    ONE\n\n    TWO', 'PARAGRAPH\n    CONTINUED']) {
    for (const prefix of ['', '  ', '   ', '> ']) for (const tail of ['TAIL_ONE **bold**\nTAIL_TWO', 'TAIL\n===', '\nTAIL', 'TAIL\n\n    NEXT_CODE']) {
      const source = wrap(body, context) + '\n' + tail.split('\n').map(line => prefix + line).join('\n') + '\n\nAFTER\n'
      if (seen.has(source)) continue
      seen.add(source)
      rows.push({ name: 'code-container-' + rows.length, body: body.startsWith('PARAGRAPH') ? 'paragraph-control' : 'indented-code', context, source, sha256: crypto.createHash('sha256').update(source).digest('hex') })
    }
  }
  return rows
}
if (require.main === module) {
  const modules = path.resolve(process.argv[2]), out = path.resolve(process.argv[3] || 'outputs/markdown-code-containers')
  const report = probe(modules, out, documents(), process.argv[4] && path.resolve(process.argv[4]))
  report.baseCommit = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: report.readerRoot, encoding: 'utf8' }).trim()
  report.workingTree = !process.argv[4]
  fs.writeFileSync(path.join(out, 'baseline.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.rows.filter(c => c.oracleAgreement && !c.exact).slice(0,4).map(c => ({ name:c.name, source:c.source, reference:c.referenceHtml, actual:c.actualHtml }))))
}
module.exports = { documents }
