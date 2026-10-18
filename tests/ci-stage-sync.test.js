'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  assertManualOnlyWorkflows,
  assertStagedContent,
  assertTargetRepository,
  inspectStaged,
  pushArguments,
  pushStage,
  secretFindings,
  sensitivePath,
  workflowTriggers
} = require('../scripts/ci-stage-sync')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('工作流触发方式解析覆盖块写法与行内写法，且不把 inputs 当触发', () => {
  assert.deepEqual(workflowTriggers(read('.github/workflows/ci.yml')), ['workflow_dispatch'])
  assert.deepEqual(workflowTriggers(read('.github/workflows/wechat-upload.yml')), ['workflow_dispatch'])
  assert.deepEqual(workflowTriggers('on: [push, pull_request]\njobs: {}\n'), ['push', 'pull_request'])
  assert.deepEqual(workflowTriggers('name: x\non:\n  schedule:\n    - cron: "0 0 * * *"\n  workflow_dispatch:\n    inputs:\n      version: {}\njobs: {}\n'), ['schedule', 'workflow_dispatch'])
  assert.deepEqual(workflowTriggers('name: x\njobs: {}\n'), [])
})

test('仓库现有工作流全部手动触发，代码推送不会触发上传', () => {
  const summary = assertManualOnlyWorkflows()
  assert.deepEqual(summary.map(entry => entry.name), ['ci.yml', 'wechat-upload.yml'])
  for (const entry of summary) assert.deepEqual(entry.triggers, ['workflow_dispatch'])
  const upload = summary.find(entry => entry.name === 'wechat-upload.yml')
  assert.ok(upload, '微信上传工作流必须存在且只可手动触发')
})

test('自动触发的工作流被拒绝，避免推送代码顺带上传微信', () => {
  for (const source of [
    'name: x\non:\n  push:\n    branches: [main]\njobs: {}\n',
    'name: x\non: [pull_request]\njobs: {}\n',
    'name: x\non:\n  schedule:\n    - cron: "0 6 * * *"\njobs: {}\n'
  ]) {
    assert.throws(() => assertManualOnlyWorkflows([{ name: 'synthetic.yml', source }]), /自动触发|只能手动触发/, source)
  }
})

test('密钥扫描识别真实凭据形态，且不误判仓库既有文件', () => {
  const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')
  assert.deepEqual(secretFindings(`key: ${pem}`).map(f => f.label), ['PEM 私钥'])
  assert.deepEqual(secretFindings('token = ghp_' + 'A'.repeat(24)).map(f => f.label), ['GitHub 访问令牌'])
  assert.deepEqual(secretFindings('id: AKIA' + 'ABCDEFGHIJKLMNOP').map(f => f.label), ['AWS 访问键 ID'])
  // 工作流用 GitHub Secret 占位符，不是密钥本身；测试与文档也不含真实凭据。
  for (const file of ['.github/workflows/wechat-upload.yml', '.github/workflows/ci.yml', 'README.md', 'tests/wechat-ci.test.js', 'scripts/ci-stage-sync.js']) {
    assert.deepEqual(secretFindings(read(file)), [], file)
  }
})

test('敏感文件名一律不得进入提交，示例配置除外', () => {
  for (const file of ['.env', '.env.production', 'a.pem', 'a.key', 'a.p12', 'id_rsa', 'project.private.config.json']) {
    assert.equal(sensitivePath(file), true, file)
  }
  for (const file of ['.env.example', 'README.md', 'package.json', 'scripts/ci-stage-sync.js', 'miniprogram/app.json']) {
    assert.equal(sensitivePath(file), false, file)
  }
})

test('暂存内容校验拦截密钥与敏感文件', () => {
  const clean = { paths: ['README.md'], findings: [], sensitive: [] }
  assert.deepEqual(assertStagedContent(clean), clean)
  assert.throws(() => assertStagedContent({ ...clean, sensitive: ['a.pem'] }), /敏感文件/)
  assert.throws(() => assertStagedContent({ ...clean, findings: [{ file: 'a.js', line: 3, label: 'PEM 私钥' }] }), /疑似密钥/)
  // 当前暂存区同样不得含疑似密钥。
  assert.deepEqual(inspectStaged().findings, [])
})

test('推送默认 dry-run，只有显式 --execute 才构造真实推送', () => {
  const dryRun = pushArguments({ remote: 'origin', branch: 'main', dryRun: true })
  const execute = pushArguments({ remote: 'origin', branch: 'main', dryRun: false })
  assert.deepEqual(dryRun, ['push', 'origin', 'HEAD:refs/heads/main', '--dry-run'])
  assert.deepEqual(execute, ['push', 'origin', 'HEAD:refs/heads/main'])
  for (const args of [dryRun, execute]) {
    assert.ok(!args.includes('--tags') && !args.includes('--force') && !args.includes('-f'), args.join(' '))
    assert.ok(!args.some(arg => arg.startsWith('+')), args.join(' '))
  }
})

test('只能把 main 同步到独立仓库，分支不符在联网前就拒绝', () => {
  assert.throws(() => pushStage({ remote: 'origin', branch: 'develop', execute: true }), /只允许同步 main 分支/)
})

test('目标仓库检查拒绝外部 Git 目录与其他远程，允许独立仓库任务分支', () => {
  const facts = {
    toplevel: root, gitDir: path.join(root, '.git'), commonDir: path.join(root, '.git'),
    branch: 'codex/example', remotes: [{ name: 'origin', url: 'https://github.com/SiliconYahaha/agent-rabbit-reader-dsh.git', type: '(push)' }]
  }
  assert.equal(assertTargetRepository(facts), facts)
  assert.throws(() => assertTargetRepository({ ...facts, commonDir: path.dirname(root) }), /Git 目录越出项目/)
  assert.throws(() => assertTargetRepository({ ...facts, remotes: [{ name: 'origin', url: 'https://github.com/example/other.git' }] }), /不是本项目独立仓库/)
})
