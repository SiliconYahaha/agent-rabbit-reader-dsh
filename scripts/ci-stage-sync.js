'use strict'

// 阶段同步流程：本地检查 → 提交 → 显式推送 → 核对远程。
//
//   node scripts/ci-stage-sync.js check [--base <sha>] [--full] [--skip-tests] [--report <path>]
//   node scripts/ci-stage-sync.js commit --message "<主题>" [--no-add] [--skip-tests] [--base <sha>]
//   node scripts/ci-stage-sync.js push [--remote origin] [--branch main]   # 默认 dry-run
//   node scripts/ci-stage-sync.js push --execute                            # 显式真正推送
//   node scripts/ci-stage-sync.js verify [--remote origin] [--branch main]
//
// 硬约束：
//   * push 默认只做预检/dry-run，真正推送必须显式 --execute；不推标签、不创建 PR、不强推。
//   * commit 只使用仓库配置里的真实 Git 身份，不传 --author，不写死作者。
//   * 微信上传是独立手动流程：本脚本不调用任何上传命令，也不读取上传密钥。
//   * 输出只写项目目录内（默认 outputs/stage-sync-report.json，已被 .gitignore 忽略）。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { planChanges } = require('./ci-plan')

const projectRoot = path.resolve(__dirname, '..')
const PUSH_BRANCH = 'main'
const REPORT_PATH = path.join(projectRoot, 'outputs', 'stage-sync-report.json')
// 只允许同步到本项目的独立仓库；任何其他远程都先修好再同步。
const EXPECTED_REMOTES = new Set([
  'https://github.com/SiliconYahaha/agent-rabbit-reader-dsh.git',
  'https://github.com/SiliconYahaha/agent-rabbit-reader-dsh',
  'git@github.com:SiliconYahaha/agent-rabbit-reader-dsh.git',
  'ssh://git@github.com/SiliconYahaha/agent-rabbit-reader-dsh.git'
])

