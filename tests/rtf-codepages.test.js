'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const iconv = require('iconv-lite')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { encodedRtf, windowsCodepageCases } = require('./helpers/rtf-samples')

const hex = bytes => Array.from(bytes, byte => `\\'${byte.toString(16).padStart(2, '0')}`).join('')

for (const { encoding, codepage, charset, source } of windowsCodepageCases) {
  const expected = iconv.decode(iconv.encode(source, encoding), encoding)
  test(`RTF ${encoding} 文档代码页保留可见正文`, () => {
    for (let variant = 0; variant < 4; variant++) {
      assert.equal(rtfToText(encodedRtf(source, encoding, codepage, variant)).normalize('NFC'), expected.normalize('NFC'))
    }
  })

  test(`RTF fcharset ${charset} 字体覆盖后退出组恢复默认代码页`, () => {
    const local = iconv.encode(source, encoding)
    const rtf = Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Arial;}{\\f1\\fcharset${charset} Local;}}\\f0 Caf\\'e9 {\\f1 ${hex(local)}} Caf\\'e9}`, 'latin1')
    assert.equal(rtfToText(rtf).normalize('NFC'), `Café ${expected} Café`.normalize('NFC'))
  })
}

test('RTF Windows 单字节代码页切换不会把前后段落按最后一个编码重解码', () => {
  const segments = windowsCodepageCases.map(({ encoding, codepage, source }) => {
    const expected = iconv.decode(iconv.encode(source, encoding), encoding)
    return { expected, rtf: `{\\ansicpg${codepage} ${hex(iconv.encode(source, encoding))}}` }
  })
  const rtf = Buffer.from(`{\\rtf1\\ansi ${segments.map(row => row.rtf).join('\\par ')}}`, 'latin1')
  assert.equal(rtfToText(rtf).normalize('NFC'), segments.map(row => row.expected).join('\n').normalize('NFC'))
})

test('RTF Windows 单字节代码页的1280个高字节与独立表一致，未定义值明确拒绝', () => {
  for (const { encoding, codepage } of windowsCodepageCases) {
    for (let byte = 0x80; byte <= 0xff; byte++) {
      const expected = iconv.decode(Buffer.from([byte]), encoding)
      const rtf = Buffer.from(`{\\rtf1\\ansi\\ansicpg${codepage} A\\'${byte.toString(16).padStart(2, '0')}B}`, 'latin1')
      if (expected === '\ufffd') assert.throws(() => rtfToText(rtf), /字节.*代码页/)
      else assert.equal(rtfToText(rtf), `A${expected}B`, `${encoding} 0x${byte.toString(16)}`)
    }
  }
})
