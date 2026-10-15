'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { analyzeHtml, transformHtml, _internals } = require('../miniprogram/file-reader/document/html-compat')
const sample = require('../miniprogram/data/sample-html')

test('样本中的每一种标签都有明确处理状态', () => {
  const report = analyzeHtml(sample)
  assert.ok(report.uniqueTagCount >= 60)
  assert.equal(report.tags.some(tag => !tag.status), false)
  assert.equal(report.elementCount > 250, true)
  assert.equal(report.scriptCount, 1)
  assert.equal(report.title, 'HTML / CSS / JS 本地综合测试页')
})

test('完整样本可转换且浏览器脚本被安全移除', () => {
  const result = transformHtml(sample)
  assert.ok(result.html.length > 10000)
  assert.equal(/<script\b/i.test(result.html), false)
  assert.equal(/addEventListener|localStorage|document\.getElementById/.test(result.html), false)
  assert.equal(result.html.includes('网页脚本已安全移除'), false)
  assert.match(result.notes.join('\n'), /已移除网页 JavaScript/)
  assert.match(result.html, /Canvas/)
  assert.match(result.html, /进度 68 \/ 100/)
  assert.match(result.html, /测量值 72 \/ 100/)
})

test('危险链接、事件属性和 CSS 表达式不会进入渲染结果', () => {
  const input = '<div onclick="steal()" style="color:red;behavior:url(x);width:expression(x)"><a href=javascript:alert(1)>x</a><img src="data:text/html,bad" onerror="bad()"></div>'
  const result = transformHtml(input).html
  assert.equal(/onclick|onerror|javascript:|data:text\/html|expression\s*\(|behavior\s*:/.test(result), false)
  assert.match(result, /color:red/)
})

test('表单和不受支持元素会生成可读替代内容', () => {
  const input = '<form><input type="checkbox" checked value="HTML"><select><option selected>A</option><option>B</option></select><textarea>备注</textarea><button>提交</button><dialog>你好</dialog></form>'
  const result = transformHtml(input).html
  assert.match(result, /☑ HTML/)
  assert.match(result, /选择框：A/)
  assert.match(result, /多行输入：备注/)
  assert.match(result, /提交/)
  assert.match(result, /对话框内容/)
  assert.equal(/<(form|input|select|textarea|button|dialog)\b/i.test(result), false)
})

test('畸形和未知 HTML 也不会让解析器崩溃', () => {
  const input = '<main><x-ai-card data-x="1"><p>AI 内容<div>未闭合 &amp; 可读<script>bad()'
  const result = transformHtml(input)
  assert.match(result.html, /AI 内容/)
  assert.equal(/<script\b/i.test(result.html), false)
  assert.equal(result.analysis.tags.find(tag => tag.name === 'x-ai-card').status, 'fallback')
})

test('转换结果能够被 mp-html 微信解析器完整接收', () => {
  global.wx = {
    canIUse: () => true,
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'iOS' })
  }
  const Parser = require('../node_modules/mp-html/dist/mp-weixin/parser')
  const transformed = transformHtml(sample).html
  const images = []
  const nodes = new Parser({
    data: {
      tagStyle: {},
      containerStyle: '',
      useAnchor: true,
      setTitle: false,
      previewImg: true,
      scrollTable: true,
      selectable: true
    },
    imgList: images,
    plugins: []
  }).parse(transformed)
  assert.ok(nodes.length > 0)
  assert.ok(JSON.stringify(nodes).length > 10000)
})

test('内嵌 CSS 会保留、清理危险内容并交给样式插件匹配', () => {
  global.wx = {
    canIUse: () => true,
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'iOS' })
  }
  const Parser = require('../node_modules/mp-html/dist/mp-weixin/parser')
  const Style = require('../miniprogram/file-reader/document/components/mp-html/style-plugin')
  const input = '<style>:root{--accent:#ff7043}.card{color:var(--accent);behavior:url(x)}.card::before{content:"Hi"}</style><main><button class="card">打开</button></main>'
  const transformed = transformHtml(input).html
  const nodes = new Parser({
    data: {
      tagStyle: {},
      containerStyle: '',
      useAnchor: true,
      setTitle: false,
      previewImg: true,
      scrollTable: true,
      selectable: true
    },
    imgList: [],
    plugins: [new Style()]
  }).parse(transformed)
  const rendered = JSON.stringify(nodes)
  assert.match(transformed, /<style>/)
  assert.equal(/var\(--|behavior\s*:/.test(transformed), false)
  assert.match(rendered, /color:#ff7043/)
  assert.match(rendered, /Hi/)
  assert.match(rendered, /打开/)
})

