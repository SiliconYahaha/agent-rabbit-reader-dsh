'use strict'

// Run probe-psd-gray-tone.py first. Expected samples come from the independent
// producer's saved planes and Pillow decode, never from extractPsdComposite.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const http = require('node:http')
const { chromeTestResult } = require('./chrome-test-result')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview, flush } = require('../tests/helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const jpeg = require('jpeg-js')
const originals = path.resolve(process.argv[2] || 'outputs/psd-alpha-colors/originals')
const output = path.resolve(process.argv[3] || 'outputs/psd-alpha-colors/verified')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main () {
  fs.mkdirSync(output, { recursive: true })
  const references = JSON.parse(fs.readFileSync(path.join(originals, 'references.json')))
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: output }, getFileSystemManager: () => ({
    readFile (o) { const start = o.position || 0, bytes = input.subarray(start, start + o.length); o.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const results = []
  const browserSamples = []
  assert.equal(references.results.length, 32)
  for (const reference of references.results) {
    input = fs.readFileSync(path.join(originals, reference.name))
    assert.equal(hash(input), reference.sha256, reference.name)
    const expected = Buffer.from(reference.rgbaBase64, 'base64')
    const pillow = Buffer.from(reference.pillowRgbaBase64, 'base64')
    const result = extractPsdComposite(input)
    assert.deepEqual([result.width, result.height], [reference.width, reference.height])
    assert.deepEqual(Buffer.from(result.rgba), expected, reference.name)
    assert.ok(Math.max(...pillow.map((v, i) => Math.abs(v - expected[i]))) <= 1)
    written = null
    host.loadMaterial({ name: reference.name, path: path.join(originals, reference.name), size: input.length })
    await flush()
    assert.equal(host.data.loading, false); assert.equal(host.data.error, '')
    assert.match(host.data.previewPath, /psd-composite-/)
    const pixels = reference.transparent ? compositeRgbaOnCheckerboard(expected, reference.width) : expected
    const expectedJpeg = Buffer.from(encode({ data: pixels, width: reference.width, height: reference.height }, 82).data)
    assert.deepEqual(written, expectedJpeg, reference.name)
    const visible = jpeg.decode(written, { useTArray: true })
    assert.deepEqual([visible.width, visible.height], [reference.width, reference.height])
    const previewMaxChannelDelta = Math.max(...visible.data.map((v, i) => Math.abs(v - pixels[i])))
    fs.writeFileSync(path.join(output, reference.name + '.jpg'), written)
    browserSamples.push({ name: reference.name, jpg: written.toString('base64'), rgba: Buffer.from(pixels).toString('base64'), width: reference.width, height: reference.height })
    results.push({ name: reference.name, sourceSha256: reference.sha256, sourcePixelsExact: true,
      pillowMaxChannelDelta: reference.pillowMaxChannelDelta, actualHostJpegExact: true,
      previewMaxChannelDelta, previewSha256: hash(written) })
  }
  let browser = null
  if (process.argv.includes('--browser')) {
    const html = `<!doctype html><meta charset="utf-8"><style>img{display:block;width:390px;image-rendering:pixelated}</style><main></main><output></output><script>
    (async()=>{const out=document.querySelector('output');try{const samples=await(await fetch('/samples.json')).json(),rows=[];
    for(const s of samples){const img=new Image();img.src='data:image/jpeg;base64,'+s.jpg;await img.decode();document.querySelector('main').append(img);
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const got=ctx.getImageData(0,0,c.width,c.height).data,expected=atob(s.rgba);let max=0;
      for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-expected.charCodeAt(i)));
      rows.push({name:s.name,width:img.naturalWidth,height:img.naturalHeight,visible:img.getBoundingClientRect().height>0,maxChannelDelta:max});
    }out.setAttribute('data-result',btoa(JSON.stringify(rows)));}catch(e){out.setAttribute('data-error',e.stack)}})();</script>`
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/samples.json' ? 'application/json' : 'text/html')
      res.end(req.url === '/samples.json' ? JSON.stringify(browserSamples) : html)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const dom = await chromeTestResult(`http://127.0.0.1:${server.address().port}`)
      fs.writeFileSync(path.join(output, 'browser.html'), dom)
      const match = dom.match(/data-result="([^"]+)"/)
      assert.ok(match, dom.match(/data-error="([^"]*)"/)?.[1] || 'Browser did not finish')
      browser = JSON.parse(Buffer.from(match[1], 'base64').toString())
      assert.equal(browser.length, browserSamples.length)
      for (const [i, row] of browser.entries()) {
        assert.equal(row.visible, true)
        assert.deepEqual([row.width, row.height], [browserSamples[i].width, browserSamples[i].height])
        // JPEG82 has up to 2 levels of measured loss on these ramps; allow one
        // further level for independent native JPEG rounding, never source loss.
        assert.ok(row.maxChannelDelta <= 3, `${row.name}: browser JPEG error ${row.maxChannelDelta}`)
      }
    } finally { server.close() }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ producer: references.producer, results, browser,
    limits: ['Host file API mocked; native WeChat and physical devices not run.', 'JPEG preview is lossy; error measured separately from saved source pixels.', 'Unprofiled merged grayscale only; no ICC or layer compositing claim.'] }, null, 2) + '\n')
  console.log(JSON.stringify({ originals: results.length, sourcePixelsExact: results.length, actualHostJpegs: results.length,
    browserViews: browser?.length || 0,
    maximumJpegChannelDelta: Math.max(...results.map(r => r.previewMaxChannelDelta)) }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
