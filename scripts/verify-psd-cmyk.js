'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
const { extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const output = path.resolve(process.argv[2] || 'outputs/psd-cmyk-oracle')
fs.mkdirSync(output, { recursive: true })
const inputs = require('../tests/helpers/psd-cmyk').cases()
for (const filename of process.argv.slice(3)) inputs.push({ name: path.basename(filename), bytes: fs.readFileSync(filename), group: 'public-original' })
for (const input of inputs) fs.writeFileSync(path.join(output, input.name), input.bytes)
const list = path.join(output, 'inputs.json'); fs.writeFileSync(list, JSON.stringify(inputs.map(c => path.join(output, c.name))))
const report = JSON.parse(execFileSync(process.env.PSD_ORACLE_PYTHON || 'python3', [path.join(__dirname, 'psd-cmyk-oracle.py'), list], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 }))
const baselines = require('../tests/fixtures/psd-cmyk-reference.json')
const results = inputs.map(input => {
  const reference = report.results.find(r => r.name === input.name), expected = Buffer.from(reference.rgbaBase64, 'base64')
  const actual = extractPsdComposite(input.bytes)
  assert.deepEqual(Buffer.from(actual.rgba), expected, input.name)
  const pinned = baselines.results.find(r => r.name === input.name)
  if (input.group !== 'public-original') {
    assert.ok(pinned, input.name)
    assert.equal(crypto.createHash('sha256').update(input.bytes).digest('hex'), pinned.sourceSha256)
    assert.equal(reference.rgbaBase64, pinned.rgbaBase64)
  }
  return { name: input.name, group: input.group, depth: reference.depth, sourceSha256: crypto.createHash('sha256').update(input.bytes).digest('hex'), pixels: actual.width * actual.height, rgbaDifference: 0, pillowRGBDifference: reference.pillowRGBDifference, pillowMaximumRGBDifference: reference.pillowMaximumRGBDifference }
})
async function previewFiles () {
  const { designPreview } = require('../tests/helpers/reader-host')
  const { compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
  const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
  const page = designPreview({ env: { USER_DATA_PATH: output }, getFileSystemManager: () => ({
    readFile (options) { const b=fs.readFileSync(options.filePath).subarray(options.position||0,(options.position||0)+options.length);options.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}) },
    writeFile (options) { fs.writeFileSync(options.filePath,Buffer.from(options.data));options.success() }
  }) })
  const opened=[]
  for (const input of inputs.filter(c=>(c.group==='resource-spot'&&c.name.includes('-v2-'))||c.group==='public-original')) {
    page.loadMaterial({name:input.name,path:path.join(output,input.name),size:input.bytes.length})
    for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(page.data.error,'');assert.equal(page.data.loading,false);assert.match(page.data.previewPath,/psd-composite-/)
    const r=report.results.find(r=>r.name===input.name),rgba=Buffer.from(r.rgbaBase64,'base64')
    const pixels=r.alphaIndex==null?rgba:compositeRgbaOnCheckerboard(rgba,r.width)
    const expected=encode({data:pixels,width:r.width,height:r.height},82).data
    assert.deepEqual(fs.readFileSync(page.data.previewPath),Buffer.from(expected),input.name)
    assert.ok(page.data.metadata.some(m=>/未应用 ICC/.test(m.value)))
    fs.copyFileSync(page.data.previewPath,path.join(output,input.name+'.jpg'))
    opened.push({name:input.name,generatedJPEGMatchesReference:true,colorNotice:true})
  }
  const result = { testedAt: new Date().toISOString(), oracle: report.oracle, cases: results.length, exact: results.length, results, actualLocalFilePreview: opened }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ cases: result.cases, exact: result.exact, pillowDifferences: results.filter(r => r.pillowRGBDifference).length, actualLocalFilePreview: opened.length }))
}
previewFiles().catch(error=>{console.error(error);process.exitCode=1})
