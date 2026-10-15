'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const zlib = require('node:zlib')
const { samples } = require('./helpers/rar-crc')
const { inspectFileBytes, extractArchiveEntry } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { inspectRarArchive, extractRarEntry } = require('../miniprogram/file-reader/archive/rar-runtime')
const { harness } = require('./helpers/rar-reader')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br'))

for (const sample of samples()) {
  test(`${sample.name}: stored fallback enforces bounded headers and present CRC including zero`, async () => {
    const run = () => { const inspection = inspectFileBytes(sample.bytes,{name:'input.rar'}); return extractArchiveEntry(sample.bytes,inspection.entries[0]) }
    if (sample.openable === false) {
      assert.equal(inspectFileBytes(sample.bytes,{name:'input.rar'}).entries[0].canOpen,false)
    } else if (sample.accept) assert.equal(Buffer.from(run()).toString('hex'),sample.hex)
    else assert.throws(run,/CRC|长度|截断|范围|大小|整数/)
    if (sample.baseline || sample.accept) {
      const native = async () => {const i=await inspectRarArchive(sample.bytes,{wasmBinary}); return extractRarEntry(sample.bytes,i.entries[0],{wasmBinary})}
      if (sample.accept) assert.equal(Buffer.from(await native()).toString('hex'),sample.hex)
      else await assert.rejects(native)
    }
  })
}

for (const mode of ['no-wasm','native-wasm']) {
  test(`${mode}: full RAR entry rejects corruption before writing and recovers with the next valid file`, async () => {
    const old=global.WXWebAssembly
    if(mode==='native-wasm')global.WXWebAssembly={instantiate:(_path,imports)=>WebAssembly.instantiate(wasmBinary,imports)}
    else delete global.WXWebAssembly
    const h=harness(),valid=samples().find(s=>s.name==='rar4-valid')
    try {
      for(const sample of samples().filter(s=>s.baseline)) {
        const count=h.writes.length
        await h.open(sample)
        if(h.page._inspectorVisibleEntries?.length) await h.tap()
        if(sample.accept) {
          assert.equal(h.writes.length,count+1,sample.name)
          assert.equal(h.writes.at(-1).toString('hex'),sample.hex)
        } else {
          assert.equal(h.writes.length,count,sample.name)
          assert.ok(h.page.data.error,sample.name)
        }
        await h.open(valid);await h.tap()
        assert.equal(h.writes.at(-1).toString('hex'),valid.hex)
        assert.equal(h.page._htmlRuntime.document.body.textContent,Buffer.from(valid.hex,'hex').toString())
      }
    } finally {h.page._htmlRuntime?.destroy();if(old===undefined)delete global.WXWebAssembly;else global.WXWebAssembly=old}
  })
}

test('stored extraction honors zero resource limit and does not accept missing CRC on RAR4',()=>{
  const sample=samples().find(s=>s.name==='rar4-valid'),entry=inspectFileBytes(sample.bytes,{name:'x.rar'}).entries[0]
  assert.throws(()=>extractArchiveEntry(sample.bytes,entry,{maxSize:0}),/超过/)
  assert.throws(()=>extractArchiveEntry(sample.bytes,{...entry,crc:null}),/CRC/)
  assert.throws(()=>extractArchiveEntry(sample.bytes,{...entry,compressedSize:NaN}),/长度/)
})

test('late RAR native failure cannot replace a newly opened file',async()=>{
  const api=require('../miniprogram/file-reader/archive/api'),original=api.inspectRarArchive
  let reject
  api.inspectRarArchive=()=>new Promise((resolve,rejectFn)=>{reject=rejectFn})
  const h=harness(),sample=samples()[0]
  try {
    h.files.set('/input.rar',sample.bytes)
    h.page.openSelectedFile({name:'old.rar',path:'/input.rar',size:sample.bytes.length})
    h.files.set('/new.txt',Buffer.from('NEW FILE'))
    h.page.openSelectedFile({name:'new.txt',path:'/new.txt',size:8})
    reject(new Error('Archive header or data are damaged'));await h.settle()
    assert.match(h.page._htmlRuntime.document.body.textContent,/NEW FILE/)
    assert.equal(h.writes.length,0)
  } finally {api.inspectRarArchive=original;h.page._htmlRuntime?.destroy()}
})
