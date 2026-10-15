'use strict'

// Independent engines receive original archive bytes. Name display and byte
// extraction are recorded separately: Python3.9 does not interpret 0x7075.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib')
const { spawnSync } = require('node:child_process'), assert = require('node:assert/strict')
const { inspectZip, extractZipEntry } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { zipMember } = require('../tests/helpers/zip-integrity')
const { localNameMismatch, localZip64, variants } = require('../tests/helpers/zip-local-identity')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const root = path.resolve(__dirname, '..')
assert.ok(process.argv[2], 'Supply an existing task scratch directory')
const out = fs.mkdtempSync(path.join(path.resolve(process.argv[2]), 'zip-identity-'))
const samples = require('../tests/fixtures/zip-local-identity/samples.json')
const tasks = samples.map(s => ({ ...s, bytes: fs.readFileSync(path.join(root, 'tests/fixtures/zip-local-identity', s.name)) }))
const emptyFixed = Buffer.from([0x03, 0x00])
const emptyStored = Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff])
for (let n = 0; n < 24; n++) {
  const content = Buffer.from((`empty-tail-${n}-正文-` + 'ABC😀').repeat(n + 1))
  const raw = zlib.deflateRawSync(content, { level: n % 10, strategy: [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY][n % 3] })
  const tail = n % 3 === 0 ? emptyFixed : n % 3 === 1 ? emptyStored : Buffer.concat([emptyFixed, emptyStored])
  tasks.push({ name: `generated-empty-tail-${n}`, bytes: zipMember({ content, packed: Buffer.concat([raw, tail]) }), expected: hash(content) })
}
for (const c of variants) {
  tasks.push({ name: c.name, bytes: zipMember(c), expected: hash(c.content) })
  tasks.push({ name: c.name + '-mismatch', bytes: localNameMismatch(c), reject: true })
}
for (const method of [0, 8]) for (const descriptor of [false, 'signed', 'unsigned']) {
  const content = Buffer.from('ZIP64 占位及正文')
  tasks.push({ name: `zip64-${method}-${descriptor}`, bytes: localZip64({ content, method, descriptor }), expected: hash(content) })
}
const python = spawnSync('python3', ['-c', `import io,sys,json,base64,zipfile,hashlib,platform
result=[]
for t in json.load(sys.stdin):
 rows=[]
 try:
  with zipfile.ZipFile(io.BytesIO(base64.b64decode(t['base64']))) as z:
   for e in z.infolist():
    try:
     b=z.read(e); rows.append(dict(name=e.filename,size=len(b),sha256=hashlib.sha256(b).hexdigest()))
    except Exception as ex: rows.append(dict(name=e.filename,error=str(ex)))
  result.append(dict(name=t['name'],entries=rows))
 except Exception as ex: result.append(dict(name=t['name'],error=str(ex)))
print(json.dumps(dict(version=platform.python_version(),results=result)))`], {
  input: JSON.stringify(tasks.map(t => ({ name: t.name, base64: t.bytes.toString('base64') }))), encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024
})
assert.equal(python.status, 0, python.stderr)
const reference = JSON.parse(python.stdout), results = []
for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i], ref = reference.results[i]
  assert.equal(ref.name, task.name)
  if (task.sha256) assert.equal(hash(task.bytes), task.sha256)
  const entries = inspectZip(task.bytes).entries.filter(e => !e.isDirectory)
  if (task.reject) {
    assert.match(ref.entries[0].error, /directory.*header.*differ/)
    assert.throws(() => extractZipEntry(task.bytes, entries[0]), /文件名不一致/)
    results.push({ name: task.name, readerRejected: true, python: ref }); continue
  }
  const expectedHashes = task.entries ? task.entries.map(e => e.sha256).sort() : [task.expected]
  assert.deepEqual(ref.entries.map(e => e.sha256).sort(), expectedHashes)
  let readerError = '', reader = []
  for (const e of entries) {
    try { const data = extractZipEntry(task.bytes, e); reader.push({ name: e.name, size: data.length, sha256: hash(data) }) } catch (error) { readerError = error.message }
  }
  assert.equal(readerError, '')
  assert.deepEqual(reader.map(e => e.sha256).sort(), expectedHashes)
  let sevenZip, bsdtar
  if (task.sha256) {
    const inputPath = path.join(root, 'tests/fixtures/zip-local-identity', task.name)
    // Use raw 7-Zip FS output, not the reader's technical-listing parser. Its
    // error exit code is isolated in a child so failures cannot poison this run.
    const native = spawnSync(process.execPath, ['-e', `
      const fs=require('fs'),zlib=require('zlib'),crypto=require('crypto'),Seven=require('./miniprogram/file-reader/sevenzip/runtime/7zz');
      Seven({wasmBinary:zlib.brotliDecompressSync(fs.readFileSync('./miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')),print(){},printErr(){}}).then(e=>{
        e.FS.writeFile('/input.zip',fs.readFileSync(process.argv[1]));let code;
        try{code=e.callMain(['x','/input.zip','-o/out','-y'])}catch(x){code=x.status||2}
        const rows=[];function walk(p){for(const n of e.FS.readdir(p)){if(n==='.'||n==='..')continue;const f=p+'/'+n;if(e.FS.isDir(e.FS.stat(f).mode))walk(f);else{const b=e.FS.readFile(f);rows.push({name:f.slice(5),size:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')})}}}
        if(e.FS.analyzePath('/out').exists)walk('/out');console.log(JSON.stringify({code,entries:rows}));
      }).catch(x=>{console.log(JSON.stringify({error:x.message}));process.exitCode=1})
    `, inputPath], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    if (native.error) throw native.error
    sevenZip = { exitCode: native.status, ...JSON.parse(native.stdout) }
    assert.deepEqual(sevenZip.entries.map(e => e.sha256).sort(), expectedHashes)
    const tar = spawnSync('bsdtar', ['-xOf', inputPath], { timeout: 10000, maxBuffer: 1024 * 1024 })
    // Concatenation order differs from our displayed sorting: record its real
    // output digest; exact per-member bytes are checked using Python/raw7z.
    bsdtar = { exitCode: tar.status, size: tar.stdout.length, sha256: hash(tar.stdout), stderr: tar.stderr.toString() }
  }
  results.push({ name: task.name, inputSha256: hash(task.bytes), reader, readerError, python: ref, sevenZip, bsdtar })
}
const tarVersion = spawnSync('bsdtar', ['--version'], { encoding: 'utf8', timeout: 10000 })
assert.equal(tarVersion.status, 0)
const wasm = require('node:zlib').brotliDecompressSync(fs.readFileSync(path.join(root, 'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const report = { testedAt: new Date().toISOString(), node: process.version, python: reference.version, bsdtar: tarVersion.stdout.trim(), sevenZipWasmSha256: hash(wasm), publicOriginals: 3, publicContentPasses: 3, publicEntriesMatched: 7, retainedDeflateGap: 0, generatedEmptyTailStreams: 24, generatedNormal: 60, generatedNameRejects: 60, localZip64Variants: 6, results }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ out, ...report, results: undefined }, null, 2))
