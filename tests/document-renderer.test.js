'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  parseCssRules,
  renderHtmlDomTree,
  resolveVariables,
  selectorSpecificity,
  splitStyleDeclarations,
  validRenderSelector
} = require('../miniprogram/file-reader/document/document-renderer')

function findNode (nodes, predicate) {
  for (const node of nodes || []) {
    if (predicate(node)) return node
    const child = findNode(node.children, predicate)
    if (child) return child
  }
  return null
}

test('CSS 声明统一过滤危险值并换算绝对单位与 rem', () => {
  const declarations = splitStyleDeclarations(`
    width: 210mm; padding: 12pt; margin: 1rem;
    background: url("https://example.com/x.png");
    behavior: url(x); color: expression(bad); font-family: "10pt song"
  `, 20)
  const map = Object.fromEntries(declarations.map(item => [item.property, item.value]))

  assert.equal(map.width, '793.7px')
  assert.equal(map.padding, '16px')
  assert.equal(map.margin, '20px')
  assert.equal(map.background, 'none')
  assert.equal(map.behavior, undefined)
  assert.equal(map.color, undefined)
  assert.equal(map['font-family'], '"10pt song"')
})

test('渲染器按设备主题应用 prefers-color-scheme，避免深色底出现深色文字', () => {
  const html = `<style>
    body { background:#111; color:#111 }
    @media (prefers-color-scheme: light) { body { background:#fff; color:#222 } .card { background:#f7f5f1 } }
    @media (prefers-color-scheme: dark) { body { background:#050505; color:#eee } }
  </style><main class="card">浅色正文</main>`
  const light = renderHtmlDomTree(html, { viewportWidth: 375, colorScheme: 'light' })
  const dark = renderHtmlDomTree(html, { viewportWidth: 375, colorScheme: 'dark' })
  const lightCard = findNode(light.nodes, node => node.attrs && node.attrs.class === 'card')

  assert.match(light.wrapperStyle, /background:#fff/)
  assert.match(light.wrapperStyle, /color:#222/)
  assert.match(lightCard.attrs.style, /background:#f7f5f1/)
  assert.match(dark.wrapperStyle, /background:#050505/)
  assert.match(dark.wrapperStyle, /color:#eee/)
})

test('阅读层清理 AI 导出 HTML 的 filecite 私有标记但保留正文', () => {
  const result = renderHtmlDomTree('<p>正文。\uE200filecite\uE202turn0file0\uE202L80-L103\uE201 下一句。</p>')
  const paragraph = findNode(result.nodes, node => node.name === 'p')

  assert.equal(paragraph.children.map(node => node.text || '').join(''), '正文。 下一句。')
  assert.doesNotMatch(JSON.stringify(result.nodes), /filecite|\uE200|\uE201|\uE202/)
})

test('普通 HTML 源码换行按浏览器语义折叠，不生成块间空白行', () => {
  const result = renderHtmlDomTree(`<body>
    <main>
      <p>第一段</p>
      <p>第二段 <span>A</span> <span>B</span></p>
      <pre>保留\n  原始空白</pre>
    </main>
  </body>`)
  const main = findNode(result.nodes, node => node.name === 'main')
  const paragraph = main.children.find(node => node.name === 'p' && /第二段/.test(JSON.stringify(node)))
  const pre = findNode(result.nodes, node => node.name === 'pre')

  assert.deepEqual(main.children.map(node => node.name || node.type), ['p', 'p', 'pre'])
  assert.equal(paragraph.children.filter(node => node.type === 'text').map(node => node.text).join(''), '第二段  ')
  assert.equal(paragraph.children[2].type, 'text')
  assert.equal(paragraph.children[2].text, ' ')
  assert.equal(pre.children[0].text, '保留\n  原始空白')
})

test('微信原生输入框和 picker 获得完整文字行高且不重复垂直 padding', () => {
  const result = renderHtmlDomTree(`<style>
    input,select{font-size:16px;line-height:1.5;padding:10px 12px;border:1px solid #ccc;width:100%}
  </style><body><input id="text" placeholder="不会裁切"><select id="select"><option>选项</option></select><input id="date" type="date"></body>`)
  const input = findNode(result.nodes, node => node.attrs && node.attrs.id === 'text')
  const select = findNode(result.nodes, node => node.attrs && node.attrs.id === 'select')
  const date = findNode(result.nodes, node => node.attrs && node.attrs.id === 'date')

  ;[input, select, date].forEach(node => {
    assert.match(node.attrs.style, /height:46px/)
    assert.match(node.attrs.style, /line-height:44px/)
    assert.match(node.attrs.style, /padding-top:0/)
    assert.match(node.attrs.style, /padding-bottom:0/)
  })
})

test('深色背景上的低对比度小字自动提升到可读颜色，合格颜色保持原样', () => {
  const result = renderHtmlDomTree(`<style>
    body{background:#1c1815;color:#f3e7cf}.muted{color:#6b5f4d;font-size:12px}.good{color:#e9ddc4}
    .panel{background:#16120f;color:#28211c}
  </style><body><small class="muted">低对比说明</small><p class="good">正常正文</p><section class="panel">继承后仍需可读</section></body>`)
  const muted = findNode(result.nodes, node => node.attrs && node.attrs.class === 'muted')
  const good = findNode(result.nodes, node => node.attrs && node.attrs.class === 'good')
  const panel = findNode(result.nodes, node => node.attrs && node.attrs.class === 'panel')

  assert.doesNotMatch(muted.attrs.style, /color:#6b5f4d/)
  assert.match(good.attrs.style, /color:#e9ddc4/)
  assert.doesNotMatch(panel.attrs.style, /color:#28211c/)
})

test('渲染器计算固定纸张宽度并输出 fit-scale 所需 contentWidth', () => {
  const result = renderHtmlDomTree('<style>.paper{width:210mm;min-height:297mm}</style><body><article class="paper">A4</article></body>', { viewportWidth: 390 })
  const paper = findNode(result.nodes, node => node.attrs && node.attrs.class === 'paper')

  assert.match(paper.attrs.style, /width:793\.7px/)
  assert.match(paper.attrs.style, /min-height:1122\.52px/)
  assert.equal(result.contentWidth, 793.7)

  const percentage = renderHtmlDomTree('<style>.fluid{width:1000%;min-width:20px}</style><body><div class="fluid"></div></body>', { viewportWidth: 390 })
  assert.equal(percentage.contentWidth, 390)
})

test('作者通配规则压过 UA，specificity、顺序和 important 正确裁决', () => {
  const result = renderHtmlDomTree(`
    <style>*{color:green}p{color:blue}.note{color:purple}#x{color:red}p{color:black!important}</style>
    <body><p id="x" class="note">层叠</p></body>
  `)
  const paragraph = findNode(result.nodes, node => node.name === 'p')

  assert.match(paragraph.attrs.style, /color:black/)
  assert.equal(selectorSpecificity('#x'), 10000)
  assert.equal(selectorSpecificity('.note'), 100)
  assert.equal(selectorSpecificity('p'), 1)
})

test('属性、nth、not、后代和子选择器在内联端生效', () => {
  const result = renderHtmlDomTree(`
    <style>
      .cards > article[data-kind^="news"]:nth-child(2n+1):not(.skip) b { color:#123456 }
      article[data-kind$="cn"] { padding:9px }
    </style>
    <body><section class="cards"><article data-kind="news-cn"><b id="hit">命中</b></article><article data-kind="news-us"><b>不命中</b></article></section></body>
  `)
  const hit = findNode(result.nodes, node => node.attrs && node.attrs.id === 'hit')
  const article = findNode(result.nodes, node => node.name === 'article')

  assert.match(hit.attrs.style, /color:#123456/)
  assert.match(article.attrs.style, /padding:9px/)
})

test('未知交互伪类会丢弃，兄弟组合器按浏览器语义匹配', () => {
  assert.equal(validRenderSelector('.delete:hover'), false)
  assert.equal(validRenderSelector('.a + .b'), true)
  assert.equal(validRenderSelector('.a ~ .b'), true)
  assert.equal(parseCssRules('.delete:hover{display:block}.a + .b{color:red}').length, 1)
})

test('Tailwind 转义类会命中且不会误判为伪类', () => {
  const result = renderHtmlDomTree('<style>.bg-night\\/95{background-color:#14171cf2}.sm\\:w-56{width:14rem}.hover\\:text-red:hover{color:red}</style><header class="bg-night/95 sm:w-56 hover:text-red">标题</header>')
  const header = findNode(result.nodes, node => node.name === 'header')

  assert.match(header.attrs.style, /background-color:#14171cf2/)
  assert.match(header.attrs.style, /width:224px/)
  assert.doesNotMatch(header.attrs.style, /color:red/)
})

test('伪元素规则按层叠合并，content none 可取消', () => {
  const shown = renderHtmlDomTree('<style>.x::before{content:"前";color:red}.x::before{font-weight:bold}</style><body><p class="x">正文</p></body>')
  const paragraph = findNode(shown.nodes, node => node.name === 'p')
  assert.equal(paragraph.children[0].attrs.class, 'hr-pseudo-before')
  assert.equal(paragraph.children[0].children[0].text, '前')
  assert.match(paragraph.children[0].attrs.style, /color:red/)
  assert.match(paragraph.children[0].attrs.style, /font-weight:bold/)

  const hidden = renderHtmlDomTree('<style>.x::after{content:"后"}.x::after{content:none}</style><body><p class="x">正文</p></body>')
  const hiddenParagraph = findNode(hidden.nodes, node => node.name === 'p')
  assert.equal(hiddenParagraph.children.some(node => node.attrs && node.attrs.class === 'hr-pseudo-after'), false)
})

test('全局和元素级 CSS 变量在元素作用域解析，未解变量整条丢弃', () => {
  const result = renderHtmlDomTree(`
    <style>:root{--accent:#999}:root.theme{--accent:#ff7043}.card{--space:12px;color:var(--accent);padding:var(--space);border-color:var(--missing)}</style>
    <html class="theme"><body><div class="card">变量</div></body></html>
  `)
  const card = findNode(result.nodes, node => node.attrs && node.attrs.class === 'card')

  assert.match(card.attrs.style, /color:#ff7043/)
  assert.match(card.attrs.style, /padding:12px/)
  assert.equal(/border-color/.test(card.attrs.style), false)
  assert.equal(resolveVariables('var(--a, 8px)', {}), '8px')
})

test('CSS 变量遵守 specificity 和 important，行内 rem 使用根字号', () => {
  const result = renderHtmlDomTree(`<style>
    html { font-size:20px }
    #box { --tone:green }
    .box { --tone:red !important }
    .box span { color:var(--tone) }
  </style><body><div id="box" class="box"><span id="text" style="margin-left:2rem">x</span></div></body>`, { viewportWidth: 390 })
  const text = findNode(result.nodes, node => node.attrs && node.attrs.id === 'text')

  assert.match(text.attrs.style, /color:red/)
  assert.match(text.attrs.style, /margin-left:40px/)

  const importantVariable = renderHtmlDomTree('<style>#box{--tone:red!important}</style><body><p id="box" style="--tone:blue;color:var(--tone)">x</p></body>')
  assert.match(findNode(importantVariable.nodes, node => node.attrs && node.attrs.id === 'box').attrs.style, /color:red/)
})

test('@media 使用实际传入视口而非固定默认宽度', () => {
  const html = '<style>@media(max-width:380px){#x{color:red}}</style><body><p id="x">x</p></body>'
  const narrow = renderHtmlDomTree(html, { viewportWidth: 375 })
  const wide = renderHtmlDomTree(html, { viewportWidth: 390 })

  assert.match(findNode(narrow.nodes, node => node.attrs && node.attrs.id === 'x').attrs.style, /color:red/)
  assert.doesNotMatch(findNode(wide.nodes, node => node.attrs && node.attrs.id === 'x').attrs.style, /color:red/)
})

test('content 空字符串仍保留伪元素节点', () => {
  const result = renderHtmlDomTree('<style>.x::before{content:"";display:inline}</style><body><p class="x">正文</p></body>')
  const paragraph = findNode(result.nodes, node => node.name === 'p')

  assert.equal(paragraph.children[0].attrs.class, 'hr-pseudo-before')
  assert.equal(paragraph.children[0].children[0].text, '')
})

test('body dataset 与 html class 参与真实祖先链匹配并生成 wrapperStyle', () => {
  const result = renderHtmlDomTree(`
    <style>html.ready body[data-theme="night"]{background:#111;color:#eee}body[data-theme="night"] .sheet{border-color:white}</style>
    <html class="ready"><body data-theme="night"><main class="sheet">主题</main></body></html>
  `)
  const sheet = findNode(result.nodes, node => node.attrs && node.attrs.class === 'sheet')

  assert.match(result.wrapperStyle, /background:#111/)
  assert.match(result.wrapperStyle, /color:#eee/)
  assert.match(sheet.attrs.style, /border-color:white/)
})

test('SVG 会净化为本地 data URI 并保留大小写敏感属性', () => {
  const result = renderHtmlDomTree(`
    <body><svg viewBox="0 0 10 10" onclick="bad()"><linearGradient gradientUnits="userSpaceOnUse"></linearGradient><script>bad()</script><image href="https://example.com/a.png"></image></svg></body>
  `)
  const image = findNode(result.nodes, node => node.name === 'img')
  const decoded = decodeURIComponent(image.attrs.src.replace(/^data:image\/svg\+xml,/, ''))

  assert.match(decoded, /viewBox="0 0 10 10"/)
  assert.match(decoded, /<linearGradient\b/)
  assert.match(decoded, /gradientUnits="userSpaceOnUse"/)
  assert.equal(/onclick|<script|example\.com/.test(decoded), false)
  assert.match(image.svgFallbackSrc, /^data:image\/svg\+xml,/)
})

test('React SVG 属性会转换为标准连字符属性并保留外层尺寸', () => {
  const result = renderHtmlDomTree('<body><svg viewBox="0 0 20 10" style="display:block;width:100%;height:120px"><text fontSize="12" fontFamily="sans" fontWeight="700" textAnchor="middle" strokeWidth="2">兔</text></svg></body>')
  const image = findNode(result.nodes, node => node.name === 'img')
  const decoded = decodeURIComponent(image.attrs.src.replace(/^data:image\/svg\+xml,/, ''))

  assert.match(decoded, /font-size="12"/)
  assert.match(decoded, /font-family="sans"/)
  assert.match(decoded, /font-weight="700"/)
  assert.match(decoded, /text-anchor="middle"/)
  assert.match(decoded, /stroke-width="2"/)
  assert.match(image.attrs.style, /width:100%/)
  assert.match(image.attrs.style, /height:120px/)
})

test('img 内嵌百分号 SVG 会净化后保留，不再显示空白海报', () => {
  const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" onclick="bad()"><script>bad()</script><text x="2" y="8">海报</text><image href="https://example.com/x.png"/></svg>')
  const result = renderHtmlDomTree(`<body><img id="poster" src="data:image/svg+xml,${svg}"></body>`)
  const image = findNode(result.nodes, node => node.attrs && node.attrs.id === 'poster')
  const decoded = decodeURIComponent(image.attrs.src.replace(/^data:image\/svg\+xml,/, ''))

  assert.match(image.attrs.src, /^data:image\/svg\+xml,/)
  assert.match(decoded, />海报</)
  assert.doesNotMatch(decoded, /onclick|<script|example\.com/)
})

test('img 内嵌 base64 SVG 同样会净化后显示', () => {
  const encoded = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text y="12">Base64 海报</text></svg>').toString('base64')
  const result = renderHtmlDomTree(`<img id="base64-poster" src="data:image/svg+xml;base64,${encoded}">`)
  const image = findNode(result.nodes, node => node.attrs && node.attrs.id === 'base64-poster')
  const decoded = decodeURIComponent(image.attrs.src.replace(/^data:image\/svg\+xml,/, ''))

  assert.match(decoded, /Base64 海报/)
})

test('表格在 WXML 中转换为可横向阅读的网格并保留跨行跨列', () => {
  const result = renderHtmlDomTree('<body><table><caption>数据</caption><thead><tr><th rowspan="2">姓名</th><th colspan="2">成绩</th></tr><tr><th>语文</th><th>数学</th></tr></thead><tbody><tr><td>兔子</td><td>90</td><td>95</td></tr></tbody></table></body>')
  const table = findNode(result.nodes, node => node.name === 'table')
  const name = table.children.find(node => node.name === 'th' && node.attrs.rowspan === '2')
  const score = table.children.find(node => node.name === 'th' && node.attrs.colspan === '2')

  assert.match(table.attrs.style, /display:grid/)
  assert.match(table.attrs.style, /repeat\(3,minmax\(88px,1fr\)\)/)
  assert.match(table.attrs.style, /min-width:264px/)
  assert.match(name.attrs.style, /grid-row:2 \/ span 2/)
  assert.match(score.attrs.style, /grid-column:2 \/ span 2/)
  assert.match(name.attrs.style, /overflow-wrap:normal/)
})

test('阅读器默认无四周边距，details 使用明确展开标记', () => {
  const closed = renderHtmlDomTree('<body><details><summary>更多</summary><p>内容</p></details></body>')
  const opened = renderHtmlDomTree('<body><details open><summary>更多</summary><p>内容</p></details></body>')
  const closedSummary = findNode(closed.nodes, node => node.name === 'summary')
  const openSummary = findNode(opened.nodes, node => node.name === 'summary')

  assert.match(closed.wrapperStyle, /margin:0/)
  assert.equal(closedSummary.children[0].text, '▸ ')
  assert.equal(openSummary.children[0].text, '▾ ')
  assert.match(closedSummary.attrs.style, /display:block/)
})

test('常见 AI 模板计数对象串会修复为可读数量', () => {
  const result = renderHtmlDomTree('<p id="count">[object Object], [object Object], [object Object] 条</p>')
  const paragraph = findNode(result.nodes, node => node.attrs && node.attrs.id === 'count')
  assert.equal(paragraph.children.map(node => node.text || '').join(''), '3 条')
})

test('SVG 作者样式会内联，共享 defs 注入前会净化并恢复标签大小写', () => {
  const result = renderHtmlDomTree(`<style>.dot{fill:#f00}</style><body>
    <svg id="library"><defs><linearGradient id="paint" gradientUnits="userSpaceOnUse" onclick="bad()"><stop offset="0" stop-color="red"/><script>bad()</script><foreignObject><p>bad</p></foreignObject></linearGradient></defs></svg>
    <svg id="art" viewBox="0 0 10 10"><circle class="dot" r="4" fill="url(#paint)"/></svg>
  </body>`)
  const images = result.nodes.filter(node => node.name === 'img')
  const decoded = decodeURIComponent(images[1].attrs.src.replace(/^data:image\/svg\+xml,/, ''))

  assert.match(decoded, /<defs><linearGradient\b/)
  assert.match(decoded, /gradientUnits="userSpaceOnUse"/)
  assert.match(decoded, /<circle[^>]*style="[^"]*fill:#f00/)
  assert.match(decoded, /fill="url\(#paint\)"/)
  assert.doesNotMatch(decoded, /onclick|<script|foreignObject|<p>bad/)
})

test('SVG SMIL 同时输出动态版、静态回退版和探针标记', () => {
  const result = renderHtmlDomTree('<body><svg viewBox="0 0 10 10"><circle r="2"><animate attributeName="r" to="4"/></circle></svg></body>')
  const image = findNode(result.nodes, node => node.name === 'img')
  const animated = decodeURIComponent(image.attrs.src.replace(/^data:image\/svg\+xml,/, ''))
  const fallback = decodeURIComponent(image.svgFallbackSrc.replace(/^data:image\/svg\+xml,/, ''))

  assert.equal(image.svgHasSmil, true)
  assert.match(animated, /<animate\b/)
  assert.doesNotMatch(fallback, /<animate\b/)
})

test('网络媒体降级为可读占位，外链资源不会进入节点树', () => {
  const result = renderHtmlDomTree('<body><video src="https://example.com/a.mp4"></video><img src="https://example.com/a.png"><a href="https://example.com/read">链接</a></body>')
  const serialized = JSON.stringify(result.nodes)

  assert.equal(serialized.includes('a.mp4'), false)
  assert.equal(serialized.includes('a.png'), false)
  assert.match(serialized, /视频内容（阅读器不连接网络播放）/)
  assert.match(serialized, /https:\/\/example\.com\/read/)
})

test('表单和进度元素映射为小程序原生节点所需数据', () => {
  const result = renderHtmlDomTree(`<body>
    <input id="c" type="checkbox" checked value="yes"><input id="r" type="range" value="35" min="10" max="80">
    <textarea id="t">备注</textarea><select id="s"><option>A</option><option value="b" selected>B</option></select>
    <progress id="p" value="3" max="4"></progress>
  </body>`)

  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 'c').name, 'checkbox')
  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 'c').attrs.checked, true)
  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 'r').name, 'slider')
  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 't').attrs.value, '备注')
  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 's').displayText, 'B')
  assert.equal(findNode(result.nodes, node => node.attrs && node.attrs.id === 'p').percent, 75)

  const dates = renderHtmlDomTree('<body><input id="d" type="date"><input id="time" type="time"><input id="password" type="password"></body>')
  assert.equal(findNode(dates.nodes, node => node.attrs && node.attrs.id === 'd').name, 'picker-date')
  assert.equal(findNode(dates.nodes, node => node.attrs && node.attrs.id === 'time').name, 'picker-time')
  assert.equal(findNode(dates.nodes, node => node.attrs && node.attrs.id === 'password').inputType, 'text')
})

test('Canvas 节点携带轻量绘制指令和修订号', () => {
  const runtimeDocument = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim').parseHtmlDocument('<body><canvas id="chart" width="200" height="100"></canvas></body>').document
  const canvas = runtimeDocument.getElementById('chart')
  const context = canvas.getContext('2d')
  context.fillStyle = 'red'
  context.fillRect(0, 0, 40, 20)
  const result = renderHtmlDomTree({ document: runtimeDocument, styles: [] })
  const node = findNode(result.nodes, item => item.name === 'canvas')

  assert.equal(node.canvas.width, 200)
  assert.equal(node.canvas.height, 100)
  assert.equal(node.canvas.rev, 2)
  assert.deepEqual(node.canvas.ops.map(operation => operation.name), ['set:fillStyle', 'fillRect'])
  assert.match(node.canvasSizerStyle, /padding-top:50%/)
  assert.doesNotMatch(node.canvasBoxStyle, /padding-top/)
})

test('flex/grid 容器忽略纯空白文本，避免 WXML 把空白当布局项', () => {
  const grid = renderHtmlDomTree('<style>.grid{display:grid;grid-template-columns:repeat(2,1fr)}</style><div class="grid">\n  <button>A</button>\n  <button>B</button>\n</div>', { viewportWidth: 390 })
  const gridNode = grid.nodes.find(node => node.attrs && node.attrs.class === 'grid')
  assert.equal(gridNode.children.length, 2)
  assert.deepEqual(gridNode.children.map(node => node.name), ['button', 'button'])

  const normal = renderHtmlDomTree('<p>A <strong>B</strong> C</p>', { viewportWidth: 390 })
  const paragraph = normal.nodes.find(node => node.name === 'p')
  assert.equal(paragraph.children.filter(node => node.type === 'text').map(node => node.text).join(''), 'A  C')
})
