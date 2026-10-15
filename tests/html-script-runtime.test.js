'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  atobSafe,
  btoaSafe,
  bytesToBase64,
  createRuntime,
  utf8Decode,
  utf8Encode
} = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')

function delay (milliseconds = 15) { return new Promise(resolve => setTimeout(resolve, milliseconds)) }

test('Sval 脚本链可执行页面脚本并保留 body/html 运行时状态', () => {
  const runtime = createRuntime(`
    <html class="base"><body><p id="out">初始</p><script>
      document.documentElement.classList.add('ready')
      document.body.dataset.theme = 'night'
      document.getElementById('out').textContent = '脚本已运行'
    </script></body></html>
  `)

  const state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  assert.equal(state.rootClass, 'base ready')
  assert.equal(state.bodyAttrs, 'data-theme="night"')
  assert.match(state.bodyHtml, /脚本已运行/)
  runtime.destroy()
})

test('语言能力覆盖 class 私有字段、解构、可选链、生成器和标签模板', () => {
  const runtime = createRuntime(`<body><output id="out"></output><script>
    class Counter { #n = 2; value(){ return this.#n } }
    const { value = 0 } = { value: new Counter().value() }
    function* nums(){ yield value; yield 3 }
    const tag = (parts, n) => parts[0] + n
    const data = { nested: { ok: true } }
    document.getElementById('out').textContent = tag\`v=\${[...nums()].join('-')}\` + ':' + data?.nested?.ok
  </script></body>`)

  const state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /v=2-3:true/)
  runtime.destroy()
})

test('点击事件通过稳定 nid 回灌 DOM，委托冒泡仍然生效', () => {
  const actions = []
  const runtime = createRuntime(`<body><main id="root"><button id="add">0</button><a id="link" href="https://example.com">链接</a></main><script>
    document.getElementById('root').addEventListener('click', event => {
      if (event.target.id === 'add') event.target.textContent = String(Number(event.target.textContent) + 1)
    })
  </script></body>`, { onHostAction: action => actions.push(action) })
  runtime.run()

  assert.equal(runtime.dispatchTap(runtime.document.getElementById('add')._nid), true)
  assert.match(runtime.flush(true).bodyHtml, />1<\/button>/)
  runtime.dispatchTap(runtime.document.getElementById('link')._nid)
  assert.deepEqual(actions, [{ type: 'link', value: 'https://example.com' }])
  runtime.destroy()
})

test('常见内联事件属性在同一沙盒执行，return false 会阻止默认行为', () => {
  const runtime = createRuntime(`<body>
    <button id="go" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>
    <input id="check" type="checkbox" onclick="document.body.dataset.clicked='yes';return false">
  </body>`)
  runtime.run()
  runtime.dispatchTap(runtime.document.getElementById('go')._nid)
  runtime.dispatchTap(runtime.document.getElementById('check')._nid)

  assert.equal(runtime.document.getElementById('go').textContent, '1')
  assert.equal(runtime.document.body.dataset.clicked, 'yes')
  assert.equal(runtime.document.getElementById('check').checked, false)
  assert.equal(runtime.errors.length, 0)
  runtime.destroy()
})

test('hidden、reset 和文件输入兼容常见单文件页面脚本', () => {
  const runtime = createRuntime(`<body><form><input id="field" value="初始"><button id="reset" type="reset">重置</button></form>
    <section id="panel"></section><input id="file" type="file"><p id="out"></p><script>
      const panel=document.getElementById('panel');const field=document.getElementById('field');const file=document.getElementById('file');const out=document.getElementById('out');
      panel.hidden=true; field.value='已改';file.addEventListener('change', event => out.textContent=String(event.target.files.length));
    </script></body>`)
  runtime.run()
  runtime.dispatchTap(runtime.document.getElementById('reset')._nid)
  runtime.syncInput(runtime.document.getElementById('file')._nid, { value: '' }, 'change')

  assert.equal(runtime.document.getElementById('panel').hidden, true)
  assert.equal(runtime.document.getElementById('field').value, '初始')
  assert.equal(runtime.document.getElementById('out').textContent, '0')
  assert.equal(runtime.errors.length, 0)
  runtime.destroy()
})

