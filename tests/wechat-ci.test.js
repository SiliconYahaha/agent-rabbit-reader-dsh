'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { execFileSync } = require('node:child_process')
const git = (...args) => execFileSync('git', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim()
const { assertReleaseTag, expectedAppId, inspectProject, pushUploadInputs, robotNumber, validatePrivateKey, validateReleaseInputs } = require('../scripts/wechat-ci-upload')

const root = path.resolve(__dirname, '..')

test('GitHub Actions 微信上传读取正式项目身份', () => {
  const project = inspectProject()
  assert.equal(project.projectRoot, root)
  assert.equal(project.appid, expectedAppId)
  assert.equal(project.version, require('../package.json').version)
  assert.equal(project.miniprogramRoot, 'miniprogram/')
})

test('上传输入必须匹配 package 版本、main 和显式确认', () => {
  const valid = {
    version: '1.3.8',
    expectedVersion: '1.3.8',
    description: '兔子阅读器 1.3.8：GitHub Actions 上传验证。',
    confirmation: 'UPLOAD',
    ref: 'refs/heads/main'
  }
  assert.doesNotThrow(() => validateReleaseInputs(valid))
  assert.throws(() => validateReleaseInputs({ ...valid, version: '1.3.7' }), /package.json/)
  assert.throws(() => validateReleaseInputs({ ...valid, confirmation: 'upload' }), /UPLOAD/)
  assert.throws(() => validateReleaseInputs({ ...valid, ref: 'refs/heads/feature' }), /只允许从 main/)
  assert.throws(() => validateReleaseInputs({ ...valid, description: 'x'.repeat(201) }), /200/)
})

test('版本标签必须与当前 main 提交完全一致', () => {
  assert.doesNotThrow(() => assertReleaseTag({ version: '1.3.8', head: 'abc', tagCommit: 'abc' }))
  assert.throws(() => assertReleaseTag({ version: '1.3.8', head: 'abc', tagCommit: 'def' }), /没有指向当前 main/)
})

test('私钥和上传机器人编号采用严格门禁', () => {
  const begin = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
  const end = ['-----END', 'PRIVATE KEY-----'].join(' ')
  const pem = `${begin}\n${'a'.repeat(128)}\n${end}`
  assert.match(validatePrivateKey(pem), /BEGIN PRIVATE KEY/)
  assert.throws(() => validatePrivateKey(''), /WECHAT_CI_PRIVATE_KEY/)
  assert.equal(robotNumber('1'), 1)
  assert.equal(robotNumber('30'), 30)
  assert.throws(() => robotNumber('0'), /1–30/)
  assert.throws(() => robotNumber('31'), /1–30/)
})

test('上传说明生成器使用当前提交和 package 版本', () => {
  const projectInfo = { version: '1.3.8' }
  const inputs = pushUploadInputs(projectInfo, { GITHUB_SHA: git('rev-parse', 'HEAD') })
  assert.equal(inputs.version, '1.3.8')
  assert.equal(inputs.confirmation, 'UPLOAD')
  assert.match(inputs.description, /^main@[0-9a-f]{7} \S/)
  assert.ok(Array.from(inputs.description).length <= 200)
  assert.doesNotThrow(() => validateReleaseInputs({ ...inputs, expectedVersion: '1.3.8', ref: 'refs/heads/main' }))
})

test('微信工作流仅可手动触发，且不把微信私钥写进仓库', () => {
  const workflowPath = path.join(root, '.github/workflows/wechat-upload.yml')
  const workflow = fs.readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\n  (?:workflow_call|push|pull_request):/)
  const checks = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.doesNotMatch(checks, /needs: test/)
  assert.doesNotMatch(checks, /uses: \.\/.github\/workflows\/wechat-upload\.yml/)
  assert.doesNotMatch(workflow, /npm run check\n|verify:chrome-oracle/)
  assert.match(workflow, /node scripts\/ci-current-main\.js/)
  assert.match(workflow, /WECHAT_CI_MODE: manual/)
  assert.match(workflow, /WECHAT_CI_PRIVATE_KEY: \$\{\{ secrets\.WECHAT_CI_PRIVATE_KEY \}\}/)
  assert.match(workflow, /WECHAT_CI_CONFIRM: \$\{\{ inputs\.confirm \}\}/)
  assert.match(workflow, /permissions:\n\s+contents: read/)
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/)
  assert.match(workflow, /npm ci --ignore-scripts --prefix tools\/wechat-ci/)
  assert.doesNotMatch(workflow, /-----BEGIN (?:RSA )?PRIVATE KEY-----/)
})

test('微信官方 CI 依赖与小程序主体依赖隔离', () => {
  const rootPackage = require('../package.json')
  const ciPackage = require('../tools/wechat-ci/package.json')
  assert.equal(rootPackage.dependencies && rootPackage.dependencies['miniprogram-ci'], undefined)
  assert.equal(rootPackage.devDependencies && rootPackage.devDependencies['miniprogram-ci'], undefined)
  assert.equal(ciPackage.dependencies['miniprogram-ci'], '2.1.31')
})

test('README 说明手动发布流程且不包含任何私钥内容', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /均由手动触发/)
  assert.match(readme, /密钥和本地开发者工具配置不进入仓库/)
  assert.match(readme, /普通提交不自动上传微信/)
  assert.doesNotMatch(readme, /-----BEGIN (?:RSA )?PRIVATE KEY-----/)
})
