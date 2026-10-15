'use strict'

const cmpVersion = require('licia/cmpVersion')
const automatorPackage = require('miniprogram-automator/package.json')

const PATCH_MARKER = Symbol.for('html-reader.miniprogram-automator.check-version')
const MINIMUM_SDK_VERSION = '2.7.3'

function automationPortForProject (projectRoot) {
  let hash = 2166136261
  for (const char of String(projectRoot || '')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return 12000 + (hash % 10000)
}

function automationCliArgs (projectRoot, port) {
  return [
    'auto',
    '--project', projectRoot,
    '--auto-port', String(port),
    '--trust-project'
  ]
}

function resolveSdkVersion (toolInfo) {
  if (!toolInfo || typeof toolInfo !== 'object') return ''
  return [toolInfo.SDKVersion, toolInfo.sdkVersion, toolInfo.baseLibraryVersion]
    .find(value => typeof value === 'string' && value.trim()) || ''
}

function installAutomatorVersionCompatibility (MiniProgramClass) {
  const MiniProgram = MiniProgramClass || require('miniprogram-automator/out/MiniProgram').default
  const prototype = MiniProgram && MiniProgram.prototype
  if (!prototype || prototype[PATCH_MARKER]) return false

  Object.defineProperty(prototype, PATCH_MARKER, { value: true })
  prototype.checkVersion = async function checkVersionCompatible () {
    const sdkVersion = resolveSdkVersion(await this.send('Tool.getInfo'))

    // Stable DevTools 2.02.2608040 can omit SDKVersion even though the
    // automation protocol is available. In that case the protocol itself is
    // the capability check, so do not crash before the simulator can run.
    if (!sdkVersion || sdkVersion === 'dev') return
    if (cmpVersion(sdkVersion, MINIMUM_SDK_VERSION) < 0) {
      throw new Error(
        `SDKVersion is currently ${sdkVersion}, while automator(${automatorPackage.version}) ` +
        `requires at least version ${MINIMUM_SDK_VERSION}`
      )
    }
  }
  return true
}

module.exports = {
  MINIMUM_SDK_VERSION,
  automationCliArgs,
  automationPortForProject,
  installAutomatorVersionCompatibility,
  resolveSdkVersion
}