test('手机阅读会展开匹配的响应式样式并忽略打印和关键帧规则', () => {
  const input = `
    <style>
      .hero-grid { display:grid; grid-template-columns:1.4fr .6fr }
      @keyframes bounce { from { transform:translateX(0) } to { transform:translateX(10px) } }
      @media (max-width: 860px) { .hero-grid { grid-template-columns:1fr } }
      @media (min-width: 900px) { .hero-grid { gap:40px } }
      @media print { .hero-grid { display:none } }
    </style>
    <div class="hero-grid">手机布局</div>
  `
  const result = transformHtml(input)

  assert.equal(/@media|@keyframes|display:none|gap:40px/.test(result.html), false)
  assert.match(result.html, /\.hero-grid\s*\{\s*grid-template-columns:1fr\s*\}/)
})

test('按钮降级后仍能匹配原网页的 button 选择器', () => {
  global.wx = {
    canIUse: () => true,
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'iOS' })
  }
  const Parser = require('../node_modules/mp-html/dist/mp-weixin/parser')
  const Style = require('../miniprogram/file-reader/document/components/mp-html/style-plugin')
  const transformed = transformHtml('<style>button{color:white;background:#334155}button.secondary{padding:9px 14px}</style><button class="secondary">切换</button>').html
  const nodes = new Parser({
    data: { tagStyle: {}, containerStyle: '', useAnchor: true, setTitle: false, previewImg: true, scrollTable: true, selectable: true },
    imgList: [],
    plugins: [new Style()]
  }).parse(transformed)
  const rendered = JSON.stringify(nodes)

  assert.match(transformed, /hr-origin-button secondary/)
  assert.match(rendered, /color:white/)
  assert.match(rendered, /background:#334155/)
  assert.match(rendered, /padding:9px 14px/)
})

test('综合测试页在手机解析器中保留白色 Hero、单列布局和全部章节', () => {
  global.wx = {
    canIUse: () => true,
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'iOS' })
  }
  const Parser = require('../node_modules/mp-html/dist/mp-weixin/parser')
  const Style = require('../miniprogram/file-reader/document/components/mp-html/style-plugin')
  const transformed = transformHtml(sample).html
  const nodes = new Parser({
    data: {
      tagStyle: {
        body: 'box-sizing:border-box;width:100%;max-width:100%;margin:0;overflow:hidden',
        h1: 'font-size:30px;line-height:1.25;margin:24px 0 14px'
      },
      containerStyle: '', useAnchor: true, setTitle: false, previewImg: true, scrollTable: true, selectable: true
    },
    imgList: [],
    plugins: [new Style()]
  }).parse(transformed)
  const flat = []
  const visit = list => {
    for (const node of list || []) {
      flat.push(node)
      visit(node.children)
    }
  }
  visit(nodes)
  const byClass = name => flat.find(node => String(node.attrs && node.attrs.class || '').split(' ').includes(name))
  const hero = byClass('hero')
  const heroGrid = byClass('hero-grid')
  const secondary = byClass('secondary')
  const heading = flat.find(node => node.name === 'h1')
  const text = JSON.stringify(nodes)

  assert.match(hero.attrs.style, /color:white/)
  assert.match(heroGrid.attrs.style, /grid-template-columns:1fr/)
  assert.match(secondary.attrs.style, /background:#334155/)
  assert.equal(/color:#101828/.test(heading.attrs.style), false)
  for (let section = 1; section <= 11; section++) assert.match(text, new RegExp(`${section}\\.`))
})

