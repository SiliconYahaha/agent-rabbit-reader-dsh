'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { SOURCE_FILE, syncFileReader, treeDigest } = require('../scripts/sync-file-reader')

function makeSource (root) {
  const source = path.join(root, 'source')
  fs.mkdirSync(path.join(source, 'core'), { recursive: true })
  fs.writeFileSync(path.join(source, 'index.js'), "module.exports = 1\n")
  fs.writeFileSync(path.join(source, 'core', 'a.js'), "module.exports = 'a'\n")
  return source
}

function makeTarget (root) {
  const target = path.join(root, 'miniapp')
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'app.json'), '{"pages":[]}')
  return target
}

test('首次同步复制整目录并写入 SOURCE.json，指纹与来源一致', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-reader-sync-'))
  const source = makeSource(root)
  const target = makeTarget(root)
  const result = syncFileReader({ source, targetRoot: target, now: () => new Date('2026-09-02T00:00:00Z') })
  assert.equal(result.changed, true)
  const record = JSON.parse(fs.readFileSync(path.join(target, 'file-reader', SOURCE_FILE), 'utf8'))
  assert.equal(record.treeSha256, treeDigest(source).sha256)
  assert.equal(record.syncedAt, '2026-09-02T00:00:00.000Z')
  assert.equal(record.files, 2)
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'core', 'a.js'), 'utf8'), "module.exports = 'a'\n")
  assert.equal(syncFileReader({ source, targetRoot: target }).changed, false)
})

test('目标被本地修改后拒绝覆盖，--force 才覆盖；没有 SOURCE.json 也拒绝', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-reader-sync-'))
  const source = makeSource(root)
  const target = makeTarget(root)
  syncFileReader({ source, targetRoot: target })
  fs.writeFileSync(path.join(target, 'file-reader', 'core', 'a.js'), 'local change\n')
  assert.throws(() => syncFileReader({ source, targetRoot: target }), /被本地修改过/)
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'core', 'a.js'), 'utf8'), 'local change\n')
  const forced = syncFileReader({ source, targetRoot: target, force: true })
  assert.equal(forced.changed, true)
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'core', 'a.js'), 'utf8'), "module.exports = 'a'\n")

  fs.rmSync(path.join(target, 'file-reader', SOURCE_FILE))
  assert.throws(() => syncFileReader({ source, targetRoot: target }), /没有 SOURCE\.json/)
})

test('来源更新后再次同步会替换目标内容并删除来源已不存在的文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-reader-sync-'))
  const source = makeSource(root)
  const target = makeTarget(root)
  syncFileReader({ source, targetRoot: target })
  fs.writeFileSync(path.join(source, 'core', 'b.js'), 'new\n')
  fs.rmSync(path.join(source, 'core', 'a.js'))
  const result = syncFileReader({ source, targetRoot: target })
  assert.equal(result.changed, true)
  assert.equal(fs.existsSync(path.join(target, 'file-reader', 'core', 'a.js')), false)
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'core', 'b.js'), 'utf8'), 'new\n')
  assert.equal(treeDigest(path.join(target, 'file-reader')).sha256, treeDigest(source).sha256)
})

test('目标不是 miniprogramRoot 时直接报错，不创建任何文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-reader-sync-'))
  const source = makeSource(root)
  const target = path.join(root, 'not-miniapp')
  fs.mkdirSync(target)
  assert.throws(() => syncFileReader({ source, targetRoot: target }), /app\.json/)
  assert.equal(fs.existsSync(path.join(target, 'file-reader')), false)
})

test('skin/ 属于宿主：首次同步复制默认皮肤，之后同步不覆盖也不参与指纹', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-reader-sync-'))
  const source = makeSource(root)
  const target = makeTarget(root)
  fs.mkdirSync(path.join(source, 'skin', 'status'), { recursive: true })
  fs.writeFileSync(path.join(source, 'skin', 'status', 'status.wxss'), 'default\n')
  const first = syncFileReader({ source, targetRoot: target })
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'skin', 'status', 'status.wxss'), 'utf8'), 'default\n')
  assert.match(first.skin, /首次同步/)
  fs.writeFileSync(path.join(target, 'file-reader', 'skin', 'status', 'status.wxss'), 'host style\n')
  fs.writeFileSync(path.join(source, 'skin', 'status', 'status.wxss'), 'default v2\n')
  fs.writeFileSync(path.join(source, 'core', 'a.js'), "module.exports = 'a2'\n")
  const second = syncFileReader({ source, targetRoot: target })
  assert.equal(second.changed, true, '宿主改皮肤不算本地改动，核心更新照常同步')
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'skin', 'status', 'status.wxss'), 'utf8'), 'host style\n')
  assert.equal(fs.readFileSync(path.join(target, 'file-reader', 'core', 'a.js'), 'utf8'), "module.exports = 'a2'\n")
  assert.match(second.skin, /未覆盖/)
})