function run (command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    // Vendored runtimes and offline examples can produce multi-MiB text diffs.
    // Keep scanning the complete diff; exceeding this bound still fails closed.
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv(options.env),
    stdio: options.capture ? 'pipe' : 'inherit'
  })
  if (result.error) throw result.error
  const output = options.capture ? `${result.stdout || ''}${result.stderr || ''}` : ''
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败（退出码 ${result.status}）${output.trim() ? `：\n${output.trim()}` : ''}`)
  }
  return output
}

const git = (...args) => run('git', args, { capture: true }).trim()

// 缓存与临时目录默认落在项目内；用户显式指向项目内的取值才沿用。
// 目标可能尚不存在：逐级上退到最近的已存在祖先再解析真实路径。
function insideProject (target) {
  if (!target) return false
  let current = path.resolve(target)
  while (true) {
    try {
      const resolved = fs.realpathSync(current)
      return resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)
    } catch {}
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function childEnv (extra = {}) {
  const env = { ...process.env, ...extra }
  const cache = env.npm_config_cache
  env.npm_config_cache = insideProject(cache) ? cache : path.join(projectRoot, '.npm-cache')
  const tmp = env.TMPDIR
  env.TMPDIR = insideProject(tmp) ? tmp : path.join(projectRoot, 'tmp')
  fs.mkdirSync(env.TMPDIR, { recursive: true })
  fs.mkdirSync(env.npm_config_cache, { recursive: true })
  return env
}

function repoFacts () {
  const toplevel = path.resolve(git('rev-parse', '--show-toplevel'))
  const gitDir = path.resolve(git('rev-parse', '--absolute-git-dir'))
  const commonDir = path.resolve(git('rev-parse', '--git-common-dir'))
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const head = git('rev-parse', 'HEAD')
  const remotes = git('remote', '-v').split('\n').filter(Boolean).map(line => {
    const [name, url, type] = line.split(/\s+/)
    return { name, url, type }
  })
  let upstream = ''
  try { upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}') } catch {}
  const status = git('status', '--porcelain=v1')
  return { toplevel, gitDir, commonDir, branch, head, remotes, upstream, status, dirty: status !== '' }
}

// 目标仓库与工作树边界：源码目录即 Git 根，Git 目录在项目内，所有远程都是本项目独立仓库。
function assertTargetRepository (facts = repoFacts()) {
  assert.equal(facts.toplevel, projectRoot, `Git 工作树根不是源码目录：${facts.toplevel}`)
  for (const dir of [facts.gitDir, facts.commonDir]) {
    assert.ok(insideProject(dir), `Git 目录越出项目：${dir}`)
  }
  assert.ok(facts.remotes.length > 0, '仓库没有配置任何远程，拒绝同步')
  for (const remote of facts.remotes) {
    assert.ok(EXPECTED_REMOTES.has(remote.url), `远程 ${remote.name} 指向 ${remote.url}，不是本项目独立仓库；请先修正 remote 再同步`)
  }
  return facts
}

function listWorkflows () {
  const directory = path.join(projectRoot, '.github', 'workflows')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter(name => /\.(?:yml|yaml)$/.test(name))
    .sort()
    .map(name => ({ name, source: fs.readFileSync(path.join(directory, name), 'utf8') }))
}

// 只解析 on: 下第一层键，避免把 inputs: 之类的子结构当成触发方式。
function workflowTriggers (source) {
  const triggers = []
  let inOn = false
  let baseIndent = null
  for (const line of String(source).split(/\r?\n/)) {
    if (!inOn) {
      const start = line.match(/^on:\s*(.*)$/)
      if (start) {
        const inline = start[1].trim()
        if (inline) {
          for (const item of inline.replace(/^\[|\]$/g, '').split(',')) if (item.trim()) triggers.push(item.trim())
          continue
        }
        inOn = true
      }
      continue
    }
    if (!line.trim()) continue
    const indent = line.match(/^ */)[0].length
    if (baseIndent === null) baseIndent = indent
    if (indent < baseIndent) { inOn = false; continue }
    if (indent === baseIndent) {
      const key = line.trim().match(/^([A-Za-z_][\w-]*):/)
      if (key) triggers.push(key[1])
    }
  }
  return triggers
}

// 代码推送不得触发任何工作流；微信上传只保留手动触发。
const MANUAL_TRIGGERS = new Set(['workflow_dispatch', 'workflow_call'])
const AUTOMATIC_EVENTS = ['push', 'pull_request', 'pull_request_target', 'schedule', 'repository_dispatch', 'release', 'create', 'delete', 'fork', 'watch', 'issues', 'issue_comment', 'page_build', 'registry_package', 'workflow_run', 'deployment', 'deployment_status', 'check_run', 'check_suite', 'discussion', 'label', 'milestone', 'project', 'public', 'status']

function assertManualOnlyWorkflows (workflows = listWorkflows()) {
  assert.ok(workflows.length > 0, '没有找到任何 GitHub 工作流，无法确认推送不会触发上传')
  const summary = []
  for (const { name, source } of workflows) {
    const triggers = workflowTriggers(source)
    assert.ok(triggers.length > 0, `${name} 没有声明触发方式`)
    const offending = triggers.filter(trigger => !MANUAL_TRIGGERS.has(trigger))
    assert.equal(offending.length, 0, `${name} 包含自动触发 ${offending.join(', ')}；代码推送不得触发任何工作流，微信上传只能手动触发（如确需改为自动触发，请同步修改本检查）`)
    summary.push({ name, triggers })
  }
  return summary
}

const SECRET_PATTERNS = [
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, label: 'PEM 私钥' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/, label: 'GitHub 访问令牌' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/, label: 'GitHub 细粒度令牌' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS 访问键 ID' },
  { pattern: /\b(?:WECHAT_[A-Z0-9_]*(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*['"]?[^\s'"]{12,}/, label: '微信上传凭据赋值' },
  { pattern: /\bappsecret\s*[:=]\s*['"][0-9a-f]{16,}['"]/i, label: '小程序 AppSecret' }
]

function secretFindings (text) {
  const findings = []
  String(text).split(/\r?\n/).forEach((line, index) => {
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push({ line: index + 1, label, excerpt: line.trim().slice(0, 120) })
    }
  })
  return findings
}

// 凭据类文件名一律不得进入提交；.gitignore 已忽略，这里作为二次拦截。
function sensitivePath (relativePath) {
  const file = String(relativePath).replace(/\\/g, '/').split('/').pop() || ''
  if (/^\.env(?:\..+)?$/.test(file) && !/\.example$/.test(file)) return true
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(file)) return true
  return /^(?:id_rsa|id_ed25519|project\.private\.config\.json)$/.test(file)
}

// 暂存内容与密钥排除：逐行扫描新增行，并拦截敏感文件名。
function inspectStaged () {
  const paths = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean)
  const findings = []
  let current = ''
  for (const line of git('diff', '--cached', '--no-renames', '-U0', '--no-color').split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.*)$/)
    if (header) { current = header[1]; continue }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const finding of secretFindings(line.slice(1))) findings.push({ file: current, ...finding })
  }
  return { paths, findings, sensitive: paths.filter(sensitivePath) }
}

function assertStagedContent (staged) {
  assert.equal(staged.sensitive.length, 0, `暂存内容包含敏感文件：${staged.sensitive.join(', ')}`)
  assert.equal(staged.findings.length, 0, `暂存内容疑似密钥：\n${staged.findings.map(f => `${f.file}:${f.line} ${f.label}`).join('\n')}`)
  return staged
}

// 变更范围：已提交基线到工作树，加上尚未跟踪的新文件。
function changedFiles (base) {
  const files = new Set()
  if (base) for (const file of git('diff', '--name-only', '--no-renames', base).split('\n').filter(Boolean)) files.add(file)
  for (const file of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) files.add(file)
  return [...files].sort()
}

function resolveBase () {
  for (const ref of ['origin/main', '@{upstream}']) {
    try {
      const sha = git('rev-parse', ref)
      if (/^[0-9a-f]{40}$/.test(sha)) return sha
    } catch {}
  }
  try {
    const sha = git('rev-parse', 'HEAD~1')
    if (/^[0-9a-f]{40}$/.test(sha)) return sha
  } catch {}
  return ''
}

// 相关测试与生产配置检查：复用 CI 的变更路由，只跑受影响的部分。
function runRelevantChecks ({ base = '', full = false, alwaysProduction = true, skipTests = false }) {
  const resolvedBase = base || resolveBase()
  const files = changedFiles(resolvedBase)
  const plan = full || !resolvedBase ? planChanges([], { full: true }) : planChanges(files)
  const ran = []
  const skipped = []
  if (!skipTests) {
    if (plan.production || alwaysProduction) { run('npm', ['run', 'check:production']); ran.push('check:production') }
    if (plan.mode === 'full') { run('npm', ['run', 'check']); ran.push('check') }
    else if (plan.tests.length) {
      run(process.execPath, ['--test', ...plan.tests])
      ran.push(`node --test ${plan.tests.length} 个测试文件`)
    } else if (!ran.length) skipped.push('没有受影响的 Node 测试（文档/工作流元数据改动）')
  } else skipped.push('--skip-tests：按要求跳过测试')
  skipped.push(...plan.browser.map(command => `浏览器/微信验证需单独环境，未运行：${command}`))
  return { base: resolvedBase, changedFiles: files, plan: { mode: plan.mode, tests: plan.tests.length, browser: plan.browser.length, production: plan.production }, ran, skipped }
}

// 真实 Git 身份：只读取仓库/全局配置，绝不代填或覆盖作者。
function resolveIdentity () {
  const read = key => { try { return git('config', '--get', key) } catch { return '' } }
  return { name: read('user.name'), email: read('user.email') }
}

function assertIdentity () {
  const identity = resolveIdentity()
  assert.ok(identity.name, '仓库未配置 user.name；请先设置真实 Git 身份，脚本不会代填作者')
  assert.match(identity.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `仓库 user.email 不合法：${identity.email || '(空)'}`)
  return identity
}

function commitStage ({ message, add = true, skipTests = false, base = '', full = false }) {
  assert.ok(String(message || '').trim(), '必须通过 --message 提供提交主题')
  const facts = assertTargetRepository()
  const triggers = assertManualOnlyWorkflows()
  const identity = assertIdentity()
  const checks = runRelevantChecks({ base, full, skipTests })
  if (add) git('add', '-A')
  const staged = assertStagedContent(inspectStaged())
  assert.ok(staged.paths.length > 0, '暂存区为空，没有可提交的改动；如需提交当前索引请去掉 --no-add')
  run('git', ['diff', '--check', '--cached'])
  const before = git('rev-parse', 'HEAD')
  run('git', ['commit', '-m', message])
  const after = git('rev-parse', 'HEAD')
  assert.notEqual(before, after, '提交没有产生新的提交')
  return {
    branch: facts.branch,
    previous: before,
    commit: after,
    subject: git('log', '-1', '--format=%s'),
    author: git('log', '-1', '--format=%an <%ae>'),
    identity,
    staged: staged.paths,
    triggers,
    checks
  }
}

function pushArguments ({ remote, branch, dryRun }) {
  const args = ['push', remote, `HEAD:refs/heads/${branch}`]
  // 唯一真正写远程的分支：只有 --execute 才会去掉 --dry-run。
  if (dryRun) args.push('--dry-run')
  return args
}

function remoteHead (remote, branch) {
  try {
    const line = run('git', ['ls-remote', '--heads', remote, branch], { capture: true }).split('\n')[0] || ''
    const sha = line.split('\t')[0].trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : ''
  } catch { return '' }
}

function pushStage ({ remote = 'origin', branch = PUSH_BRANCH, execute = false }) {
  assert.equal(branch, PUSH_BRANCH, `只允许同步 ${PUSH_BRANCH} 分支`)
  const facts = assertTargetRepository()
  assert.equal(facts.branch, branch, `只允许同步 ${PUSH_BRANCH} 分支：请求的是 ${branch}，当前分支是 ${facts.branch}`)
  const dryRun = !execute
  const args = pushArguments({ remote, branch, dryRun })
  // 双保险：非执行模式不允许出现不带 --dry-run 的推送参数。
  if (!execute) assert.ok(args.includes('--dry-run'), '未显式 --execute 时禁止执行真实推送')
  const before = remoteHead(remote, branch)
  const output = run('git', args, { capture: true }).trim()
  if (!execute) {
    return { pushed: false, dryRun: true, remote, branch, remoteBefore: before, command: `git ${args.join(' ')}`, output, head: facts.head, subject: git('log', '-1', '--format=%s') }
  }
  const verified = verifyRemote({ remote, branch })
  return { pushed: true, dryRun: false, remote, branch, remoteBefore: before, command: `git ${args.join(' ')}`, output, ...verified }
}

// 核对远程提交：抓取后逐项比对本地 HEAD、远程分支引用和 ls-remote 结果。
function verifyRemote ({ remote = 'origin', branch = PUSH_BRANCH } = {}) {
  const facts = assertTargetRepository()
  run('git', ['fetch', '--no-tags', remote, branch])
  const fetched = git('rev-parse', 'FETCH_HEAD')
  const listed = remoteHead(remote, branch)
  const local = git('rev-parse', 'HEAD')
  assert.equal(fetched, local, `远程 ${remote}/${branch} 抓取结果 ${fetched.slice(0, 7)} 与本地 HEAD ${local.slice(0, 7)} 不一致`)
  assert.equal(listed, local, `远程 ${remote}/${branch} 引用 ${listed.slice(0, 7) || '(空)'} 与本地 HEAD ${local.slice(0, 7)} 不一致`)
  return {
    remote,
    branch,
    commit: local,
    subject: git('log', '-1', '--format=%s'),
    author: git('log', '-1', '--format=%an <%ae>'),
    upstream: facts.upstream,
    verified: true
  }
}

function writeReport (report, explicitPath) {
  const target = path.resolve(projectRoot, explicitPath || REPORT_PATH)
  assert.ok(insideProject(target), `报告路径必须位于项目目录内：${target}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`)
  return target
}

function parseOptions (argv) {
  const options = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { options._.push(arg); continue }
    const equals = arg.indexOf('=')
    if (equals > 2) { options[arg.slice(2, equals)] = arg.slice(equals + 1); continue }
    const key = arg.slice(2)
    if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) options[key] = argv[++index]
    else options[key] = true
  }
  return options
}

const USAGE = `阶段同步（默认不推送）：
  check   [--base <sha>] [--full] [--skip-tests] [--report <path>]
  commit  --message "<主题>" [--no-add] [--skip-tests] [--full] [--base <sha>] [--report <path>]
  push    [--remote origin] [--branch main]      # 默认 dry-run，不写远程
  push    --execute                              # 显式真正推送并核对远程
  verify  [--remote origin] [--branch main]      # 只读核对远程提交`

