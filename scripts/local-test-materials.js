'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const projectRoot = path.resolve(__dirname, '..')

function testMaterialRoot (explicit) {
  if (explicit || process.env.HTML_READER_TEST_FILES) return path.resolve(explicit || process.env.HTML_READER_TEST_FILES)
  const local = path.join(projectRoot, 'test-materials', 'files')
  if (fs.existsSync(local)) return local
  // Worktrees share the canonical checkout's private originals, not copies.
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (path.basename(common) === '.git') {
      const shared = path.join(path.dirname(common), 'test-materials', 'files')
      if (fs.existsSync(shared)) return shared
    }
  } catch {}
  return path.join(os.homedir(), 'Downloads', '测试文件')
}

function findTestMaterial (name, legacyPath) {
  const root = testMaterialRoot()
  const direct = path.join(root, name)
  if (fs.existsSync(direct)) return direct
  const matches = []
  function visit (directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && entry.name === name) matches.push(target)
    }
  }
  visit(root)
  if (matches.length > 1) throw Error(`测试原件 ${name} 有多个版本，请通过脚本参数指定文件`)
  return matches[0] || legacyPath || direct
}

module.exports = { testMaterialRoot, findTestMaterial }
