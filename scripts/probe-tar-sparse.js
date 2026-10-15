'use strict'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto')
const tar = require('../miniprogram/file-reader/archive/tar-runtime')
const out = path.resolve(process.argv[2] || 'outputs/tar-sparse/current')
const report = JSON.parse(fs.readFileSync('tests/fixtures/tar-sparse/before.json'))
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')) }
async function main () {
  fs.mkdirSync(out, { recursive: true })
  for (const row of report.rows) {
    const bytes = Buffer.from(row.base64, 'base64'), expected = Buffer.from(row.expectedBodyBase64, 'base64')
    if (sha(bytes) !== row.sha256 || sha(expected) !== row.expectedSha256) throw Error(row.name + ' hash mismatch')
    try {
      const info = await tar.inspectTarArchive(bytes, options), selected = info.entries.find(e => e.name !== 'after.txt')
      const body = Buffer.from(await tar.extractTarEntry(bytes, selected, options))
      row.current = { selectedName: selected.name, declaredSize: selected.uncompressedSize, size: body.length, exact: body.equals(expected), sha256: sha(body), prefixBase64: body.subarray(0, 80).toString('base64') }
      const after = info.entries.find(e => e.name === 'after.txt')
      row.current.afterExact = !!after && Buffer.from(await tar.extractTarEntry(bytes, after, options)).toString() === 'AFTER\n'
    } catch (error) { row.current = { error: error.message } }
  }
  report.probedAt = new Date().toISOString()
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ sources: report.rows.length, wrongNames: report.rows.filter(r => r.current.selectedName !== 'body.bin').length, wrongBodies: report.rows.filter(r => !r.current.exact).length, followingMemberExact: report.rows.filter(r => r.current.afterExact).length }))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
