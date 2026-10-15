'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const samples = require('../tests/fixtures/svg-viewport-culling.json')
const discovery = process.argv.includes('--discover')
const output = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'outputs/svg-viewport-culling')
fs.mkdirSync(output, { recursive: true })
// Keep unresolved rotation controls available for discovery. The strict
// gate uses exact pixels for every certified case; no error tolerance is added.
const inputs = path.join(output, 'inputs.json')
fs.writeFileSync(inputs, JSON.stringify(discovery ? samples : samples.filter(c => !c.knownGap), null, 2) + '\n')
const args = ['scripts/verify-svg-container-bounds.js', output, '--input-file', inputs]
if (discovery) args.push('--discover')
const baselineAt = process.argv.indexOf('--baseline-ref')
if (baselineAt >= 0) args.push('--baseline-ref', process.argv[baselineAt + 1])
execFileSync(process.execPath, args, { stdio: 'inherit' })
