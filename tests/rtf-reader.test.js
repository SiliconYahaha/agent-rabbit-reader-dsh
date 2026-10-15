'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { encodedRtf } = require('./helpers/rtf-samples')

for (const [encoding, cp, text] of [['gbk', 936, '中文正文：会议纪要￥测试'], ['big5', 950, '繁體中文：閱讀器功能'], ['shift_jis', 932, '日本語の本文：表示と機能']]) {
  test(`RTF ${encoding} 原始字节、hex、混合与软换行的 20 个变体保留正文`, () => {
    for (let variant = 0; variant < 20; variant++) assert.equal(rtfToText(encodedRtf(`${text} ${variant} \\ { }`, encoding, cp, variant)), `${text} ${variant} \\ { }`)
  })
}

test('RTF Unicode 回退按完整控制字、控制符或 hex 字节计数', () => {
  assert.equal(rtfToText('{\\rtf1\\uc1\\u20320\\par X}'), '你X') // MSFT-RTF 1.9.1 pp.14–15, not Cocoa's newline recovery.
  assert.equal(rtfToText("{\\rtf1\\uc2\\u20320\\'c4\\'e3X}"), '你X')
  assert.equal(rtfToText('{\\rtf1\\uc1\\u20320\\{X}'), '你X')
  assert.equal(rtfToText('{\\rtf1\\uc1\\u20320\r\n?X}'), '你X')
  assert.equal(rtfToText('{\\rtf1\\uc0\\u-10179\\u-8704}'), '😀')
})

test('RTF 回退遇到组边界立即结束，uc 随组退出恢复', () => {
  assert.equal(rtfToText('{\\rtf1\\uc1\\u20320{X}Y}'), '你XY')
  assert.equal(rtfToText('{\\rtf1{\\uc2\\u20320??}\\u22909?X}'), '你好X')
  assert.equal(rtfToText('{\\rtf1{\\uc2\\u20320}{\\*\\unknown hidden}X}'), '你X')
})

test('RTF bin 长度按原始字节消费，二进制中的括号不改变正文组', () => {
  assert.equal(rtfToText('{\\rtf1 body{\\pict\\bin7 }SECRET}tail}'), 'bodytail')
  assert.equal(rtfToText('{\\rtf1\\uc1\\u20320\\bin7 }SECRET X}'), '你 X')
})

test('RTF 引号、非断空格与不换行连字符保留实际文字', () => {
  assert.equal(rtfToText('{\\rtf1\\lquote A\\rquote \\ldblquote B\\rdblquote X\\~Y\\_Z}'), '‘A’“B”X\u00a0Y\u2011Z')
  assert.equal(rtfToText('{\\rtf1 第一段\\par\\par\\par 第二段}'), '第一段\n\n\n第二段')
})

test('RTF 字体指定的中文代码页覆盖文档默认，退出组后恢复', () => {
  assert.equal(rtfToText("{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Arial;}{\\f1\\fcharset134 SimSun;}}\\f0 Caf\\'e9{\\f1 \\'d6\\'d0\\'ce\\'c4}Caf\\'e9}"), 'Café中文Café')
  assert.equal(rtfToText("{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Arial;}{\\f1\\fcharset0\\cpg936 SimSun;}}\\f1 \\'d6\\'d0\\'ce\\'c4\\plain Caf\\'e9}"), '中文Café')
  assert.equal(rtfToText("{\\rtf1\\ansicpg1252 Caf\\'e9{\\ansicpg936 \\'d6\\'d0}Caf\\'e9}"), 'Café中Café')
  assert.equal(rtfToText('{\\rtf1 a\\constructor b}'), 'ab')
})

test('RTF Windows-1252 与已解码 JS 字符串分别处理', () => {
  assert.equal(rtfToText(Buffer.from("{\\rtf1\\ansi Caf\xe9 \\'80}", 'latin1')), 'Café €')
  assert.equal(rtfToText('{\\rtf1 中文 café 😀}'), '中文 café 😀')
})

test('RTF 拒绝实际超限、过深组、损坏二进制长度和不完整结构', () => {
  assert.throws(() => rtfToText(Buffer.alloc(5 * 1024 * 1024 + 1)), /5 MB/)
  assert.throws(() => rtfToText('{\\rtf1' + '{'.repeat(1025) + '}'.repeat(1026)), /嵌套/)
  for (const source of ['{\\rtf1\\bin-1 x}', '{\\rtf1\\bin999 x}', '{\\rtf1\\bin x}', '{\\rtf1\\uc-1 x}', '{\\rtf1 x']) assert.throws(() => rtfToText(source), /RTF/)
  assert.throws(() => rtfToText("{\\rtf1\\ansicpg949 \\'b0}"), /代码页/)
  assert.throws(() => rtfToText("{\\rtf1\\ansicpg936 \\'d6}"), /字节.*代码页/)
})

test('RTF 5 MB 边界正文完整返回，跨 realm ArrayBuffer 与偏移视图可读取', () => {
  const prefix = '{\\rtf1 '
  const body = 'A'.repeat(5 * 1024 * 1024 - prefix.length - 1)
  assert.equal(rtfToText(Buffer.from(prefix + body + '}')), body)
  const source = encodedRtf('跨运行层中文')
  const padded = Buffer.concat([Buffer.from('prefix'), source, Buffer.from('suffix')])
  assert.equal(rtfToText(new DataView(padded.buffer, padded.byteOffset + 6, source.length)), '跨运行层中文')
  const crossRealm = require('node:vm').runInNewContext(`Uint8Array.from(${JSON.stringify([...source])}).buffer`)
  assert.equal(rtfToText(crossRealm), '跨运行层中文')
})

test('RTF 分块边界不能切断双字节或四字节字符', () => {
  for (const [encoding, cp, text] of [['gbk', 936, '中文'], ['big5', 950, '繁體'], ['shift_jis', 932, '日本語'], ['utf8', 65001, '😀中文']]) {
    for (let offset = 0; offset < 4; offset++) {
      const expected = 'A'.repeat(8190 + offset) + text.repeat(5000)
      assert.equal(rtfToText(encodedRtf(expected, encoding, cp, 2)), expected)
    }
  }
})

test('RTF 100 个固定种子的 Unicode 回退组合保持真实正文', () => {
  let seed = 20260831
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let sample = 0; sample < 100; sample++) {
    let expected = ''
    let source = '{\\rtf1\\uc1 '
    for (let index = 0; index < 100; index++) {
      const code = 0x4e00 + next() % 0x4000
      expected += String.fromCharCode(code)
      source += `\\u${code}${['?', "\\'3f", '\\~', '\\tab ', '\\{'][next() % 5]}`
    }
    assert.equal(rtfToText(source + '}'), expected)
  }
})

test('RTF 5 MB 正文在独立 Node 进程中避免逐字拼接的数百 MB 内存峰值', () => {
  const { spawnSync } = require('node:child_process')
  const script = `const {rtfToText}=require(${JSON.stringify(require.resolve('../miniprogram/file-reader/engine/core/rtf-reader'))});
    const body='A'.repeat(5*1024*1024-8);
    const bytes=Buffer.from('{\\\\rtf1 '+body+'}');
    if(rtfToText(bytes)!==body)process.exit(1);
    console.log(JSON.stringify({peakRssKiB:process.resourceUsage().maxRSS}));`
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  const usage = JSON.parse(result.stdout)
  assert.ok(usage.peakRssKiB < 256 * 1024, `Node 整进程峰值 ${usage.peakRssKiB} KiB 超过回归预算；不是微信真机峰值`)
})
