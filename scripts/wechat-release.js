'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const expectedAppId = 'wx3a426835ea59403a'

function run (command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: options.capture ? 'pipe' : 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : ''
    throw new Error(`${command} ${args.join(' ')} 执行失败${detail ? `：\n${detail}` : ''}`)
  }
  return options.capture ? `${result.stdout || ''}${result.stderr || ''}` : ''
}

function git (...args) {
  return run('git', args, { capture: true }).trim()
}

function readJson (relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

function inspectRelease () {
  const packageJson = readJson('package.json')
  const projectConfig = readJson('project.config.json')
  const gitRoot = path.resolve(git('rev-parse', '--show-toplevel'))
  // actions/checkout checks pull requests out as a detached commit. Keep the
  // local safety gate strict, while allowing read-only release inspection to
  // report the source branch supplied by GitHub Actions.
  const branch = git('branch', '--show-current') || process.env.GITHUB_HEAD_REF || ''
  const head = git('rev-parse', 'HEAD')
  let upstream = ''
  try {
    upstream = git('rev-parse', '@{upstream}')
  } catch {}

  assert.equal(gitRoot, projectRoot, `发布脚本所在项目与 Git 根目录不一致：${gitRoot}`)
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, `版本号不合法：${packageJson.version}`)
  assert.equal(projectConfig.appid, expectedAppId, `AppID 不一致：${projectConfig.appid}`)
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/', 'miniprogramRoot 配置异常')
  const releaseDoc = `docs/release-v${packageJson.version}-dev.md`
  assert.ok(fs.existsSync(path.join(projectRoot, releaseDoc)), `缺少版本记录：${releaseDoc}`)

  return {
    projectRoot,
    version: packageJson.version,
    appid: projectConfig.appid,
    branch,
    head,
    upstream,
    releaseDoc
  }
}

function assertDevelopmentBranch (release) {
  assert.match(release.branch, /^agent\//, `禁止从非开发分支上传：${release.branch || '(detached HEAD)'}`)
}

function assertCleanAndPushed (release) {
  assertDevelopmentBranch(release)
  const status = git('status', '--porcelain=v1')
  assert.equal(status, '', `工作树不干净，拒绝上传：\n${status}`)
  assert.ok(release.upstream, '当前分支没有上游分支，拒绝上传')
  assert.equal(release.head, release.upstream, '本地提交尚未完整推送到上游，拒绝上传')
}

function getLoginState () {
  assert.ok(fs.existsSync(cliPath), `找不到微信开发者工具 CLI：${cliPath}`)
  const output = run(cliPath, ['islogin'], { capture: true })
  const matched = output.match(/\{"login":(true|false)\}/)
  assert.ok(matched, `无法识别微信开发者工具登录状态：\n${output}`)
  return matched[1] === 'true'
}

function verifyRelease () {
  const commands = [
    ['npm', ['run', 'check:production']],
    ['npm', ['run', 'check']],
    ['npm', ['run', 'verify:originals']],
    ['npm', ['run', 'verify:reported']],
    ['npm', ['run', 'verify:chrome-oracle']],
    ['git', ['diff', '--check']]
  ]
  for (const [command, args] of commands) run(command, args)
}

function openCorrectProject () {
  run(cliPath, ['open', '--project', projectRoot])
}

function assertUploadCliOutput (output) {
  const failure = String(output || '').match(/(?:✖\s*Uploading|\[error\]|上传失败|appid missing|错误码：\d+)/i)
  assert.equal(failure, null, `微信 CLI 报告上传失败，即使进程退出码为 0 也拒绝记录成功：\n${output}`)
}

function uploadRelease (release, description) {
  const outputDir = path.join(projectRoot, 'outputs', 'wechat-upload')
  fs.mkdirSync(outputDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const infoOutput = path.join(outputDir, `v${release.version}-${timestamp}.json`)
  const output = run(cliPath, [
    'upload',
    '--project', projectRoot,
    '--version', release.version,
    '--desc', description,
    '--info-output', infoOutput
  ], { capture: true })
  console.log(output)
  assertUploadCliOutput(output)
  assert.ok(fs.existsSync(infoOutput), `微信 CLI 未生成上传结果文件，拒绝记录成功：${infoOutput}`)
  return infoOutput
}

function optionValue (name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function main () {
  const mode = process.argv[2] || 'inspect'
  const release = inspectRelease()

  if (mode === 'inspect') {
    console.log(JSON.stringify(release, null, 2))
    return
  }

  if (mode === 'verify') {
    verifyRelease()
    const refreshed = inspectRelease()
    assertCleanAndPushed(refreshed)
    console.log(JSON.stringify({ ...refreshed, verified: true }, null, 2))
    return
  }

  if (mode !== 'upload') throw new Error(`未知模式：${mode}`)

  const description = optionValue('--desc') || `兔子阅读器 ${release.version}：修复 HTML 交互、主题显示、Ai 文件解析并恢复分享入口。`
  assert.ok(getLoginState(), '微信开发者工具未登录，已停止；不会误传旧项目')
  verifyRelease()
  const refreshed = inspectRelease()
  assertCleanAndPushed(refreshed)
  openCorrectProject()
  run('npm', ['run', 'verify:simulator'])
  const infoOutput = uploadRelease(refreshed, description)
  console.log(JSON.stringify({ ...refreshed, verified: true, uploaded: true, infoOutput }, null, 2))
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error && error.stack || error)
    process.exitCode = 1
  }
}

module.exports = {
  assertUploadCliOutput,
  assertDevelopmentBranch,
  expectedAppId,
  inspectRelease,
  projectRoot
}