test('840px 固定画布会按手机宽度等比缩放而不是横向裁切', () => {
  const input = `
    <style>
      body { padding: 50px; gap: 50px }
      .section-title { margin-bottom: -30px; font-size: 14px }
      .card { width: 840px; height: 180px; border-radius: 20px }
      .card h3 { font-size: 38px }
    </style>
    <p class="section-title" style="font-size:14px">画布说明</p>
    <div class="card"><h3 style="font-size:46px">固定画布</h3></div>
  `
  const result = transformHtml(input)

  assert.match(result.html, /width:100%;max-width:340px/)
  assert.match(result.html, /height:\s*72\.86px/)
  assert.match(result.html, /font-size:\s*15\.38px/)
  assert.match(result.html, /font-size:18\.62px/)
  assert.match(result.html, /\.section-title\s*\{[^}]*margin-bottom:\s*-12\.14px;\s*font-size:\s*14px/)
  assert.match(result.html, /class="section-title" style="font-size:14px"/)
  assert.match(result.html, /padding-left:0!important/)
  assert.match(result.html, /body\{box-sizing:border-box;width:100%;max-width:100%/)
  assert.match(result.notes.join('\n'), /840px 固定宽度画布/)
})

test('原网页 body 背景会保留并铺满阅读区域', () => {
  const input = `
    <style>
      body { background-color: #e8e5df; padding: 50px; margin: 0 }
      .card { width: 840px; height: 180px; background-color: #F8ECE1 }
    </style>
    <div class="card">卡片</div>
  `
  const result = transformHtml(input)

  assert.match(result.html, /body\s*\{[^}]*background-color:\s*#e8e5df/i)
  assert.match(result.html, /body\{box-sizing:border-box;width:100%;max-width:100%/)
  assert.match(result.html, /\.card\s*\{[^}]*background-color:\s*#F8ECE1/i)
})

test('脚本被隔离但不会往原页面插入额外警告块', () => {
  const result = transformHtml('<main><h1>原页面</h1></main><script>alert(1)</script>')

  assert.match(result.html, /原页面/)
  assert.equal(result.html.includes('网页脚本已安全移除'), false)
  assert.match(result.notes.join('\n'), /已移除网页 JavaScript/)
})

test('CSS 绝对单位和 rem 会转为微信渲染稳定的 px，字符串内容保持不变', () => {
  const css = _internals.prepareCss(`
    html { font-size: 125% }
    .paper { width: 210mm; padding: 12pt; margin: 1rem; font-family: "10pt song" }
  `)

  assert.match(css, /font-size:\s*125%/i)
  assert.match(css, /width:\s*793\.7px/i)
  assert.match(css, /padding:\s*16px/i)
  assert.match(css, /margin:\s*20px/i)
  assert.match(css, /font-family:\s*"10pt song"/i)
})

test('@supports 内容会静态展开，forwards 动画会固化为最后一帧', () => {
  const css = _internals.prepareCss(`
    @supports (display: grid) { .grid { display: grid } }
    @keyframes reveal { from { opacity: 0 } to { opacity: 1; transform: translateX(10px) } }
    .card { color: red; animation: reveal 1s ease forwards }
  `)

  assert.match(css, /\.grid\s*\{\s*display:\s*grid\s*\}/i)
  assert.equal(/@supports|@keyframes|animation\s*:/.test(css), false)
  assert.match(css, /\.card\s*\{[^}]*opacity:\s*1/i)
  assert.match(css, /transform:\s*translateX\(10px\)/i)
})

test('浅色设备会保留 prefers-color-scheme 浅色样式并丢弃深色分支', () => {
  const css = _internals.prepareCss(`
    body { background:#111; color:#111 }
    @media (prefers-color-scheme: light) {
      body { background:#fff; color:#222 }
      .card { background:#f7f5f1 }
    }
    @media (prefers-color-scheme: dark) {
      body { background:#000; color:#eee }
    }
  `)

  assert.match(css, /body\s*\{\s*background:#fff;\s*color:#222\s*\}/)
  assert.match(css, /\.card\s*\{\s*background:#f7f5f1\s*\}/)
  assert.equal(css.includes('background:#000'), false)
})

test('展示资源保持纯本地：外链资源被移除，普通链接和安全内嵌图片仍可用', () => {
  const safePng = 'data:image/png;base64,iVBORw0KGgo='
  const input = `
    <style>.remote { background-image: url("https://example.com/a.png") }</style>
    <a href="https://example.com/read">阅读链接</a>
    <img class="remote" src="https://example.com/a.png" srcset="https://example.com/2x.png 2x">
    <video src="//example.com/a.mp4" poster="https://example.com/poster.jpg"></video>
    <img src="${safePng}">
  `
  const result = transformHtml(input).html

  assert.equal(/example\.com\/(?:a\.(?:png|mp4)|2x\.png|poster\.jpg)/.test(result), false)
  assert.match(result, /href="https:\/\/example\.com\/read"/)
  assert.match(result, /data:image\/png;base64,iVBORw0KGgo=/)
  assert.equal(/srcset=/i.test(result), false)
  assert.match(result, /background-image:\s*none/i)
})

test('静态回退链保留安全 data 图片并从 srcset 生成 src', () => {
  const data = 'data:image/png;base64,AA=='
  const result = transformHtml(`<style>.cover{background-image:url(${data})}</style><img class="cover" srcset="${data} 1x">`).html

  assert.match(result, /background-image:\s*url\(["']?data:image\/png;base64,AA==/i)
  assert.match(result, /src="data:image\/png;base64,AA=="/i)
  assert.equal(/srcset=/i.test(result), false)
})
