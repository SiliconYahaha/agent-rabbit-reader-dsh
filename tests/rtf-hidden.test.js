'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { readerPage } = require('./helpers/reader-host')
const { cases, malformed } = require('./helpers/rtf-hidden')

for (const sample of cases) {
  test('RTF hidden character formatting: ' + sample.name, () => {
    assert.equal(rtfToText(sample.source), sample.expected)
    assert.equal(rtfToText(Buffer.from(sample.source)), sample.expected)
  })
}

test('RTF hidden content still validates structure, bytes and Unicode; later files recover', () => {
  for (const sample of malformed) {
    assert.throws(() => rtfToText(Buffer.from(sample.source)), /RTF/, sample.name)
    assert.equal(rtfToText('{\\rtf1 VISIBLE}'), 'VISIBLE')
  }
})

test('RTF hidden byte runs retain validation at the decoder chunk boundary', () => {
  const { encodedRtf } = require('./helpers/rtf-samples')
  const original = encodedRtf('A'.repeat(8191) + '中文'.repeat(4500), 'gbk', 936, 2)
  const source = Buffer.concat([Buffer.from('{\\rtf1 A{\\v '), original, Buffer.from('}B}')])
  assert.equal(rtfToText(source), 'AB')
})

test('RTF file entry preserves visible body, rejects malformed/empty content and recovers on the same host', () => {
  let bytes
  const page = readerPage({ getFileSystemManager: () => ({
    readFile: options => options.success({ data: bytes })
  }) })
  try {
    for (const sample of [...cases, ...malformed, cases[0], cases[8]]) {
      bytes = Buffer.from(sample.source)
      page.openSelectedFile({ name: sample.name + '.rtf', path: '/local/body.rtf', size: bytes.length })
      if (!sample.expected) {
        assert.match(page.data.error, /RTF/, sample.name)
        assert.equal(page.data.hasContent, false, sample.name)
      } else {
        assert.equal(page.data.error, '', sample.name)
        assert.equal(page.data.hasContent, true, sample.name)
        assert.equal(page._htmlRuntime.document.body.textContent.trim(), sample.expected, sample.name)
        assert.equal(page._htmlRuntime.document.querySelector('script'), null, sample.name)
      }
    }
  } finally { page.detached() }
})

test('RTF stale hidden-file read callback cannot overwrite a subsequently selected visible file', () => {
  const reads = []
  const page = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  try {
    page.openSelectedFile({ name: 'hidden.rtf', path: '/local/hidden.rtf' })
    page.openSelectedFile({ name: 'visible.rtf', path: '/local/visible.rtf' })
    reads[1].success({ data: Buffer.from('{\\rtf1 VISIBLE}') })
    reads[0].success({ data: Buffer.from('{\\rtf1\\v HIDDEN}') })
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'VISIBLE')
    assert.equal(page.data.error, '')
  } finally { page.detached() }
})
