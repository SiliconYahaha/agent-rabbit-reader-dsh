'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const { planChanges } = require('../scripts/ci-plan')
const { assertCurrentMain } = require('../scripts/ci-current-main')
const { matchingMainRuns, passedGate } = require('../scripts/ci-upload-check')

test('docs and upload receipts do not install dependencies, run browser tests or upload', () => {
  const plan = planChanges(['README.md', 'docs/release-v1.4.140-dev.md', 'docs/home-visual-comparison/after.png', 'docs/design-system.html', 'compatibility/runs/receipt.json', 'miniprogram/file-reader/README.md'])
  assert.deepEqual([plan.mode, plan.install, plan.upload, plan.tests.length, plan.browser.length], ['docs', false, false, 0, 0])
})
test('RTF changes include parser and routing contracts without unrelated SVG/Canvas checks', () => {
  const plan = planChanges(['miniprogram/file-reader/engine/core/rtf-reader.js', 'tests/helpers/rtf-alternatives.js'])
  assert.equal(plan.mode, 'scoped')
  assert.equal(plan.upload, true)
  assert.ok(plan.tests.includes('tests/rtf-reader.test.js'))
  assert.ok(plan.tests.includes('tests/read-html-file.test.js'))
  assert.ok(plan.browser.includes('node scripts/verify-rtf-views.js'))
  assert.ok(!plan.tests.some(s => /svg|canvas/.test(s)))
  assert.ok(plan.browser.every(s => /rtf/.test(s)))
})
test('Markdown, SVG and archive changes select their families', () => {
  for (const [file, expected] of [
    ['miniprogram/file-reader/markdown/runtime/list-tokenizer.js', 'tests/markdown-document.test.js'],
    ['miniprogram/file-reader/image/svg/xml-parser.js', 'tests/svg-player.test.js'],
    ['miniprogram/file-reader/archive/tar-runtime.js', 'tests/tar-entry.test.js']
  ]) {
    const plan = planChanges([file])
    assert.equal(plan.mode, 'scoped', file)
    assert.ok(plan.tests.includes(expected), file)
  }
})
test('mixed changes union the required test and browser families without duplicates', () => {
  const plan = planChanges(['tests/rtf-reader.test.js', 'tests/markdown-document.test.js'])
  assert.ok(plan.tests.includes('tests/markdown-document.test.js'))
  assert.ok(plan.browser.some(s => /rtf/.test(s)))
  assert.ok(plan.browser.some(s => /markdown/.test(s)))
  assert.equal(plan.tests.length, new Set(plan.tests).size)
  assert.equal(plan.upload, false)
})
test('shared runtime, dependencies, unknown files and deleted unknown tests use full fallback', () => {
  for (const file of ['miniprogram/file-reader/document/html-dom.js', 'package-lock.json', 'scripts/new-tool.js', 'tests/deleted-unknown.test.js', 'tests/helpers/shared-host.js']) {
    const plan = planChanges([file])
    assert.equal(plan.mode, 'full', file)
    assert.ok(plan.browser.includes('verify:chrome-oracle'))
  }
  assert.equal(planChanges([], { full: true }).mode, 'full')
})
test('CI changes test policy, upload guards and stage sync without reinstalling or testing the product', () => {
  const plan = planChanges(['.github/workflows/ci.yml', 'scripts/ci-plan.js', 'scripts/ci-upload-check.js'])
  assert.deepEqual(plan.tests, ['tests/ci-plan.test.js', 'tests/ci-stage-sync.test.js', 'tests/wechat-ci.test.js'])
  assert.equal(plan.mode, 'scoped')
  assert.equal(plan.install, false)
  assert.equal(plan.upload, false)
  assert.deepEqual(plan.browser, [])
})
test('profile metadata validates its schema without exercising product rendering', () => {
  const plan = planChanges(['compatibility/profiles/rtf.json'])
  assert.deepEqual(plan.tests, ['tests/compatibility-profiles.test.js'])
  assert.equal(plan.install, false)
})
test('future format oracles appended to the aggregate command participate in scoped checks', () => {
  const plan = planChanges(['tests/rtf-reader.test.js'], { scripts: { 'verify:chrome-oracle': 'node scripts/verify-rtf-views.js && npm run verify:rtf-future && node scripts/verify-css-structure.js' } })
  assert.deepEqual(plan.browser, ['node scripts/verify-rtf-views.js', 'npm run verify:rtf-future'])
})
test('upload rejects stale or missing main identity', () => {
  const sha = 'a'.repeat(40)
  assert.doesNotThrow(() => assertCurrentMain(sha, sha))
  assert.throws(() => assertCurrentMain(sha, 'b'.repeat(40)), /superseded/)
  assert.throws(() => assertCurrentMain(sha, ''))
  assert.doesNotThrow(() => assertCurrentMain(sha, 'b'.repeat(40), true))
})
test('manual uploads trust only exact main tests, and can retry a failed upload', () => {
  const run = { id: 1, head_sha: 'abc', head_branch: 'main', event: 'push', conclusion: 'failure' }
  assert.deepEqual(matchingMainRuns([run, { ...run, event: 'pull_request' }, { ...run, head_sha: 'old' }, { ...run, head_branch: 'feature' }], 'abc'), [run])
  assert.deepEqual(matchingMainRuns([{ ...run, event: 'workflow_dispatch' }], 'abc'), [{ ...run, event: 'workflow_dispatch' }])
  assert.equal(passedGate([{ name: 'Test and production gates', conclusion: 'success' }, { name: 'upload / Verify and upload', conclusion: 'failure' }]), true)
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) assert.equal(passedGate([{ name: 'Test and production gates', conclusion }]), false)
})
test('independent repository workflows require manual execution and never chain an upload', () => {
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
  const upload = fs.readFileSync('.github/workflows/wechat-upload.yml', 'utf8')
  for (const workflow of [ci, upload]) {
    assert.match(workflow, /\n  workflow_dispatch:/)
    assert.doesNotMatch(workflow, /\n  (?:push|pull_request|workflow_call|schedule):/)
  }
  assert.match(ci, /name: Test and production gates/)
  assert.doesNotMatch(ci, /uses: \.\/\.github\/workflows\/wechat-upload/)
  assert.match(upload, /Type UPLOAD/)
})

