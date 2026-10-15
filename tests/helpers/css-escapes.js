'use strict'

const cases = []
const codes = [0, 1, 9, 10, 13, 32, 34, 39, 65, 92, 128, 160, 0x2003, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xffff, 0x1f430, 0x10ffff, 0x110000, 0xffffff]
for (const code of codes) for (const terminator of [' ', '\t', '\n', '\r\n', '\f', '\u00a0']) {
  const hex = code.toString(16)
  const decoded = !code || code >= 0xd800 && code <= 0xdfff || code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code)
  cases.push({ id: cases.length, css: `"L\\${hex}${terminator}R"`, expected: 'L' + decoded + (terminator === '\u00a0' ? terminator : '') + 'R', name: `U+${hex}/${JSON.stringify(terminator)}` })
}
for (const [css, expected] of [
  ['"\\41B"', '\u041b'], ['"\\000041B"', 'AB'], ['"\\1100000"', '\ufffd0'],
  ['"\\0000000"', '\ufffd0'], ['"\\41  B"', 'A B'], ['"\\41\u3000B"', 'A\u3000B'],
  ['"a\\\nb"', 'ab'], ['"a\\\r\nb"', 'ab'], ['"a\\\fb"', 'ab'],
  ['"a\\qb"', 'aqb'], ['"a\\\\41b"', 'a\\41b'], ['"a\\\"b"', 'a"b'],
  ['"one" "two"', 'onetwo'], ['"attr(data-label)"', 'attr(data-label)'],
  ['"prefix " attr(data-label) " suffix"', 'prefix \\110000 suffix'],
  ['"a\nb"', null], ['"a\r\nb"', null], ['none', null], ['normal', null],
  ['"x" unsupported()', null]
]) cases.push({ id: cases.length, css, expected, name: css })

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
function caseHtml (item) {
  return `<style>#probe::before{content:${item.css};white-space:pre-wrap}</style><p id="probe" data-label="\\110000">正文必须保留</p>`
}
const selectors = [
  ['#\\110000', '\ufffd'], ['#\\0', '\ufffd'], ['#\\d800', '\ufffd'], ['#\\10ffff', '\u{10ffff}'],
  ['#\\1f430', '🐰'], ['#\\41 B', 'AB'], ['#\\41\r\nB', 'AB'], ['#\\41 B', 'A B'],
  ['#foo\\', 'foo\ufffd'], ['#a\\+b', 'a+b'], ['#a\\,b', 'a,b'], ['#a\\.b', 'a.b'],
  ['#a\\ b', 'a b'], ['#中文', '中文'], ['#a\\>b', 'a>b'], ['#a\\:b', 'a:b']
].map(([selector, id]) => ({ selector, id }))

const visualHtml = String.raw`<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:18px;background:#fff;color:#171717;font:20px sans-serif}p{line-height:1.6;margin:16px 0}
#bad::before{content:"\110000";color:#38531b}#spaces::before{content:"\41 B · ";color:#38531b}
#literal::before{content:"属性原文：" attr(data-label);color:#38531b}
#\41 B{font-weight:bold}button{font:inherit;padding:10px;background:#c6ed35}
</style><h1>CSS 正文回归</h1><p id="bad">后续正文完整</p><p id="spaces">不换行空格保留</p>
<p id="literal" data-label="\110000"></p><p id="AB">转义选择器命中</p><button id="change">更新内容</button><p id="result">等待点击</p>
<script>document.getElementById('change').onclick=function(){document.getElementById('literal').setAttribute('data-label','更新完成');document.getElementById('result').textContent='点击已生效';}</script>`

module.exports = { cases, selectors, caseHtml, visualHtml }
