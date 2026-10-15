'use strict'

// 面向 SVG 的小型 XML 解析器：只产出光栅化需要的节点树 { name, attrs, children, text }。
// 不执行任何脚本，不解析 DTD；实体只认 XML 预定义实体与数字字符引用。
// 与 engine 里的 HTML DOM 无关：image 分包必须自包含，不能同步 require 引擎分包。

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities (value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body.toLowerCase()) ? NAMED_ENTITIES[body.toLowerCase()] : match
  })
}

function localName (qualified) {
  const index = qualified.indexOf(':')
  return index >= 0 ? qualified.slice(index + 1) : qualified
}

function parseAttributes (text, attrs) {
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let match
  while ((match = pattern.exec(text))) {
    const name = match[1]
    const value = match[2] != null ? match[2] : match[3] != null ? match[3] : match[4] != null ? match[4] : ''
    // xlink:href 与 href 统一成 href；xml:space 之类保留完整名
    const key = name === 'xlink:href' ? 'href' : name
    if (!(key in attrs)) attrs[key] = decodeEntities(value)
  }
}

function createNode (name, attrs) {
  return { name, attrs, children: [], text: '' }
}

// 返回根节点（第一个元素）。文本节点作为 { name: '#text', text } 挂在 children 里，
// 但只有 text/tspan/style/title/desc 这类需要文本的元素才会保留，其余空白全部丢弃。
const TEXT_BEARING = new Set(['text', 'tspan', 'textPath', 'style', 'title', 'desc', 'script'])

function parseXml (source) {
  const input = String(source || '')
  const root = createNode('#document', {})
  const stack = [root]
  let index = 0
  const length = input.length
  while (index < length) {
    const open = input.indexOf('<', index)
    if (open < 0) {
      appendText(stack[stack.length - 1], input.slice(index))
      break
    }
    if (open > index) appendText(stack[stack.length - 1], input.slice(index, open))
    if (input.startsWith('<!--', open)) {
      const close = input.indexOf('-->', open + 4)
      index = close < 0 ? length : close + 3
      continue
    }
    if (input.startsWith('<![CDATA[', open)) {
      const close = input.indexOf(']]>', open + 9)
      const end = close < 0 ? length : close
      appendText(stack[stack.length - 1], input.slice(open + 9, end), true)
      index = close < 0 ? length : close + 3
      continue
    }
    if (input.startsWith('<?', open) || input.startsWith('<!', open)) {
      const close = input.indexOf('>', open)
      index = close < 0 ? length : close + 1
      continue
    }
    if (input.startsWith('</', open)) {
      const close = input.indexOf('>', open)
      const name = localName(input.slice(open + 2, close < 0 ? length : close).trim())
      // 容错：找到栈里最近的同名元素并弹出到它
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === name) { stack.length = depth; break }
      }
      index = close < 0 ? length : close + 1
      continue
    }
    const close = findTagEnd(input, open)
    const rawTag = input.slice(open + 1, close)
    const selfClosing = /\/\s*$/.test(rawTag)
    const body = selfClosing ? rawTag.replace(/\/\s*$/, '') : rawTag
    const nameMatch = body.match(/^[^\s/>]+/)
    if (!nameMatch) { index = close + 1; continue }
    const name = localName(nameMatch[0])
    const node = createNode(name, {})
    parseAttributes(body.slice(nameMatch[0].length), node.attrs)
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) {
      if (name === 'style' || name === 'script' || name === 'title' || name === 'desc') {
        // 原样吃掉到闭标签，样式表里的 > 不能当标签结束
        const endTag = input.indexOf(`</${nameMatch[0]}`, close + 1)
        const end = endTag < 0 ? length : endTag
        node.text = decodeEntities(input.slice(close + 1, end))
        const endClose = input.indexOf('>', end)
        index = endClose < 0 ? length : endClose + 1
        continue
      }
      stack.push(node)
    }
    index = close + 1
  }
  const element = root.children.find(child => child.name !== '#text')
  return element || null
}

function findTagEnd (input, open) {
  let index = open + 1
  let quote = ''
  while (index < input.length) {
    const char = input[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
    index++
  }
  return input.length
}

function appendText (parent, text, raw = false) {
  if (!parent || !TEXT_BEARING.has(parent.name)) return
  const value = raw ? text : decodeEntities(text)
  if (!value) return
  const last = parent.children[parent.children.length - 1]
  if (last && last.name === '#text') last.text += value
  else parent.children.push({ name: '#text', attrs: {}, children: [], text: value })
}

// 深度优先遍历，回调返回 false 时不进入子树
function walk (node, visit, parent = null) {
  if (!node) return
  if (visit(node, parent) === false) return
  for (const child of node.children) walk(child, visit, node)
}

function textContent (node) {
  if (!node) return ''
  if (node.name === '#text') return node.text
  return node.children.map(textContent).join('')
}

module.exports = { decodeEntities, parseXml, textContent, walk }
