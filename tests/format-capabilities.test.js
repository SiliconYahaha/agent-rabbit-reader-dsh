'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { FORMAT_CAPABILITIES, capabilityAudit } = require('../miniprogram/file-reader/shared/format-capabilities')
const { SUPPORTED_EXTENSIONS } = require('../miniprogram/file-reader/shared/file-types')

test('74 个声明格式逐一登记用户可见结果和真实限制', () => {
  const audit = capabilityAudit()
  assert.deepEqual(audit.missing, [])
  assert.deepEqual(audit.extra, [])
  assert.deepEqual(audit.invalidModes, [])
  assert.deepEqual(audit.invalidLevels, [])
  assert.equal(Object.keys(FORMAT_CAPABILITIES).length, SUPPORTED_EXTENSIONS.length)
  for (const extension of SUPPORTED_EXTENSIONS) {
    const item = FORMAT_CAPABILITIES[extension]
    assert.ok(item.level, `${extension} 缺少内容等级`)
    assert.ok(item.visibleResult, `${extension} 缺少用户实际看到的结果`)
    assert.ok(item.evidence, `${extension} 缺少验收证据`)
    assert.ok(item.outcome, `${extension} 缺少用户结果`)
    assert.ok(item.limitations, `${extension} 缺少限制说明`)
    if (item.mode === 'identity-only' || item.mode === 'structure-preview') assert.equal(item.contentReady, false, `${extension} 不能把识别或结构检查写成正文已可读`)
  }
})

test('内容等级覆盖 74 个扩展名，并只把 DWG 列为内容未支持', () => {
  const counts = Object.values(FORMAT_CAPABILITIES).reduce((result, item) => {
    result[item.level] = (result[item.level] || 0) + 1
    return result
  }, {})
  assert.deepEqual(counts, {
    'full-content': 27,
    'wechat-native': 14,
    'conditional-content': 28,
    'partial-content': 4,
    'unsupported-content': 1
  })

  const audit = capabilityAudit()
  assert.deepEqual(audit.unsupportedContent, ['dwg'])
  assert.deepEqual(audit.partialContent.sort(), ['cdr', 'dxf', 'step', 'stp'])
  for (const extension of ['ai', 'psd', 'psb', 'zip', 'rar', '7z', 'tar', 'mp3', 'mp4']) assert.ok(audit.conditionalContent.includes(extension), `${extension} 应明确为条件内容`)
  for (const extension of ['html', 'txt', 'md', 'rtf', 'pdf', 'png']) assert.equal(audit.unsupportedContent.includes(extension), false, `${extension} 已有正文或原生预览链`)
})

test('DWG 不会把版本识别或文件内缩略图宣传成图纸内容支持', () => {
  const dwg = FORMAT_CAPABILITIES.dwg
  assert.equal(dwg.contentReady, false)
  assert.equal(dwg.level, 'unsupported-content')
  assert.match(dwg.outcome, /仅显示 DWG 保存版本/)
  assert.match(dwg.outcome, /不是图纸预览/)
  assert.match(dwg.limitations, /不支持 DWG 几何内容/)
  assert.match(dwg.limitations, /另存为 DXF/)
})

test('公开审计表逐一列出全部 74 个扩展名和五级合计', () => {
  const auditDoc = fs.readFileSync(path.join(__dirname, '../docs/format-capability-audit.md'), 'utf8')
  for (const extension of SUPPORTED_EXTENSIONS) assert.match(auditDoc, new RegExp('`' + extension + '`'), `${extension} 未出现在公开审计表`)
  assert.match(auditDoc, /27 \+ 14 \+ 28 \+ 4 \+ 1 = 74/)
  assert.match(auditDoc, /唯一明确属于“内容未支持”的扩展名是 \*\*DWG\*\*/)
})
