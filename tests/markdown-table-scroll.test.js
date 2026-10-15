'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const ge = require('glass-easel')
const { TmplGroup } = require('glass-easel-template-compiler')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { compactDomTreeForView } = require('../miniprogram/file-reader/document/view-payload')
const { readerPage, flush } = require('./helpers/reader-host')

const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])])
const source = '# Guide\n\nBefore table\n\n| Name | Cost | Address | Coordinates | Description | Last column |\n|---|---|---|---|---|---|\n| Park | Free | North road | 33.84, 113.19 | Scenic area | RIGHT EDGE |\n\nAfter table'

test('real Markdown file opening gives each wide table a native scroll viewport without dropping cells', async () => {
  const reads = [], page = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    for (const text of [source, '# Plain\n\nNo table', source.replace('RIGHT EDGE', 'REOPENED EDGE')]) {
      page.openSelectedFile({ name: 'table.md', path: '/local/table.md' })
      reads.shift().success({ data: Buffer.from(text) })
      await flush()
      assert.equal(page.data.error, '')
      assert.equal(page.data.domMode, true)
      assert.equal(page.data.domFrameStyle, 'width:100%')
      const nodes = flatten(page.data.domTree), tables = nodes.filter(n => n.name === 'table')
      assert.equal(tables.length, text.includes('|') ? 1 : 0)
      if (tables.length) {
        assert.equal(tables[0].tableScroll, true)
        assert.equal(tables[0].children.length, 12)
        assert.match(nodes.filter(n => n.type === 'text').map(n => n.text).join(''), text.includes('REOPENED') ? /REOPENED EDGE/ : /RIGHT EDGE/)
      }
    }
  } finally { page.detached() }
})

test('fixed-width, hidden and merged-cell HTML tables retain content and avoid page-wide downscaling', () => {
  const rendered = renderHtmlDomTree('<table style="width:1200px"><caption>Caption</caption><tr><th rowspan="2">A</th><th colspan="2">B</th></tr><tr><td>C</td><td>D</td></tr></table><table hidden><tr><td>Hidden</td></tr></table>', { viewportWidth: 390 })
  assert.equal(rendered.contentWidth, 390)
  const compacted = compactDomTreeForView(rendered.nodes)
  const tables = compacted.nodes
  assert.equal(tables[0].tableScroll, true)
  assert.match(compacted.styles[tables[0].styleId], /width:1200px/)
  assert.match(compacted.styles[tables[0].children[1].styleId], /grid-row:2 \/ span 2/)
  assert.equal(tables[1].tableScrollStyle, 'display:none')
  assert.match(compacted.styles[tables[1].styleId], /display:none/)
})

test('compiled production WXML mounts horizontal scroll-view at nested table depths', () => {
  const root = path.resolve(__dirname, '..'), group = TmplGroup.newDev()
  let groups
  try {
    group.addTmpl('', fs.readFileSync(path.join(root, 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml'), 'utf8') + '<template is="dn0" data="{{nodes:domTree,styles:domStyles}}"/>')
    groups = new Function('return ' + group.getTmplGenObjectGroups())()
  } finally { group.free() }
  const rendered = renderHtmlDomTree('<article><blockquote><table><tr><td>A</td></tr></table></blockquote><section><div><table><tr><td>B</td></tr></table></div></section></article>')
  const data = compactDomTreeForView(rendered.nodes)
  const def = ge.registerElement({ template: { groupList: groups, content: groups[''] }, data: { domTree: data.nodes, domStyles: data.styles } }).general()
  const element = ge.Component.createWithContext('root', def, new ge.EmptyBackendContext())
  const walk = node => [node, ...(node.childNodes || []).flatMap(walk)]
  const scrollers = walk(element.getShadowRoot()).filter(node => node.is === 'scroll-view')
  assert.equal(scrollers.length, 2)
  for (const scroller of scrollers) assert.equal(scroller.getAttribute('scroll-x'), true)
})
