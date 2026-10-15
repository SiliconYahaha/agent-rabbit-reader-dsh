'use strict'

const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')

async function solidArchive (wasmBinary, members, options = {}) {
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  const createdDirectories = new Set(['/'])
  const ensureDirectory = directory => {
    const parts = String(directory || '').split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      if (createdDirectories.has(current)) continue
      engine.FS.mkdir(current)
      createdDirectories.add(current)
    }
  }
  for (const member of members) {
    const name = String(member.name || '').replace(/^\/+|\/+$/g, '')
    const slash = name.lastIndexOf('/')
    if (slash >= 0) ensureDirectory(name.slice(0, slash))
    if (member.directory) {
      ensureDirectory(name)
    } else {
      engine.FS.writeFile(`/${name}`, member.bytes)
    }
  }
  const archiveName = options.archiveName || 'solid.7z'
  const args = [
    'a', '-t7z',
    `-m0=${options.method || `lzma2:d=${options.dictionary || '1m'}`}`,
    `-ms=${options.solid || 'on'}`,
    '-mqs=off'
  ]
  if (options.password) {
    args.push(`-p${String(options.password)}`)
    if (options.headerEncryption !== false) args.push('-mhe=on')
  }
  const archiveInputs = []
  const seenInputs = new Set()
  for (const member of members) {
    const name = String(member.name || '').replace(/^\/+|\/+$/g, '')
    const input = name.includes('/') ? name.split('/')[0] : name
    if (!seenInputs.has(input)) {
      archiveInputs.push(input)
      seenInputs.add(input)
    }
  }
  args.push(
    `/${archiveName}`,
    '--',
    ...archiveInputs.map(name => `/${name}`)
  )
  if (engine.callMain(args) !== 0) throw new Error('无法生成固实 7z 测试样本')
  return new Uint8Array(engine.FS.readFile(`/${archiveName}`))
}

module.exports = { solidArchive }
