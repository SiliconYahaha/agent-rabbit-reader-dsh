'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), zlib = require('node:zlib')
const {bitmapFixture,cases} = require('./helpers/psd-bitmap')
const {extractPsdComposite} = require('../miniprogram/file-reader/engine/core/design-file')
const {designPreview} = require('./helpers/reader-host')
const encode = require('../miniprogram/file-reader/engine/core/vendor/jpeg-encoder')
const refs = require('./fixtures/psd-bitmap-reference.json').results
const samples = cases()
const reference = name => refs.find(r=>r.name===name)
const pixels = ref => zlib.inflateSync(Buffer.from(ref.rgbaZlibBase64,'base64'))
for(const compression of [0,1,2]) test(`bitmap PSD/PSB compression ${compression}: independent pixels across bit, row and PackBits boundaries`,()=>{
  for(const input of samples.filter(c=>c.compression===compression)) {
    const ref=reference(input.name)
    assert.equal(crypto.createHash('sha256').update(input.bytes).digest('hex'),ref.sourceSha256,input.name)
    const actual=extractPsdComposite(input.bytes)
    assert.deepEqual(Buffer.from(actual.rgba),pixels(ref),input.name)
    assert.equal(actual.width,ref.width);assert.equal(actual.height,ref.height)
    assert.equal(actual.transparentPixels,0);assert.equal(actual.alphaChannel,-1)
  }
})
function invalidCases () {
  const result=[]
  for(const version of [1,2]) {
    const raw=bitmapFixture({version}),rle=bitmapFixture({version,compression:1}),zip=bitmapFixture({version,compression:2})
    result.push({name:`v${version}-raw-short`,bytes:raw.subarray(0,raw.length-1),error:/原始.*不完整/})
    result.push({name:`v${version}-rle-short`,bytes:rle.subarray(0,rle.length-1),error:/RLE.*不完整/})
    result.push({name:`v${version}-zip-short`,bytes:zip.subarray(0,zip.length-1),error:/ZIP.*损坏/})
    const corrupt=Buffer.from(zip);corrupt[corrupt.length-1]^=1
    result.push({name:`v${version}-zip-checksum`,bytes:corrupt,error:/ZIP.*损坏/})
    const long=Buffer.concat([zip.subarray(0,version===2?44:40),zlib.deflateSync(Buffer.alloc(7))])
    result.push({name:`v${version}-zip-length`,bytes:long,error:/ZIP.*(损坏|长度|上限)/})
    result.push({name:`v${version}-prediction`,bytes:bitmapFixture({version,compression:3}),error:/1-bit.*Prediction/})
    const depth=Buffer.from(raw);depth.writeUInt16BE(8,22)
    result.push({name:`v${version}-bitmap-depth`,bytes:depth,error:/1 bit 单通道/})
    const mode=Buffer.from(raw);mode.writeUInt16BE(1,24)
    result.push({name:`v${version}-gray-depth`,bytes:mode,error:/1-bit 位图/})
    const channel=Buffer.from(raw);channel.writeUInt16BE(2,12)
    result.push({name:`v${version}-bitmap-channels`,bytes:channel,error:/1 bit 单通道/})
  }
  return result
}
test('bitmap invalid data and unsupported prediction fail explicitly before a fabricated image',()=>{
  for(const c of invalidCases())assert.throws(()=>extractPsdComposite(c.bytes),c.error,c.name)
  assert.throws(()=>extractPsdComposite(bitmapFixture(),{maxPixels:26}),/合成上限/)
  assert.throws(()=>extractPsdComposite(bitmapFixture({compression:2}),{maxInflatedBytes:5}),/解压上限/)
})
test('bitmap unused low bits do not leak into following rows',()=>{
  const a=bitmapFixture({width:9,height:2,packed:Buffer.from([0xaa,0x80,0x55,0])})
  const b=bitmapFixture({width:9,height:2,packed:Buffer.from([0xaa,0xff,0x55,0x7f])})
  assert.deepEqual(extractPsdComposite(a).rgba,extractPsdComposite(b).rgba)
})
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}
test('actual design component opens all bitmap cases, clears invalid previews and recovers after write failure',async()=>{
  let input,written,failWrite=false
  const page=designPreview({env:{USER_DATA_PATH:'/user-data'},getFileSystemManager:()=>({
    readFile(o){const b=input.bytes.subarray(o.position||0,(o.position||0)+o.length);o.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})},
    writeFile(o){if(failWrite)o.fail({errMsg:'intentional write failure'});else{written=Buffer.from(o.data);o.success()}}
  })})
  const sequence=[...samples]
  for(const [i,c] of invalidCases().entries())sequence.splice(i*3+1,0,c)
  sequence.push({...samples[0],writeFailure:true},samples[1],samples[0])
  for(input of sequence){
    written=null;failWrite=!!input.writeFailure
    page.open({name:input.name+'.psd',path:'/input.psd',size:input.bytes.length});await flush()
    assert.equal(page.data.loading,false);assert.equal(page.data.error,'')
    if(input.error||failWrite){assert.equal(written,null);assert.equal(page.data.previewPath,'');assert.match(page.data.message,input.error||/intentional write failure/);continue}
    const ref=reference(input.name)
    assert.deepEqual(written,Buffer.from(encode({width:ref.width,height:ref.height,data:pixels(ref)},82).data),input.name)
    assert.match(page.data.previewPath,/psd-composite-/)
    assert.ok(page.data.metadata.some(m=>m.label==='合成预览'&&m.value.includes('1 bit')))
  }
})
