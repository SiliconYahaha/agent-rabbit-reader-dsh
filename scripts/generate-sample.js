'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'html-css-js-local-test.html')
const target = path.join(root, 'miniprogram/data/sample-html.js')

function bundledSample (targetPath) {
  if (!fs.existsSync(targetPath)) throw new Error(`缺少 HTML 源样本和内置样本：${targetPath}`)
  delete require.cache[require.resolve(targetPath)]
  const html = require(targetPath)
  if (typeof html !== 'string' || !html.trim()) throw new Error(`内置 HTML 样本无效：${targetPath}`)
  return html
}

function generateSample (sourcePath = source, targetPath = target) {
  if (!fs.existsSync(sourcePath)) {
    const html = bundledSample(targetPath)
    console.log(`根目录源样本不存在，已验证现有内置样本：${Buffer.byteLength(html)} bytes`)
    return { generated: false, html }
  }

  const html = fs.readFileSync(sourcePath, 'utf8')
  const output = [
    "'use strict'",
    '',
    '// 由 npm run generate:sample 从根目录 HTML 样本生成，请勿手工编辑。',
    `module.exports = ${JSON.stringify(html)}`,
    ''
  ].join('\n')

  fs.writeFileSync(targetPath, output)
  console.log(`已生成内置样本：${Buffer.byteLength(html)} bytes`)
  return { generated: true, html }
}

if (require.main === module) generateSample()

module.exports = { bundledSample, generateSample }
