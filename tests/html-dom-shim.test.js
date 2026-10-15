'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  ShimCustomEvent,
  ShimEvent,
  dispatchDomClick,
  parseHtmlDocument,
  serializeBodyAttributes,
  serializeNode
} = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')

test('DOM shim 解析 html/body 属性并只收集可执行的内联脚本', () => {
  const parsed = parseHtmlDocument(`
    <html class="theme-dark"><head><title>测试页</title><style>.x{color:red}</style></head>
    <body data-theme="dark"><main id="app">正文</main>
    <script src="https://example.com/a.js"></script>
    <script type="application/json">{"x":1}</script>
    <script>document.body.dataset.ready = 'yes'</script></body></html>
  `)

  assert.equal(parsed.document.documentElement.className, 'theme-dark')
  assert.equal(parsed.document.body.dataset.theme, 'dark')
  assert.equal(parsed.document.title, '测试页')
  assert.deepEqual(parsed.styles, ['.x{color:red}'])
  assert.deepEqual(parsed.scripts, ["document.body.dataset.ready = 'yes'"])
  assert.equal(parsed.document.querySelector('#app').textContent, '正文')

  const edge = parseHtmlDocument('<html data-note="1 > 0"><body><p title="a > b">A &amp; B</p><textarea>&lt;b&gt;x&lt;/b&gt;</textarea><script type="text/javascript; charset=utf-8">document.body.hidden=false</script></body></html>')
  assert.equal(edge.document.documentElement.dataset.note, '1 > 0')
  assert.equal(edge.document.querySelector('p').getAttribute('title'), 'a > b')
  assert.equal(edge.document.querySelector('textarea').value, '<b>x</b>')
  assert.equal(edge.document.querySelector('textarea').children.length, 0)
  assert.equal(edge.scripts.length, 1)
})

test('head 标题不会被正文 SVG title 抢占，style/script 属性中的大于号可解析', () => {
  const parsed = parseHtmlDocument(`<!doctype html><html><head>
    <title>文档标题</title>
    <style data-query="a > b">.x{color:red}</style>
    <script data-query='a > b' type="text/javascript; charset=utf-8">document.body.dataset.ready='yes'</script>
  </head><body><svg><title>图形标题</title></svg><p class="x">正文</p></body></html>`)

  assert.equal(parsed.title, '文档标题')
  assert.deepEqual(parsed.styles, ['.x{color:red}'])
  assert.equal(parsed.scripts.length, 1)
  assert.match(parsed.scripts[0], /dataset\.ready/)
  assert.equal(parsed.document.querySelector('script'), null)
  // Styles remain script-addressable; only their rendered nodes and external
  // resources are blocked. Removing them breaks legitimate CSSOM updates.
  assert.equal(parsed.document.querySelector('style').textContent, '.x{color:red}')
})

test('RAWTEXT/RCDATA 中的结构伪结束标签不会截断 head、body 或后续正文', () => {
  const parsed = parseHtmlDocument(`<html><head>
    <style>p::before{content:"</head>"}</style><title>真实标题 </head> 仍保留</title>
  </head><body>
    <script>const marker = "</body>"; document.body.dataset.ready = marker</script>
    <textarea id="notes">&lt;保留&gt; </body> 仍是输入内容</textarea>
    <p id="after">后续正文完整</p>
  </body></html>`)

  assert.equal(parsed.title, '真实标题 </head> 仍保留')
  assert.deepEqual(parsed.styles, ['p::before{content:"</head>"}'])
  assert.deepEqual(parsed.scripts, ['const marker = "</body>"; document.body.dataset.ready = marker'])
  assert.equal(parsed.document.getElementById('notes').value, '<保留> </body> 仍是输入内容')
  assert.equal(parsed.document.getElementById('after').textContent, '后续正文完整')
})

test('节点增删、克隆、片段和四向 insertAdjacentHTML 保持树关系', () => {
  const { document } = parseHtmlDocument('<body><div id="root"><b>A</b></div></body>')
  const root = document.getElementById('root')
  const fragment = document.createDocumentFragment()
  const em = document.createElement('em')
  em.textContent = 'B'
  fragment.appendChild(em)
  root.appendChild(fragment)
  root.insertAdjacentHTML('afterbegin', '<i>0</i>')
  root.lastElementChild.after(root.lastElementChild.cloneNode(true))

  assert.equal(root.children.length, 4)
  assert.equal(root.textContent, '0ABB')
  root.replaceChild(document.createTextNode('X'), root.children[1])
  assert.equal(root.textContent, '0XBB')
  root.lastChild.remove()
  assert.equal(root.textContent, '0XB')
})

