'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto'), http = require('node:http')
const baseline = process.argv.indexOf('--baseline-ref')
if (baseline >= 0) {
  const { execFileSync } = require('node:child_process'), Module = require('node:module')
  const filename = require.resolve('../miniprogram/file-reader/engine/core/design-file')
  const previous = new Module(filename, module); previous.filename = filename; previous.paths = module.paths
  previous._compile(execFileSync('git', ['show', process.argv[baseline + 1] + ':miniprogram/file-reader/engine/core/design-file.js'], { encoding: 'utf8' }), filename)
  require.cache[filename] = previous
}
const icc = process.argv.includes('--icc')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview, flush } = require('../tests/helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const { chromeTestResult } = require('./chrome-test-result')
const originals = path.resolve(process.argv[2]), out = path.resolve(process.argv[3])
const difference = (actual, expected) => { let count = 0, max = 0; for (let i = 0; i < actual.length; i++) { const d = Math.abs(actual[i] - expected[i]); if (d) count++; max = Math.max(max, d) } return { count, max } }
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const refs = JSON.parse(fs.readFileSync(path.join(originals, 'references.json')))
  assert.equal(refs.results.length, icc ? 144 : 72)
  assert.equal(new Set(refs.results.map(ref => ref.name)).size, refs.results.length)
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: out }, getFileSystemManager: () => ({
    readFile (o) { const b = input.subarray(o.position || 0, (o.position || 0) + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const results = [], samples = []
  for (const ref of refs.results) {
    input = fs.readFileSync(path.join(originals, ref.name))
    assert.equal(crypto.createHash('sha256').update(input).digest('hex'), ref.sha256)
    const expected = Buffer.from(ref.rgbaBase64, 'base64'), actual = extractPsdComposite(input)
    assert.deepEqual([actual.width, actual.height], [ref.width, ref.height])
    const transparent = ref.transparent == null ? ref.mode !== 'opaque' : ref.transparent
    const pixels = transparent ? compositeRgbaOnCheckerboard(expected, ref.width) : expected
    const expectedJpeg = Buffer.from(encode({ data: pixels, width: ref.width, height: ref.height }, 82).data)
    written = null; host.loadMaterial({ name: ref.name, path: path.join(originals, ref.name), size: input.length }); await flush()
    assert.equal(host.data.error, ''); assert.equal(host.data.loading, false); assert.match(host.data.previewPath, /psd-composite-/); assert.ok(written)
    const row = { name: ref.name, source: difference(actual.rgba, expected), hostJpegExact: written.equals(expectedJpeg), numpyVisibleMaxDelta: ref.numpyVisibleMaxDelta, colorProfile: actual.colorProfile || null, hostProfileMessage: host.data.metadata.some(item => item.value === '已按文件色彩配置还原') }
    results.push(row)
    samples.push({ name: ref.name, actual: written.toString('base64'), expected: expectedJpeg.toString('base64'), width: ref.width, height: ref.height })
  }
  const good = input, goodJpeg = written
  input = Buffer.from('8BPS invalid'); written = null
  host.loadMaterial({ name: 'bad.psd', path: '/local/bad.psd', size: input.length }); await flush()
  const rejected = !host.data.previewPath && written === null
  input = good; host.loadMaterial({ name: 'recovered.psb', path: '/local/recovered.psb', size: input.length }); await flush()
  const recovery = { rejected, ready: !host.data.loading && !host.data.error && Boolean(host.data.previewPath) && Boolean(written), jpegExact: Boolean(written && written.equals(goodJpeg)) }
  const html = `<!doctype html><meta charset="utf-8"><output></output><script>(async()=>{try{
    const rows=[], samples=await(await fetch('/samples')).json();
    const decode=async(src)=>{const i=new Image();i.src='data:image/jpeg;base64,'+src;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return {width:c.width,height:c.height,pixels:x.getImageData(0,0,c.width,c.height).data}};
    for(const s of samples){const a=await decode(s.actual),e=await decode(s.expected);let count=0,max=0;for(let i=0;i<a.pixels.length;i++){const d=Math.abs(a.pixels[i]-e.pixels[i]);if(d)count++;max=Math.max(max,d)}rows.push({name:s.name,width:a.width,height:a.height,count,max})}
    document.querySelector('output').setAttribute('data-result',btoa(JSON.stringify(rows)))
    }catch(e){document.querySelector('output').setAttribute('data-error',e.stack)}})()</script>`
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/samples' ? 'application/json' : 'text/html'); res.end(req.url === '/samples' ? JSON.stringify(samples) : html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`)
    fs.writeFileSync(path.join(out, 'browser.html'), dom)
    const match = dom.match(/data-result="([^"]+)"/); assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1])
    browser = JSON.parse(Buffer.from(match[1], 'base64').toString())
  } finally { server.close() }
  assert.equal(browser.length, samples.length)
  browser.forEach((row, i) => assert.deepEqual([row.width, row.height], [samples[i].width, samples[i].height]))
  const report = { results, recovery, browser }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ files: results.length, sourceWrong: results.filter(r => r.source.count).length, hostJpegWrong: results.filter(r => !r.hostJpegExact).length, browserWrong: browser.filter(r => r.count).length, recovery }))
  if (!process.argv.includes('--record')) { assert.ok(results.every(r => !r.source.count && r.hostJpegExact && (!icc || (r.colorProfile === 'applied' && r.hostProfileMessage)))); assert.ok(browser.every(r => !r.count)); assert.deepEqual(recovery, { rejected: true, ready: true, jpegExact: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
