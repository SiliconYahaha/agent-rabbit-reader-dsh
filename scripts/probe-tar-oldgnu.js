'use strict'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto'), cp = require('node:child_process')
const { oldGnu, archive } = require('../tests/helpers/tar-oldgnu')
const engineRoot = path.resolve(process.env.TAR_OLDGNU_ENGINE_ROOT || path.join(__dirname, '..'))
const runtime = require(path.join(engineRoot, 'miniprogram/file-reader/archive/tar-runtime'))
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
function cases () {
  const basic = [
    ['unaligned-length', 4096, [[512, Buffer.from('HELLO')]]],
    ['unaligned-offset', 4096, [[513, Buffer.alloc(512, 65)]]],
    ['both-unaligned', 4097, [[513, Buffer.from('HELLO')]]],
    ['all-hole-odd', 4097, []], ['all-hole-zero', 0, []],
    ['aligned-control', 4096, [[512, Buffer.alloc(512, 65)]]],
    ...[4, 25, 65].map(n => ['extension-' + n, n * 64 + 3, Array.from({ length: n }, (_, i) => [i * 64 + 1, Buffer.from('BLOCK' + i)])])
  ]
  return basic.map(([name, size, blocks]) => {
    const expected = Buffer.alloc(size); for (const [offset, b] of blocks) b.copy(expected, offset)
    return { name, size, expected, bytes: archive(oldGnu({ size, blocks })) }
  })
}
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/tar-oldgnu/current'); fs.mkdirSync(out, { recursive: true })
  const wasm = fs.readFileSync(path.join(engineRoot, 'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')), options = { wasmBinary: zlib.brotliDecompressSync(wasm) }, rows = []
  for (const sample of cases()) {
    const file = path.join(out, sample.name + '.tar'); fs.writeFileSync(file, sample.bytes)
    const native = cp.spawnSync('/usr/bin/tar', ['-xOf', file, 'body.bin'], { timeout: 3000 })
    const python = cp.spawnSync('python3', ['-c', "import tarfile,sys; t=tarfile.open(sys.argv[1]); sys.stdout.buffer.write(t.extractfile('body.bin').read())", file], { timeout: 3000 })
    let reader
    try {
      const { entries } = await runtime.inspectTarArchive(sample.bytes, options), entry = entries.find(e => e.name === 'body.bin')
      reader = { listed: entries.map(e => e.name), expectedMemberPresent: !!entry }
      if (entry) { const bytes = Buffer.from(await runtime.extractTarEntry(sample.bytes, entry, options)); reader.exact = bytes.equals(sample.expected); reader.size = bytes.length; reader.sha256 = hash(bytes) }
      const after = entries.find(e => e.name === 'after.html'); reader.followingExact = !!after && Buffer.from(await runtime.extractTarEntry(sample.bytes, after, options)).toString() === '<p>AFTER 正文</p>'
    } catch (error) { reader = { ...reader, error: error.message } }
    rows.push({ name: sample.name, size: sample.size, sourceSha256: hash(sample.bytes), base64: sample.bytes.toString('base64'), expectedSha256: hash(sample.expected), expectedBodyBase64: sample.expected.toString('base64'), bsdtar: { status: native.status, exact: native.stdout.equals(sample.expected), stderr: String(native.stderr) }, python: { status: python.status, exact: python.stdout.equals(sample.expected), stderr: String(python.stderr) }, reader })
  }
  const report = { at: new Date().toISOString(), wasmBrSha256: hash(wasm), generation: 'Authored oldGNU byte-granular holes and sparse maps spanning main header and multiple21-record extensions; deterministic; ordinary following HTML member.', rows }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, bothNativeExact: rows.filter(r => r.bsdtar.exact && r.python.exact).length, readerExact: rows.filter(r => r.reader.exact).length, readerMissing: rows.filter(r => r.reader.expectedMemberPresent === false).length, readerErrors: rows.filter(r => r.reader.error).length }))
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { cases }
