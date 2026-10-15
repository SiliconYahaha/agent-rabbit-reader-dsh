'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const jpeg = require('jpeg-js')
const { extractPsdThumbnail } = require('../miniprogram/file-reader/engine/core/design-file')
const { designPreview, flush } = require('./helpers/reader-host')
const { references, resourceBlock, resourceData, documentWithResources } = require('./helpers/psd-thumbnails')

// Original PSD/PSB bytes and expected pixels independently read with psd-tools
// and Pillow. Row padding has nonzero seeded bytes, so it cannot pass as RGB.
for (const sample of references.samples) test('PSD thumbnail pixels: ' + sample.name, () => {
  const thumbnail = extractPsdThumbnail(Buffer.from(sample.resourcesBase64, 'base64'))
  assert.ok(thumbnail)
  assert.deepEqual([thumbnail.resourceId, thumbnail.width, thumbnail.height], [sample.resourceId, sample.width, sample.height])
  const expected = Buffer.from(sample.rgbaBase64, 'base64')
  if (thumbnail.sourceFormat === 'raw') assert.deepEqual(Buffer.from(thumbnail.rgba), expected)
  else {
    // JPEG-js and libjpeg use different chroma upsampling. The product forwards
    // the original JPEG unchanged; native Chrome/WeChat pixels are checked by
    // the verifier against Pillow, rather than blessing a larger tolerance.
    const data = resourceData(Buffer.from(sample.resourcesBase64, 'base64'), sample.resourceId)
    assert.deepEqual(Buffer.from(thumbnail.jpeg), data.subarray(28))
  }
})

test('invalid raw headers never allocate pixels; valid V4 data remains usable', () => {
  const oldSample = references.samples.find(s => s.name.startsWith('raw-1033-w7.'))
  const sample = references.samples.find(s => s.name.startsWith('raw-1036-w7.'))
  const legacy = resourceBlock(1033, resourceData(Buffer.from(oldSample.resourcesBase64, 'base64'), 1033))
  const original = resourceData(Buffer.from(sample.resourcesBase64, 'base64'), 1036)
  const variants = [
    b => b.writeUInt32BE(0, 4),
    b => b.writeUInt32BE(65536, 4),
    b => { b.writeUInt32BE(1000, 4); b.writeUInt32BE(2001, 8) },
    b => b.writeUInt32BE(21, 12), // unpadded row length
    b => b.writeUInt32BE(1, 16),
    b => b.writeUInt32BE(1, 20),
    b => b.writeUInt16BE(8, 24),
    b => b.writeUInt16BE(2, 26),
    b => b.writeUInt32BE(2, 0),
    b => b.subarray(0, -1)
  ]
  for (const mutate of variants) {
    let data = Buffer.from(original)
    const result = mutate(data)
    if (Buffer.isBuffer(result)) data = result
    const invalid = resourceBlock(1036, data)
    assert.equal(extractPsdThumbnail(invalid), null)
    for (const combined of [Buffer.concat([legacy, invalid]), Buffer.concat([invalid, legacy])]) {
      const thumbnail = extractPsdThumbnail(combined)
      assert.equal(thumbnail.resourceId, 1033)
      assert.deepEqual(Buffer.from(thumbnail.rgba), Buffer.from(oldSample.rgbaBase64, 'base64'))
    }
  }
})

function previewHost (files, writes, pending) {
  const reads = []
  const host = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) {
      reads.push({ position: o.position, length: o.length })
      const input = files[o.filePath], start = o.position || 0
      const data = input.subarray(start, start + o.length)
      o.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile (o) {
      writes.push(Buffer.from(o.data))
      if (pending) pending.push(o)
      else o.success()
    }
  }) })
  host.readCalls = reads
  return host
}

test('real component fallback writes raw thumbnails and clears an invalid preview before recovery', async () => {
  const sample = references.samples.find(s => s.name === 'modern-raw-after-legacy-jpeg.psb')
  const resources = Buffer.from(sample.resourcesBase64, 'base64')
  const invalid = resourceData(resources, 1036); invalid.writeUInt16BE(8, 24)
  const files = {
    '/good.psb': documentWithResources(resources, { version: 2 }),
    '/bad.psd': documentWithResources(resourceBlock(1036, invalid))
  }
  const writes = [], host = previewHost(files, writes)
  for (const name of ['good.psb', 'bad.psd', 'good.psb']) {
    host.loadMaterial({ name, path: '/' + name, size: files['/' + name].length })
    await flush()
    assert.equal(host.data.loading, false); assert.equal(host.data.error, '')
    if (name === 'bad.psd') {
      assert.equal(host.data.previewPath, ''); assert.match(host.data.message, /未找到可用缩略图/)
    } else {
      assert.match(host.data.previewPath, /psd-preview-/)
      assert.match(host.data.message, /缩略图/)
      const decoded = jpeg.decode(writes.at(-1), { useTArray: true })
      assert.deepEqual([decoded.width, decoded.height], [sample.width, sample.height])
      assert.equal(host.data.metadata.find(m => m.label === '预览').value, `${sample.width} × ${sample.height} px`)
    }
  }
  assert.equal(writes.length, 2)
})

test('bounded full composite wins without reading or decoding its thumbnail', async () => {
  const sample = references.samples[0], resources = Buffer.from(sample.resourcesBase64, 'base64')
  const files = { '/small.psd': documentWithResources(resources, { width: 2, height: 1 }) }, writes = []
  const host = previewHost(files, writes)
  host.loadMaterial({ name: 'small.psd', path: '/small.psd', size: files['/small.psd'].length })
  await flush()
  assert.match(host.data.previewPath, /psd-composite-/)
  assert.deepEqual(host.readCalls.map(r => r.position), [0, 30, 0])
  assert.deepEqual([jpeg.decode(writes[0]).width, jpeg.decode(writes[0]).height], [2, 1])
})

test('late fallback writes cannot replace the next document and detached views stay idle', async () => {
  const resources = Buffer.from(references.samples[0].resourcesBase64, 'base64')
  const files = { '/large.psd': documentWithResources(resources), '/small.psd': documentWithResources(resources, { width: 2, height: 1 }) }
  const pending = [], host = previewHost(files, [], pending)
  const open = name => host.loadMaterial({ name, path: '/' + name, size: files['/' + name].length })
  open('large.psd'); await flush()
  open('small.psd'); await flush()
  pending[1].success(); await flush()
  const visible = host.data.previewPath
  pending[0].success(); await flush()
  assert.equal(host.data.name, 'small.psd'); assert.equal(host.data.previewPath, visible)
  open('large.psd'); await flush(); host.detached()
  const patches = host.patches.length
  pending[2].success(); await flush()
  assert.equal(host.patches.length, patches)
})
