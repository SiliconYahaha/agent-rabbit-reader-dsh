'use strict'
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { chromeTestResult } = require('./chrome-test-result')
const { imageFixture } = require('../tests/helpers/tar-oldgnu-image')
const { malformed } = require('../tests/helpers/tar-oldgnu')
const { readerPage } = require('../tests/helpers/reader-host')
const runtime = require('../miniprogram/file-reader/archive/tar-runtime')
const out = path.resolve(process.argv[2] || 'outputs/tar-oldgnu/content')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const options = { wasmBinary: zlib.brotliDecompressSync(fs.readFileSync('miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')) }
async function browserRun (images) {
  const rows = []
  for (const source of images) {
    const img = new Image(); img.src = source.url; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), b => b.toString(16).padStart(2, '0')).join('')
    rows.push({ name: source.name, width: canvas.width, height: canvas.height, pixelsSha256: hash })
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(rows)))
}
async function main () {
  fs.mkdirSync(out, { recursive: true })
  const fixture = imageFixture(), decoded = [{ name: 'authored-original', url: 'data:image/png;base64,' + fixture.png.toString('base64') }], report = { at: new Date().toISOString(), native: [], malformed: [], host: [], expectedPixelsSha256: sha(fixture.pixels), wechat: 'not run', device: 'not run' }
  const reads = [], files = new Map(), previews = [], deferredWrites = []
  let holdWrites = false
  const priorWxWasm = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(options.wasmBinary, imports) }
  const page = readerPage({ env: { USER_DATA_PATH: '/fixture' }, previewImage: arg => previews.push(arg), getFileSystemManager: () => ({ readFile: arg => reads.push(arg), writeFile: arg => { files.set(arg.filePath, Buffer.from(arg.data)); if (holdWrites) deferredWrites.push(arg); else arg.success() } }) })
  const open = async bytes => { page.openSelectedFile({ name: 'sparse.tar', path: '/fixture/sparse.tar', size: bytes.length }); await reads.shift().success({ data: bytes }) }
  try {
    for (const { version, bytes } of fixture.variants) {
      const source = path.join(out, 'image-' + version + '.tar'); fs.writeFileSync(source, bytes)
      const native = execFileSync('/usr/bin/tar', ['-xOf', source, '三色图.png'])
      const python = execFileSync('python3', ['-c', "import tarfile,sys; t=tarfile.open(sys.argv[1]); sys.stdout.buffer.write(t.extractfile('三色图.png').read())", source])
      assert.deepEqual(native, fixture.png); assert.deepEqual(python, fixture.png)
      const info = await runtime.inspectTarArchive(bytes, options)
      const body = Buffer.from(await runtime.extractTarEntry(bytes, info.entries[0], options))
      assert.deepEqual(body, fixture.png)
      report.native.push({ version, sourceSha256: sha(bytes), logicalSize: body.length, imageSha256: sha(body), pythonExact: true, bsdtarExact: true })
      decoded.push({ name: 'reader-' + version, url: 'data:image/png;base64,' + body.toString('base64') })
      for (let repeat = 0; repeat < 2; repeat++) {
        await open(bytes); assert.equal(page.data.error, '')
        await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === '三色图.png') } }); assert.equal(page.data.error, '')
        assert.equal(page.data.sourceName, '三色图.png')
        const preview = previews.at(-1); assert.ok(preview); assert.deepEqual(files.get(preview.current), fixture.png)
        await open(bytes)
        await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'after.html') } })
        const read = reads.shift(); await read.success({ data: files.get(read.filePath) })
        assert.equal(page._htmlRuntime.document.body.textContent, 'AFTER 正文')
      }
      report.host.push({ version, repeats: 2, previewExactBytes: true, followingHtmlText: 'AFTER 正文' })
    }
    for (const sample of malformed()) {
      const source = path.join(out, sample.name + '.tar'); fs.writeFileSync(source, sample.bytes)
      const native = spawnSync('/usr/bin/tar', ['-xOf', source], { timeout: 3000, maxBuffer: 1024 * 1024 })
      await open(sample.bytes); assert.match(page.data.error, /TAR 读取失败/)
      report.malformed.push({ name: sample.name, sourceSha256: sha(sample.bytes), hostError: page.data.error, bsdtarStatus: native.status, bsdtarOutputSha256: sha(native.stdout || Buffer.alloc(0)), bsdtarStderr: String(native.stderr || '') })
    }
    await open(fixture.variants[2].bytes); assert.equal(page.data.error, '')
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === '三色图.png') } }); assert.deepEqual(files.get(previews.at(-1).current), fixture.png)
    report.hostRecovery = true
    // A previous preview callback must not overwrite the next file's state.
    const previousPreview = previews.at(-1)
    previousPreview.fail({ errMsg: 'fixture current preview failure' })
    assert.match(page.data.error, /图片预览失败/)
    await open(fixture.variants[0].bytes)
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === 'after.html') } })
    const afterRead = reads.shift(); await afterRead.success({ data: files.get(afterRead.filePath) })
    previousPreview.fail({ errMsg: 'fixture stale preview failure' })
    assert.equal(page.data.error, ''); assert.equal(page._htmlRuntime.document.body.textContent, 'AFTER 正文')
    await open(fixture.variants[0].bytes)
    holdWrites = true
    await page.openInspectorEntry({ detail: { index: page._inspectorVisibleEntries.findIndex(e => e.name === '三色图.png') } })
    assert.equal(deferredWrites.length, 1)
    const previewCount = previews.length
    page.openSelectedFile({ name: 'new.html', path: '/fixture/new.html' })
    await reads.shift().success({ data: Buffer.from('<p>NEW CONTENT</p>') })
    deferredWrites.shift().success()
    assert.equal(previews.length, previewCount)
    assert.equal(page._htmlRuntime.document.body.textContent, 'NEW CONTENT')
    report.stalePreviewFailureIgnored = true
    report.staleExtractionWriteIgnored = true
  } finally { page.detached(); if (priorWxWasm === undefined) delete global.WXWebAssembly; else global.WXWebAssembly = priorWxWasm }
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<output></output><script>(' + browserRun.toString() + ')(' + JSON.stringify(decoded) + ').catch(e=>document.querySelector("output").setAttribute("data-error",e.message))</script>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const html = await chromeTestResult('http://127.0.0.1:' + server.address().port)
    fs.writeFileSync(path.join(out, 'chrome.html'), html)
    const encoded = html.match(/data-result="([^"]+)"/); assert.ok(encoded, html.slice(-1500))
    report.chrome = JSON.parse(decodeURIComponent(encoded[1]))
    for (const row of report.chrome) { assert.equal(row.width, fixture.width); assert.equal(row.height, fixture.height); assert.equal(row.pixelsSha256, sha(fixture.pixels)) }
  } finally { server.close() }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
