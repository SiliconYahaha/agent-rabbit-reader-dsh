'use strict'

// Isolated Chrome pixel oracle. No access to the user's browser or files.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto')
const { createInlineImageStore } = require('../miniprogram/file-reader/document/inline-image-store')
const { chromeTestResult } = require('./chrome-test-result')
const fixtures = require('../tests/fixtures/inline-cache-recovery/wpt-images.json')
const { png } = require('../tests/helpers/inline-poster')
const { bootStore, cacheFilesystem } = require('../tests/helpers/inline-cache-filesystem')
async function main () {
  const output = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'inline-cache-recovery-'))
  fs.mkdirSync(output, { recursive: true })
  const rows = [], files = new Map()
  const samples = fixtures.concat({ path: 'generated.png', base64: png().split(',')[1] })
  for (const sample of samples) {
    const original = Buffer.from(sample.base64, 'base64')
    if (sample.sha256) assert.equal(crypto.createHash('sha256').update(original).digest('hex'), sample.sha256)
    let failing = true, writes = 0
    const store = createInlineImageStore({ writeFile: o => { writes++; if (failing) o.fail({ errMsg: 'injected temporary failure' }); else { files.set(o.filePath, Buffer.from(o.data, o.encoding)); o.success() } }, unlink: o => files.delete(o.filePath) }, '/cache')
    const url = 'data:image/png;base64,' + sample.base64
    await assert.rejects(store.resource(url, true), /injected/)
    assert.equal(store.bytes, 0); assert.equal(store.size, 0)
    failing = false
    const recovered = await store.resource(url, true)
    assert.deepEqual(files.get(recovered), original); assert.equal(writes, 2)
    files.set('/source/' + rows.length, original)
    rows.push({ name: sample.path, source: '/source/' + rows.length, recovered, bytes: original.length })
    // A second independent JS module boot sees the same persisted filesystem.
    // Its quota fits one image only; old baseline fails the second open.
    const disk = cacheFilesystem(original.length + 1)
    const abandoned = bootStore()(disk.io, '/local')
    const previous = await abandoned.resource(url, true)
    const restarted = bootStore()(disk.io, '/local')
    const afterRestart = await restarted.resource(url, true)
    assert.equal(disk.files.has(previous), false)
    assert.deepEqual(disk.files.get(afterRestart), original)
    files.set(afterRestart, disk.files.get(afterRestart)); files.set('/source/' + rows.length, original)
    rows.push({ name: sample.path + ':restart', source: '/source/' + rows.length, recovered: afterRestart, bytes: original.length })
    await restarted.dispose(); assert.equal(disk.files.size, 0)
    for (const fault of ['bounded-sweep', 'blocked-first-batch', 'partial-write', 'missing-directory']) {
      const disk = cacheFilesystem(original.length + 25), create = bootStore()
      const dir = '/local/reader-inline-cache-v1'; disk.directories.add(dir)
      if (fault.includes('batch') || fault.includes('sweep')) {
        for (let n = 0; n < 300; n++) {
          const p = `${dir}/reader-inline-old-boot-1-${String(n).padStart(4, '0')}.png`
          if (fault === 'blocked-first-batch' && n < 256) disk.directories.add(p)
          else disk.files.set(p, Buffer.alloc(1))
        }
      }
      const store = create(disk.io, '/local'), write = disk.io.writeFile
      let partial = fault === 'partial-write'
      if (partial) {
        disk.failUnlink(true)
        disk.io.writeFile = o => write({ ...o, success: () => partial ? o.fail({ errMsg: 'partial write' }) : o.success({}) })
      }
      if (fault === 'missing-directory') {
        await store.resource('data:image/png;base64,' + Buffer.alloc(32).toString('base64'), true)
        disk.files.clear(); disk.directories.delete(dir)
      }
      await assert.rejects(store.resource(url, true))
      partial = false; disk.failUnlink(false)
      const recovered = await store.resource(url, true)
      assert.equal(disk.scans.length, 2); assert.deepEqual(disk.files.get(recovered), original)
      files.set(recovered, disk.files.get(recovered)); files.set('/source/' + rows.length, original)
      rows.push({ name: sample.path + ':' + fault, source: '/source/' + rows.length, recovered, bytes: original.length })
      await store.dispose()
    }
  }
  const run = async function (rows) {
    const decode = async src => {
      const image = new Image(); image.src = src; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let fnv = 2166136261
      for (const byte of bytes) fnv = Math.imul(fnv ^ byte, 16777619) >>> 0
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
      return { width: canvas.width, height: canvas.height, rgbaSha256: hash, rgbaFnv32: fnv }
    }
    const result = []
    for (const row of rows) result.push({ name: row.name, source: await decode(row.source), recovered: await decode(row.recovered) })
    document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(result)))
  }
  const server = http.createServer((req, res) => {
    if (files.has(req.url)) { res.setHeader('Content-Type', 'image/png'); res.end(files.get(req.url)); return }
    if (req.url !== '/') { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><output></output><script>(' + run + ')(' + JSON.stringify(rows) + ').catch(e=>document.querySelector("output").setAttribute("data-error",e.message))</script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const dom = await chromeTestResult('http://127.0.0.1:' + server.address().port + '/')
    fs.writeFileSync(path.join(output, 'chrome-dom.html'), dom)
    const encoded = dom.match(/data-result="([^"]+)"/); assert.ok(encoded, dom)
    const result = JSON.parse(decodeURIComponent(encoded[1])); assert.equal(result.length, 24)
    result.forEach(row => assert.deepEqual(row.recovered, row.source, row.name))
    const report = { checkedAt: new Date().toISOString(), checked: 24, failed: 0, fault: 'Four originals across transient write, cold restart, bounded sweep, blocked first batch, partial write and missing-directory retry; exact file bytes and full Chrome RGBA compared', result }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
  } finally { server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