function main (argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const command = options._[0] || 'check'
  const report = options.report
  let result
  if (command === 'check') {
    result = { command, repository: assertTargetRepository(), workflows: assertManualOnlyWorkflows(), ...runRelevantChecks({ base: options.base, full: Boolean(options.full), skipTests: Boolean(options['skip-tests']) }) }
  } else if (command === 'commit') {
    result = { command, ...commitStage({ message: options.message, add: !options['no-add'], skipTests: Boolean(options['skip-tests']), base: options.base, full: Boolean(options.full) }) }
  } else if (command === 'push') {
    result = { command, ...pushStage({ remote: options.remote, branch: options.branch, execute: Boolean(options.execute) }) }
  } else if (command === 'verify') {
    result = { command, ...verifyRemote({ remote: options.remote, branch: options.branch }) }
  } else {
    console.error(USAGE)
    throw new Error(`未知命令：${command}`)
  }
  const written = writeReport(result, report)
  console.log(JSON.stringify({ ...result, report: written }, null, 2))
  if (command === 'push' && !result.pushed) console.log('\n以上为 dry-run 预检，未推送任何内容；确认后加 --execute 才真正同步。')
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
  PUSH_BRANCH,
  assertManualOnlyWorkflows,
  assertStagedContent,
  assertTargetRepository,
  commitStage,
  inspectStaged,
  listWorkflows,
  pushArguments,
  pushStage,
  resolveIdentity,
  resolveBase,
  runRelevantChecks,
  secretFindings,
  sensitivePath,
  verifyRemote,
  workflowTriggers
}
