'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

// Some hosted Ubuntu images still ship Chrome 149, whose empty from/to path
// semantics predate WPT #59696. Keep every native geometry assertion and run
// an updated browser rather than accepting that obsolete oracle behavior.
const VERSION = '152.0.7977.82'
const ARCHIVE_SHA256 = '0ca12ea26b502a83e32db334a17883c315348845efc071d908de7a6d94a97eff'
function oracleChrome (configured) {
  const version = execFileSync(configured, ['--version'], { encoding: 'utf8' }).trim()
  const major = Number((version.match(/\b(\d+)\.\d+\.\d+\.\d+/) || [])[1])
  if (major >= 152) return configured
  if (!process.env.CI || process.platform !== 'linux' || process.arch !== 'x64') throw Error(`Path morph oracle requires Chrome 152 or newer; received ${version}`)
  const cache = path.resolve('outputs', `svg-path-oracle-chrome-${VERSION}`)
  const executable = path.join(cache, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
  fs.mkdirSync(cache, { recursive: true })
  if (!fs.existsSync(executable)) {
    const archive = path.join(cache, 'chrome-headless-shell-linux64.zip')
    const url = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-headless-shell-linux64.zip`
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20', '--max-time', '120', url, '--output', archive], { timeout: 150000, stdio: 'inherit' })
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (hash !== ARCHIVE_SHA256) throw Error('Chrome for Testing archive checksum mismatch')
    execFileSync('unzip', ['-q', '-o', archive, '-d', cache], { timeout: 30000, stdio: 'inherit' })
  }
  const selected = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim()
  if (!selected.includes(VERSION)) throw Error(`Unexpected cached path oracle browser: ${selected}`)
  console.log(`Path morph oracle: ${version} -> pinned ${selected}; all samples retained`)
  return executable
}
module.exports = { oracleChrome }
