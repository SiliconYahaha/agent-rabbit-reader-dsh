'use strict'

// 生成 miniprogram/file-reader/MESSAGES.md：引擎里所有经 skinCopy.message() 的用户可见文案清单
// （code | 默认文案 | 参数 | 位置）。宿主照着 code 在 skin/copy.js 的 MESSAGES 里覆盖。
// tests/skin-messages.test.js 断言清单与源码一致、code 的哈希与默认文案一致。
const fs = require('node:fs')
const path = require('node:path')
const { ENGINE_FILES, hash6, readLiteral, splitTemplate } = require('./skin-message-sites')

const root = path.resolve(__dirname, '..')
const OUTPUT = path.join(root, 'miniprogram/file-reader/MESSAGES.md')

function collect () {
  const rows = []
  const marker = "skinCopy.message('"
  for (const file of ENGINE_FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      let from = 0
      while (true) {
        const at = line.indexOf(marker, from)
        if (at < 0) break
        const codeStart = at + marker.length
        const codeEnd = line.indexOf("'", codeStart)
        const code = line.slice(codeStart, codeEnd)
        // 参数对象：从 { 到配对的 }
        let cursor = codeEnd + 1
        while (line[cursor] !== '{') cursor++
        let depth = 0; let paramsEnd = cursor
        for (let i = cursor; i < line.length; i++) {
          const quote = line[i]
          if (quote === "'" || quote === '"' || quote === '`') { const end = readLiteral(line, i); if (end > i) { i = end; continue } }
          if (line[i] === '{') depth++
          else if (line[i] === '}') { depth--; if (depth === 0) { paramsEnd = i; break } }
        }
        let literalStart = paramsEnd + 1
        while (line[literalStart] !== "'" && line[literalStart] !== '`') literalStart++
        const literalEnd = readLiteral(line, literalStart)
        const literal = line.slice(literalStart, literalEnd + 1)
        const split = literal[0] === '`' ? splitTemplate(literal) : { text: literal.slice(1, -1), expressions: [] }
        rows.push({ code, text: split.text, params: split.expressions.map(item => item.name), file: `${file.replace('miniprogram/file-reader/', '')}:${index + 1}` })
        from = literalEnd + 1
      }
    })
  }
  return rows
}

function render (rows) {
  const byCode = new Map()
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, { ...row, sites: [row.file] })
    else byCode.get(row.code).sites.push(row.file)
  }
  const sorted = Array.from(byCode.values()).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const escape = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines = [
    '# file-reader 用户可见文案清单',
    '',
    '由 `npm run generate:skin-messages` 从引擎源码生成，不要手改。引擎里每一处用户可见文案都写成',
    "`skinCopy.message('<code>', { 参数 }, '<默认文案>')`；宿主在 `skin/copy.js` 的 `MESSAGES` 里按 code 覆盖：",
    '值可以是带 `{参数}` 占位的字符串，也可以是 `(params, fallback) => string`。',
    'code = 文件.方法.类别.默认文案哈希，默认文案一改 code 就变，覆盖项需要跟着复核。',
    '',
    `共 ${sorted.length} 条。`,
    '',
    '| code | 默认文案 | 参数 | 位置 |',
    '| --- | --- | --- | --- |'
  ]
  for (const row of sorted) lines.push(`| \`${row.code}\` | ${escape(row.text)} | ${row.params.length ? row.params.map(name => `\`${name}\``).join(' ') : '—'} | ${row.sites.map(site => `\`${site}\``).join(' ')} |`)
  return lines.join('\n') + '\n'
}

function verify (rows) {
  const problems = []
  for (const row of rows) {
    const expected = row.code.split('.').pop()
    if (hash6(row.text) !== expected) problems.push(`${row.file} code ${row.code} 的哈希与默认文案不符（应为 ${hash6(row.text)}）`)
  }
  const texts = new Map()
  for (const row of rows) {
    if (texts.has(row.code) && texts.get(row.code) !== row.text) problems.push(`code ${row.code} 对应了两种默认文案`)
    texts.set(row.code, row.text)
  }
  return problems
}

function main (argv = process.argv.slice(2)) {
  const rows = collect()
  const problems = verify(rows)
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; return }
  const content = render(rows)
  if (argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
    if (current !== content) { console.error('MESSAGES.md 与源码不一致，请运行 npm run generate:skin-messages'); process.exitCode = 1; return }
    console.log(`MESSAGES.md 一致：${rows.length} 处、${new Set(rows.map(row => row.code)).size} 条`)
    return
  }
  fs.writeFileSync(OUTPUT, content)
  console.log(`已生成 ${path.relative(root, OUTPUT)}：${rows.length} 处、${new Set(rows.map(row => row.code)).size} 条`)
}

if (require.main === module) main()

module.exports = { OUTPUT, collect, render, verify }
