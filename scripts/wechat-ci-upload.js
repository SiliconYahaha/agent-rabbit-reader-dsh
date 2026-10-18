'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const expectedAppId = 'wx3a426835ea59403a'

function readJson (relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

function git (...args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
}

function inspectProject () {
  const packageJson = readJson('package.json')
  const projectConfig = readJson('project.config.json')

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, `package.json 版本号不合法：${packageJson.version}`)
  assert.equal(projectConfig.appid, expectedAppId, `AppID 不一致：${projectConfig.appid}`)
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/', 'miniprogramRoot 配置异常')

  return {
    projectRoot,
    version: packageJson.version,
    appid: projectConfig.appid,
    miniprogramRoot: projectConfig.miniprogramRoot
  }
}

function validateReleaseInputs ({ version, expectedVersion, description, confirmation, ref }) {
  assert.match(String(version || ''), /^\d+\.\d+\.\d+$/, '版本号必须使用 x.y.z 格式')
  assert.equal(version, expectedVersion, `工作流版本 ${version} 与 package.json ${expectedVersion} 不一致`)
  assert.ok(String(description || '').trim(), '上传说明不能为空')
  assert.ok(Array.from(String(description)).length <= 200, '上传说明不能超过 200 个字符')
  assert.equal(confirmation, 'UPLOAD', '确认字段必须精确填写 UPLOAD')
  assert.equal(ref, 'refs/heads/main', `只允许从 main 上传微信开发版，当前为 ${ref || '(unknown)'}`)
}

function assertReleaseTag ({ version, head, tagCommit }) {
  assert.equal(tagCommit, head, `标签 v${version} 没有指向当前 main 提交：${tagCommit} != ${head}`)
}

// push 到 main 的自动上传：版本号取 package.json，说明由提交生成，不要求版本标签
function pushUploadInputs (projectInfo, env = process.env) {
  const head = env.GITHUB_SHA || git('rev-parse', 'HEAD')
  const subject = git('log', '-1', '--format=%s', head).replace(/\s+/g, ' ').trim()
  const description = Array.from(`main@${head.slice(0, 7)} ${subject}`).slice(0, 200).join('')
  return { version: projectInfo.version, description, confirmation: 'UPLOAD', head }
}

function resolveReleaseIdentity (version, env = process.env) {
  const head = env.GITHUB_SHA || git('rev-parse', 'HEAD')
  let tagCommit = ''
  try {
    tagCommit = git('rev-parse', `refs/tags/v${version}^{}`)
  } catch {
    throw new Error(`缺少标签 v${version}；请先在 GitHub 为已合并的 main 提交创建版本标签和 Release`)
  }
  assertReleaseTag({ version, head, tagCommit })
  return { head, tag: `v${version}` }
}

function validatePrivateKey (value) {
  const key = String(value || '').trim()
  assert.ok(key.length >= 100, '缺少 GitHub Secret：WECHAT_CI_PRIVATE_KEY')
  assert.match(key, /-----BEGIN (?:RSA )?PRIVATE KEY-----/, 'WECHAT_CI_PRIVATE_KEY 不是有效的 PEM 私钥')
  assert.match(key, /-----END (?:RSA )?PRIVATE KEY-----/, 'WECHAT_CI_PRIVATE_KEY 缺少 PEM 结束标记')
  return `${key}\n`
}

function robotNumber (value) {
  const robot = Number(value || 1)
  assert.equal(Number.isInteger(robot) && robot >= 1 && robot <= 30, true, 'WECHAT_CI_ROBOT 必须是 1–30 的整数')
  return robot
}

function privateKeyPathForRunner (env = process.env) {
  const base = env.RUNNER_TEMP || path.join(projectRoot, 'outputs', 'wechat-ci')
  fs.mkdirSync(base, { recursive: true })
  return path.join(base, 'wechat-code-upload.private.key')
}

function writeSummary (summary) {
  const outputDir = path.join(projectRoot, 'outputs', 'wechat-ci')
  fs.mkdirSync(outputDir, { recursive: true })
  const filePath = path.join(outputDir, `v${summary.version}-${summary.uploadedAt.replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`)
  return filePath
}

