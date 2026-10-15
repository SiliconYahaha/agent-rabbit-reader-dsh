'use strict'
const { header } = require('./tar-fixtures')
function oldGnu ({ name = 'body.bin', size = 4096, blocks = [[512, Buffer.alloc(512, 65)]], pairs } = {}) {
  pairs ||= [...blocks.map(([offset, bytes]) => [offset, bytes.length]), [size, 0]]
  const data = Buffer.concat(blocks.map(([, bytes]) => bytes))
  const h = Buffer.from(header(name, data, 'S').subarray(0, 512))
  h.write('ustar  \0', 257, 8)
  const num = (target, offset, n) => target.write(n.toString(8).padStart(11, '0') + '\0', offset, 12)
  const fill = (target, offset, list) => list.forEach(([start, length], i) => { num(target, offset + 24 * i, start); num(target, offset + 24 * i + 12, length) })
  fill(h, 386, pairs.slice(0, 4)); h[482] = pairs.length > 4 ? 1 : 0; num(h, 483, size)
  h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  const extensions = []
  for (let i = 4; i < pairs.length; i += 21) {
    const block = Buffer.alloc(512); fill(block, 0, pairs.slice(i, i + 21)); block[504] = pairs.length > i + 21 ? 1 : 0; extensions.push(block)
  }
  return Buffer.concat([h, ...extensions, data, Buffer.alloc(-data.length & 511)])
}

function archive (member) { return Buffer.concat([member, header('after.html', '<p>AFTER 正文</p>'), Buffer.alloc(1024)]) }
function malformed () {
  const blocks = [[1, Buffer.from('HELLO')]], size = 128
  const rows = [
    ['packed-short', [[1, 6]]], ['packed-extra', [[1, 4]]], ['past-end', [[127, 5]]],
    ['overlap', [[1, 3], [2, 2]]], ['descending', [[5, 2], [1, 3]]]
  ].map(([name, pairs]) => ({ name, bytes: archive(oldGnu({ size, blocks, pairs })) }))
  const checksum = b => { b.fill(32, 148, 156); b.write(b.subarray(0, 512).reduce((a, n) => a + n, 0).toString(8).padStart(6, '0') + '\0 ', 148); return b }
  const invalidFlag = archive(oldGnu()); invalidFlag[482] = 2
  rows.push({ name: 'header-extension-flag', bytes: checksum(invalidFlag) })
  const badNumber = archive(oldGnu()); badNumber.write('not-a-number', 386, 12)
  rows.push({ name: 'header-map-number', bytes: checksum(badNumber) })
  const extBlocks = Array.from({ length: 30 }, (_, i) => [i * 16 + 1, Buffer.from('EXT')])
  const extension = archive(oldGnu({ size: 512, blocks: extBlocks }))
  const badFlag = Buffer.from(extension); badFlag[512 + 504] = 2
  rows.push({ name: 'extension-flag', bytes: badFlag })
  const badExtNumber = Buffer.from(extension); badExtNumber.write('not-a-number', 512, 12)
  rows.push({ name: 'extension-number', bytes: badExtNumber })
  const badExtGap = Buffer.from(extension); badExtGap.fill(0, 512, 536)
  rows.push({ name: 'extension-premature-gap', bytes: badExtGap })
  rows.push({ name: 'extension-truncated', bytes: extension.subarray(0, 777) })
  return rows
}
module.exports = { oldGnu, archive, malformed }
