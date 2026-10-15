'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { parseRgbIccProfile } = require('../miniprogram/file-reader/engine/core/icc-rgb')
const { parsePsdHeader, extractPsdComposite } = require('../miniprogram/file-reader/engine/core/design-file')
const { psdAlphaFixture } = require('./helpers/psd-alpha')
const { designPreview, flush } = require('./helpers/reader-host')
const fixtures = require('./fixtures/psd-icc-rgb.json').cases
function profileIn (source) {
  const start = parsePsdHeader(source).resourceLengthOffset, end = start + 4 + source.readUInt32BE(start)
  for (let offset = start + 4; offset < end;) {
    const nameBytes = 1 + source[offset + 6], sizeOffset = offset + 6 + nameBytes + nameBytes % 2
    const length = source.readUInt32BE(sizeOffset), data = sizeOffset + 4
    if (source.readUInt16BE(offset + 4) === 1039) return source.subarray(data, data + length)
    offset = data + length + length % 2
  }
  throw Error('Fixture ICC missing')
}
function tagEntry (profile, name) {
  for (let i = 0; i < profile.readUInt32BE(128); i++) { const at = 132 + i * 12; if (profile.toString('ascii', at, at + 4) === name) return at }
  throw Error('Tag missing')
}
const sample = name => Buffer.from(fixtures.find(f => f.name === name).sourceBase64, 'base64')
const good = () => sample('p3-v4-d16-a1-v1-c0.psd')
function edited (fn) { const source = good(); fn(profileIn(source)); return source }

test('independent LittleCMS originals retain their profile and exact full-precision RGB/alpha pixels', () => {
  assert.equal(fixtures.length, 36)
  for (const f of fixtures) {
    const source = Buffer.from(f.sourceBase64, 'base64')
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), f.sha256)
    const result = extractPsdComposite(source)
    assert.equal(result.colorProfile, 'applied', f.name)
    assert.deepEqual(Buffer.from(result.rgba), Buffer.from(f.rgbaBase64, 'base64'), f.name)
  }
})

test('ICC bounds, duplicate/overlapping tags, curve sizes and degenerate matrices fail closed', () => {
  const mutations = [
    p => p.writeUInt32BE(p.length + 1, 0), p => p.writeUInt32BE(0xffffffff, 128),
    p => p.writeUInt32BE(4, tagEntry(p, 'rXYZ') + 4),
    p => p.write('rXYZ', tagEntry(p, 'gXYZ')),
    p => p.writeUInt32BE(p.length, tagEntry(p, 'rTRC') + 8),
    p => { const entry = tagEntry(p, 'rXYZ'); p.writeUInt32BE(p.readUInt32BE(tagEntry(p, 'gXYZ') + 4) + 4, entry + 4) },
    p => { const offset = p.readUInt32BE(tagEntry(p, 'rTRC') + 4); p.writeInt32BE(0, offset + 12) },
    p => { for (const tag of ['rXYZ','gXYZ','bXYZ']) { const offset = p.readUInt32BE(tagEntry(p, tag) + 4); p.fill(0, offset + 8, offset + 20) } }
  ]
  for (const mutate of mutations) {
    const source = edited(mutate), result = extractPsdComposite(source)
    assert.equal(result.colorProfile, 'invalid')
    assert.equal(result.rgba.length, 16 * 16 * 4)
  }
  assert.equal(parseRgbIccProfile(new Uint8Array(10)).status, 'invalid')
  assert.equal(parseRgbIccProfile(new Uint8Array(4 * 1024 * 1024 + 1)).status, 'unsupported')
  assert.equal(extractPsdComposite(good()).colorProfile, 'applied')
})

test('unsupported transforms and legacy white points are never silently replaced with a matrix', () => {
  for (const mutate of [
    p => p.write('link', 12), p => { p[8] = 5 },
    p => p.write('A2B0', tagEntry(p, 'desc')),
    p => { const offset = p.readUInt32BE(tagEntry(p, 'wtpt') + 4); p.writeInt32BE(Math.round(.95 * 65536), offset + 8) }
  ]) assert.equal(extractPsdComposite(edited(mutate)).colorProfile, 'unsupported')
  const profile = profileIn(good()), resource = Buffer.alloc(12 + profile.length + profile.length % 2)
  resource.write('8BIM'); resource.writeUInt16BE(1039, 4); resource.writeUInt32BE(profile.length, 8); profile.copy(resource, 12)
  assert.equal(extractPsdComposite(psdAlphaFixture({ depth: 32, resources: resource })).colorProfile, 'unsupported')
})

test('host communicates applied/invalid/unsupported colors and clears that state when changing files', async () => {
  let input, written
  const host = designPreview({ env: { USER_DATA_PATH: '/user-data' }, getFileSystemManager: () => ({
    readFile (o) { const b = input.subarray(o.position || 0, (o.position || 0) + o.length); o.success({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) },
    writeFile (o) { written = Buffer.from(o.data); o.success() }
  }) })
  for (const [source, message] of [[good(), '已按文件色彩配置还原'], [edited(p => p.writeUInt32BE(0xffffffff, 128)), '色彩配置损坏，当前颜色可能有偏差'], [psdAlphaFixture(), null], [edited(p => p.write('link', 12)), '暂不支持此色彩配置，当前颜色可能有偏差'], [good(), '已按文件色彩配置还原']]) {
    input = source; written = null; host.loadMaterial({ name: 'profile.psd', path: '/local/profile.psd', size: input.length }); await flush()
    assert.equal(host.data.error, ''); assert.equal(host.data.loading, false); assert.ok(written); assert.match(host.data.previewPath, /psd-composite-/)
    const rows = host.data.metadata.filter(row => row.label === '色彩预览')
    assert.deepEqual(rows.map(row => row.value), message ? [message] : [])
  }
})
