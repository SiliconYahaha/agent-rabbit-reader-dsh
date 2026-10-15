'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { OUTPUT, collect, render, verify } = require('../scripts/gen-skin-messages')
const skinCopy = require('../miniprogram/file-reader/skin/copy')

test('引擎里每一处用户可见文案都经 skinCopy.message，code 哈希与默认文案一致，清单与源码同步', () => {
  const rows = collect()
  assert.ok(rows.length >= 150, `文案位置过少：${rows.length}`)
  assert.deepEqual(verify(rows), [])
  assert.equal(fs.readFileSync(OUTPUT, 'utf8'), render(rows), 'MESSAGES.md 过期：npm run generate:skin-messages')
  // 引擎源码里不允许再出现未经 message() 的中文错误/状态字面量
  for (const file of ['miniprogram/file-reader/engine/components/reader/reader.js', 'miniprogram/file-reader/engine/components/design-preview/design-preview.js']) {
    const source = fs.readFileSync(file, 'utf8')
    const stray = source.split('\n').filter(line => /(stopLoadingWithError\(|error: |nativeStatus: |mediaDiagnostic: |inspectorPasswordStatus: |message: )(`|')[^`']*[一-鿿]/.test(line) && !line.includes('skinCopy.message('))
    assert.deepEqual(stray, [], `${file} 里还有未经皮肤的文案`)
  }
})

test('默认皮肤原样返回默认文案；字符串覆盖按 {参数} 插值，函数覆盖拿到 params 与默认文案', () => {
  assert.equal(skinCopy.message('reader.x.error.000000', { detail: 'boom' }, `失败：boom`), '失败：boom')
  skinCopy.MESSAGES['reader.x.error.000000'] = '打不开（{detail}）'
  assert.equal(skinCopy.message('reader.x.error.000000', { detail: 'boom' }, '失败：boom'), '打不开（boom）')
  skinCopy.MESSAGES['reader.x.error.000000'] = (params, fallback) => `${fallback}｜${params.detail}`
  assert.equal(skinCopy.message('reader.x.error.000000', { detail: 'boom' }, '失败：boom'), '失败：boom｜boom')
  delete skinCopy.MESSAGES['reader.x.error.000000']
})

test('精简文案覆盖有效状态码，并保留文件名、诊断与限制等动态信息', () => {
  const rows = new Map(collect().map(row => [row.code, row]))
  for (const [code, override] of Object.entries(skinCopy.MESSAGES)) {
    const source = rows.get(code)
    assert.ok(source, `文案覆盖已过期：${code}`)
    const params = Object.fromEntries(source.params.map(name => [name, `__${name}__`]))
    const result = skinCopy.message(code, params, source.text)
    for (const name of source.params) assert.ok(result.includes(params[name]), `${code} 丢失参数 ${name}`)
    assert.ok(typeof override === 'string' || typeof override === 'function')
  }
  assert.match(skinCopy.message('inspector.inspectDwg.summary.edeac1'), /暂不支持 DWG 图纸/)
  assert.match(skinCopy.message('reader.dispatchSelectedFile.error.5acbff'), /20 MB/)
  assert.match(skinCopy.message('reader.inspectLocalFile.summary.01ef2b'), /80 MB/)
})
