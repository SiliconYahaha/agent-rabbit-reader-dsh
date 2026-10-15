'use strict'

// Caller supplies legally obtained, uudecoded libarchive samples. This script
// neither downloads nor redistributes them, and bsdtar only writes to stdout.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { tombstone } = require('./tombstone')

// verdicts.md T2：只有 docs/release-v1.4.43-dev.md 引用，需要公开 RAR 原件；观察两个发布周期。
tombstone('verify-rar-link-references', '2026-09-02', '只有 docs/release-v1.4.43-dev.md 引用；需要外部 RAR 原件与 bsdtar')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { inspectRarArchive, readRarEntry } = require('../miniprogram/file-reader/archive/rar-runtime')
const profile = require('../compatibility/profiles/rar.json')

async function main () {
  const inputPaths = process.argv.slice(2)
  assert.equal(inputPaths.length, 3, '参数顺序：RAR4 compress_normal、RAR5 symlink、RAR5 hardlink 文件路径')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))
  const expectedLinks = [1, 2, 1]
  const records = []
  for (const [index, inputPath] of inputPaths.entries()) {
    const bytes = fs.readFileSync(inputPath)
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    assert.equal(sha256, profile.publicSamples[index].sha256, '公开样本与已登记固定版本不同')
    const listing = execFileSync('tar', ['-tvf', inputPath], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
    const inspected = await inspectRarArchive(bytes, { wasmBinary })
    const links = inspected.entries.filter(entry => entry.isLink)
    assert.equal(links.length, expectedLinks[index])
    for (const entry of links) {
      const actual = await readRarEntry(bytes, entry, { wasmBinary })
      const targetName = actual.entry.name.replace(/\/$/, '')
      assert.ok(listing.includes(`${entry.name} -> ${targetName}`) || listing.includes(`${entry.name} link to ${targetName}`), '独立目录工具没有相同链接目标')
      if (actual.entry.isDirectory) {
        assert.equal(targetName, 'dir')
        assert.deepEqual(actual.entries, [])
        records.push({ sample: profile.publicSamples[index].name, sha256, link: entry.name, target: targetName, emptyDirectory: true })
      } else {
        const reference = execFileSync('tar', ['-xOf', inputPath, targetName], { timeout: 10000, maxBuffer: 30 * 1024 * 1024 })
        assert.ok(Buffer.from(actual.bytes).equals(reference), '目标正文与系统 bsdtar 不同')
        records.push({ sample: profile.publicSamples[index].name, sha256, link: entry.name, target: targetName, targetBytes: reference.length, targetSha256: crypto.createHash('sha256').update(reference).digest('hex'), contentVerified: true })
      }
    }
  }
  process.stdout.write(JSON.stringify({ version: require('../package.json').version, verifiedAt: new Date().toISOString(), oracle: execFileSync('tar', ['--version'], { encoding: 'utf8' }).trim(), records }, null, 2) + '\n')
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })
