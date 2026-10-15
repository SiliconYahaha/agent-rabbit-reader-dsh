'use strict'
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const plan = JSON.parse(fs.readFileSync('outputs/ci-plan.json', 'utf8'))
function run (command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
if (plan.production) run('npm', ['run', 'check:production'])
if (plan.mode === 'full') run('npm', ['run', 'check'])
else if (plan.tests.length) run(process.execPath, ['--test', ...plan.tests])
for (const command of plan.browser) {
  if (command.startsWith('verify:')) run('npm', ['run', command])
  else if (/^(?:node scripts\/[\w.-]+|npm run verify:[\w:-]+)$/.test(command)) {
    const [binary, ...args] = command.split(' ')
    run(binary, args)
  } else throw new Error(`Unrecognised browser command: ${command}`)
}
