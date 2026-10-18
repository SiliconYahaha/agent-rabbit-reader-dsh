'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { unzipSync, zipSync } = require('fflate')
const { PNG } = require('pngjs')
const { extractDesignPackage } = require('../miniprogram/file-reader/engine/core/design-package')
const { fileKind, isSupportedMaterial } = require('../miniprogram/file-reader/shared/file-types')
const { designPreview, flush } = require('./helpers/reader-host')
const root = path.join(__dirname, 'fixtures/design-packages')
const fig = fs.readFileSync(path.join(root, 'circle.fig')), sketch = fs.readFileSync(path.join(root, 'image.sketch'))

for (const [name, source, entry] of [['circle.fig', fig, 'thumbnail.png'], ['image.sketch', sketch, 'previews/preview.png']]) {
  test(name + ': original author preview matches independent ZIP/PNG decoder', () => {
    const result = extractDesignPackage(source, name.split('.').pop())
    const expected = unzipSync(source)[entry]
    assert.deepEqual(Buffer.from(result.preview), Buffer.from(expected))
    const png = PNG.sync.read(Buffer.from(expected))
    assert.deepEqual([result.width, result.height], [png.width, png.height])
    assert.match(result.message, /不.*(?:全部画板|完整 Figma 画布)/)
  })
}
test('new design extensions take design route even with ZIP/PDF MIME; unsupported Adobe projects are not claimed', () => {
  for (const ext of ['fig', 'sketch', 'eps', 'ait', 'psdt']) {
    const f = { name: 'design.' + ext, path: '/file', type: ext === 'ait' ? 'application/pdf' : 'application/zip' }
    assert.equal(fileKind(f), 'design');assert.equal(isSupportedMaterial(f), true)
  }
  for (const ext of ['xd', 'indd', 'idml', 'aep', 'prproj']) assert.equal(fileKind({ name: 'x.' + ext }), 'unsupported')
})
test('missing preview is honest, arbitrary asset image is never used', () => {
  const files = unzipSync(fig), thumb = files['thumbnail.png'];delete files['thumbnail.png'];files['images/unrelated.png'] = thumb
  const result = extractDesignPackage(zipSync(files), 'fig')
  assert.equal(result.preview, null);assert.match(result.message, /没有保存可用预览/)
})
test('bad canvas, metadata, fake PNG, oversized preview and broken CRC are rejected', () => {
  const original = unzipSync(fig)
  const encode = s => Buffer.from(s)
  for (const change of [
    x => { x['canvas.fig'] = encode('notfig!!') },
    x => { x['meta.json'] = encode('{bad') },
    x => { x['thumbnail.png'] = encode('<svg onload=bad />') },
    x => { const b = Buffer.from(x['thumbnail.png']);b.writeUInt32BE(16385, 16);x['thumbnail.png'] = b },
    x => { x['thumbnail.png'] = new Uint8Array(8 * 1024 * 1024 + 1) }
  ]) {
    const files = { ...original };change(files)
    assert.throws(() => extractDesignPackage(zipSync(files), 'fig'))
  }
  const damaged = Buffer.from(zipSync(original, { level: 0 }))
  const png = damaged.indexOf(Buffer.from([137,80,78,71,13,10,26,10])); damaged[png + 50] ^= 1
  assert.throws(() => extractDesignPackage(damaged, 'fig'), /CRC|校验/)
  assert.throws(() => extractDesignPackage(Buffer.from('fig-kiwi'), 'fig'), /本地副本/)
  assert.throws(() => extractDesignPackage(sketch.subarray(0, 50), 'sketch'))
})
test('real component writes preview; stale async load cannot overwrite newer material; rejects actual oversized file', async () => {
  const files = { '/circle.fig': fig, '/image.sketch': sketch }, pending = [], writes = []
  const host = designPreview({ env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({
    stat: o => o.success({ stats: { size: o.path === '/huge.fig' ? 41 * 1024 * 1024 : files[o.path].length } }),
    readFile: o => pending.push(o),
    writeFile: o => { writes.push(o);o.success() }
  }) })
  host.loadMaterial({ name: 'circle.fig', path: '/circle.fig' });await flush()
  host.loadMaterial({ name: 'image.sketch', path: '/image.sketch' });await flush()
  const reply = o => o.success({ data: files[o.filePath] })
  reply(pending[1]);await flush();assert.match(host.data.previewPath, /design-package-preview/)
  const expectedPath = host.data.previewPath
  reply(pending[0]);await flush();assert.equal(host.data.previewPath, expectedPath);assert.equal(writes.length, 1)
  assert.equal(host.data.metadata.find(x => x.label === '格式').value, 'Sketch')
  host.loadMaterial({ name: 'huge.fig', path: '/huge.fig', size: 1 });await flush()
  assert.match(host.data.error, /40 MB/);assert.equal(host.data.previewPath, '')
})

