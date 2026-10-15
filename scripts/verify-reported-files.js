'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const { renderHtmlDomTree, sanitizeStandaloneSvg } = require('../miniprogram/file-reader/document/document-renderer')
const { compactDomTreeForView, payloadBytes } = require('../miniprogram/file-reader/document/view-payload')

const { findTestMaterial } = require('./local-test-materials')
const home = os.homedir()
const htmlFiles = process.argv.slice(2, 4).length === 2 ? process.argv.slice(2, 4) : [
  findTestMaterial('牛来-glm 5.2.html', path.join(home, 'Desktop', '牛来-glm 5.2.html')),
  findTestMaterial('牛来宇宙-Vol.01.html', path.join(home, 'Desktop', '牛来宇宙-Vol.01.html'))
]
const calculatorPath = process.argv[4] || findTestMaterial('日常计算器.html', path.join(home, 'Downloads', '测试文件', '日常计算器.html'))
const svgPath = process.argv[5] || findTestMaterial('svg-test-animated-dashboard-01.svg', path.join(home, 'Downloads', '测试文件', 'svg-test-animated-dashboard-01.svg'))
const lightArticlePath = process.argv[6] || findTestMaterial('我的女友景甜_关系分析.html', path.join(home, 'Downloads', '测试文件', '我的女友景甜_关系分析.html'))

function findRenderedNode (nodes, nid) {
  for (const node of nodes || []) {
    if (node && node.nid === nid) return node
    const nested = node && findRenderedNode(node.children, nid)
    if (nested) return nested
  }
  return null
}

function flattenRenderedNodes (nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node)
    flattenRenderedNodes(node.children, output)
  }
  return output
}

function renderedStyle (opened, selector) {
  const sourceNode = opened.runtime.document.querySelector(selector)
  assert.ok(sourceNode, `${path.basename(opened.filePath)} 缺少元素 ${selector}`)
  const renderedNode = findRenderedNode(opened.renderedNodes, sourceNode._nid)
  assert.ok(renderedNode, `${path.basename(opened.filePath)} 没有上屏元素 ${selector}`)
  return renderedNode.attrs && renderedNode.attrs.style || ''
}

function openHtml (filePath, options = {}) {
  assert.ok(fs.existsSync(filePath), `缺少测试文件：${filePath}`)
  const runtimeOptions = { viewportWidth: 390, viewportHeight: 844, devicePixelRatio: 3, colorScheme: 'light', ...options }
  const runtime = createRuntime(fs.readFileSync(filePath, 'utf8'), runtimeOptions)
  runtime.run()
  runtime.flush(true)
  assert.deepEqual(runtime.errors, [], `${path.basename(filePath)} 存在运行时错误`)
  const state = runtime.renderState()
  const rendered = renderHtmlDomTree({ document: runtime.document, styles: state.styles }, runtimeOptions)
  const compacted = compactDomTreeForView(rendered.nodes)
  const bytes = payloadBytes({ domTree: compacted.nodes, domStyles: compacted.styles })
  assert.ok(bytes <= 900 * 1024, `${path.basename(filePath)} 视图数据 ${bytes} bytes 超过安全上限`)
  return { filePath, runtime, renderedNodes: rendered.nodes, bytes, nodes: rendered.nodes.length, styles: compacted.styles.length }
}

