'use strict'
// Deterministic authored documents; independent parsers live outside product dependencies.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { signature } = require('../tests/helpers/markdown-list-tabs')
const sourceHash = source => crypto.createHash('sha256').update(source).digest('hex')
function documents () {
  const bodies = {
    div: '<div>\nBODY\n</div>', span: '<span>\nBODY\n</span>', custom: '<custom>\nBODY\n</custom>',
    pre: '<pre>\nCODE\tBODY\n</pre>', comment: '<!--\nBODY\n-->', processing: '<?target\nBODY\n?>',
    declaration: '<!X\nBODY\n>', cdata: '<![CDATA[\nBODY\n]]>', script: '<script>\nvoid 0;\n</script>',
    style: '<style>\n.fixture {color:red}\n</style>', paragraph: 'START', fence: '```\nCODE\tBODY\n```', heading: '# START', rule: '---'
  }
  const endings = { immediate: '', rawParagraph: '\nparagraph', newParagraph: '\n\nparagraph', blank: '\n', heading: '\n# HEADING' }
  const wrappers = {
    root: lines => lines, quote: lines => lines.map(l => '> ' + l), doubleQuote: lines => lines.map(l => '> > ' + l),
    list: lines => lines.map((l, i) => (i ? '  ' : '- ') + l),
    quoteList: lines => lines.map((l, i) => (i ? '>   ' : '> - ') + l),
    listQuote: lines => lines.map((l, i) => (i ? '  > ' : '- > ') + l),
    quoteListQuote: lines => lines.map((l, i) => (i ? '>   > ' : '> - > ') + l)
  }
  const cases = []
  for (const [bodyName, body] of Object.entries(bodies)) for (const [endingName, ending] of Object.entries(endings)) for (const [container, wrap] of Object.entries(wrappers)) {
    const source = wrap((body + ending).split('\n')).join('\n') + '\nTAIL **bold** [jump](#after)\n\n# AFTER\n'
    cases.push({ name: `${bodyName}-${endingName}-${container}`, body: bodyName, ending: endingName, container, source, sha256: sourceHash(source) })
  }
  for (const c of require('../tests/fixtures/markdown-list-tabs-reference.json').cases.filter(c => c.retainedDifference && !c.name.includes('task'))) cases.push({ name: 'retained-' + c.name, body: 'retained', source: c.source, sha256: c.sha256 })
  return cases
}
function probe (modules, output, sources = documents(), readerRoot = null) {
  const render = readerRoot ? require(path.join(readerRoot, "miniprogram/file-reader/markdown/runtime/markdown-document")).renderMarkdownDocument : renderMarkdownDocument
  const cm = require(path.join(modules, 'commonmark')), md = require(path.join(modules, 'markdown-it'))
  const versions = { commonmark: require(path.join(modules, 'commonmark/package.json')).version, markdownIt: require(path.join(modules, 'markdown-it/package.json')).version }
  if (versions.commonmark !== '0.31.2' || versions.markdownIt !== '15.0.1') throw new Error('Pinned independent parser versions required')
  const parser = new cm.Parser(), renderer = new cm.HtmlRenderer(), secondary = new md('commonmark')
  const rows = sources.map(c => {
    const referenceHtml = renderer.render(parser.parse(c.source)), secondaryHtml = secondary.render(c.source)
    const actualHtml = render(c.source).html
    const expected = signature(referenceHtml, 'mixed'), other = signature(secondaryHtml, 'mixed'), actual = signature(actualHtml, 'mixed')
    return { ...c, referenceHtml, secondaryHtml, actualHtml, oracleAgreement: JSON.stringify(expected) === JSON.stringify(other), exact: JSON.stringify(actual) === JSON.stringify(expected) }
  })
  const failures = rows.filter(r => r.oracleAgreement && !r.exact), disagreements = rows.filter(r => !r.oracleAgreement)
  const byBody = {}; for (const r of failures) byBody[r.body] = (byBody[r.body] || 0) + 1
  const report = { at: new Date().toISOString(), versions, scope: 'Deterministic authored source matrix; see generator for dimensions. Structural screening only; actual host, browser and scope review required before claiming a visible repair.', readerRoot: readerRoot || path.resolve(__dirname, '..'), summary: { cases: rows.length, certifiedFailures: failures.length, oracleDisagreements: disagreements.length, byBody }, rows }
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'baseline.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report.summary, report: path.join(output, 'baseline.json') }))
  return report
}
if (require.main === module) probe(path.resolve(process.argv[2]), path.resolve(process.argv[3] || 'outputs/markdown-html-boundaries'))
module.exports = { documents, probe }
