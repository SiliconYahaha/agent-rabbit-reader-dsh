'use strict'

const cases = []
const styles = [
  ['color', 'green'], ['background-color', 'green'], ['font-weight', 'bold'], ['display', 'block'], ['font-style', 'italic']
]
const escaped = (name, full, terminator) => Array.from(name, c => '\\' + c.codePointAt(0).toString(16).padStart(full ? 6 : 1, '0') + terminator).join('')
for (const [property, value] of styles) for (const full of [false, true]) for (const terminator of [' ', '\t', '\n']) {
  cases.push({ name: `${property}/${full}/${JSON.stringify(terminator)}`, css: `#probe{${escaped(property, full, terminator)}:${escaped(value, full, terminator)}}`, property, expected: value })
  cases.push({ name: `value/${property}/${full}/${JSON.stringify(terminator)}`, css: `#probe{${property}:${escaped(value, full, terminator)}}`, property, expected: value })
}
for (const [name, css, property, expected] of [
  ['dimension', '#probe{font-size:12p\\78}', 'font-size', '12px'],
  ['escaped-digit-is-unit-not-number', '#probe{font-size:1\\32 p\\78}', 'font-size', '16px'],
  ['rgb-function', '#probe{color:r\\67 b(0, 128, 0)}', 'color', 'rgb(0, 128, 0)'],
  ['hash-color', '#probe{color:#\\30 08000}', 'color', '#008000'],
  ['case-sensitive', ':root{--Brand:green;--brand:red}#probe{color:var(--Brand)}', 'color', 'green'],
  ['escaped-var-name', ':root{--Brand:green;--brand:red}#probe{color:var(--\\42 rand)}', 'color', 'green'],
  ['escaped-custom-property', ':root{--\\42 rand:green;--brand:red}#probe{color:var(--Brand)}', 'color', 'green'],
  ['escaped-var-function', ':root{--Brand:green}#probe{color:v\\61 r(--Brand)}', 'color', 'green'],
  ['unicode-variable', ':root{--主题:green}#probe{color:var(--主题)}', 'color', 'green'],
  ['escaped-colon-variable', ':root{--a\\:b:green}#probe{color:var(--a\\:b)}', 'color', 'green'],
  ['escaped-semicolon-variable', ':root{--a\\;b:green}#probe{color:var(--a\\;b)}', 'color', 'green'],
  ['nested-fallback', '#probe{color:var(--missing,var(--other,green))}', 'color', 'green'],
  ['rgb-fallback', '#probe{color:var(--missing,rgb(0,128,0))}', 'color', 'rgb(0, 128, 0)'],
  ['important', '#probe{color:green!\\69mportant;color:red}', 'color', 'green'],
  ['inline', '', 'color', 'green']
]) cases.push({ name, css, property, expected, inline: name === 'inline' ? '--Brand:green;--brand:red;\\63olor:var(--Brand)' : '' })
const htmlFor = item => `<style>#probe{color:black;background-color:transparent;font-weight:normal;font-style:normal;display:inline-block;font-size:16px}${item.css}</style><p id="probe"${item.inline ? ` style="${item.inline}"` : ''}>正文保留</p>`
const visualHtml = String.raw`<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:18px;background:#fff;color:#171717;font:18px sans-serif}h1{font-size:25px}p{line-height:1.6;margin:12px 0}
:root{--Brand:green;--brand:red}#escaped{\63 olor:\67 reen}#variable{color:var(--Brand)}#inline{color:var(--Brand)}#result{font-weight:bold}button{font:inherit;padding:10px;background:#c6ed35}
</style><h1>CSS 属性与变量</h1><p id="escaped">转义属性：绿色</p><p id="variable">大小写变量：绿色</p>
<p id="inline" style="--Brand:green;--brand:red">行内变量：绿色</p><button id="change">切换为蓝色</button><p id="result">等待点击</p>
<script>document.getElementById('change').onclick=function(){document.documentElement.style.setProperty('--Brand','blue');document.getElementById('variable').textContent='大小写变量：蓝色';document.getElementById('inline').style.setProperty('--Brand','blue');document.getElementById('inline').textContent='行内变量：蓝色';document.getElementById('result').textContent='点击已生效';}</script>`
module.exports = { cases, htmlFor, visualHtml }
