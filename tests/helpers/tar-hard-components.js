'use strict'

const common = [
  { name: 'real/', type: '5' }, { name: 'real/deep/', type: '5' },
  { name: 'body.txt', body: 'ROOT\n' }, { name: 'real/body.txt', body: 'REAL\n' },
  { name: 'real/deep/body.txt', body: 'DEEP\n' },
  { name: 'folder', type: '2', target: 'real/deep' }
]
module.exports = [
  ['hard-through-directory-link', 'folder/body.txt', 'DEEP\n'],
  ['hard-parent-after-directory-link', 'folder/../body.txt', 'REAL\n'],
  ['hard-repeat-finite', 'folder/../../folder/../body.txt', 'REAL\n'],
  ['hard-missing-before-parent', 'missing/../body.txt', null],
  ['hard-file-before-parent', 'body.txt/../body.txt', null],
  ['hard-file-trailing-slash', 'body.txt/', null]
].map(([name, target, body]) => ({ name, selected: 'open.txt', members: [...common, { name: 'open.txt', type: '1', target }], body }))