test('标准全局 URL、编码、存储、crypto、FormData 和 getComputedStyle 不缺席', () => {
  const runtime = createRuntime(`<body><form id="f"><input name="user" value="兔子"></form><p id="out" style="color:red"></p><script>
    const params = new URLSearchParams('?a=1&a=2')
    const url = new URL('/page?x=1', 'https://local.invalid/base/')
    const bytes = new TextEncoder().encode('兔')
    localStorage.setItem('x', 'ok')
    const form = new FormData(document.getElementById('f'))
    const id = crypto.randomUUID()
    document.getElementById('out').textContent = [params.getAll('a').join(','), url.pathname, new TextDecoder().decode(bytes), localStorage.getItem('x'), form.get('user'), id.length, getComputedStyle(document.getElementById('out')).getPropertyValue('color')].join('|')
  </script></body>`)

  const state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  // Chrome resolves named colors to rgb(); the old literal-red assertion
  // merely proved that inline style was echoed, not computed.
  assert.match(state.bodyHtml, /1,2\|\/page\|兔\|ok\|兔子\|36\|rgb\(255, 0, 0\)/)
  runtime.destroy()
})

test('微信宿主缺少 Intl 时使用兼容实现，页面脚本和按钮交互不会降级', () => {
  const runtime = createRuntime(`<body>
    <p id="out"></p><button id="add">+</button>
    <script>
      let count = 1234
      const render = () => { document.getElementById('out').textContent = new Intl.NumberFormat('zh-CN').format(count) }
      document.getElementById('add').addEventListener('click', () => { count += 1; render() })
      render()
    </script>
  </body>`, { intl: null })

  let state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /1,234/)
  assert.equal(runtime.dispatchTap(runtime.document.getElementById('add')._nid), true)
  state = runtime.flush(true)
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /1,235/)
  runtime.destroy()
})

test('缺少宿主 Intl 时日期、复数、列表与显示名称常用接口仍可调用', () => {
  const runtime = createRuntime(`<body><p id="out"></p><script>
    const values = [
      typeof Intl.NumberFormat,
      typeof Intl.DateTimeFormat,
      new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(2026, 7, 27)),
      new Intl.PluralRules('zh-CN').select(2),
      new Intl.ListFormat('zh-CN').format(['HTML', 'Ai', 'PSD']),
      new Intl.DisplayNames('zh-CN', { type: 'language' }).of('zh')
    ]
    document.getElementById('out').textContent = values.join('|')
  </script></body>`, { intl: undefined })

  const state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /function\|function\|2026\/8\/27\|other\|HTML、Ai、PSD\|zh/)
  runtime.destroy()
})

test('运行时 matchMedia 与 CSS 使用同一设备主题，网页初始化不会选错深色模式', () => {
  const source = `<body><p id="out"></p><script>
    const scheme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    document.body.dataset.theme = scheme
    document.getElementById('out').textContent = new Intl.NumberFormat('zh-CN').format(50000000)
  </script></body>`
  const light = createRuntime(source, { intl: null, colorScheme: 'light' })
  const dark = createRuntime(source, { intl: null, colorScheme: 'dark' })

  assert.equal(light.run().bodyAttrs, 'data-theme="light"')
  assert.equal(dark.run().bodyAttrs, 'data-theme="dark"')
  assert.equal(light.errors.length, 0)
  assert.equal(dark.errors.length, 0)
  light.destroy()
  dark.destroy()
})

test('fetch、XHR、WebSocket 和分享 API 提供异步断网语义而不让初始化崩溃', async () => {
  const runtime = createRuntime(`<body><p id="out">0</p><script>
    let failures = 0
    const done = () => document.getElementById('out').textContent = String(++failures)
    fetch('/x').catch(done)
    navigator.share({ title: 'x' }).catch(done)
    const xhr = new XMLHttpRequest(); xhr.onerror = done; xhr.open('GET', '/x'); xhr.send()
    const ws = new WebSocket('wss://example.com'); ws.onerror = done
  </script></body>`)
  runtime.run()
  await delay(30)

  assert.equal(runtime.errors.length, 0)
  assert.equal(runtime.document.getElementById('out').textContent, '4')
  runtime.destroy()
})

