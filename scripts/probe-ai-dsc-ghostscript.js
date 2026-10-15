'use strict'

// Independent interpreter, installed only in ignored verification output:
// npm install --prefix outputs/ai-dsc/native-oracle --ignore-scripts @jspawn/ghostscript-wasm@0.0.2
// HTML_READER_GHOSTSCRIPT=absolute/path/to/@jspawn/ghostscript-wasm node scripts/probe-ai-dsc-ghostscript.js
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { cases, dataCases } = require('../tests/helpers/ai-dsc')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
async function worker () {
  const [, , , input, output, dimensions] = process.argv
  const root = process.env.HTML_READER_GHOSTSCRIPT
  const factory = require(root), wasm = fs.readFileSync(path.join(root, 'gs.wasm'))
  const gs = await factory({ noInitialRun: true, instantiateWasm: (imports, receive) => {
    WebAssembly.instantiate(wasm, imports).then(result => receive(result.instance))
    return {}
  } })
  gs.FS.writeFile('/input.eps', fs.readFileSync(input))
  const page = dimensions ? ['-dNOEPS', '-g' + dimensions] : ['-dEPSCrop']
  const status = gs.callMain(['-dSAFER', '-dBATCH', '-dNOPAUSE', ...page, '-sDEVICE=png16m', '-r72', '-sOutputFile=/output.png', '-f', '/input.eps', '-c', 'showpage'])
  if (status !== 0) { process.exitCode = status || 1; return }
  fs.writeFileSync(output, gs.FS.readFile('/output.png'))
}
function main () {
  const root = process.env.HTML_READER_GHOSTSCRIPT
  if (!root || !path.isAbsolute(root)) throw new Error('Set HTML_READER_GHOSTSCRIPT to the isolated interpreter package directory')
  const out = path.resolve(process.argv[2] || 'outputs/ai-dsc/ghostscript')
  fs.mkdirSync(out, { recursive: true })
  const rows = []
  for (const sample of [...cases().filter(s => s.box), ...dataCases()]) {
    const input = path.join(out, sample.name + '.eps'), output = path.join(out, sample.name + '.png')
    fs.writeFileSync(input, sample.bytes)
    // This build fails inside EPSBoundingBoxProcess on a legal (atend)
    // declaration. Preserve that failure; a fixed canvas only verifies artwork.
    const fixedCanvas = sample.name.startsWith('parent-box-')
    const run = spawnSync(process.execPath, [__filename, '--worker', input, output, ...(fixedCanvas ? [sample.box.join('x')] : [])], { timeout: 15000, maxBuffer: 1024 * 1024 })
    const row = { name: sample.name, sourceSha256: hash(sample.bytes), base64: sample.bytes.toString('base64'), expectedBox: sample.box, framing: fixedCanvas ? 'explicit canvas; not an independent BoundingBox check' : 'Ghostscript EPSCrop', status: run.status, signal: run.signal, stdout: run.stdout.toString().trim(), stderr: run.stderr.toString().trim() }
    if (run.status === 0 && fs.existsSync(output)) {
      const bytes = fs.readFileSync(output)
      row.png = { file: path.basename(output), sha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      row.dimensionsExact = row.png.width === sample.box[0] && row.png.height === sample.box[1]
    }
    rows.push(row)
  }
  const failures = rows.filter(r => r.status !== 0 || !r.dimensionsExact).map(r => r.name)
  const report = { testedAt: new Date().toISOString(), interpreter: 'Ghostscript 9.56.0, independently built @jspawn/ghostscript-wasm 0.0.2', wasmSha256: hash(fs.readFileSync(path.join(root, 'gs.wasm'))), source: 'https://github.com/jsscheller/ghostscript-wasm', scope: 'Original EPS byte streams executed in a separate process/virtual filesystem; -c showpage asks the interpreter to display EPS artwork without rewriting input. Does not compare EPSI preview comments to painted artwork. Pixel comparisons performed separately in verify-ai-dsc.js.', cases: rows.length, failures, rows }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, failures }))
  if (failures.length) process.exitCode = 1
}
if (process.argv[2] === '--worker') worker().catch(e => { console.error(e); process.exitCode = 1 })
else main()
