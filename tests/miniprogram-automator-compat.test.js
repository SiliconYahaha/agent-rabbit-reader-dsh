'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  automationCliArgs,
  automationPortForProject,
  installAutomatorVersionCompatibility,
  resolveSdkVersion
} = require('../scripts/miniprogram-automator-compat')

test('自动化启动固定使用当前项目和独立端口', () => {
  assert.deepEqual(
    automationCliArgs('/project/current', 14349),
    ['auto', '--project', '/project/current', '--auto-port', '14349', '--trust-project']
  )
})

test('不同工作树使用不同且稳定的自动化端口，避免连接旧项目', () => {
  const current = '/worktrees/html-reader/20260827-runtime-ai-fixes'
  const stale = '/worktrees/html-reader/20260824-runtime-fixes'
  assert.equal(automationPortForProject(current), automationPortForProject(current))
  assert.notEqual(automationPortForProject(current), automationPortForProject(stale))
  assert.ok(automationPortForProject(current) >= 12000)
  assert.ok(automationPortForProject(current) < 22000)
})

test('新版开发者工具未返回 SDKVersion 时仍允许协议能力验收', async () => {
  class FakeMiniProgram {
    async send () { return { version: '2.02.2608040' } }
  }

  assert.equal(installAutomatorVersionCompatibility(FakeMiniProgram), true)
  assert.equal(installAutomatorVersionCompatibility(FakeMiniProgram), false)
  await assert.doesNotReject(() => new FakeMiniProgram().checkVersion())
})

test('兼容层仍拒绝真实低版本基础库', async () => {
  class FakeMiniProgram {
    async send () { return { sdkVersion: '2.6.9' } }
  }

  installAutomatorVersionCompatibility(FakeMiniProgram)
  await assert.rejects(() => new FakeMiniProgram().checkVersion(), /requires at least version 2\.7\.3/)
})

test('兼容层识别新旧字段并忽略无效值', () => {
  assert.equal(resolveSdkVersion({ SDKVersion: '2.30.0' }), '2.30.0')
  assert.equal(resolveSdkVersion({ sdkVersion: '3.0.0' }), '3.0.0')
  assert.equal(resolveSdkVersion({ baseLibraryVersion: '3.9.10' }), '3.9.10')
  assert.equal(resolveSdkVersion({ version: '2.02.2608040' }), '')
  assert.equal(resolveSdkVersion(null), '')
})
