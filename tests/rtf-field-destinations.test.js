'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { rtfToText, rtfToHtml } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases, malformed, wrap, field } = require('./helpers/rtf-field-destinations')
const { readerPage, flush } = require('./helpers/reader-host')

test('optional markers preserve supported field destinations, Unicode and inherited visibility', () => {
  for (const fixture of cases) {
    assert.equal(rtfToText(fixture.source), fixture.expected, fixture.id + ' string')
    assert.equal(rtfToText(Buffer.from(fixture.source)), fixture.expected, fixture.id + ' bytes')
  }
})

test('field instructions and unsupported destinations cannot leak into the result or execute markup', () => {
  const source = wrap('A' + field('<script>window.bad=1</script>&', true, true) + 'Z')
  const html = rtfToHtml(Buffer.from(source))
  assert.doesNotMatch(html, /<script|NEVER-BODY|https:\/\/example/)
  assert.match(html, /&lt;script&gt;window.bad=1&lt;\/script&gt;&amp;/)
  for (const id of ['result-prefix-unknown', 'field-prefix-unknown', 'instruction-remains-hidden']) {
    assert.equal(rtfToText(cases.find(row => row.id === id).source), 'AZ', id)
  }
})

test('newly readable field results still validate binary lengths, Unicode and codepages', () => {
  for (const fixture of malformed) assert.throws(() => rtfToText(Buffer.from(fixture.source)), /RTF/, fixture.id)
})

test('one actual host recovers from invalid field results and ignores stale file reads', async () => {
  const reads = [], page = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  const open = fixture => { page.openSelectedFile({ name: fixture.id + '.rtf', path: '/local/' + fixture.id + '.rtf', size: Buffer.byteLength(fixture.source) }); return reads.shift() }
  try {
    for (const fixture of malformed) {
      open(fixture).success({ data: Buffer.from(fixture.source) }); await flush()
      assert.match(page.data.error, /RTF/)
      const valid = cases.find(row => row.id === 'both-unicode')
      open(valid).success({ data: Buffer.from(valid.source) }); await flush()
      assert.equal(page.data.error, '')
      assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, valid.expected)
    }
    const stale = cases.find(row => row.id === 'both-plain'), current = cases.find(row => row.id === 'both-fallback')
    const oldRead = open(stale), newRead = open(current)
    newRead.success({ data: Buffer.from(current.source) }); await flush()
    oldRead.success({ data: Buffer.from(stale.source) }); await flush()
    assert.equal(page._htmlRuntime.document.querySelector('pre').textContent, current.expected)
  } finally { page.detached() }
})
