import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const bcd = require('@mdn/browser-compat-data')
const projectRoot = path.resolve(import.meta.dirname, '..')
const outputPath = path.join(projectRoot, 'docs/reader-coverage.md')

const blockedTags = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'foreignobject'])
const mappedTags = new Set(['input', 'textarea', 'select', 'progress', 'meter', 'canvas', 'svg'])
const degradedTags = new Set(['audio', 'video'])
const hiddenTags = new Set(['template', 'noscript'])
const selectorEngine = new Set(['class', 'id', 'type', 'attribute', 'descendant', 'child', 'next-sibling', 'subsequent-sibling', 'root', 'empty', 'first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-of-type', 'nth-last-of-type', 'not', 'checked', 'disabled', 'enabled', 'required', 'optional', 'read-only', 'read-write', 'before', 'after'])
const cssStripped = new Set(['behavior', 'src'])
const apiShimmed = new Set(['Document', 'Element', 'Node', 'Event', 'CustomEvent', 'Window', 'History', 'Location', 'Storage', 'FormData', 'FileReader', 'Blob', 'URL', 'TextEncoder', 'TextDecoder', 'CanvasRenderingContext2D', 'HTMLCanvasElement', 'IntersectionObserver', 'XMLHttpRequest', 'WebSocket', 'Crypto'])
const apiDegraded = new Set(['Navigator', 'Performance', 'Screen', 'MediaQueryList', 'Image', 'Audio'])

function chromeSupported (entry) {
  const support = entry && entry.__compat && entry.__compat.support && entry.__compat.support.chrome
  const records = Array.isArray(support) ? support : support ? [support] : []
  return records.some(record => record && record.version_added !== false && record.version_added != null && record.version_removed == null)
}

function rowsFor (record, classify) {
  return Object.keys(record).sort().filter(name => chromeSupported(record[name])).map(name => ({ name, ...classify(name) }))
}

const htmlRows = rowsFor(bcd.html.elements, name => blockedTags.has(name)
  ? { status: 'blocked', note: '危险或可嵌入执行上下文，不进入阅读树' }
  : mappedTags.has(name) ? { status: 'mapped', note: '映射为小程序节点或本地快照' }
    : degradedTags.has(name) ? { status: 'degraded', note: '离线占位；video 可显示安全 poster' }
      : hiddenTags.has(name) ? { status: 'hidden', note: '按浏览器默认隐藏' }
        : { status: 'native', note: 'DOM 树保留并由 WXML/WXSS 展示' })

const cssRows = rowsFor(bcd.css.properties, name => cssStripped.has(name)
  ? { status: 'stripped', note: '资源或旧式执行能力被移除' }
  : { status: 'native', note: '安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响' })

const selectorRows = rowsFor(bcd.css.selectors, name => selectorEngine.has(name)
  ? { status: 'engine', note: '本地选择器引擎匹配' }
  : /(?:hover|active|focus|visited|target)/.test(name) ? { status: 'degraded', note: '无浏览器交互状态，整条规则不误匹配' }
    : { status: 'gap', note: '当前选择器引擎未声明支持' })

const atRuleRows = rowsFor(bcd.css['at-rules'], name => ['media', 'supports', 'keyframes'].includes(name)
  ? { status: 'engine', note: '静态展开或固化最终帧' }
  : ['import', 'font-face', 'charset'].includes(name) ? { status: 'stripped', note: '离线与安全边界下移除' }
    : { status: 'gap', note: '当前未解释' })

const apiRows = rowsFor(bcd.api, name => apiShimmed.has(name)
  ? { status: 'shim', note: '隔离运行时提供受控实现' }
  : apiDegraded.has(name) ? { status: 'degraded', note: '提供稳定只读、离线或 noop 语义' }
    : { status: 'gap', note: '未注入脚本沙盒' })

const sections = [
  ['HTML 元素', htmlRows], ['CSS 属性', cssRows], ['CSS 选择器', selectorRows], ['CSS @ 规则', atRuleRows], ['Web API 接口', apiRows]
]

function summary (rows) {
  const counts = new Map()
  rows.forEach(row => counts.set(row.status, (counts.get(row.status) || 0) + 1))
  return Array.from(counts).sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => `${name} ${count}`).join('；')
}

const lines = [
  '# 阅读器兼容性清单', '',
  `数据源：\`@mdn/browser-compat-data ${bcd.__meta.version}\`；仅列出 BCD 中声明当前 Chrome 可用的顶层能力。`, '',
  '状态不是“完整浏览器兼容”承诺：`native` 表示安全转换后交给微信渲染层，`engine/shim/mapped` 表示阅读器有明确实现，`degraded/hidden/stripped/blocked` 表示有意降级或隔离，`gap` 表示尚未实现。', '',
  '| 类别 | 条目数 | 状态汇总 |', '|---|---:|---|',
  ...sections.map(([title, rows]) => `| ${title} | ${rows.length} | ${summary(rows)} |`), ''
]

for (const [title, rows] of sections) {
  lines.push(`## ${title}`, '', '| 能力 | 状态 | 说明 |', '|---|---|---|')
  rows.forEach(row => lines.push(`| \`${row.name}\` | ${row.status} | ${row.note} |`))
  lines.push('')
}

fs.writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`)
console.log(`generated ${path.relative(projectRoot, outputPath)} (${sections.reduce((sum, [, rows]) => sum + rows.length, 0)} entries)`)
