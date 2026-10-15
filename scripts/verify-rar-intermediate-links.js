'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const zlib = require('node:zlib')
const { rar4Links, rar5Links } = require('../tests/helpers/rar-links')
const { inspectRarArchive, readRarEntry } = require('../miniprogram/file-reader/archive/rar-runtime')

const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))

function bsdtar (args, archive) {
  const result = spawnSync('/usr/bin/bsdtar', args, { input: archive, maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `bsdtar ${args.join(' ')} failed: ${result.stderr.toString()}`)
  return result.stdout
}

async function main () {
  const expected = Buffer.from('独立解压器确认的目标正文')
  const results = []
  for (const [format, make] of [['RAR4', rar4Links], ['RAR5', rar5Links]]) {
    const archive = make([
      { name: 'real/docs', directory: true },
      { name: 'real/docs/child.txt', content: expected },
      { name: 'aliases/folder', target: '../real/docs', directory: true },
      { name: 'shortcut', target: 'aliases/folder/child.txt' }
    ])
    const listing = bsdtar(['-tvf', '-'], archive).toString()
    assert.match(listing, /aliases\/folder -> \.\.\/real\/docs/)
    assert.match(listing, /shortcut -> aliases\/folder\/child\.txt/)
    const nativeTarget = bsdtar(['-xOf', '-', 'real/docs/child.txt'], archive)
    assert.deepEqual(nativeTarget, expected)

    const inspection = await inspectRarArchive(archive, { wasmBinary })
    const shortcut = inspection.entries.find(entry => entry.name === 'shortcut')
    assert.ok(shortcut && shortcut.isLink, `${format} shortcut missing from reader listing`)
    const opened = await readRarEntry(archive, shortcut, { wasmBinary })
    assert.equal(opened.entry.name, 'real/docs/child.txt')
    assert.deepEqual(Buffer.from(opened.bytes), nativeTarget)
    results.push({ format, entries: inspection.entries.length, targetBytes: nativeTarget.length })
  }
  console.log(JSON.stringify({ oracle: 'macOS bsdtar/libarchive', results }, null, 2))
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
