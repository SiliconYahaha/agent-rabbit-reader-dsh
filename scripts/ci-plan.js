'use strict'

// Keep required status checks present even for documentation-only pull requests.
const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const fullBrowser = ['svg-closepath', 'svg-animation', 'svg-path-morph', 'svg-path-grammar', 'svg-native-path', 'svg-curved-clips', 'svg-clip-unions', 'svg-container-bounds', 'svg-viewports', 'chrome-oracle', 'inline-poster', 'image-data', 'image-decode', 'inline-cache', 'reader-stability', 'visible-canvas', 'canvas-readback', 'canvas-source', 'canvas-reset', 'canvas-budget'].map(s => `verify:${s}`)
const familyPatterns = {
  rtf: /(?:^|\/)(?:(?:verify|probe|generate)-)?rtf[-/.]/,
  markdown: /(?:^|\/)(?:(?:verify|probe|generate)-)?markdown[-/.]/,
  svg: /(?:^|\/)(?:(?:verify|probe|generate)-)?svg[-/.]/,
  archive: /(?:^|\/)(?:(?:verify|probe|generate)-)?(?:archive|zip|rar|7z|sevenzip|tar)[-/.]/,
  dxf: /(?:^|\/)(?:(?:verify|probe|generate)-)?dxf[-/.]/
}
function familyOf (file) {
  return Object.keys(familyPatterns).find(key => familyPatterns[key].test(file))
}
function planChanges (files, { full = false, tests, scripts, metadataOnly = [] } = {}) {
  tests ||= fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js')).map(f => `tests/${f}`)
  scripts ||= require('../package.json').scripts
  const selected = new Set(), families = new Set(), reasons = []
  let upload = false, production = false
  for (const file of files) {
    if (/^docs\//.test(file) || /^(?:README\.md|LICENSE|\.gitignore)$/.test(file) || /\/README\.md$/.test(file) || /^compatibility\/(?:runs\/|continuous-state\.json$)/.test(file)) continue
    if (/^compatibility\/profiles\//.test(file)) { selected.add('tests/compatibility-profiles.test.js'); continue }
    if (/^(?:miniprogram\/|project\.config\.json$|package(?:-lock)?\.json$)/.test(file)) { upload = true; production = true }
    if (metadataOnly.includes(file)) continue
    if (/^(?:\.github\/|scripts\/ci-[^/]+\.js$|scripts\/wechat-ci-upload\.js$|tests\/(?:ci-[^/]+|wechat-ci)\.test\.js$|tools\/wechat-ci\/)/.test(file)) {
      selected.add('tests/ci-plan.test.js'); selected.add('tests/wechat-ci.test.js'); selected.add('tests/ci-stage-sync.test.js'); continue
    }
    // Only isolated format modules may use narrow routing. Shared renderer,
    // decoding, package dependencies and unrecognised paths fail closed to full.
    const isolated = /^(?:tests\/|scripts\/(?:verify|probe|generate)-|miniprogram\/file-reader\/(?:engine\/core\/(?:rtf-|dxf-)|markdown\/|image\/svg\/|archive\/|sevenzip\/|shared\/archive-))/.test(file)
    const family = isolated && familyOf(file)
    if (family) { families.add(family); continue }
    if (/^tests\/[^/]+\.test\.js$/.test(file) && tests.includes(file)) { selected.add(file); continue }
    full = true; reasons.push(file)
  }
  for (const family of families) {
    for (const file of tests) if (familyPatterns[family].test(file)) selected.add(file)
    // Entry routing and payload contracts cross the individual format boundary.
    for (const file of ['tests/file-inspector.test.js', 'tests/read-html-file.test.js', 'tests/view-payload.test.js']) if (tests.includes(file)) selected.add(file)
  }
  const browser = new Set()
  for (const family of families) {
    if (family === 'svg') for (const command of fullBrowser.filter(s => s.startsWith('verify:svg-'))) browser.add(command)
    // Split the previous mega-command so an RTF change does not test CSS, SVG,
    // Markdown, DXF and every other unchanged format too.
    const chain = scripts['verify:chrome-oracle'] || ''
    for (const command of chain.split(/\s*&&\s*/)) {
      if (familyPatterns[family].test(command.replace(/^node /, '')) || command.startsWith(`npm run verify:${family}-`)) browser.add(command)
    }
  }
  if (full) return { mode: 'full', install: true, production: true, upload, tests, browser: fullBrowser, reasons }
  return { mode: selected.size || production ? 'scoped' : 'docs', install: [...selected].some(f => !/^tests\/(?:ci-plan|wechat-ci|ci-stage-sync|compatibility-profiles)\.test\.js$/.test(f)), production, upload, tests: [...selected].sort(), browser: [...browser], reasons: [...families] }
}
function changedFiles (base, head) {
  if (!/^[a-f0-9]{40}$/.test(base || '') || !/^[a-f0-9]{40}$/.test(head || '')) throw new Error('Exact base and head commit SHAs are required')
  // --no-renames includes both old and new paths; deletions still affect routing.
  return git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean)
}
// A release version bump must not accidentally turn every scoped release into
// a full run. Dependency / build changes still require the full fallback.
function manifestImpact (file, before, after) {
  const old = structuredClone(before), next = structuredClone(after)
  delete old.version; delete next.version
  if (file === 'package-lock.json') {
    if (old.packages?.['']) delete old.packages[''].version
    if (next.packages?.['']) delete next.packages[''].version
    return isDeepStrictEqual(old, next) ? [] : null
  }
  const oldScripts = old.scripts || {}, nextScripts = next.scripts || {}
  delete old.scripts; delete next.scripts
  if (!isDeepStrictEqual(old, next)) return null
  const affected = []
  for (const name of new Set([...Object.keys(oldScripts), ...Object.keys(nextScripts)])) {
    if (oldScripts[name] === nextScripts[name]) continue
    if (!/^verify:(?:chrome-oracle|simulator|rtf-[\w:-]+|markdown-[\w:-]+|svg-[\w:-]+|dxf-[\w:-]+)$/.test(name)) return null
    const previous = (oldScripts[name] || '').split(/\s*&&\s*/)
    const current = (nextScripts[name] || '').split(/\s*&&\s*/)
    const delta = [...previous.filter(c => !current.includes(c)), ...current.filter(c => !previous.includes(c))].filter(Boolean)
    // A reordering of existing commands also merits the full fallback.
    if (!delta.length) return null
    for (const command of delta) {
      const match = command.match(/^node (scripts\/verify-[\w.-]+\.js)$/) || command.match(/^npm run verify:([\w:-]+)$/)
      if (!match) return null
      const target = match[1].startsWith('scripts/') ? match[1] : `scripts/verify-${match[1].replaceAll(':', '-')}.js`
      if (!familyOf(target)) return null
      affected.push(target)
    }
  }
  return affected
}
function planRange (base, head, options = {}) {
  const files = changedFiles(base, head), metadataOnly = []
  for (const file of ['package.json', 'package-lock.json']) {
    if (!files.includes(file)) continue
    try {
      const impact = manifestImpact(file, JSON.parse(git('show', `${base}:${file}`)), JSON.parse(git('show', `${head}:${file}`)))
      if (impact !== null) { metadataOnly.push(file); files.push(...impact) }
    } catch { /* unreadable/new manifests use the full fallback */ }
  }
  return planChanges(files, { ...options, metadataOnly })
}
function main () {
  const env = process.env
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const full = env.CI_FULL === 'true' || env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  const head = git('rev-parse', 'HEAD')
  let base = event.before
  if (event.pull_request) base = git('merge-base', event.pull_request.base.sha, head)
  let plan
  // Dispatch or missing history is an explicit full run, never a silent skip.
  if (full || !base || /^0+$/.test(base)) plan = planChanges([], { full: true })
  else {
    git('diff', '--check', base, head)
    plan = planRange(base, head)
  }
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'outputs/ci-plan.json'), JSON.stringify(plan, null, 2))
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `install=${plan.install}\nupload=${plan.upload}\n`)
  const summary = `## Scoped checks\nMode: ${plan.mode}\nTests: ${plan.tests.length} files\nBrowser commands: ${plan.browser.length}\nReasons: ${plan.reasons.join(', ') || 'documentation / workflow metadata'}\n`
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
}
if (require.main === module) main()
module.exports = { planChanges, changedFiles, fullBrowser, manifestImpact, planRange }
