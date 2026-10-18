'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname, '..')
function definition (relative, register) {
  let value
  const file = path.join(root, relative)
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { [register]: data => { value = data }, require: require('node:module').createRequire(file) })
  return value
}

test('all-formats categories retain extension coverage and distinguish limited previews from demos', () => {
  const page = definition('miniprogram/examples/pages/formats/formats.js', 'Page')
  const guide = require('../miniprogram/examples/format-guide')
  const expected = new Set([...guide.primaryFormats, ...guide.additionalFormats].flatMap(group => group.extensions).concat('dwg'))
  const actual = new Set(page.data.formats.flatMap(group => group.extensions))
  assert.deepEqual([...actual].sort(), [...expected].sort())
  for (const group of page.data.formats) {
    assert.ok(group.label && group.title && group.iconLabel && group.usage, JSON.stringify(group))
    assert.doesNotMatch(group.title, /品牌|18 点|时钟/)
  }
  assert.equal(page.data.formats.find(g => g.extensions.includes('fig')).badge, '内嵌预览')
  assert.equal(page.data.formats.find(g => g.extensions.includes('dwg')).badge, '仅文件信息')
})

test('file information closes on file change and names without extensions stay readable', () => {
  const bar = definition('miniprogram/file-reader/skin/filebar/filebar.js', 'Component')
  const host = { data: { ...bar.data }, setData (patch) { Object.assign(this.data, patch) } }
  bar.observers.name.call(host, '海报.psd')
  bar.methods.toggle.call(host)
  assert.equal(host.data.expanded, true)
  bar.observers.name.call(host, '下一个文件')
  assert.equal(host.data.expanded, false)
  assert.equal(host.data.extension, 'FILE')
  bar.observers.name.call(host, '长名称.版本.2026.SVG')
  assert.equal(host.data.extension, 'SVG')
})
