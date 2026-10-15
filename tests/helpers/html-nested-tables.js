'use strict'

// Authored originals: tag omission, row groups and nesting are deterministic.
function cases () {
  const rows = []
  for (const cell of ['td', 'th']) for (const group of ['implicit', 'tbody', 'thead', 'tfoot']) for (const omitted of [false, true]) for (const depth of [1, 2, 3]) {
    const id = `${cell}-${group}-${omitted ? 'omitted' : 'explicit'}-${depth}`
    function table (level) {
      const prefix = 't' + level
      const nested = level < depth ? table(level + 1) : '<button id="action">Read</button>'
      const endCell = omitted ? '' : `</${cell}>`, endRow = omitted ? '' : '</tr>'
      const content = `<tr id="${prefix}-r0"><${cell} id="${prefix}-a">A${level}${endCell}<${cell} id="${prefix}-b">B${level}${nested}Z${level}${endCell}<${cell} id="${prefix}-c">C${level}${endCell}${endRow}<tr id="${prefix}-r1"><${cell} id="${prefix}-d" colspan="3">D${level}${endCell}${endRow}`
      return `<table id="${prefix}" border="1"><caption id="${prefix}-caption">Title${level}</caption>${group === 'implicit' ? content : `<${group}>${content}${omitted && group === 'tbody' ? '' : `</${group}>`}`}</table>`
    }
    rows.push({ id, source: table(0), kind: 'nested' })
  }
  rows.push({ id: 'sibling-tables', source: '<table id="left"><tr><td id="left-a">L</table><table id="right"><tr><td id="right-a">R</table>', kind: 'control' })
  rows.push({ id: 'rowspan-and-groups', source: '<table id="outer"><thead><tr><th id="head" colspan="2">Head</thead><tbody><tr><td id="span" rowspan="2">Span<table id="inner"><tbody><tr><td id="in-a">One<tr><td id="in-b">Two</tbody></table><td id="out-a">A<tr><td id="out-b">B</tbody><tfoot><tr><td id="foot" colspan="2">Foot</tfoot></table>', kind: 'nested' })
  for (const tag of ['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']) {
    rows.push({ id: 'stray-inner-close-' + tag, kind: 'invalid-recovery', source: `<table id="outer"><${['tbody', 'thead', 'tfoot'].includes(tag) ? tag : 'tbody'}><tr><td id="outer-a">Outer<table id="inner"></${tag}><tr><td id="inner-a">Inner</td></tr></table>Tail</td></tr></${['tbody', 'thead', 'tfoot'].includes(tag) ? tag : 'tbody'}></table><p id="after">After</p>` })
  }
  return rows.map(row => ({ ...row, source: '<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}table{border-spacing:2px}td,th{padding:2px}button{font:inherit}</style></head><body>' + row.source + '</body></html>' }))
}

// Uses only standard DOM properties shared by the native and reader DOMs.
function snapshot (document) {
  const ancestor = (node, tags) => { for (let parent = node.parentNode; parent; parent = parent.parentNode) if (tags.includes(parent.localName)) return parent; return null }
  return [...document.querySelectorAll('table')].map(table => ({
    id: table.id,
    parentCell: ancestor(table, ['td', 'th'])?.id || '',
    captions: [...table.children].filter(x => x.localName === 'caption').map(x => x.textContent),
    rows: [...table.querySelectorAll('tr')].filter(row => ancestor(row, ['table']) === table).map(row => ({
      id: row.id,
      group: row.parentNode.localName,
      cells: [...row.children].filter(x => ['td', 'th'].includes(x.localName)).map(cell => ({ id: cell.id, tag: cell.localName, text: cell.textContent, colspan: cell.getAttribute('colspan') || '1', rowspan: cell.getAttribute('rowspan') || '1' }))
    }))
  }))
}
module.exports = { cases, snapshot }
