'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { TextDecoder: Decoder, TextEncoder: Encoder } = require('../miniprogram/file-reader/shared/pdf-runtime/text-encoding')
test('PDF text encoding matches native UTF-8/16 for Unicode, BOM, malformed and streamed bytes', () => {
  const text = '\ufeff兔子 Reader 🐰\u0000\ud800结束'
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
    const bytes = encoding === 'utf-8' ? new TextEncoder().encode(text) : Buffer.from(text, 'utf16le')
    if (encoding === 'utf-16be') bytes.swap16()
    for (const ignoreBOM of [true, false]) {
      assert.equal(new Decoder(encoding, { ignoreBOM }).decode(bytes), new TextDecoder(encoding, { ignoreBOM }).decode(bytes))
      for (let split = 0; split <= bytes.length; split++) {
        const local = new Decoder(encoding, { ignoreBOM }), native = new TextDecoder(encoding, { ignoreBOM })
        assert.equal(local.decode(bytes.subarray(0, split), { stream: true }) + local.decode(bytes.subarray(split)), native.decode(bytes.subarray(0, split), { stream: true }) + native.decode(bytes.subarray(split)))
      }
    }
  }
  for (const bytes of [[0xff], [0xe0,0x80,0x80], [0xf0,0x9f], [0xed,0xa0,0x80], [0xc2,0x41], [0xef,0xbf,0xbd]]) {
    const input = new Uint8Array(bytes)
    assert.equal(new Decoder().decode(input), new TextDecoder().decode(input))
    if (bytes[0] !== 0xef) assert.throws(() => new Decoder('utf-8', { fatal: true }).decode(input), TypeError)
  }
  assert.throws(() => new Decoder('utf-16be', { fatal: true }).decode(new Uint8Array([0])), TypeError)
  // A high surrogate followed by an incomplete code unit is one EOF error.
  const truncated = new Uint8Array([0xdb, 0xd9, 0x64])
  assert.equal(new Decoder('utf-16le').decode(truncated), new TextDecoder('utf-16le').decode(truncated))
  assert.equal(new Decoder().decode(), '')
  assert.deepEqual(new Encoder().encode(text), new TextEncoder().encode(text))
  for (let size = 0; size < 45; size++) {
    const local = new Uint8Array(size), native = new Uint8Array(size)
    assert.deepEqual(new Encoder().encodeInto(text, local), new TextEncoder().encodeInto(text, native))
    assert.deepEqual(local, native)
  }
})
test('Firefox original Ai parses all four pages without TextDecoder or TextEncoder globals', () => {
  const { spawnSync } = require('node:child_process')
  const program = `
    const fs=require('node:fs'),assert=require('node:assert/strict');
    global.TextDecoder=undefined;global.TextEncoder=undefined;
    global.wx={createOffscreenCanvas(){return {}},loadSubpackage(o){o.success()},getFileSystemManager(){return {readCompressedFile(o){try{const b=require('node:zlib').brotliDecompressSync(fs.readFileSync('miniprogram'+o.filePath));o.success({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})}catch(e){o.fail(e)}}}}};
    (async()=>{const engine=require('./miniprogram/file-reader/pdf');const task=engine.open(new Uint8Array(fs.readFileSync('scripts/assets/example-art/firefox-classic.ai')));const pdf=await task.promise;assert.equal(pdf.numPages,4);for(let n=1;n<=4;n++){const page=await pdf.getPage(n);const ops=await page.getOperatorList();assert.ok(engine.hasPaint(ops),'page '+n+' must paint')}await task.destroy();console.log('four-pages-ok')})().catch(e=>{console.error(e);process.exitCode=1});
  `
  const result = spawnSync(process.execPath, ['-e', program], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr.slice(-1500))
  assert.match(result.stdout, /four-pages-ok/)
})
