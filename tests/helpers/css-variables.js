'use strict'
const cases = []
for (const length of [1, 2, 8, 9, 16, 40, 120]) {
  const chain = Array.from({ length }, (_, i) => `--v${i}:${i ? `var(--v${i - 1})` : 'green'}`).join(';')
  const cycle = Array.from({ length }, (_, i) => `--v${i}:var(--v${(i + 1) % length}, red)`).join(';')
  cases.push({ name: `chain-${length}`, css: `:root{${chain}}#probe{color:var(--v${length - 1})}`, expected: 'green' })
  cases.push({ name: `cycle-${length}`, css: `:root{${cycle}}#probe{color:var(--v0,green)}`, expected: 'green' })
}
for (const [name, css, expected, property] of [
  ['computed-inheritance', ':root{--a:green;--b:var(--a)}#probe{--a:red;color:var(--b)}', 'green'],
  ['fallback-inheritance', ':root{--b:var(--absent,green)}#probe{--absent:red;color:var(--b)}', 'green'],
  ['initial', ':root{--a:initial}#probe{color:var(--a,green)}', 'green'],
  ['inherit', ':root{--a:green}#probe{--a:inherit;color:var(--a)}', 'green'],
  ['unset', ':root{--a:green}#probe{--a:unset;color:var(--a)}', 'green'],
  ['empty-override', ':root{--a:red}#probe{--a:;color:var(--a,red)}', 'black'],
  ['invalid-fragment', ':root{--a:red var(--missing)}#probe{color:var(--a,green)}', 'green'],
  ['cycle-fragment', ':root{--a:red var(--b);--b:var(--a)}#probe{color:var(--a,green)}', 'green'],
  ['cycle-outside-fallback', ':root{--a:var(--b);--b:var(--a);--x:var(--a,green)}#probe{color:var(--x)}', 'green'],
  ['unused-fallback-cycle', ':root{--a:var(--ok,var(--b));--b:var(--a);--ok:green}#probe{color:var(--a)}', 'green'],
  ['numeric-token-boundary', '#probe{--n:10;margin-left:var(--n)px}', '0px', 'margin-left'],
  ['identifier-token-boundary', '#probe{--word:gr;color:var(--word)een}', 'black'],
  ['empty-fallback', '#probe{margin-left:var(--missing,)0px}', '0px', 'margin-left'],
  ['ordinary-valid-calc', '#probe{--n:10px;margin-left:calc(var(--n) + 2px)}', '12px', 'margin-left']
]) cases.push({ name, css, expected, property })
for (const c of cases) c.property ||= 'color'
const htmlFor = c => `<style>body{margin:0;color:black}#probe{margin:0}${c.css}</style><p id="probe">变量正文保留</p>`
const visualHtml = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:18px;background:white;color:#171717;font:18px sans-serif}p{line-height:1.6}h1{font-size:25px}button{font:inherit;padding:10px;background:#c6ed35}
:root{--a:green;--alias:var(--a);--loop:var(--loop)}#inherited{--a:red;color:var(--alias)}#cycle{color:var(--loop,green)}#updated{color:var(--alias)}
</style><h1>变量依赖与继承</h1><p id="inherited">继承别名：绿色</p><p id="cycle">循环备用：绿色</p><p id="updated">动态别名：绿色</p><button id="change">更新根变量</button><p id="result">等待点击</p>
<script>document.getElementById('change').onclick=function(){document.documentElement.style.setProperty('--a','blue');document.getElementById('inherited').textContent='继承别名：蓝色';document.getElementById('updated').textContent='动态别名：蓝色';document.getElementById('result').textContent='点击已生效';}</script>`
module.exports = { cases, htmlFor, visualHtml }