test('选择器支持属性算符、nth/not、后代/子/相邻与后续兄弟', () => {
  const { document } = parseHtmlDocument(`
    <body><section class="cards"><article class="card" data-kind="news-cn"><b>A</b></article>
    <article class="card featured" data-kind="news-us"><b>B</b></article>
    <article class="card" data-kind="note"><b>C</b></article></section></body>
  `)

  assert.equal(document.querySelectorAll('.cards > .card').length, 3)
  assert.equal(document.querySelectorAll('[data-kind^="news"]').length, 2)
  assert.equal(document.querySelectorAll('[data-kind$="cn"]').length, 1)
  assert.equal(document.querySelectorAll('[data-kind*="ote"]').length, 1)
  assert.equal(document.querySelectorAll('.card:nth-child(2n+1):not(.featured)').length, 2)
  assert.equal(document.querySelector('.featured + article b').textContent, 'C')
  assert.equal(document.querySelectorAll('.featured ~ article').length, 1)
  assert.equal(document.querySelector('b').closest('section').className, 'cards')
})

test('选择器支持 Tailwind 转义类名', () => {
  const { document } = parseHtmlDocument('<body><header class="bg-night/95 sm:w-56 supports-[backdrop-filter]:bg-night/85"></header></body>')

  assert.equal(document.querySelector('.bg-night\\/95').localName, 'header')
  assert.equal(document.querySelector('.sm\\:w-56').localName, 'header')
  assert.equal(document.querySelector('.supports-\\[backdrop-filter\\]\\:bg-night\\/85').localName, 'header')
})

test('classList、dataset 和 style 的同值写入不会重复触发脏标', () => {
  let dirtyRises = 0
  const { document } = parseHtmlDocument('<body><div class="one" data-count="1" style="color:red"></div></body>', { onDirty: () => { dirtyRises++ } })
  const div = document.querySelector('div')

  div.dataset.count = '1'
  div.style.color = 'red'
  assert.equal(dirtyRises, 0)
  div.classList.add('two')
  assert.equal(dirtyRises, 1)
  document._dirty = false
  div.dataset.count = '2'
  assert.equal(dirtyRises, 2)
  assert.equal(div.getAttribute('data-count'), '2')
  div.style.setProperty('background-color', 'blue')
  assert.equal(div.style.backgroundColor, 'blue')
  div.style.removeProperty('color')
  assert.equal(div.style.color, '')
  div.dataset.empty = ''
  assert.equal(div.dataset.empty, '')
})

test('事件支持冒泡、CustomEvent detail、阻止默认和移除监听', () => {
  const { document } = parseHtmlDocument('<body><div id="outer"><button id="go">走</button></div></body>')
  const outer = document.getElementById('outer')
  const button = document.getElementById('go')
  const calls = []
  const removed = () => calls.push('removed')
  outer.addEventListener('done', event => calls.push(`outer:${event.detail}`))
  button.addEventListener('done', event => { calls.push(`button:${event.detail}`); event.preventDefault() })
  button.addEventListener('done', removed)
  button.removeEventListener('done', removed)
  const event = new ShimCustomEvent('done', { detail: 7 })

  assert.equal(button.dispatchEvent(event), false)
  assert.deepEqual(calls, ['button:7', 'outer:7'])
  assert.equal(event.defaultPrevented, true)
})

test('表单支持具名元素、值/勾选语义、label 联动和可取消 submit', () => {
  const { document } = parseHtmlDocument(`
    <body><form id="f"><label for="agree">同意</label><input id="agree" name="agree" type="checkbox">
    <input name="user" value="兔子"><button type="submit">提交</button></form></body>
  `)
  const form = document.getElementById('f')
  assert.equal(form.elements.namedItem('user').value, '兔子')
  assert.equal(form.user.value, '兔子')
  dispatchDomClick(document.querySelector('label'))
  assert.equal(form.agree.checked, true)
  let submitted = false
  form.addEventListener('submit', event => { submitted = true; event.preventDefault() })
  dispatchDomClick(document.querySelector('button'))
  assert.equal(submitted, true)
})

