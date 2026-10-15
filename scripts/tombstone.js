'use strict'

// 墓碑观察埋点：脚本进入时打印提示并把调用记录追加到 outputs/tombstones/<name>.jsonl。
// 不改变脚本行为；观察期与去留规则见 docs/dead-code-patterns.md。
const fs = require('node:fs')
const path = require('node:path')

function tombstone (name, since, reason) {
  const directory = path.resolve(__dirname, '..', 'outputs', 'tombstones')
  const message = `[tombstone] ${name} 自 ${since} 观察中：${reason}`
  process.stderr.write(`${message}\n`)
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(path.join(directory, `${name}.jsonl`), JSON.stringify({ name, at: new Date().toISOString(), argv: process.argv.slice(2) }) + '\n')
  } catch (_) {
    // 记录失败不影响脚本本身
  }
  return message
}

module.exports = { tombstone }