async function uploadFromGitHubActions (env = process.env) {
  const projectInfo = inspectProject()
  const mode = env.WECHAT_CI_MODE === 'push' ? 'push' : 'manual'
  const pushInputs = mode === 'push' ? pushUploadInputs(projectInfo, env) : null
  const version = pushInputs ? pushInputs.version : String(env.WECHAT_CI_VERSION || '').trim()
  const description = pushInputs ? pushInputs.description : String(env.WECHAT_CI_DESCRIPTION || '').trim()

  validateReleaseInputs({
    version,
    expectedVersion: projectInfo.version,
    description,
    confirmation: pushInputs ? pushInputs.confirmation : env.WECHAT_CI_CONFIRM,
    ref: env.GITHUB_REF
  })
  const releaseIdentity = pushInputs ? { head: pushInputs.head, tag: '' } : resolveReleaseIdentity(version, env)
  const privateKey = validatePrivateKey(env.WECHAT_CI_PRIVATE_KEY)
  const robot = robotNumber(env.WECHAT_CI_ROBOT)
  const privateKeyPath = privateKeyPathForRunner(env)
  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 })

  // 微信官方 CI 工具包含大量只在发布阶段需要的旧构建依赖；将它隔离在
  // tools/wechat-ci，避免污染小程序主体依赖和普通 PR 的 npm audit 结果。
  const ci = require(path.join(projectRoot, 'tools/wechat-ci/node_modules/miniprogram-ci'))
  const project = new ci.Project({
    appid: projectInfo.appid,
    type: 'miniProgram',
    projectPath: projectRoot,
    privateKeyPath,
    ignores: ['node_modules/**/*', '.git/**/*', 'outputs/**/*']
  })

  let result
  try {
    result = await ci.upload({
      project,
      version,
      desc: description,
      robot,
      // Avoid repeated COS transfer stalls on hosted runners. Official direct upload.
      useCOS: false,
      setting: {
        es6: true,
        minify: true,
        minifyJS: true,
        minifyWXML: true,
        minifyWXSS: true,
        autoPrefixWXSS: true
      },
      onProgressUpdate: progress => {
        const status = progress && typeof progress === 'object'
          ? [progress.status, progress.message].filter(Boolean).join(' ')
          : String(progress || '')
        if (status) console.log(`[miniprogram-ci] ${status}`)
      }
    })
  } finally {
    // GitHub hosted runner 会销毁，但 self-hosted runner 会复用；无论成功失败都
    // 立即擦除本脚本创建的临时私钥，避免私钥留在 runner 工作目录。
    if (fs.existsSync(privateKeyPath)) {
      fs.writeFileSync(privateKeyPath, '', { mode: 0o600 })
      fs.unlinkSync(privateKeyPath)
    }
  }

  const uploadedAt = new Date().toISOString()
  const summary = {
    schemaVersion: 1,
    appid: projectInfo.appid,
    mode,
    version,
    description,
    robot,
    commit: releaseIdentity.head,
    tag: releaseIdentity.tag,
    ref: env.GITHUB_REF,
    runId: env.GITHUB_RUN_ID || '',
    runAttempt: env.GITHUB_RUN_ATTEMPT || '',
    uploadedAt,
    resultKeys: result && typeof result === 'object' ? Object.keys(result).sort() : []
  }
  const summaryPath = writeSummary(summary)
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2))
  return { ...summary, summaryPath }
}

async function main () {
  const mode = process.argv[2] || 'upload'
  if (mode === 'inspect') {
    console.log(JSON.stringify(inspectProject(), null, 2))
    return
  }
  if (mode !== 'upload') throw new Error(`未知模式：${mode}`)
  await uploadFromGitHubActions()
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error)
    // The SDK can leave worker threads alive after a rejected upload.
    // uploadFromGitHubActions has already completed its private-key cleanup.
    process.exit(1)
  })
}

module.exports = {
  assertReleaseTag,
  pushUploadInputs,
  expectedAppId,
  inspectProject,
  robotNumber,
  validatePrivateKey,
  validateReleaseInputs
}
