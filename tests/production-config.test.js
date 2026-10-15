'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {
  assertLocalOnlySources,
  requiredMaterialTypes,
  validateProductionPackage,
  validateSupportedMaterials
} = require('../scripts/check-production-config')

test('正式包配置覆盖聊天素材、分享入口并保持纯本地', () => {
  const result = validateProductionPackage(path.resolve(__dirname, '..'))
  assert.deepEqual(result.supportedMaterials, requiredMaterialTypes)
  assert.equal(result.localOnly, true)
  assert.equal(result.shareEntry, true)
  assert.ok(result.inspectedFiles > 20)
  assert.ok(result.mainPackageBytes > 0 && result.mainPackageBytes < 2 * 1024 * 1024)
  assert.ok(result.subPackageBytes['file-reader/sevenzip'] > 500 * 1024)
  assert.ok(result.subPackageBytes['file-reader/sevenzip'] < 2 * 1024 * 1024)
})

test('聊天素材声明必须符合微信名称、描述和入口限制', () => {
  assert.throws(() => validateSupportedMaterials({ supportedMaterials: [] }), /缺少 video\/\*/)
  assert.throws(() => validateSupportedMaterials({ supportedMaterials: requiredMaterialTypes.map(materialType => ({
    materialType,
    name: '直接打开',
    desc: '描述',
    path: 'pages/index/index'
  })) }), /必须包含/)
})

test('兼容清单在 docs 生成且内容不变，不随小程序运行包上传', () => {
  const fs = require('node:fs')
  const root = path.resolve(__dirname, '..')
  const before = fs.readFileSync(path.join(root, 'docs/reader-coverage.md'))
  const result = require('node:child_process').spawnSync(process.execPath, ['scripts/gen-reader-coverage.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readFileSync(path.join(root, 'docs/reader-coverage.md')), before)
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/file-reader/document/html-runtime/COVERAGE.md')), false)
})

test('正式小程序包拒绝重新引入上传、web-view 或远端高保真配置', () => {
  assert.throws(() => assertLocalOnlySources({ 'page.js': 'wx.uploadFile({})' }), /wx\.uploadFile/)
  assert.throws(() => assertLocalOnlySources({ 'page.wxml': '<web-view src="{{url}}" />' }), /web-view/)
  assert.throws(() => assertLocalOnlySources({ 'config.js': 'const PRODUCTION_URL = "https://example.com"' }), /PRODUCTION_URL/)
  assert.doesNotThrow(() => assertLocalOnlySources({ 'page.js': 'wx.getFileSystemManager()' }))
})

test('正式包拦截微信不能加载的 JSON require，但允许 JS 数据模块', () => {
  for (const source of ["require('./colors.json')", 'require ( "./colors.json" )']) {
    assert.throws(() => assertLocalOnlySources({ 'utils/colors.js': source }), /JSON require/)
  }
  assert.doesNotThrow(() => assertLocalOnlySources({ 'utils/colors.js': "require('./css-color-names')" }))
})
