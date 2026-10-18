'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { decodeThumbnail, extractAiSavedPreview } = require('../miniprogram/file-reader/engine/core/ai-saved-preview')
function thumbnail (data, width = 2, height = 1, depth = 8) {
  const hex = Buffer.from(data).toString('hex')
  return `%AI7_Thumbnail: ${width} ${height} ${depth}\r\n%%BeginData: ${hex.length} Hex Bytes\r\n%${hex}\r\n%%EndData\r\n`
}
function wrapper (thumb, options = {}) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /PieceInfo << /Illustrator 4 0 R >> >>',
    '<< /Private 5 0 R >>',
    '<< /AIPrivateData1 6 0 R >>',
    `<< /Length ${Buffer.byteLength(thumb)} >>\nstream\n${thumb}\nendstream`
  ]
  if (options.otherOwner) objects[2] = '<< /Type /Page /Parent 2 0 R >>'
  if (options.filtered) objects[5] = objects[5].replace('/Length', '/Filter /FlateDecode /Length')
  let source = '%PDF-1.5\n', offsets = [0]
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const start = source.length
  source += 'xref\n0 7\n0000000000 65535 f\n' + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n\n`).join('')
  source += `trailer\n<< /Size 7 /Root 1 0 R ${options.encrypted ? '/Encrypt 8 0 R' : ''} >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(source)
}
const palette = Buffer.alloc(768); palette.set([255, 0, 0, 0, 255, 0])
test('AI7 saved preview decodes exact RGB and RLE palette pixels', () => {
  const plain = thumbnail(Buffer.concat([palette, Buffer.from([0, 1])]))
  assert.deepEqual([...decodeThumbnail(plain).rgba], [255, 0, 0, 255, 0, 255, 0, 255])
  const rle = thumbnail(Buffer.concat([palette, Buffer.from([82, 76, 69, 253, 2, 1])]))
  assert.deepEqual([...decodeThumbnail(rle).rgba], [0, 255, 0, 255, 0, 255, 0, 255])
  assert.deepEqual([...decodeThumbnail(thumbnail([1, 2, 3, 4, 5, 6], 2, 1, 24)).rgba], [1, 2, 3, 255, 4, 5, 6, 255])
  const jpeg = extractAiSavedPreview(wrapper(plain))
  assert.equal(jpeg.width, 2); assert.equal(jpeg.height, 1); assert.equal(jpeg.jpeg[0], 255); assert.equal(jpeg.jpeg[1], 216)
})
test('thumbnail rejects truncated and overflowing pixel runs, wrong hex counts and excessive dimensions', () => {
  for (const data of [[82,76,69,253], [82,76,69,253,2], [82,76,69,253,3,0], [0]]) {
    assert.throws(() => decodeThumbnail(thumbnail(Buffer.concat([palette, Buffer.from(data)]))))
  }
  const valid = thumbnail(Buffer.concat([palette, Buffer.from([0, 1])]))
  assert.throws(() => decodeThumbnail(valid.replace('1540 Hex', '1542 Hex')))
  assert.throws(() => decodeThumbnail(valid.replace('2 1 8', '20000 1 8')))
  assert.throws(() => decodeThumbnail(valid.replace('%%EndData', 'fill\n%%EndData')))
})
test('PDF preview follows xref and Illustrator ownership, never unrelated bytes or encrypted/filter data', () => {
  const thumb = thumbnail(Buffer.concat([palette, Buffer.from([0, 1])]))
  assert.equal(extractAiSavedPreview(Buffer.from(thumb)), null)
  for (const opts of [{otherOwner:true}, {filtered:true}, {encrypted:true}]) assert.equal(extractAiSavedPreview(wrapper(thumb, opts)), null)
  const bad = wrapper(thumb).toString().replace('0000000009 00000 n', '0000000010 00000 n')
  assert.equal(extractAiSavedPreview(Buffer.from(bad)), null)
})
