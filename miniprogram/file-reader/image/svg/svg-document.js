'use strict'

// 把 XML 树整理成光栅化器需要的元素表：每个元素带祖先链、自身样式、计算样式、id 索引，
// 并把所有 <style> 合成一张样式表（含 @keyframes）。几何与样式的动画覆盖不在这里，
// 由 svg-animation 按时间给出，light 的元素记录只做一次。

const { parseXml, textContent, walk } = require('./xml-parser')
const { computeStyle, ownStyle, parseLength, parseStyleSheet, parseTransformList } = require('./svg-style')

const NON_RENDERED = new Set(['defs', 'clipPath', 'linearGradient', 'radialGradient', 'symbol', 'title', 'desc', 'style', 'script', 'metadata', 'mask', 'filter', 'pattern', 'marker', 'animate', 'animateTransform', 'animateMotion', 'set', '#text', 'foreignObject'])

function parseViewBox (value, allowZero = false) {
  const numbers = String(value || '').trim().split(/[\s,]+/).map(Number)
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number)) || numbers[2] < 0 || numbers[3] < 0 || (!allowZero && (!numbers[2] || !numbers[3]))) return null
  return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }
}

function parseSvgDocument (source) {
  const root = parseXml(source)
  if (!root || root.name !== 'svg') throw new Error('文件里没有 <svg> 根元素')
  let css = ''
  walk(root, node => { if (node.name === 'style') css += `\n${node.text || textContent(node)}` })
  const sheet = parseStyleSheet(css)
  const byId = Object.create(null)
  const elements = []
  const records = new Map()
  const visit = (node, ancestors, parentRecord) => {
    if (node.name === '#text') return
    const own = ownStyle(node, ancestors, sheet)
    const rootFont = records.has(root) ? parseLength(records.get(root).style['font-size']) : NaN
    const computed = computeStyle(own, parentRecord ? parentRecord.style : null, parentRecord ? (Number.isFinite(rootFont) ? rootFont : 16) : undefined)
    const record = {
      node,
      parent: parentRecord,
      ancestors,
      own,
      style: computed,
      transform: parseTransformList(node.attrs.transform),
      index: elements.length
    }
    elements.push(record)
    records.set(node, record)
    if (node.attrs.id && !byId[node.attrs.id]) byId[node.attrs.id] = record
    for (const child of node.children) visit(child, ancestors.concat(node), record)
  }
  visit(root, [], null)
  const viewBox = parseViewBox(root.attrs.viewBox)
  const width = parseLength(root.attrs.width, viewBox ? viewBox.width : 0)
  const height = parseLength(root.attrs.height, viewBox ? viewBox.height : 0)
  const intrinsic = {
    width: Number.isFinite(width) && width > 0 ? width : viewBox ? viewBox.width : 300,
    height: Number.isFinite(height) && height > 0 ? height : viewBox ? viewBox.height : 150
  }
  return {
    root,
    rootRecord: records.get(root),
    sheet,
    byId,
    elements,
    records,
    viewBox: viewBox || { x: 0, y: 0, width: intrinsic.width, height: intrinsic.height },
    intrinsic,
    title: (() => { const node = root.children.find(child => child.name === 'title'); return node ? (node.text || textContent(node)).trim() : '' })()
  }
}

function resolveReference (doc, value) {
  const match = String(value || '').trim().match(/^url\(\s*['"]?#([^)'"]+)['"]?\s*\)$|^#(.+)$/)
  const id = match ? (match[1] || match[2]) : ''
  return id ? doc.byId[id] || null : null
}

function isRendered (node) {
  return !NON_RENDERED.has(node.name)
}

module.exports = { NON_RENDERED, isRendered, parseSvgDocument, parseViewBox, resolveReference }
