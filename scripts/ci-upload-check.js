'use strict'
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
function matchingMainRuns (runs, sha) {
  return runs.filter(run => run.head_sha === sha && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event))
}
function passedGate (jobs) {
  return jobs.some(job => job.name === 'Test and production gates' && job.conclusion === 'success')
}
if (require.main === module) {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = process.env
  assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/)
  assert.match(sha || '', /^[0-9a-f]{40}$/)
  const api = route => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${route}`], { encoding: 'utf8' }))
  const result = api(`actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`)
  // An upload failure must remain retryable without running the tests again.
  const verified = matchingMainRuns(result.workflow_runs, sha).some(run => passedGate(api(`actions/runs/${run.id}/jobs?per_page=100`).jobs))
  assert.ok(verified, 'A successful main test gate for this exact commit is required')
}
module.exports = { matchingMainRuns, passedGate }
