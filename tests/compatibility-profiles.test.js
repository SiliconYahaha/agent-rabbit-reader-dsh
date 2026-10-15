'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const profileRoot = path.join(__dirname, '../compatibility/profiles')

test('细粒度格式档案记录用户可见结果、标准答案、平台和永续变异队列', () => {
  const files = fs.readdirSync(profileRoot).filter(name => name.endsWith('.json')).sort()
  assert.ok(files.length > 0, '至少建立一个可执行的细粒度格式档案')
  for (const file of files) {
    const profile = JSON.parse(fs.readFileSync(path.join(profileRoot, file), 'utf8'))
    assert.equal(profile.schemaVersion, 1, `${file} schemaVersion`)
    assert.ok(profile.format, `${file} format`)
    assert.ok(profile.userShouldSee, `${file} 缺少用户应该看到什么`)
    assert.ok(profile.currentVisibleResult, `${file} 缺少当前实际显示`)
    assert.ok(profile.oracles.length >= 2, `${file} 至少需要两个标准答案来源`)
    assert.ok(profile.capabilities.length >= 3, `${file} 不能把整个格式只写成一个测试项`)
    for (const capability of profile.capabilities) {
      assert.ok(capability.id, `${file} capability id`)
      assert.ok(capability.expectedVisibleResult, `${file}/${capability.id} 缺少用户可见结果`)
      assert.ok(['pass', 'pending', 'blocked'].includes(capability.status), `${file}/${capability.id} 状态非法`)
      assert.ok(capability.axis && Object.keys(capability.axis).length >= 4, `${file}/${capability.id} 维度不足`)
      if (capability.status === 'pass') assert.ok(capability.evidence.length > 0, `${file}/${capability.id} 通过但没有证据`)
    }
    for (const sample of profile.publicSamples || []) {
      assert.match(sample.source, /^https:\/\//, `${file}/${sample.name} 缺少来源`)
      assert.ok(sample.license, `${file}/${sample.name} 缺少许可证结论`)
      assert.match(sample.sha256, /^[a-f0-9]{64}$/, `${file}/${sample.name} 缺少 SHA-256`)
      assert.ok(sample.expectedVisibleResult.length > 0, `${file}/${sample.name} 缺少标准结果`)
      if (sample.license.startsWith('unknown')) assert.equal(sample.redistributed, false, `${file}/${sample.name} 许可未知时不能提交二进制`)
    }
    assert.ok(profile.mutationQueue.some(item => item.status === 'pending'), `${file} 修复后必须继续派生下一批问题`)
  }
})
