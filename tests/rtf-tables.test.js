'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { cases } = require('./helpers/rtf-tables')
const { wrap } = require('./helpers/rtf-alternatives')

test('RTF nested cells and rows retain separators once and suppress compatibility copies', () => {
  for (const c of cases) {
    assert.equal(rtfToText(c.source), c.expected, c.name)
    assert.equal(rtfToText(Buffer.from(c.source)), c.expected, c.name + ' bytes')
  }
})
test('RTF nested table metadata remains bounded and cannot conceal broken binary lengths', () => {
  for (const body of ['{\\*\\nesttableprops\\bin999 x}', '{\\nonesttables\\bin999 x}', '{\\*\\nesttableprops']) assert.throws(() => rtfToText(wrap(body)), /RTF/)
  assert.equal(rtfToText(wrap('A{\\*\\nesttableprops\\bin8 {\\}abc{}\\nestrow}Z')), 'A\nZ')
  const { spawnSync } = require('node:child_process')
  function child () {
    const a = require('node:assert/strict'), p = require('./miniprogram/file-reader/engine/core/rtf-reader').rtfToText
    const { row } = require('./tests/helpers/rtf-tables'), { wrap } = require('./tests/helpers/rtf-alternatives')
    a.equal(p(wrap(row(['A', 'B']).repeat(10000))), ('A\tB\t\n'.repeat(10000)).trim())
    a.equal(p(wrap('A{\\nonesttables ' + 'X'.repeat(4 * 1024 * 1024) + '}Z')), 'AZ')
  }
  const result = spawnSync(process.execPath, ['-e', '(' + child.toString() + ')()'], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
})

test('RTF table/list original bytes retain exact text contracts and documented oracle differences', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
  for (const [name, sha256] of [
    ['LICENSE.txt', 'ad5f4c4d0d4a04ac264ee55539191e1d36eb5d43ff63bbfc2cf97d541dc7ce8c'],
    ['NOTICE.txt', '407c430392d86b3eca6df93f62d9c07625f1968f4ed0bd68d817e00da44945aa'],
    ['libreoffice-nested-source.html', 'f5c39b238fc6705cca0bc2903f4f304dbd04b0657237b06554eb2eb2794f4708']
  ]) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'fixtures/rtf-tables', name))).digest('hex'), sha256, name)
  for (const sample of require('./fixtures/rtf-tables/samples.json')) {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/rtf-tables', sample.name))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sha256, sample.name)
    const text = rtfToText(bytes)
    assert.equal(text, sample.expected, sample.name)
    if (sample.name === 'libreoffice-nested.rtf' || sample.name === 'testRTFTableCellSeparation.rtf') {
      // Remove exactly the trailing cell terminator, not arbitrary whitespace
      // or internal separators that would hide a merged-cell-text regression.
      assert.equal(text.replace(/\t\n/g, '\n'), sample.libreOffice, sample.name)
    }
  }
})