test('select 的 value、selectedIndex 与 option 选择状态保持一致', () => {
  const document = parseHtmlDocument('<select id="s"><option value="a">A</option><option value="b">B</option></select>').document
  const select = document.getElementById('s')
  assert.equal(select.value, 'a')
  assert.equal(select.selectedIndex, 0)

  select.value = 'b'
  assert.equal(select.selectedIndex, 1)
  assert.equal(select.querySelectorAll('option')[1].selected, true)

  select.selectedIndex = 0
  assert.equal(select.value, 'a')
})

test('表单重置、radio 互斥、hidden 反射和 dialog 提交遵守默认行为', () => {
  const { document } = parseHtmlDocument(`<body><form id="f">
    <input id="a" type="radio" name="level" value="a" checked><input id="b" type="radio" name="level" value="b">
    <input id="text" value="初始"><button id="reset" type="reset">重置</button>
  </form><p id="panel"></p><dialog open><form method="dialog"><button id="close" value="ok">关闭</button></form></dialog></body>`)
  const form = document.getElementById('f')
  const panel = document.getElementById('panel')
  panel.hidden = true
  assert.equal(panel.hasAttribute('hidden'), true)
  dispatchDomClick(document.getElementById('b'))
  assert.equal(document.getElementById('a').checked, false)
  assert.equal(document.getElementById('b').checked, true)
  form.text.value = '已改'
  dispatchDomClick(document.getElementById('reset'))
  assert.equal(form.text.value, '初始')
  assert.equal(document.getElementById('a').checked, true)
  assert.equal(document.getElementById('b').checked, false)
  const dialog = document.querySelector('dialog')
  dispatchDomClick(document.getElementById('close'))
  assert.equal(dialog.open, false)
  assert.equal(dialog.returnValue, 'ok')
})

test('取消 click 会阻止 checkbox 的默认切换', () => {
  const { document } = parseHtmlDocument('<body><input id="x" type="checkbox"></body>')
  const input = document.getElementById('x')
  input.addEventListener('click', event => event.preventDefault())
  dispatchDomClick(input)
  assert.equal(input.checked, false)
})

test('序列化保留 SVG 属性大小写、body 状态和稳定 nid', () => {
  const { document } = parseHtmlDocument('<html class="root"><body data-theme="night"><svg viewBox="0 0 10 10"><linearGradient gradientUnits="userSpaceOnUse"></linearGradient></svg></body></html>')
  const html = serializeNode(document.body)

  assert.equal(serializeBodyAttributes(document), 'data-theme="night"')
  assert.match(html, /viewBox="0 0 10 10"/)
  assert.match(html, /gradientUnits="userSpaceOnUse"/)
  assert.match(html, /data-hr-nid="\d+"/)
})

test('SVG 命名空间内的 XML 自闭合元素不会错误套住后续兄弟', () => {
  const { document } = parseHtmlDocument('<body><svg><defs><linearGradient><stop offset="0%"/><stop offset="100%"/></linearGradient></defs><circle r="4"/><rect width="8"/></svg></body>')
  const gradient = document.querySelector('linearGradient')
  const svg = document.querySelector('svg')

  assert.equal(gradient.children.length, 2)
  assert.equal(svg.children.map(node => node.localName).join(','), 'defs,circle,rect')
})

test('dialog、document.cookie、title 和脏标上升沿均提供稳定语义', () => {
  let title = ''
  let dirtyRises = 0
  const { document } = parseHtmlDocument('<body><dialog>内容</dialog></body>', { onTitle: value => { title = value }, onDirty: () => { dirtyRises++ } })
  const dialog = document.querySelector('dialog')
  document.cookie = 'x=1'
  assert.equal(document.cookie, '')
  document.title = '新标题'
  assert.equal(title, '新标题')
  dialog.showModal()
  assert.equal(dialog.hasAttribute('open'), true)
  assert.equal(dirtyRises, 1)
  document._dirty = false
  dialog.close('ok')
  assert.equal(dialog.hasAttribute('open'), false)
  assert.equal(dialog.returnValue, 'ok')
  assert.equal(dirtyRises, 2)
  assert.equal(new ShimEvent('x').defaultPrevented, false)
})