test('Adobe template aliases use actual PDF/PSD bytes and EPS uses PostScript, not extension-only success', async () => {
  const inputs = {
    '/brand.ait': fs.readFileSync(path.join(__dirname, '../scripts/assets/example-art/firefox-classic.ai')),
    '/poster.psdt': fs.readFileSync(path.join(__dirname, '../scripts/assets/example-art/mozilla-mascot-poster.psd')),
    '/mark.eps': Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n1 0 0 setrgbcolor\n0 0 moveto\n40 0 lineto\n40 20 lineto\n0 20 lineto\nclosepath\nfill\nshowpage\n%%EOF'),
    '/broken.psdt': Buffer.from('not a photoshop document')
  }
  const writes = new Map(), opened = []
  const host = designPreview({ env: { USER_DATA_PATH: '/private' },
    getFileSystemManager: () => ({
      readFile: o => { const b = inputs[o.filePath];o.success({ data: b.subarray(o.position || 0, o.length ? (o.position || 0) + o.length : b.length) }) },
      copyFile: o => { writes.set(o.destPath, inputs[o.srcPath]);o.success() },
      writeFile: o => { writes.set(o.filePath, Buffer.from(o.data));o.success() }
    }), openDocument: o => { opened.push(o);o.success() }
  })
  for (const name of ['brand.ait', 'poster.psdt', 'mark.eps', 'broken.psdt']) {
    host.loadMaterial({ name, path: '/' + name, size: inputs['/' + name].length });await flush()
    if (name === 'brand.ait') { assert.equal(host.data.pdfSessions.length, 1);assert.equal(opened.length, 0) }
    else if (name === 'poster.psdt') { assert.equal(host.data.error, '');assert.match(host.data.previewPath, /psd-preview/);assert.ok(writes.get(host.data.previewPath).length > 100000) }
    else if (name === 'mark.eps') { assert.equal(host.data.error, '');assert.match(writes.get(host.data.previewPath).toString(), /<path/);assert.equal(host.data.canOpenPdf, false) }
    else { assert.ok(host.data.error);assert.equal(host.data.previewPath, '') }
  }
})

test('duplicate saved-preview names and encrypted entries are rejected rather than guessed', () => {
  const entries = unzipSync(fig)
  const duplicate = Buffer.from(zipSync({ ...entries, 'duplicate.png': entries['thumbnail.png'] }))
  const old = Buffer.from('duplicate.png'), replacement = Buffer.from('thumbnail.png')
  for (let i = duplicate.indexOf(old); i >= 0; i = duplicate.indexOf(old, i + old.length)) replacement.copy(duplicate, i)
  assert.throws(() => extractDesignPackage(duplicate, 'fig'), /重名/)
  const encrypted = Buffer.from(zipSync(entries))
  for (let i = 0; i < encrypted.length - 4; i++) {
    if (encrypted.readUInt32LE(i) === 0x02014b50 && encrypted.subarray(i + 46, i + 46 + 13).toString() === 'thumbnail.png') encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8)
  }
  assert.throws(() => extractDesignPackage(encrypted, 'fig'), /加密/)
})

test('Sketch shared-style documents larger than 2 MB retain their saved preview with a bounded document budget', () => {
  const files = unzipSync(sketch)
  const document = JSON.parse(Buffer.from(files['document.json']).toString())
  document.sharedStylesForTest = 's'.repeat(3 * 1024 * 1024)
  files['document.json'] = Buffer.from(JSON.stringify(document))
  const result = extractDesignPackage(zipSync(files), 'sketch')
  assert.deepEqual(Buffer.from(result.preview), Buffer.from(files['previews/preview.png']))
  assert.equal(result.pageCount, document.pages.length)
  files['document.json'] = Buffer.from(JSON.stringify({ _class: 'not-document', padding: document.sharedStylesForTest }))
  assert.throws(() => extractDesignPackage(zipSync(files), 'sketch'), /文档结构/)
  files['document.json'] = Buffer.alloc(16 * 1024 * 1024 + 1, 32)
  assert.throws(() => extractDesignPackage(zipSync(files), 'sketch'), /16 MB/)
  // The broader budget is only for the Sketch document, not arbitrary metadata.
  files['document.json'] = Buffer.from(JSON.stringify({ _class: 'document', pages: [] }))
  files['meta.json'] = Buffer.from(JSON.stringify({ padding: 's'.repeat(2 * 1024 * 1024) }))
  assert.throws(() => extractDesignPackage(zipSync(files), 'sketch'), /2 MB/)
})
