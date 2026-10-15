'use strict'

// 把 miniprogram/file-reader 整目录同步到另一个小程序的 miniprogramRoot。
// 模块不发布 npm；当前仓库是模块源码来源。目标目录写 file-reader/SOURCE.json 记录来源，
// 再次同步时先核对目标目录内容是否仍与上次记录一致，被本地改过就拒绝覆盖（--force 才覆盖）。
//
//   node scripts/sync-file-reader.js <目标 miniprogram 目录> [--force] [--dry-run]

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const MODULE_DIR = 'file-reader'
const SOURCE_FILE = 'SOURCE.json'
// skin/ 是宿主自有的皮肤（组件外观与文案）：目录指纹不含它，同步不覆盖它；目标没有时复制默认皮肤当模板。
const SKIN_DIR = 'skin'
const DEFAULT_SOURCE = path.join(projectRoot, 'miniprogram', MODULE_DIR)

function isSkinPath (relative) {
  return relative === SKIN_DIR || relative.startsWith(`${SKIN_DIR}/`)
}

function listFiles (root, relative = '') {
  const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    if (isSkinPath(next)) continue
    if (entry.isDirectory()) files.push(...listFiles(root, next))
    else if (entry.isFile() && next !== SOURCE_FILE) files.push(next)
  }
  return files
}

// 目录指纹：相对路径 + 内容，按路径排序；不含 SOURCE.json 自身，所以同步前后可比。
function treeDigest (root) {
  const hash = crypto.createHash('sha256')
  const files = listFiles(root)
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(root, file)))
    hash.update('\0')
  }
  return { sha256: hash.digest('hex'), files: files.length }
}

function gitInfo (root) {
  const run = args => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() } catch (_) { return '' }
  }
  const status = run(['status', '--porcelain', '--', path.join('miniprogram', MODULE_DIR)])
  return {
    commit: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: Boolean(status)
  }
}

function readSourceRecord (targetModule) {
  const file = path.join(targetModule, SOURCE_FILE)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { return null }
}

function syncFileReader ({ source = DEFAULT_SOURCE, targetRoot, force = false, dryRun = false, now = () => new Date() } = {}) {
  if (!targetRoot) throw new Error('缺少目标 miniprogram 目录')
  const target = path.resolve(targetRoot)
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`目标目录不存在：${target}`)
  if (!fs.existsSync(path.join(target, 'app.json'))) throw new Error(`目标目录不是小程序 miniprogramRoot（缺少 app.json）：${target}`)
  if (!fs.existsSync(source)) throw new Error(`来源目录不存在：${source}`)

  const targetModule = path.join(target, MODULE_DIR)
  const sourceDigest = treeDigest(source)
  let previous = null
  if (fs.existsSync(targetModule)) {
    previous = readSourceRecord(targetModule)
    const current = treeDigest(targetModule)
    if (!force) {
      if (!previous) throw new Error(`目标 ${MODULE_DIR}/ 已存在但没有 ${SOURCE_FILE}，无法确认它没有本地改动；确认要覆盖请加 --force`)
      if (previous.treeSha256 !== current.sha256) throw new Error(`目标 ${MODULE_DIR}/ 在上次同步（${previous.sourceCommit || '未知 commit'}）之后被本地修改过，拒绝覆盖；请先把改动合回 html-reader，或加 --force 丢弃`)
    }
    if (current.sha256 === sourceDigest.sha256 && previous && previous.treeSha256 === current.sha256) {
      return { changed: false, target: targetModule, treeSha256: sourceDigest.sha256, files: sourceDigest.files, previous }
    }
  }

  const git = gitInfo(projectRoot)
  const record = {
    sourceRepo: 'https://github.com/SiliconYahaha/agent-rabbit-reader-dsh',
    sourcePath: `miniprogram/${MODULE_DIR}`,
    sourceCommit: git.commit,
    sourceBranch: git.branch,
    sourceDirty: git.dirty,
    syncedAt: now().toISOString(),
    treeSha256: sourceDigest.sha256,
    files: sourceDigest.files
  }
  if (dryRun) return { changed: true, dryRun: true, target: targetModule, ...record, previous }

  const staging = `${targetModule}.sync-${process.pid}`
  fs.rmSync(staging, { recursive: true, force: true })
  const sourceSkin = path.join(source, SKIN_DIR)
  fs.cpSync(source, staging, { recursive: true, filter: file => path.basename(file) !== SOURCE_FILE && !(file === sourceSkin || file.startsWith(`${sourceSkin}${path.sep}`)) })
  // 皮肤属于宿主：已有的保留原样；没有时把默认皮肤复制过去当起点
  const existingSkin = path.join(targetModule, SKIN_DIR)
  let skin = 'kept'
  if (fs.existsSync(existingSkin)) fs.cpSync(existingSkin, path.join(staging, SKIN_DIR), { recursive: true })
  else if (fs.existsSync(sourceSkin)) { fs.cpSync(sourceSkin, path.join(staging, SKIN_DIR), { recursive: true }); skin = 'seeded' }
  else skin = 'missing'
  record.skin = skin === 'kept' ? 'host-owned（未覆盖）' : skin === 'seeded' ? 'host-owned（首次同步复制了默认皮肤）' : 'missing'
  fs.writeFileSync(path.join(staging, SOURCE_FILE), JSON.stringify(record, null, 2) + '\n')
  fs.rmSync(targetModule, { recursive: true, force: true })
  fs.renameSync(staging, targetModule)
  const written = treeDigest(targetModule)
  if (written.sha256 !== sourceDigest.sha256) throw new Error('同步后目录指纹与来源不一致')
  return { changed: true, target: targetModule, ...record, previous }
}

function main (argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter(arg => arg.startsWith('--')))
  const targetRoot = argv.find(arg => !arg.startsWith('--'))
  const result = syncFileReader({ targetRoot, force: flags.has('--force'), dryRun: flags.has('--dry-run') })
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) main()

module.exports = { MODULE_DIR, SOURCE_FILE, listFiles, syncFileReader, treeDigest }