test('FileReader、Blob 和 IntersectionObserver 走可控异步回调', async () => {
  const runtime = createRuntime(`<body><p id="out">等待</p><script>
    const output = document.getElementById('out')
    const reader = new FileReader()
    reader.onload = () => { output.textContent = reader.result }
    reader.readAsText(new Blob(['本地内容'], { type: 'text/plain' }))
    new IntersectionObserver(entries => { if (entries[0].isIntersecting) output.dataset.visible = 'yes' }).observe(output)
  </script></body>`)
  runtime.run()
  await delay(25)

  assert.equal(runtime.document.getElementById('out').textContent, '本地内容')
  assert.equal(runtime.document.getElementById('out').dataset.visible, 'yes')
  assert.equal(runtime.errors.length, 0)
  runtime.destroy()
})

test('脚本错误被逐条隔离，后续脚本和静态正文仍继续运行', () => {
  const runtime = createRuntime(`<body><p id="out">正文</p>
    <script>missingBrowserApi.crash()</script>
    <script>document.getElementById('out').textContent = '后续脚本正常'</script>
  </body>`)
  const state = runtime.run()

  assert.equal(runtime.errors.length, 1)
  assert.match(runtime.errors[0].message, /missingBrowserApi/)
  assert.match(state.bodyHtml, /后续脚本正常/)
  runtime.destroy()
})

test('沙盒封锁构造器、原型、Reflect 和属性描述符逃逸链', () => {
  const attempts = [
    "window.constructor.constructor('return process')()",
    "console.log.constructor('return process')()",
    "document['constructor']['constructor']('return process')()",
    "({}).constructor.constructor('return process')()",
    "(()=>{}).constructor('return process')()",
    "(async()=>{}).constructor('return process')()",
    "(function*(){}).constructor('return process')()",
    "({}).__proto__.constructor.constructor('return process')()",
    "Reflect.get(console.log, 'constructor')('return process')()",
    "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(()=>{}), 'constructor').value('return process')()",
    "(()=>{ const { constructor: HostFunction } = console.log; return HostFunction('return process')() })()",
    "(()=>{ with (window) { return constructor.constructor('return process')() } })()",
    "Function('return process')()",
    "eval('process')"
  ]
  const scripts = attempts.map(attempt => `<script>${attempt}</script>`).join('')
  const runtime = createRuntime(`<body><p id="out">安全正文</p>${scripts}<script>document.getElementById('out').textContent='后续脚本正常'</script></body>`)
  const state = runtime.run()

  assert.equal(runtime.errors.length, attempts.length)
  assert.equal(runtime.errors.every(error => /blocked|disabled|not defined|not a function/i.test(error.message)), true)
  assert.match(state.bodyHtml, /后续脚本正常/)
  runtime.destroy()
})

test('React 单文件生产包可在隔离运行时渲染并响应状态更新', () => {
  const runtime = createRuntime(`<body><div id="root"></div><script>
    const React = {
      Fragment: Symbol.for('fragment'), StrictMode: Symbol.for('strict'),
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: { current: null } }
    }
    React.useState = initial => React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current.useState(initial)
    const jsx = { jsx: (type, props) => ({ type, props }) }
    const ReactDOM = { createRoot(){ throw new Error('原始浏览器根节点不应执行') } }
    function App(){
      const [count, setCount] = React.useState(1)
      return jsx.jsx('button', { id: 'count', onClick: () => setCount(value => value + 1), children: '计数 ' + count })
    }
    ReactDOM.createRoot(document.getElementById('root')).render(jsx.jsx(React.StrictMode, { children: jsx.jsx(App, {}) }))
  </script></body>`)

  let state = runtime.run()
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /计数 1/)
  runtime.dispatchTap(runtime.document.getElementById('count')._nid)
  state = runtime.flush(true)
  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /计数 2/)
  runtime.destroy()
})

test('本地虚拟地址兼容 React Router 的 URL 与 History 用法', () => {
  const runtime = createRuntime(`<body><p id="out"></p><script>
    history.replaceState({ page: 1 }, '', '#/archive')
    history.pushState({ page: 2 }, '', '/gallery?sort=new#top')
    const relative = new URL('?view=grid', location.href)
    document.getElementById('out').textContent = [location.origin, location.pathname, location.search, location.hash, history.length, history.state.page, relative.href].join('|')
  </script></body>`)
  const state = runtime.run()

  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /https:\/\/local\.invalid\|\/gallery\|\?sort=new\|#top\|2\|2\|https:\/\/local\.invalid\/gallery\?view=grid/)
  runtime.destroy()
})

