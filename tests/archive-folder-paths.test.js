'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildArchiveTree } = require('../miniprogram/file-reader/engine/core/file-inspector')

const file = (name, id, pathSeparator = 'slash') => ({ name, id, memberIndex: id, pathSeparator, isDirectory: false, canOpen: true })
const visible = entries => entries.map(({ name, displayName, depth }) => [name, displayName, depth])

test('implicit archive directories preserve literal backslashes at every level', () => {
  const sources = [file('literal\\dir/page.txt', 0), file('literal/dir/real.txt', 1), file('literal\\dir/deep\\name/second.txt', 2)]
  const expected = [
    ['literal/', 'literal/', 0], ['literal/dir/', 'dir/', 1], ['literal/dir/real.txt', 'real.txt', 2],
    ['literal\\dir/', 'literal\\dir/', 0], ['literal\\dir/deep\\name/', 'deep\\name/', 1],
    ['literal\\dir/deep\\name/second.txt', 'second.txt', 2], ['literal\\dir/page.txt', 'page.txt', 1]
  ]
  assert.deepEqual(visible(buildArchiveTree(sources)), expected)
  const explicit = sources.concat(['literal\\dir', 'literal\\dir/deep\\name'].map((name, i) => ({ ...file(name, 10 + i), isDirectory: true })))
  assert.deepEqual(visible(buildArchiveTree(explicit)), expected)
  assert.deepEqual(visible(buildArchiveTree(buildArchiveTree(sources))), expected)
})

test('case-distinct directory subtrees and same-name files stay in their own visible groups', () => {
  const tree = buildArchiveTree([file('a/first.txt', 0), file('A/last.txt', 1), file('A', 2), file('a', 3), file('A/sub/last.txt', 4), file('A/Sub/first.txt', 5)])
  assert.deepEqual(tree.map(e => e.name), ['A', 'A/', 'A/last.txt', 'A/Sub/', 'A/Sub/first.txt', 'A/sub/', 'A/sub/last.txt', 'a', 'a/', 'a/first.txt'])
  assert.deepEqual(tree.filter(e => !e.isDirectory).map(e => [e.id, e.memberIndex]), [[2, 2], [1, 1], [5, 5], [4, 4], [3, 3], [0, 0]])
})

test('dual separators, same-name identities and unsafe archive entries retain their contracts', () => {
  const entries = [file('docs\\same.txt', 0, 'both'), file('docs/same.txt', 1, 'both'), file('../outside.txt', 2), file('folder\\..\\outside.txt', 3)]
  const tree = buildArchiveTree(entries)
  const duplicates = tree.filter(e => e.id === 0 || e.id === 1)
  assert.deepEqual(duplicates.map(e => e.displayName), ['same.txt（同名 1/2）', 'same.txt（同名 2/2）'])
  assert.deepEqual(duplicates.map(e => e.memberIndex), [0, 1])
  for (const id of [2, 3]) {
    const entry = tree.find(e => e.id === id)
    assert.equal(entry.canOpen, false); assert.equal(entry.depth, 0)
    assert.match(entry.detail, /路径不安全/)
  }
})
