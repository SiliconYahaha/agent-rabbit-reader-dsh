'use strict'
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
function assertCurrentMain (head, remote, identicalPayload = false) {
  assert.match(head || '', /^[0-9a-f]{40}$/)
  assert.match(remote || '', /^[0-9a-f]{40}$/)
  assert.ok(head === remote || identicalPayload, 'This release has been superseded on main; refusing stale upload')
}
if (require.main === module) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const head = git('rev-parse', 'HEAD')
  assert.equal(process.env.GITHUB_SHA, head, 'Checked out commit differs from workflow identity')
  // A newer documentation receipt must not strand the preceding code upload.
  // Fetch the current main, compare every upload input, and reject newer code.
  git('fetch', '--no-tags', 'origin', 'main')
  const remote = git('rev-parse', 'FETCH_HEAD')
  const changed = git('diff', '--name-only', head, remote, '--', 'miniprogram', 'project.config.json', 'package.json', 'package-lock.json', 'tools/wechat-ci', 'scripts/wechat-ci-upload.js', ':(glob,exclude)miniprogram/**/README.md')
  assertCurrentMain(head, remote, !changed)
}
module.exports = { assertCurrentMain }
