'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.aac', '.m4a'])
const MAX_RECOMMENDED_MEDIA_SIZE = 200 * 1024

function walk (directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && ['.git', 'node_modules'].includes(entry.name)) return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

test('小程序包内图片和音频资源均不超过微信工具建议的 200 KB', () => {
  const root = path.join(__dirname, '..', 'miniprogram')
  const oversized = walk(root)
    .filter(file => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map(file => ({ file: path.relative(root, file), size: fs.statSync(file).size }))
    .filter(item => item.size > MAX_RECOMMENDED_MEDIA_SIZE)

  assert.deepEqual(oversized, [])
})

test('内置示例生成脚本在根目录源样本缺失时仍可安全验收', () => {
  const script = require('../scripts/generate-sample')
  const root = path.join(__dirname, '..')
  const result = script.generateSample(
    path.join(root, '__missing-html-sample__.html'),
    path.join(root, 'miniprogram/data/sample-html.js')
  )

  assert.equal(result.generated, false)
  assert.equal(typeof result.html, 'string')
  assert.equal(result.html.length > 10000, true)
})

test('固定深度 DOM 模板可确定性生成 21 层并带稳定 nid key', () => {
  const generator = require('../scripts/gen-dom-tree-wxml')
  const output = generator.generate(path.join(__dirname, '..', 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml'))

  assert.equal(generator.DEPTH, 20)
  assert.match(output, /template name="dn0"/)
  assert.match(output, /template name="dn20"/)
  assert.match(output, /wx:key="nid"/)
  assert.match(output, /bindtouchmove="onDomTouchMove"/)
  assert.match(output, /wx:if="\{\{n\.touch\}\}"[^>]*bindtouchstart="onDomTouchStart"/)
  assert.match(output, /wx:else[^>]*data-nid="\{\{n\.nid\}\}"[^>]*catchtap="onDomTap"/)
  assert.match(output, /n\.type === 'text' && n\.tapNid !== undefined[^>]*data-nid="\{\{n\.tapNid\}\}"[^>]*catchtap="onDomTap"/)
  assert.match(output, /<checkbox-group\b/)
  assert.match(output, /<radio-group\b/)
  assert.match(output, /mode="date"/)
  assert.match(output, /mode="time"/)
  assert.match(output, /maxlength="\{\{n\.attrs\.maxlength !== undefined \? n\.attrs\.maxlength : -1\}\}"/)
  assert.match(output, /class="dom-canvas-box"/)
  assert.equal(/selectable decode/.test(output), false)
  assert.equal(/data-touch="\{\{n\.touch\}\}"[^>]*data-touch="\{\{n\.touch\}\}"/.test(output), false)
})

test('Sval vendored 运行时使用空白全局并封锁原型逃逸属性', () => {
  const vendor = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/file-reader/document/html-runtime/vendor/sval.js'), 'utf8')

  assert.match(vendor, /function Tr\(\)\{return Ce\(\{\[De\]:h\}\)\}/)
  assert.match(vendor, /HTML Reader blocked unsafe property access/)
  assert.doesNotMatch(vendor, /function Tr\(\)\{return j\(Ce\(\{\[De\]:h\}\),Xt\)\}/)
})

test('PSD JPEG 编码器不依赖微信不存在的 Node Buffer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/file-reader/engine/core/vendor/jpeg-encoder.js'), 'utf8')
  const context = { module: { exports: {} }, Uint8Array, Array, Math, Date, console }
  vm.runInNewContext(source, context)
  const encoded = context.module.exports({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 }, 82)

  assert.doesNotMatch(source, /\bBuffer\.(?:from|alloc)\b/)
  assert.equal(Object.prototype.toString.call(encoded.data), '[object Uint8Array]')
  assert.deepEqual(Array.from(encoded.data.slice(0, 2)), [0xff, 0xd8])
})
