'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { cases } = require('./helpers/psd-cmyk')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { extractPsdComposite, compositeRgbaOnCheckerboard } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview } = require('./helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const reference = require('./fixtures/psd-cmyk-reference.json')
const samples = cases()
for (const group of ['original', 'opaque', 'alpha', 'spot', 'resource-spot', 'precision']) test(`CMYK ${group}: real PSD/PSB bytes match independently decoded full-precision reference`, () => {
  for (const input of samples.filter(c => c.group === group)) {
    const r = reference.results.find(r => r.name === input.name)
    assert.equal(crypto.createHash('sha256').update(input.bytes).digest('hex'), r.sourceSha256, input.name)
    const actual = extractPsdComposite(input.bytes)
    assert.deepEqual(Buffer.from(actual.rgba), Buffer.from(r.rgbaBase64, 'base64'), input.name)
    assert.equal(actual.width, r.width); assert.equal(actual.height, r.height)
  }
})
test('CMYK black plate attenuates rather than clips mixed inks, and 16-bit plates round only at final RGB', () => {
  assert.deepEqual(Array.from(extractPsdComposite(psdAlphaFixture({ mode:4,colors:[.5,.5,.5,.5],extraChannel:false,flag:'none',width:1,height:1 })).rgba),[64,64,64,255])
  // Both encoded 16-bit plates are below the 8-bit rounding threshold. Early
  // plate quantization produces 21; the original-precision product is 22.
  assert.deepEqual(Array.from(extractPsdComposite(psdAlphaFixture({ mode:4,depth:16,colors:[.291,.291,.291,.291],extraChannel:false,flag:'none',width:1,height:1 })).rgba),[22,22,22,255])
})
test('actual design preview writes oracle-colored JPEGs, preserves alpha/spot, and recovers after invalid CMYK', async () => {
  let input, written
  const page = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (options) { const start=options.position||0,b=input.bytes.subarray(start,start+options.length); options.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}) },
    writeFile (options) { written=Buffer.from(options.data); options.success() }
  }) })
  const sequence = samples.filter(c => c.group === 'resource-spot' && c.name.includes('-v2-'))
  const bad = { name:'invalid-32bit-cmyk.psd',bytes:psdAlphaFixture({mode:4,depth:32}) }
  sequence.splice(4,0,bad)
  for (input of sequence) {
    written=null;page.loadMaterial({name:input.name,path:'/tmp/cmyk.psd',size:input.bytes.length})
    for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(page.data.loading,false);assert.equal(page.data.error,'')
    if(input===bad){assert.equal(written,null);assert.equal(page.data.previewPath,'');assert.match(page.data.message,/32 bit.*CMYK/);continue}
    const r=reference.results.find(r=>r.name===input.name),rgba=Buffer.from(r.rgbaBase64,'base64')
    const expected=encode({data:compositeRgbaOnCheckerboard(rgba,r.width),width:r.width,height:r.height},82).data
    assert.deepEqual(written,Buffer.from(expected),input.name)
    assert.match(page.data.previewPath,/psd-composite-/)
    assert.ok(page.data.metadata.some(m=>m.label==='色彩预览'&&/未应用 ICC/.test(m.value)))
  }
})
