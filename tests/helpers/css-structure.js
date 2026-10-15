'use strict'

const cases = []
const literals = ['{', '}', '{}', ';', ':', '/* literal */', '@media screen {x}', '@supports (display:grid) {x}', '@import "literal";', '@font-face {x}', '@keyframes move {to{x:y}}', 'url(https://example.invalid/a)', 'expression(x)', 'behavior:x', 'javascript:x', 'var(--missing)', '16rem 12pt', 'a\\{b', 'a"b', '末尾空格 ']
for (const literal of literals) {
  const css = JSON.stringify(literal)
  for (const wrapper of ['', 'media', 'supports']) cases.push({ name: `${wrapper || 'plain'}:${literal}`, css: (wrapper ? `@${wrapper} ${wrapper === 'media' ? '(min-width:1px)' : '(display:block)'}{` : '') + `#probe::before{content:${css};color:rgb(12, 34, 56)}#after{font-weight:bold}` + (wrapper ? '}' : ''), expected: literal })
}
for (const [css, expected] of [
  ['#probe::before{content:"brace \\{ inside"}', 'brace { inside'],
  ['#probe::before{content:"brace \\} inside"}', 'brace } inside'],
  ['#probe::before{content:"x"', 'x'],
  ['#probe::before{content:"x', 'x'],
  ['#probe::before{content:"x\\', 'x'],
  ['#probe::before{/* real } comment */content:"/* literal */"}', '/* literal */'],
  ['#probe::before{content:var(--label)}:root{--label:"{ variable }"}', '{ variable }'],
  ['#probe::before{content:"{前}" attr(data-label) "{后}"}', '{前}原文{后}']
]) cases.push({ name: css, css, expected })
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const caseHtml = item => `<style>${item.css}</style><p id="probe" data-label="原文">正文</p><p id="after">后续正文</p>`
const selectors = [
  ['#foo\\ ', 'foo '], ['#foo\\  ', 'foo '], ['#foo\\ , #other', 'foo '], ['#a\\{b', 'a{b'], ['#a\\}b', 'a}b'], ['#a\\;b', 'a;b'], ['#foo ', 'foo '], ['#foo　', 'foo　']
].map(([selector, id]) => ({ selector, id }))
const visualHtml = String.raw`<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:18px;background:#fff;color:#171717;font:18px sans-serif}p{line-height:1.6;margin:12px 0}h1{font-size:26px}
#braces::before{content:"{前缀} ";color:#38531b}#literal::before{content:"/*原文*/ @media { }"}
#url::before{content:"url(test) / var(--x)"}#dynamic::before{content:"{" attr(data-label) "}"}
#foo\ {font-weight:bold;color:rgb(12,34,56)}button{font:inherit;padding:10px;background:#c6ed35}
</style><h1>CSS 字符串正文</h1><p id="braces">正文保留</p><p id="literal"></p><p id="url"></p>
<p id="foo ">转义空格选择器</p><p id="dynamic" data-label="等待更新"></p><button id="change">更新内容</button><p id="result">等待点击</p>
<script>document.getElementById('change').onclick=function(){document.getElementById('dynamic').setAttribute('data-label','更新完成');document.getElementById('result').textContent='点击已生效';}</script>`
module.exports = { cases, caseHtml, selectors, visualHtml }
