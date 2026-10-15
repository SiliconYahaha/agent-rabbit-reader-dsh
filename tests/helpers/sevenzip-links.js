'use strict'

const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')

async function sevenZipLinks (members, wasmBinary, options = {}) {
  const logs = []
  const engine = await SevenZip({ wasmBinary, print: value => logs.push(value), printErr: value => logs.push(value) })
  const sources = members.map((_, index) => `source-${String(index).padStart(3, '0')}`)
  members.forEach((member, index) => {
    if (member.target !== undefined) engine.FS.symlink(member.target, `/${sources[index]}`)
    else engine.FS.writeFile(`/${sources[index]}`, Buffer.from(member.content || ''))
  })
  const args = ['a', '-t7z', '-snl', `-m0=${options.codec || 'lzma2'}`, `-ms=${options.solid === false ? 'off' : 'on'}`, '-mtc=off', '-mta=off', '-mtm=off', '/links.7z', '--', ...sources]
  if (options.plainHeader) args.splice(2, 0, '-mhc=off')
  if (options.password) args.splice(2, 0, `-p${options.password}`, '-mhe=on')
  if (engine.callMain(args)) throw new Error(`7z fixture creation failed: ${logs.join('\n')}`)
  const rename = ['rn', '/links.7z']
  if (options.plainHeader) rename.push('-mhc=off')
  if (options.password) rename.push(`-p${options.password}`)
  rename.push('--', ...sources.flatMap((source, index) => [source, members[index].name]))
  if (engine.callMain(rename)) throw new Error(`7z fixture rename failed: ${logs.join('\n')}`)
  return Buffer.from(engine.FS.readFile('/links.7z'))
}

const body = '<h1>7z 链接真实正文 🐇</h1><p>second paragraph</p>'
const safeMembers = [
  { name: 'real/docs/page.html', content: body },
  { name: 'real/docs/empty.txt', content: '' },
  { name: 'real/docs/data.bin', content: Buffer.from([0, 255, 128, 10, 13, 1]) },
  { name: 'literal\\file.html', content: '<h1>literal backslash</h1>' },
  { name: 'literal/file.html', content: '<h1>nested decoy</h1>' },
  { name: '中文/🐇.html', content: '<h1>Unicode body</h1>' },
  { name: 'direct', target: 'real/docs/page.html' },
  { name: 'aliases/relative', target: '../real/docs/page.html' },
  { name: 'aliases/folder', target: '../real/docs' },
  { name: 'intermediate', target: 'aliases/folder/page.html' },
  { name: 'chained', target: 'direct' },
  { name: 'backslash', target: 'literal\\file.html' },
  { name: 'unicode', target: '中文/🐇.html' },
  { name: 'empty', target: 'real/docs/empty.txt' },
  { name: 'binary', target: 'real/docs/data.bin' },
  { name: 'root', target: '.' }
]
const destinations = { direct: 'real/docs/page.html', 'aliases/relative': 'real/docs/page.html', intermediate: 'real/docs/page.html', chained: 'real/docs/page.html', backslash: 'literal\\file.html', unicode: '中文/🐇.html', empty: 'real/docs/empty.txt', binary: 'real/docs/data.bin' }

module.exports = { sevenZipLinks, safeMembers, destinations, body }

// Original Copy-only 7z fixture: independent header construction lets tests
// represent payloads that a filesystem symlink API cannot create (NUL/UTF-8
// errors and the 4096-byte boundary). Each member has its own Copy folder.
function rawCopyLinks (members) {
  const { crc32 } = require('./archive-duplicates')
  const uint = value => {
    let size = 0
    while (value >= 2 ** (7 + 7 * size) && size < 8) size++
    const bytes = Buffer.alloc(size + 1)
    bytes[0] = ((0xff << (8 - size)) & 0xff) | (size < 8 ? Math.floor(value / 2 ** (8 * size)) : 0)
    for (let n = 0; n < size; n++) bytes[n + 1] = Math.floor(value / 2 ** (8 * n)) & 255
    return bytes
  }
  const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes }
  const data = members.map(m => Buffer.from(m.targetBytes === undefined ? m.content : m.targetBytes))
  if (data.some(b => !b.length)) throw new Error('Copy fixture requires nonempty streams')
  const sizes = data.map(b => uint(b.length))
  const names = Buffer.concat([Buffer.from([0]), ...members.map(m => Buffer.from(m.name + '\0', 'utf16le'))])
  const attrs = Buffer.concat([Buffer.from([1, 0]), ...members.map(m => u32(m.targetBytes === undefined ? 0x81a48020 : 0xa1ff8020))])
  const header = Buffer.concat([
    Buffer.from([1, 4, 6, 0]), uint(members.length), Buffer.from([9]), ...sizes, Buffer.from([0, 7, 11]), uint(members.length), Buffer.from([0]),
    ...members.map(() => Buffer.from([1, 1, 0])), Buffer.from([12]), ...sizes,
    Buffer.from([10, 1]), ...data.map(b => u32(crc32(b))), Buffer.from([0, 8, 0, 0, 5]), uint(members.length),
    Buffer.from([17]), uint(names.length), names, Buffer.from([21]), uint(attrs.length), attrs, Buffer.from([0, 0])
  ])
  const start = Buffer.alloc(32)
  Buffer.from('377abcaf271c0004', 'hex').copy(start)
  start.writeBigUInt64LE(BigInt(data.reduce((sum, b) => sum + b.length, 0)), 12)
  start.writeBigUInt64LE(BigInt(header.length), 20)
  start.writeUInt32LE(crc32(header), 28)
  start.writeUInt32LE(crc32(start.subarray(12)), 8)
  return Buffer.concat([start, ...data, header])
}
module.exports.rawCopyLinks = rawCopyLinks
