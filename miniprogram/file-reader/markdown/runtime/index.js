'use strict'

// Markdown 分包入口：marked + front-matter/TeX/脚注/定义列表/diff/Mermaid 扩展。
// 与 7z 内核一样按需加载（reader 组件 require.async），不占主包额度。
const { parseFrontMatter, renderMarkdownDocument } = require('./markdown-document')
const { formatFormulaBlock, formatFormulaText } = require('./tex-text')
const { detectDiagramType, mermaidSvgDataUri, renderMermaid } = require('./mermaid-lite')

module.exports = { detectDiagramType, formatFormulaBlock, formatFormulaText, mermaidSvgDataUri, parseFrontMatter, renderMarkdownDocument, renderMermaid }
