'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { extractZipEntry, inspectZip } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { resolveZipLink } = require('../miniprogram/file-reader/archive/zip-links')
const { zipWithLinks } = require('./helpers/archive-links')

async function openLink (members, name = 'shortcut') {
  const archive = zipWithLinks(members)
  const inspection = inspectZip(archive)
  const entries = inspection.zipIdentityEntries
  const link = entries.find(entry => entry.name === name)
  const resolved = await resolveZipLink(entries, link, (entry, maxSize) => extractZipEntry(archive, entry, { maxSize }))
  return { archive, inspection, resolved }
}

test('ZIP Unix 符号链接显示为链接并打开包内真实正文', async () => {
  const opened = await openLink([
    { name: 'docs/page.html', content: '<h1>ZIP 链接真实正文</h1>' },
    { name: 'shortcut', target: 'docs/page.html' }
  ])
  const visibleLink = opened.inspection.entries.find(entry => entry.name === 'shortcut')
  assert.equal(visibleLink.isLink, true)
  assert.match(visibleLink.detail, /符号链接/)
  assert.equal(opened.resolved.entry.name, 'docs/page.html')
  assert.equal(Buffer.from(extractZipEntry(opened.archive, opened.resolved.entry)).toString(), '<h1>ZIP 链接真实正文</h1>')
})

test('ZIP 链接支持相对路径和中间目录，并拒绝越界、缺失、循环与同名', async () => {
  const nested = await openLink([
    { name: 'real/docs/page.html', content: '中间目录真实正文' },
    { name: 'aliases/folder', target: '../real/docs' },
    { name: 'shortcut', target: 'aliases/folder/page.html' }
  ])
  assert.equal(nested.resolved.entry.name, 'real/docs/page.html')
  await assert.rejects(openLink([{ name: 'shortcut', target: '../../outside.txt' }]), /范围|不安全/)
  await assert.rejects(openLink([{ name: 'shortcut', target: 'missing.txt' }]), /不存在/)
  await assert.rejects(openLink([{ name: '__MACOSX/hidden.txt', content: '系统元数据' }, { name: 'shortcut', target: '__MACOSX/hidden.txt' }]), /不存在/)
  await assert.rejects(openLink([{ name: 'first', target: 'second' }, { name: 'second', target: 'first' }], 'first'), /循环/)
  await assert.rejects(openLink([{ name: 'target.txt', content: 'one' }, { name: 'target.txt', content: 'two' }, { name: 'shortcut', target: 'target.txt' }]), /同名/)
})

test('ZIP 目录链接返回真实子项而不是目标路径文本', async () => {
  const opened = await openLink([
    { name: 'docs/child.txt', content: '目录子文件' },
    { name: 'folder', target: 'docs' }
  ], 'folder')
  assert.equal(opened.resolved.entry.isDirectory, true)
  assert.deepEqual(opened.resolved.entries.map(entry => entry.name), ['docs/child.txt'])
})
