'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { parseFrontMatter, renderMarkdownDocument } = require('../miniprogram/file-reader/markdown/runtime/markdown-document')
const { formatFormulaText } = require('../miniprogram/file-reader/markdown/runtime/tex-text')
const { renderMermaid, detectDiagramType } = require('../miniprogram/file-reader/markdown/runtime/mermaid-lite')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')

test('front-matter 解析成 meta，正文不含分隔线；没有 front-matter 时 meta 为空', () => {
  const parsed = parseFrontMatter('---\ntitle: "报告"\nagi_bar_version: 1\nwx_miniapp_path: /pages/index/index\n---\n\n# 标题\n')
  assert.deepEqual(parsed.meta, { title: '报告', agi_bar_version: '1', wx_miniapp_path: '/pages/index/index' })
  assert.equal(parsed.body, '# 标题\n')
  assert.deepEqual(parseFrontMatter('# 没有头\n').meta, {})
  assert.equal(parseFrontMatter('---\nno closing\n# x').body, '---\nno closing\n# x')
})

test('TeX 公式转成可读 Unicode：行内、块级、\\( \\) 与 \\[ \\]，价格里的 $ 不当公式', () => {
  const { html } = renderMarkdownDocument([
    '质能方程 $E = mc^2$，价格 $5 和 $10 不变。',
    '',
    '$$',
    '\\frac{a+b}{2} \\leq \\sqrt{ab}',
    '$$',
    '',
    '行内 \\(\\alpha_1 + \\beta\\) 与块 \\[x \\to \\infty\\]'
  ].join('\n'))
  assert.match(html, /<span class="md-formula">E = mc²<\/span>/)
  assert.match(html, /价格 \$5 和 \$10 不变/)
  assert.match(html, /<div class="md-formula-block"><pre class="md-formula">\(a\+b\) \/ 2 ≤ √ab<\/pre><\/div>/)
  assert.match(html, /<span class="md-formula">α₁ \+ β<\/span>/)
  assert.match(html, /<span class="md-formula md-formula-display">x → ∞<\/span>/)
  assert.equal(formatFormulaText('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'), 'lim(x → 0) (sin x) / x = 1')
  assert.equal(formatFormulaText('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'), '(a  b)\n(c  d)')
  // 公式里的 * 和 _ 不被当成强调语法
  assert.match(renderMarkdownDocument('$a * b_1 * c$').html, /<span class="md-formula">a ∗ b₁ ∗ c<\/span>|<span class="md-formula">a \* b₁ \* c<\/span>/)
})

test('脚注按首次引用顺序编号并在末尾列出，未定义的脚注保持原文', () => {
  const { html } = renderMarkdownDocument([
    '第一段[^b]，再引一次[^b]，另一个[^a]，未定义[^zzz]。',
    '',
    '[^a]: 甲的解释',
    '[^b]: 乙的解释',
    '    续行'
  ].join('\n'))
  const d = parseHtmlDocument(html).document
  assert.equal(d.querySelector('p').textContent, '第一段[1]，再引一次[1]，另一个[2]，未定义[^zzz]。')
  assert.deepEqual(d.querySelectorAll('.md-footnote-ref a').map(a => a.getAttribute('href')), ['#md-fn-1', '#md-fn-1', '#md-fn-2'])
  assert.deepEqual(d.querySelectorAll('.md-footnote p').map(p => p.textContent), ['[1] 乙的解释\n续行', '[2] 甲的解释'])
  assert.deepEqual(d.querySelectorAll('.md-footnote-backref').map(a => a.getAttribute('href')), ['#md-fn-ref-1-1', '#md-fn-ref-1-2', '#md-fn-ref-2-1'])
  for (const a of d.querySelectorAll('a')) assert.ok(d.getElementById(a.getAttribute('href').slice(1)))
  assert.doesNotMatch(html, /\[\^a\]:/)
})

