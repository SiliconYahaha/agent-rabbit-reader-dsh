'use strict'

const unicodeSpaces = [0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]
const modes = ['normal', 'nowrap', 'pre-line', 'pre', 'pre-wrap', 'break-spaces']
const cases = []
for (const mode of modes) for (const point of unicodeSpaces) {
  const space = String.fromCodePoint(point)
  cases.push({ id: `${mode}-${point}`, mode, html: `A${space}${space}B`, expected: `A${space}${space}B` })
}
for (let count = 1; count <= 20; count++) cases.push({ id: `blank-${count}`, mode: 'pre-line', html: `A${'\n'.repeat(count)}B`, expected: `A${'\n'.repeat(count)}B` })
for (const mode of modes) {
  cases.push({ id: `crlf-${mode}`, mode, html: 'A\r\n\rB', expected: /^(normal|nowrap)$/.test(mode) ? 'A B' : 'A\n\nB' })
  cases.push({ id: `reference-cr-${mode}`, mode, html: 'A&#13;B', expected: ['pre', 'pre-wrap', 'break-spaces'].includes(mode) ? 'A\rB' : 'A B' })
  cases.push({ id: `entities-${mode}`, mode, html: 'A&ensp;&emsp;&thinsp;B', expected: 'A\u2002\u2003\u2009B' })
}
cases.push({ id: 'newline-entity', mode: 'pre-line', html: 'A&NewLine;&NewLine;B', expected: 'A\n\nB' })
cases.push({ id: 'pre-line-indent', mode: 'pre-line', html: 'A \t\n \t\n  B', expected: 'A\n\nB' })
cases.push({ id: 'ordinary-collapse', mode: 'normal', html: 'A  \t\n  B', expected: 'A B' })

function caseMarkup (item) { return `<div id="case-${item.id}" style="white-space:${item.mode};font:16px/24px monospace">${item.html}</div>` }

const visualHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px/24px sans-serif;background:#fff;color:#171715}h1{font-size:22px}section{padding:12px;border-bottom:1px solid #ddd}.sample{font:20px/28px monospace;border-left:3px solid #70833d;padding-left:8px}button{padding:8px 14px}
</style></head><body><h1>正文空白回归</h1>
<section>空行：A与B之间应空一行<div id="blank" class="sample" style="white-space:pre-line">A\n\nB</div></section>
<section>不换行空格：保留两个<div id="nbsp" class="sample">A&nbsp;&nbsp;B</div></section>
<section>全角缩进：保留两个<div id="wide" class="sample">&#12288;&#12288;正文</div></section>
<section>跨标签空行<div id="split" class="sample" style="white-space:pre-line"><span>A</span>\n\n<span>B</span></div></section>
<section>普通源码换行应折叠<div id="normal" class="sample">A  \n  B</div></section>
<button id="update">更新正文</button><div id="dynamic" class="sample" style="white-space:pre-line">初始</div>
<script>document.getElementById('update').addEventListener('click',function(){document.getElementById('dynamic').textContent='更新A\\n\\n更新B\\u00a0\\u00a0结束'})</script>
</body></html>`

module.exports = { unicodeSpaces, modes, cases, caseMarkup, visualHtml }
