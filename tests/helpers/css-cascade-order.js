'use strict'

const families = [
  ['margin', 'margin-left', '12px', '40px', '12px', '40px'],
  ['padding', 'padding-left', '12px', '40px', '12px', '40px'],
  ['background', 'background-color', 'yellow', 'lime', 'rgb(255, 255, 0)', 'rgb(0, 255, 0)'],
  ['font', 'font-size', 'italic 20px/1.5 sans-serif', '32px', '20px', '32px'],
  ['border', 'border-left-width', '4px solid green', '12px', '4px', '12px'],
  ['border-top', 'border-top-width', '4px solid green', '12px', '4px', '12px'],
  ['outline', 'outline-width', '4px solid green', '12px', '4px', '12px'],
  ['overflow', 'overflow-x', 'hidden', 'scroll', 'hidden', 'scroll'],
  ['list-style', 'list-style-type', 'square inside', 'circle', 'square', 'circle']
]
const cases = []
for (const [short, long, a, b, expectedA, expectedB] of families) {
  const add = (name, css, expected, inline = '') => cases.push({ name:short+'/'+name, css, property:long, expected, inline })
  const s = short+':'+a, l = long+':'+b
  add('short-last', `#probe{${l};${s}}`, expectedA)
  add('long-last', `#probe{${s};${l}}`, expectedB)
  add('short-reassigned', `#probe{${s};${l};${s}}`, expectedA)
  add('long-reassigned', `#probe{${l};${s};${l}}`, expectedB)
  add('specific-long', `#probe{${l}}div{${s}}`, expectedB)
  add('specific-short', `#probe{${s}}div{${l}}`, expectedA)
  add('important-long', `div{${l}!important}#probe{${s}}`, expectedB)
  add('important-short', `div{${s}!important}#probe{${l}}`, expectedA)
  add('important-beats-inline-long', `#probe{${s}!important}`, expectedA, l)
  add('important-beats-inline-short', `#probe{${l}!important}`, expectedB, s)
  add('inline-long', `#probe{${l};${s}}`, expectedB, l)
  add('inline-short', `#probe{${s};${l}}`, expectedA, s)
  add('both-important', `#probe{${s}!important;${l}!important;${s}!important}`, expectedA)
  add('variable-short', `:root{--value:${a}}#probe{${l};${short}:var(--value)}`, expectedA)
  add('variable-important-long', `:root{--value:${b}}#probe{${long}:var(--value)!important;${s}}`, expectedB)
}
// Inline styles do not apply to pseudo-elements: keep only stylesheet variants.
for (const c of cases.slice().filter(c=>!c.inline)) cases.push({...c,name:'pseudo/'+c.name,pseudo:'::before',css:c.css.replace(/#probe(?=\{)/g,'#probe::before').replace(/\bdiv(?=\{)/g,'div::before')})
for (const selector of ['::before','body ::before','body > ::before']) cases.push({name:'implicit-universal/'+selector,pseudo:'::before',css:`${selector}{padding-left:22px}`,property:'padding-left',expected:'22px',inline:''})
cases.push({name:'contrast-uses-winning-background',css:'#probe{color:#222;background-color:#000;background:#fff}',property:'color',expected:'rgb(34, 34, 34)',inline:''})
const htmlFor = c => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white;color:black}#probe${c.pseudo||''}{border-style:solid;outline-style:solid}${c.pseudo?'#probe::before{content:"伪元素正文"}':''}${c.css}</style><div id="probe" style="${c.inline}">正文保留</div>`
const visualHtml = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:18px;background:white;color:#171717;font:18px sans-serif}#card{background-color:#f2ffc9;font-size:24px;padding-left:28px}section{background:white;font:16px/1.6 sans-serif;padding:12px;border:1px solid #555;border-radius:12px}#card.changed{background-color:#daf0ff;font-size:28px;padding-left:36px}button{font:18px sans-serif;padding:12px;margin-top:18px}</style><h1>样式优先级</h1><section id="card">标题和正文应保持字号、底色与间距。</section><p id="result">初始状态</p><button id="change">切换卡片样式</button><script>document.getElementById('change').onclick=function(){document.getElementById('card').className='changed';document.getElementById('result').textContent='切换已生效'}</script>`
module.exports = { cases, families, htmlFor, visualHtml }