test('沙盒只暴露浏览器白名单，不继承 Node 或微信宿主全局', () => {
  const runtime = createRuntime(`<body><p id="out"></p><script>
    document.getElementById('out').textContent = [
      typeof process, typeof require, typeof global, typeof wx, typeof getApp,
      typeof __hostWindow, typeof Array, typeof Promise, typeof URL
    ].join('|')
  </script></body>`)
  const state = runtime.run()

  assert.equal(runtime.errors.length, 0)
  assert.match(state.bodyHtml, /undefined\|undefined\|undefined\|undefined\|undefined\|object\|function\|function\|function/)
  assert.equal(runtime.window.__hostWindow, null)
  runtime.destroy()
})

test('无限循环和递归超过预算后停止，下一段脚本仍可继续', () => {
  const runtime = createRuntime(`<body><p id="out">正文</p>
    <script>while (true) {}</script>
    <script>const recurse = () => recurse(); recurse()</script>
    <script>document.getElementById('out').textContent='后续脚本正常'</script>
  </body>`, { maxExecutionSteps: 800 })
  const state = runtime.run()

  assert.equal(runtime.errors.length, 2)
  assert.match(runtime.errors[0].message, /execution budget/)
  assert.match(runtime.errors[1].message, /execution budget|call stack/i)
  assert.match(state.bodyHtml, /后续脚本正常/)
  runtime.destroy()
})

test('剪贴板宿主动作只允许真实用户点击同步触发', async () => {
  const actions = []
  const runtime = createRuntime(`<body><button id="copy">复制</button><script>
    navigator.clipboard.writeText('自动写入').catch(() => {})
    document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText('用户写入'))
  </script></body>`, { onHostAction: action => actions.push(action) })
  runtime.run()
  await delay()
  assert.deepEqual(actions, [])

  runtime.dispatchTap(runtime.document.getElementById('copy')._nid)
  assert.deepEqual(actions, [{ type: 'clipboard', value: '用户写入' }])
  runtime.destroy()
})

test('点击中的 scrollTo 会把目标节点桥接到微信页面滚动', () => {
  const actions = []
  const runtime = createRuntime(`<body><button id="go">去海报墙</button><section id="wall">海报</section><script>
    document.getElementById('go').onclick = () => {
      const wall = document.getElementById('wall')
      window.scrollTo({ top: wall.offsetTop - 64, behavior: 'smooth' })
    }
  </script></body>`, { onHostAction: action => actions.push(action) })
  runtime.run()
  runtime.flush(true)
  runtime.dispatchTap(runtime.document.getElementById('go')._nid)

  assert.deepEqual(actions, [{ type: 'scroll', nid: runtime.document.getElementById('wall')._nid, offsetTop: -64, behavior: 'smooth' }])
  runtime.destroy()
})

test('触摸事件同样属于真实用户手势，可同步触发剪贴板桥', async () => {
  const actions = []
  const runtime = createRuntime(`<body><div id="touch"></div><script>
    document.getElementById('touch').addEventListener('touchend',()=>navigator.clipboard.writeText('touch-link'))
  </script></body>`, { onHostAction: action => actions.push(action) })
  runtime.run()
  runtime.dispatchEvent(runtime.document.getElementById('touch')._nid, 'touchend', { changedTouches: [] })
  await Promise.resolve()

  assert.deepEqual(actions, [{ type: 'clipboard', value: 'touch-link' }])
  runtime.destroy()
})

test('base64 和 UTF-8 实现不会因 padding 空串多解出 NUL', () => {
  assert.equal(atobSafe(btoaSafe('A')), 'A')
  assert.equal(atobSafe('QQ==').length, 1)
  assert.equal(atobSafe('QQ==').includes('\u0000'), false)
  assert.equal(utf8Decode(utf8Encode('兔子🐇')), '兔子🐇')
  assert.equal(bytesToBase64(Uint8Array.from([0, 255, 128])), 'AP+A')
})

test('Canvas 2D 指令稳定且不提供假 WebGL 成功结果', () => {
  const runtime = createRuntime(`<body><canvas id="c"></canvas><p id="out"></p><script>
    const canvas = document.getElementById('c')
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'blue'; ctx.fillRect(1, 2, 3, 4)
    const gl = canvas.getContext('webgl')
    document.getElementById('out').textContent = String(gl === null)
  </script></body>`)
  runtime.run()
  const canvas = runtime.document.getElementById('c')

  assert.deepEqual(canvas._canvasState.ops.slice(0, 2).map(operation => operation.name), ['set:fillStyle', 'fillRect'])
  assert.equal(runtime.document.getElementById('out').textContent, 'true')
  runtime.destroy()
})

