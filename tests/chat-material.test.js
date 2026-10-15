'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function loadApp () {
  let definition
  global.App = app => { definition = app }
  const appPath = require.resolve('../miniprogram/app')
  delete require.cache[appPath]
  require(appPath)
  return {
    ...definition,
    globalData: structuredClone(definition.globalData)
  }
}

test('app.json 声明微信官方全部聊天素材大类入口', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram/app.json'), 'utf8'))
  const types = config.supportedMaterials.map(item => item.materialType)

  assert.deepEqual(types, ['video/*', 'audio/*', 'image/*', 'text/html', 'text/plain', 'text/markdown', 'application/postscript', 'application/x-photoshop', 'application/*'])
  assert.equal(config.supportedMaterials.every(item => item.name.includes('${nickname}') && item.path === 'pages/index/index'), true)
  assert.equal(config.pages[0], 'pages/home/home')
})

test('场景 1173 会保存微信传入的 HTML 文件供首页直接打开', () => {
  const app = loadApp()

  app.onShow({
    scene: 1173,
    forwardMaterials: [{
      type: 'text/html',
      name: 'shared.html',
      path: '/tmp/shared.html',
      size: 1024
    }]
  })

  assert.deepEqual(app.globalData.pendingMaterial, {
    type: 'text/html',
    name: 'shared.html',
    path: '/tmp/shared.html',
    size: 1024
  })
  assert.equal(app.globalData.fileQueue.length, 1)
  assert.equal(app.globalData.fileQueueIndex, 0)
})

test('普通启动不会触发自动打开，application 通配素材会进入检查器', () => {
  const app = loadApp()

  app.onShow({ scene: 1001, forwardMaterials: [{ type: 'text/html', name: 'ignored.html', path: '/tmp/ignored.html' }] })
  assert.equal(app.globalData.pendingMaterial, null)

  app.onShow({ scene: 1173, forwardMaterials: [{ type: 'application/zip', name: 'archive.zip', path: '/tmp/archive.zip' }] })
  assert.equal(app.globalData.pendingMaterial.name, 'archive.zip')
})

test('官方 26 个 MIME 类别都能由场景 1173 接收', () => {
  const officialTypes = [
    'video/*', 'audio/*', 'image/*', 'text/html', 'text/plain', 'text/markdown', 'application/*',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/vnd.rar', 'application/x-7z-compressed', 'application/x-photoshop',
    'application/acad', 'application/x-cdr', 'application/dxf', 'application/step', 'application/rtf', 'application/postscript'
  ]
  for (const [index, type] of officialTypes.entries()) {
    const app = loadApp()
    const concreteType = type.endsWith('/*') ? type.replace('*', index === 0 ? 'mp4' : index === 1 ? 'mpeg' : index === 2 ? 'png' : 'octet-stream') : type
    app.onShow({ scene: 1173, forwardMaterials: [{ type: concreteType, name: `material-${index}`, path: `/tmp/material-${index}` }] })
    assert.equal(app.globalData.pendingMaterial && app.globalData.pendingMaterial.name, `material-${index}`, type)
  }
})

test('场景 1173 会接收 AI 和 PSD 设计文件', () => {
  const app = loadApp()

  app.onShow({ scene: 1173, forwardMaterials: [{ type: 'application/x-photoshop', name: 'design.psd', path: '/tmp/design.psd', size: 2048 }] })
  assert.equal(app.globalData.pendingMaterial.name, 'design.psd')

  app.onShow({ scene: 1173, forwardMaterials: [{ type: 'application/postscript', name: 'vector.ai', path: '/tmp/vector.ai', size: 4096 }] })
  assert.equal(app.globalData.pendingMaterial.name, 'vector.ai')
})

test('场景 1173 会把 SVG 聊天素材直接交给阅读页', () => {
  const app = loadApp()

  app.onShow({ scene: 1173, forwardMaterials: [{ type: 'image/svg+xml', name: '图标.svg', path: '/tmp/icon.svg', size: 1024 }] })

  assert.equal(app.globalData.pendingMaterial.name, '图标.svg')
  assert.equal(app.globalData.pendingMaterial.type, 'image/svg+xml')

  app.onShow({ scene: 1173, forwardMaterials: [{ type: 'application/octet-stream', name: '另一图标.svg', path: '/tmp/other.svg', size: 2048 }] })
  assert.equal(app.globalData.pendingMaterial.name, '另一图标.svg')
})