const results = htmlFiles.map((filePath, index) => {
  const opened = openHtml(filePath)
  const nodes = flattenRenderedNodes(opened.renderedNodes)
  const images = nodes.filter(node => node.name === 'img')
  assert.ok(images.length >= (index === 0 ? 50 : 54), `${path.basename(filePath)} 海报数量不足`)
  assert.equal(images.filter(node => /^data:image\/svg\+xml,/.test(node.attrs && node.attrs.src || '')).length, images.length, `${path.basename(filePath)} 存在空白 SVG 海报`)
  assert.equal(nodes.filter(node => node.type === 'text' && /\[object Object\]/.test(node.text || '')).length, 0, `${path.basename(filePath)} 仍有对象计数乱码`)
  const firstSvg = decodeURIComponent(images[0].attrs.src.replace(/^data:image\/svg\+xml,/, ''))
  assert.match(firstSvg, /font-size(?:=|:)/, `${path.basename(filePath)} SVG 字号丢失`)
  assert.match(firstSvg, /text-anchor(?:=|:)/, `${path.basename(filePath)} SVG 对齐属性丢失`)
  if (index === 0) {
    const header = opened.runtime.document.querySelector('.bg-night\\/95')
    assert.ok(header, `${path.basename(filePath)} 缺少深色标题栏`)
    assert.match(findRenderedNode(opened.renderedNodes, header._nid).attrs.style, /background-color:#14171c/, `${path.basename(filePath)} 标题栏背景未恢复`)
    assert.match(images[0].attrs.style || '', /width:100%/, `${path.basename(filePath)} SVG 外层宽度丢失`)
  }
  opened.runtime.destroy()
  return { file: path.basename(filePath), bytes: opened.bytes, topLevelNodes: opened.nodes, styles: opened.styles, svgPosters: images.length }
})

const calculator = openHtml(calculatorPath)
for (const selector of ['[data-action="clear"]', '[data-value="7"]', '[data-value="+"]', '[data-value="8"]', '[data-action="equals"]']) {
  const node = calculator.runtime.document.querySelector(selector)
  assert.ok(node, `计算器缺少按键 ${selector}`)
  assert.equal(calculator.runtime.dispatchTap(node._nid), true)
  calculator.runtime.flush(true)
}
assert.equal(calculator.runtime.document.getElementById('result').textContent, '15')
calculator.runtime.destroy()

const lightArticle = openHtml(lightArticlePath, { colorScheme: 'light' })
const lightArticleStyles = {
  shell: renderedStyle(lightArticle, '.shell'),
  question: renderedStyle(lightArticle, '.question'),
  article: renderedStyle(lightArticle, '.article'),
  strong: renderedStyle(lightArticle, 'strong'),
  blockquote: renderedStyle(lightArticle, 'blockquote')
}
assert.match(lightArticleStyles.shell, /padding:20px 0 40px/)
assert.match(lightArticleStyles.question, /padding:22px 20px/)
assert.match(lightArticleStyles.question, /background:linear-gradient\(145deg, rgba\(255,255,255,\.94\)/)
assert.match(lightArticleStyles.article, /background:rgba\(255,255,255,\.88\)/)
assert.match(lightArticleStyles.strong, /color:#111/)
assert.match(lightArticleStyles.blockquote, /color:#3d342d/)
assert.doesNotMatch(Object.values(lightArticleStyles).join(';'), /rgba\(31,31,28|color:#f1f1ee|background:#11110f/)
assert.doesNotMatch(JSON.stringify(lightArticle.renderedNodes), /filecite|\uE200|\uE201|\uE202/)
lightArticle.runtime.destroy()

assert.ok(fs.existsSync(svgPath), `缺少测试文件：${svgPath}`)
const svg = sanitizeStandaloneSvg(fs.readFileSync(svgPath, 'utf8'), { viewportWidth: 390 })
assert.match(svg.fallbackSource, /<svg\b/)
assert.doesNotMatch(svg.fallbackSource, /<script|\son\w+=|example\.com/i)

console.log(JSON.stringify({
  html: results,
  calculator: { file: path.basename(calculatorPath), result: '7 + 8 = 15', payloadBytes: calculator.bytes },
  lightArticle: {
    file: path.basename(lightArticlePath),
    mode: 'light-mobile',
    runtimeErrors: 0,
    citationArtifacts: 0,
    payloadBytes: lightArticle.bytes,
    styles: lightArticleStyles
  },
  svg: { file: path.basename(svgPath), sanitizedBytes: payloadBytes(svg.fallbackSource), hasSmil: svg.hasSmil }
}, null, 2))