test('new format fixture generators and raw/hex samples select their parser family', () => {
  const plan = planChanges(['scripts/generate-rtf-korean-fixtures.py', 'tests/helpers/rtf-korean-cases.js', 'tests/fixtures/rtf-korean/characters.json'])
  assert.equal(plan.mode, 'scoped')
  assert.ok(plan.tests.includes('tests/rtf-reader.test.js'))
  assert.ok(plan.browser.every(command => /rtf/.test(command)))
  assert.equal(plan.upload, false)
  assert.equal(planChanges(['scripts/generate-unknown-fixtures.py']).mode, 'full')
})

test('workflow changes exercise main policy without automatically uploading the product', () => {
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
  assert.doesNotMatch(ci, /\n  push:/)
  assert.equal(planChanges(['.github/workflows/ci.yml']).upload, false)
})

test('version-only manifests stay scoped, dependency edits do not', () => {
  const { manifestImpact } = require('../scripts/ci-plan')
  const pkg = { version: '1.0.0', dependencies: { x: '1.0.0' }, scripts: { test: 'node --test' } }
  assert.deepEqual(manifestImpact('package.json', pkg, { ...pkg, version: '1.0.1' }), [])
  assert.equal(manifestImpact('package.json', pkg, { ...pkg, dependencies: { x: '2.0.0' } }), null)
  const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/x': { version: '1.0.0' } } }
  assert.deepEqual(manifestImpact('package-lock.json', lock, { version: '1.0.1', packages: { ...lock.packages, '': { version: '1.0.1' } } }), [])
  assert.equal(manifestImpact('package-lock.json', lock, { ...lock, packages: { ...lock.packages, 'node_modules/x': { version: '2' } } }), null)
  const plan = planChanges(['package.json', 'package-lock.json', 'miniprogram/file-reader/engine/core/rtf-reader.js'], { metadataOnly: ['package.json', 'package-lock.json'] })
  assert.equal(plan.mode, 'scoped')
  assert.equal(plan.upload, true)
})
test('adding an RTF oracle to package scripts affects RTF checks, arbitrary scripts fall back', () => {
  const { manifestImpact } = require('../scripts/ci-plan')
  const before = { scripts: { 'verify:chrome-oracle': 'node scripts/chrome-oracle.mjs' } }
  const after = { scripts: { 'verify:chrome-oracle': 'node scripts/chrome-oracle.mjs && npm run verify:rtf-new', 'verify:rtf-new': 'node scripts/verify-rtf-new.js' } }
  const impact = manifestImpact('package.json', before, after)
  assert.ok(impact.includes('scripts/verify-rtf-new.js'))
  assert.equal(planChanges(impact).mode, 'scoped')
  assert.equal(manifestImpact('package.json', before, { scripts: { check: 'echo pass' } }), null)
})
