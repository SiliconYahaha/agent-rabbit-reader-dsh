'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')

const { testMaterialRoot } = require('./local-test-materials')
const materialRoot = testMaterialRoot(process.argv[2])
const requiredFiles = [
  'html-css-js-local-test.html',
  '日常计算器.html',
  '2026-0416 结尾卡片-10个.html',
  '2026-0416 结尾推荐卡片-4个.html'
]

for (const fileName of requiredFiles) {
  const filePath = path.join(materialRoot, fileName)
  assert.equal(fs.existsSync(filePath), true, `缺少用户原文件：${filePath}`)
}

function openOriginal (fileName) {
  const html = fs.readFileSync(path.join(materialRoot, fileName), 'utf8')
  const renders = []
  const canvasFrames = []
  const runtime = createRuntime(html, {
    viewportWidth: 390,
    viewportHeight: 844,
    devicePixelRatio: 3,
    onRender: state => renders.push(state),
    onCanvas: canvases => canvasFrames.push(canvases)
  })
  runtime.run()
  runtime.flush(true)
  assert.deepEqual(runtime.errors, [], `${fileName} 存在脚本错误`)
  const state = runtime.renderState()
  const rendered = renderHtmlDomTree({ document: runtime.document, styles: state.styles }, { viewportWidth: 390 })
  return { runtime, rendered, renders, canvasFrames }
}

function tap (runtime, selector) {
  const node = runtime.document.querySelector(selector)
  assert.ok(node, `找不到交互节点：${selector}`)
  assert.equal(runtime.dispatchTap(node._nid), true, `点击未成功：${selector}`)
  runtime.flush(true)
  return node
}

async function main () {
  const comprehensive = openOriginal('html-css-js-local-test.html')
  const { runtime } = comprehensive
  assert.match(runtime.document.getElementById('jsStatus').textContent, /JavaScript 已正常执行/)
  const initialCanvasRevision = runtime.renderState().canvases[0].canvas.rev

  tap(runtime, '#themeToggle')
  assert.equal(runtime.document.documentElement.classList.contains('theme-dark'), true)

  tap(runtime, '#plusBtn')
  assert.equal(runtime.document.getElementById('counter').textContent, '1')

  const tabButtons = runtime.document.querySelectorAll('.tab-button')
  runtime.dispatchTap(tabButtons[1]._nid)
  runtime.flush(true)
  assert.equal(runtime.document.getElementById('tab1').hidden, true)
  assert.equal(runtime.document.getElementById('tab2').hidden, false)

  tap(runtime, '#openDialog')
  const dialog = runtime.document.getElementById('demoDialog')
  assert.equal(dialog.open, true)
  tap(runtime, '#demoDialog button')
  assert.equal(dialog.open, false)

  runtime.document.getElementById('name').value = '会被重置'
  tap(runtime, '#demoForm button[type="reset"]')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(runtime.document.getElementById('name').value, '')
  assert.equal(runtime.document.getElementById('fileInput').files.length, 0)

  tap(runtime, '#redrawCanvas')
  const redrawnCanvasRevision = runtime.renderState().canvases[0].canvas.rev
  assert.ok(redrawnCanvasRevision > initialCanvasRevision)
  // Canvas 的绘图缓冲区是 900px，但作者样式为 width:100%，不应误触发整页 fit-scale。
  assert.equal(comprehensive.rendered.contentWidth, 390)
  runtime.destroy()

  const calculator = openOriginal('日常计算器.html')
  tap(calculator.runtime, '[data-action="clear"]')
  tap(calculator.runtime, '[data-value="7"]')
  tap(calculator.runtime, '[data-value="+"]')
  tap(calculator.runtime, '[data-value="8"]')
  tap(calculator.runtime, '[data-action="equals"]')
  assert.equal(calculator.runtime.document.getElementById('result').textContent, '15')
  assert.equal(calculator.runtime.document.getElementById('expression').textContent, '7 + 8 =')
  calculator.runtime.destroy()

  const cardWidths = {}
  for (const fileName of requiredFiles.slice(2)) {
    const opened = openOriginal(fileName)
    cardWidths[fileName] = opened.rendered.contentWidth
    assert.equal(opened.rendered.contentWidth, 840)
    assert.ok(opened.rendered.nodes.length > 0)
    opened.runtime.destroy()
  }

  console.log(JSON.stringify({
    materialRoot,
    files: requiredFiles,
    comprehensive: {
      errors: 0,
      theme: 'theme-dark',
      counter: 1,
      activeTab: 'tab2',
      dialog: 'open-and-close',
      formReset: true,
      canvasRevisionAdvanced: true,
      contentWidth: comprehensive.rendered.contentWidth
    },
    calculator: { result: '15', expression: '7 + 8 =' },
    cardWidths
  }, null, 2))
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
