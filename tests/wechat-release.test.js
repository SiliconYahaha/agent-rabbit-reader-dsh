'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const { assertDevelopmentBranch, assertUploadCliOutput, expectedAppId, inspectRelease, projectRoot } = require('../scripts/wechat-release')

test('微信发布检查固定使用脚本所属 Git 根目录，不依赖开发者工具当前旧窗口', () => {
  const release = inspectRelease()
  assert.equal(release.projectRoot, projectRoot)
  assert.equal(release.version, require('../package.json').version)
  assert.equal(release.appid, expectedAppId)
  assert.ok(release.branch, '应返回当前 Git 分支供上传门禁继续判断')
})

test('发布信息可在 main 检查，但上传门禁仍只允许开发分支', () => {
  assert.doesNotThrow(() => assertDevelopmentBranch({ branch: 'agent/yahaha-air/example' }))
  assert.doesNotThrow(() => assertDevelopmentBranch({ branch: 'agent/example' }))
  assert.throws(() => assertDevelopmentBranch({ branch: 'main' }), /禁止从非开发分支上传：main/)
  assert.throws(() => assertDevelopmentBranch({ branch: '' }), /detached HEAD/)
})

test('微信 CLI 即使退出码为 0，只要输出上传错误也不能记录为成功', () => {
  assert.doesNotThrow(() => assertUploadCliOutput('✔ Upload\n{"subPackageInfo":[]}'))
  assert.throws(() => assertUploadCliOutput('✖ Uploading\n[error] 上传失败：错误码：41002, appid missing'), /拒绝记录成功/)
})

test('从项目外目录调用发布检查仍返回当前版本工作树', () => {
  const scriptPath = path.join(projectRoot, 'scripts', 'wechat-release.js')
  const result = spawnSync(process.execPath, [scriptPath, 'inspect'], {
    cwd: path.dirname(projectRoot),
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const release = JSON.parse(result.stdout)
  assert.equal(release.projectRoot, projectRoot)
  assert.equal(release.version, require('../package.json').version)
})
