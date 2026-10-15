'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { fileKind, isMarkdownFile } = require('../miniprogram/file-reader/shared/file-types')
const { readerPage } = require('./helpers/reader-host')

test('Markdown MIME 参数和别名在入口和实际排版中采用同一个识别规则', async () => {
  for (const type of ['text/markdown; charset=utf-8', 'Text/Markdown ; charset=UTF-8', 'text/x-markdown', 'text/markdown']) {
    const file = { name: '聊天文件', path: '/tmp/original', type, size: 100 }
    assert.equal(fileKind(file), 'text')
    assert.equal(isMarkdownFile(file), true)
    let readPath
    const page = readerPage({ getFileSystemManager: () => ({ readFile: options => { readPath = options.filePath; options.success({ data: Buffer.from('# 测试标题\n\n| 一 | 二 |\n|---|---|\n|甲|乙|') }) } }) })
    try {
      page.openSelectedFile(file)
      for (let i = 0; i < 40 && !page.data.hasContent && !page.data.error; i++) await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(readPath, '/tmp/original')
      assert.equal(page.data.error, '', type)
      assert.ok(page.data.hasContent, type)
      assert.equal(page._htmlRuntime.document.querySelector('h1').textContent, '测试标题')
      assert.equal(page._htmlRuntime.document.querySelectorAll('table').length, 1)
    } finally { page.disposeHtmlRuntime() }
  }
  assert.equal(isMarkdownFile({ name: 'note.txt', type: 'text/plain' }), false)
  assert.equal(fileKind({ name: 'photo.png', type: 'image/png' }), 'image')
})
