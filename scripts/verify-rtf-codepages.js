'use strict'

// Cross-check Windows RTF codepages against macOS system converters. The system
// tools are independent of the reader and its generated lookup tables.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const iconv = require('iconv-lite')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { encodedRtf, windowsCodepageCases } = require('../tests/helpers/rtf-samples')

function main () {
  const results = []
  for (const { encoding, codepage, source } of windowsCodepageCases) {
    const bytes = iconv.encode(source, encoding)
    const expected = iconv.decode(bytes, encoding)
    const systemIconv = execFileSync('/usr/bin/iconv', ['-f', `CP${codepage}`, '-t', 'UTF-8'], { encoding: 'utf8', input: bytes })
    assert.equal(systemIconv.normalize('NFC'), expected.normalize('NFC'), `system iconv CP${codepage}`)

    const rtf = encodedRtf(source, encoding, codepage, 2)
    const textutil = execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdin', '-stdout', '-format', 'rtf'], { encoding: 'utf8', input: rtf })
    assert.equal(textutil.trim().normalize('NFC'), expected.normalize('NFC'), `textutil CP${codepage}`)
    assert.equal(rtfToText(rtf).normalize('NFC'), expected.normalize('NFC'), `reader CP${codepage}`)
    results.push({ codepage, bytes: bytes.length, characters: Array.from(expected).length })
  }

  const macOSVersion = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
  console.log(JSON.stringify({ checked: results.length, tools: { iconv: '/usr/bin/iconv', textutil: '/usr/bin/textutil', macOSVersion }, results }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
