'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto'), http = require('node:http')
const { extractPsdThumbnail } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview, flush } = require('../tests/helpers/reader-host')
const { resourceData } = require('../tests/helpers/psd-thumbnails')
const { chromeTestResult } = require('./chrome-test-result')
const out = path.resolve('outputs/psd-thumbnails/verified'), originals = path.resolve('outputs/psd-thumbnails/originals')
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const references = JSON.parse(fs.readFileSync(path.join(originals, 'references.json')))
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: out }, getFileSystemManager: () => ({
    readFile (o) { const start = o.position || 0, data = input.subarray(start, start + o.length); o.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  const rows = []
  for (const sample of references.samples) {
    input = fs.readFileSync(path.join(originals, sample.name)); written = null
    assert.equal(hash(input), sample.sha256)
    const resources = Buffer.from(sample.resourcesBase64, 'base64')
    const thumbnail = extractPsdThumbnail(resources)
    assert.equal(thumbnail.resourceId, sample.resourceId)
    if (thumbnail.sourceFormat === 'raw') assert.deepEqual(Buffer.from(thumbnail.rgba), Buffer.from(sample.rgbaBase64, 'base64'))
    else assert.deepEqual(Buffer.from(thumbnail.jpeg), resourceData(resources, sample.resourceId).subarray(28))
    host.loadMaterial({ name: sample.name, path: path.join(originals, sample.name), size: input.length })
    await flush()
    assert.equal(host.data.loading, false); assert.equal(host.data.error, '')
    assert.match(host.data.previewPath, /psd-preview-/)
    assert.match(host.data.message, /缩略图/)
    assert.ok(written)
    if (thumbnail.jpeg) assert.deepEqual(written, Buffer.from(thumbnail.jpeg))
    fs.writeFileSync(path.join(out, sample.name + '.jpg'), written)
    rows.push({ name: sample.name, sourceSha256: sample.sha256, previewSha256: hash(written), sourceFormat: thumbnail.sourceFormat, resourceId: thumbnail.resourceId })
  }
  let browser = null
  if (process.argv.includes('--browser')) {
    const pillow = JSON.parse(fs.readFileSync(path.join(out, 'pillow.json')))
    const samples = pillow.rows.map(s => {
      const jpg = fs.readFileSync(path.join(out, s.name + '.jpg'))
      assert.equal(hash(jpg), s.sha256)
      return { ...s, jpg: jpg.toString('base64') }
    })
    const html = `<!doctype html><meta charset="utf-8"><style>img{display:block;width:240px;image-rendering:pixelated;margin:8px}</style><main></main><output></output><script>
    (async()=>{try{const rows=[];for(const s of await(await fetch('/samples')).json()){
    const image=new Image();image.src='data:image/jpeg;base64,'+s.jpg;await image.decode();document.querySelector('main').append(image);
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const got=ctx.getImageData(0,0,canvas.width,canvas.height).data,expected=atob(s.rgbaBase64);
    let max=0;for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-expected.charCodeAt(i)));
    rows.push({name:s.name,width:canvas.width,height:canvas.height,visible:image.getBoundingClientRect().height>0,maxDelta:max});
    }document.querySelector('output').setAttribute('data-result',btoa(JSON.stringify(rows)))}catch(e){document.querySelector('output').setAttribute('data-error',e.stack)}})();</script>`
    const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/samples' ? 'application/json' : 'text/html'); res.end(req.url === '/samples' ? JSON.stringify(samples) : html) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const dom = await chromeTestResult('http://127.0.0.1:' + server.address().port)
      fs.writeFileSync(path.join(out, 'browser.html'), dom)
      const result = dom.match(/data-result="([^"]+)"/)
      assert.ok(result, dom)
      browser = JSON.parse(Buffer.from(result[1], 'base64').toString())
      assert.equal(browser.length, samples.length)
      for (const [i, row] of browser.entries()) {
        assert.equal(row.visible, true)
        assert.deepEqual([row.width, row.height], [samples[i].width, samples[i].height])
        assert.equal(row.maxDelta, 0, row.name + ' Chrome versus independent Pillow native decode')
      }
    } finally { server.close() }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ seed: references.seed, rows, browser, nativeWeChat: 'separate verifier', phones: 'not run', preview: 'bounded embedded thumbnail, JPEG output is lossy; no full-resolution/layer claim' }, null, 2) + '\n')
  console.log(JSON.stringify({ originals: rows.length, correctSelection: rows.length, actualComponentPreviews: rows.length, browserImages: browser?.length || 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