test('定义列表、高亮、上下标、任务列表和 details 都进入 HTML', () => {
  const { html } = renderMarkdownDocument([
    '术语',
    ': 解释一',
    ': 解释二',
    '',
    '==重点== 与 H~2~O 和 x^2^，~~删除~~',
    '',
    '- [x] 已完成',
    '- [ ] 待办',
    '',
    '<details><summary>展开</summary>内容</details>'
  ].join('\n'))
  assert.match(html, /<dl class="md-deflist"><dt>术语<\/dt><dd>解释一<\/dd><dd>解释二<\/dd><\/dl>/)
  assert.match(html, /<mark>重点<\/mark> 与 H<sub>2<\/sub>O 和 x<sup>2<\/sup>，<del>删除<\/del>/)
  assert.match(html, /<input checked="" disabled="" type="checkbox"> 已完成/)
  assert.match(html, /<details><summary>展开<\/summary>内容<\/details>/)
})

test('diff 代码块逐行标记增删；mermaid 代码块画成 SVG 图片，不支持的图给占位', () => {
  const { html } = renderMarkdownDocument([
    '```diff',
    '+ 新增',
    '- 删除',
    '  不变',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[开始] --> B{判断}',
    '  B -->|是| C((结束))',
    '```',
    '',
    '```mermaid',
    'pie title 占比',
    '  "A" : 40',
    '```',
    '',
    '```js',
    'const x = 1 < 2',
    '```'
  ].join('\n'))
  const d = parseHtmlDocument(html).document
  assert.equal(d.querySelector('.language-diff').textContent, '+ 新增\n- 删除\n  不变\n')
  assert.equal(d.querySelector('.md-diff-add').textContent, '+ 新增')
  assert.equal(d.querySelector('.md-diff-del').textContent, '- 删除')
  assert.equal(d.querySelector('.md-diff-text').textContent, '  不变')
  assert.match(html, /<figure class="md-mermaid"><img class="md-mermaid-image" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="流程图"><\/figure>/)
  assert.match(html, /<div class="md-diagram-placeholder"><span class="md-diagram-label">饼图<\/span><pre class="md-diagram-source">pie title 占比/)
  assert.equal(d.querySelector('.language-js').textContent, 'const x = 1 < 2\n')
})

test('mermaid-lite 四种图型输出 SVG，其余返回 null，配色可覆盖', () => {
  const flow = renderMermaid('graph TD\n  A --> B\n  B --> C\n  A --> C')
  assert.match(flow, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.ok((flow.match(/<rect/g) || []).length >= 3)
  const sequence = renderMermaid('sequenceDiagram\n  participant A as 用户\n  A->>B: 请求\n  B-->>A: 响应\n  Note over A,B: 说明')
  assert.match(sequence, /用户/)
  assert.match(sequence, /stroke-dasharray="6 4"/)
  const state = renderMermaid('stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: start\n  Busy --> [*]')
  assert.match(state, /r="9"/)
  const gantt = renderMermaid('gantt\n  title 计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  设计 :a1, 2026-09-01, 3d\n  开发 :after a1, 5d\n  发布 :milestone, 2026-09-10, 0d')
  assert.match(gantt, /计划/)
  assert.match(gantt, /<polygon/)
  assert.equal(renderMermaid('classDiagram\n  A <|-- B'), null)
  assert.equal(renderMermaid(''), null)
  assert.equal(detectDiagramType('sequenceDiagram\n A->>B: x'), '时序图')
  assert.match(renderMermaid('graph LR\n A --> B', { colors: { nodeFill: '#123456' } }), /fill="#123456"/)
})

test('两次渲染互不影响：脚注编号从头开始', () => {
  renderMarkdownDocument('x[^a]\n\n[^a]: 1')
  const { html } = renderMarkdownDocument('y[^b]\n\n[^b]: 2')
  assert.match(html, /#md-fn-1/)
  assert.doesNotMatch(html, /md-fn-2/)
})
