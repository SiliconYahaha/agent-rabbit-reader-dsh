'use strict'

const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')
const { zipSync } = require('fflate')
const names = [
  ...[7, 8, 9, 10, 11, 12, 13, 27].map(code => `a${String.fromCharCode(code)}b.txt`),
  'a_b.txt', 'a\n\nPath = fake.txt', 'a\nSize = 9999999.txt',
  'a\n\n----------\nCRC = 00000000.txt', '目录\t兔/说明\n🐇.txt',
  ' leading\ttrailing.txt ', 'tab\t*.txt', 'tab_secret.txt', 'empty\n.txt',
  'literal\\backslash.html', 'literal/backslash.html'
]
const files = Object.fromEntries(names.map((name, index) => [name, Buffer.from(`原始成员 ${index} 正文，不能被替换：${JSON.stringify(name)}`)]))

async function nativeNamesArchive (wasmBinary, format, password = '') {
  if (format === 'zip') return zipSync(files)
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  for (const [name, bytes] of Object.entries(files)) {
    const parts = name.split('/')
    let directory = ''
    for (const part of parts.slice(0, -1)) {
      directory += '/' + part
      try { engine.FS.mkdir(directory) } catch (_) {}
    }
    engine.FS.writeFile('/' + name, bytes)
  }
  const args = ['a', '-t7z', '-m0=lzma2', '-ms=on', '/control.7z']
  if (password) args.push(`-p${password}`, '-mhe=on')
  args.push('--', ...names)
  if (engine.callMain(args) !== 0) throw new Error('Native name fixture generation failed')
  return engine.FS.readFile('/control.7z')
}

module.exports = { files, names, nativeNamesArchive }