test('Canvas 渐变、Image 和 ImageData 指令可安全通过 setData 序列化', () => {
  const runtime = createRuntime(`<body><canvas id="c"></canvas><script>
    const canvas = document.getElementById('c')
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 10, 0)
    gradient.addColorStop(0, 'red')
    ctx.fillStyle = gradient
    const image = new Image(); image.src = 'data:image/png;base64,AA=='
    ctx.drawImage(image, 0, 0)
    ctx.putImageData(ctx.createImageData(1, 1), 0, 0)
  </script></body>`)
  runtime.run()
  const operations = runtime.document.getElementById('c')._canvasState.ops

  assert.doesNotThrow(() => JSON.stringify(operations))
  assert.deepEqual(operations.map(operation => operation.name), ['createGradient', 'gradientColorStop', 'set:fillStyle', 'drawImage', 'putImageData'])
  assert.match(operations[3].args[0].__canvasImage, /^data:image\/png/)
  assert.deepEqual(operations[4].args[0].data.data, [0, 0, 0, 0])
  runtime.destroy()
})

test('Canvas 动画只走轻量通道，不因 DOM 键未变而丢帧', async () => {
  const fullRenders = []
  const canvasRenders = []
  const runtime = createRuntime(`<body><canvas id="c"></canvas><script>
    const ctx=document.getElementById('c').getContext('2d');ctx.fillRect(0,0,1,1);setTimeout(()=>ctx.fillRect(1,1,1,1),1)
  </script></body>`, {
    onRender: state => fullRenders.push(state),
    onCanvas: canvases => canvasRenders.push(canvases)
  })
  runtime.run()
  await new Promise(resolve => setTimeout(resolve, 18))

  assert.equal(fullRenders.length, 1)
  assert.equal(canvasRenders.length >= 1, true)
  assert.equal(canvasRenders.at(-1)[0].canvas.rev, 2)
  runtime.destroy()
})

test('存在宿主离屏 WebGL 时使用真实桥并回读像素快照', () => {
  const calls = []
  const resource = {}
  const gl = {
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    COLOR_BUFFER_BIT: 16384,
    createBuffer () { calls.push('createBuffer'); return resource },
    bindBuffer (target, value) { calls.push(value === resource ? 'bound' : 'bad') },
    clearColor () { calls.push('clearColor') },
    clear () { calls.push('clear') },
    readPixels (x, y, width, height, format, type, pixels) { pixels.fill(7) }
  }
  const runtime = createRuntime(`<body><canvas id="c" width="2" height="1"></canvas><p id="out"></p><script>
    const canvas=document.getElementById('c');const out=document.getElementById('out');const gl=canvas.getContext('webgl');const b=gl.createBuffer();gl.bindBuffer(1,b);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);out.textContent=gl.__htmlReaderRealWebGl
  </script></body>`, { createOffscreenCanvas: ({ width, height }) => ({ width, height, getContext: () => gl }) })
  const state = runtime.run()

  assert.equal(runtime.document.getElementById('out').textContent, 'true')
  assert.deepEqual(calls.slice(0, 4), ['createBuffer', 'bound', 'clearColor', 'clear'])
  assert.deepEqual(state.canvases[0].canvas.webgl.data, [7, 7, 7, 7, 7, 7, 7, 7])
  runtime.destroy()
})

test('定时器、requestAnimationFrame 和微任务修改 DOM 后会主动调度渲染', async () => {
  const renders = []
  const runtime = createRuntime(`<body><p id="out">0</p><script>
    const out = document.getElementById('out')
    queueMicrotask(() => out.textContent = '1')
    requestAnimationFrame(() => out.textContent = '2')
    setTimeout(() => out.textContent = '3', 2)
  </script></body>`, { onRender: state => renders.push(state.bodyHtml) })
  runtime.run()
  await delay(35)

  assert.equal(runtime.document.getElementById('out').textContent, '2')
  assert.equal(renders.some(html => />3<\/p>/.test(html)) || renders.some(html => />2<\/p>/.test(html)), true)
  runtime.destroy()
})
