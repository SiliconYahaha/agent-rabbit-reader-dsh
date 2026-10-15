'use strict'

const { header, paxField } = require('./tar-fixtures')

function sparseMember ({ version = '0.1', name = 'body.bin', size = 4096, blocks = [[513, Buffer.from('HEAD\n')], [2051, Buffer.from('TAIL\n')]], pairs, fields, payload, type = '0', paxType = 'x' } = {}) {
  pairs ||= [...blocks.map(([offset, bytes]) => [offset, bytes.length]), [size, 0]]
  const packed = Buffer.concat(blocks.map(([, bytes]) => bytes))
  if (!fields) {
    if (version === '0.0') fields = [['GNU.sparse.size', size], ['GNU.sparse.numblocks', pairs.length], ...pairs.flatMap(([offset, bytes]) => [['GNU.sparse.offset', offset], ['GNU.sparse.numbytes', bytes]])]
    else if (version === '0.1') fields = [['GNU.sparse.size', size], ['GNU.sparse.numblocks', pairs.length], ['GNU.sparse.name', name], ['GNU.sparse.map', pairs.flat().join(',')]]
    else fields = [['GNU.sparse.major', 1], ['GNU.sparse.minor', 0], ['GNU.sparse.name', name], ['GNU.sparse.realsize', size]]
  }
  if (!payload) {
    if (version === '1.0') {
      const map = Buffer.from([pairs.length, ...pairs.flat()].join('\n') + '\n')
      payload = Buffer.concat([map, Buffer.alloc((-map.length & 511)), packed])
    } else payload = packed
  }
  return Buffer.concat([header('PaxHeaders/body', fields.map(([k, v]) => paxField(k, String(v))).join(''), paxType), header(version === '0.0' ? name : 'GNUSparseFile.0/body', payload, type)])
}

function archive (member, after = '<p>AFTER 正文</p>') {
  return Buffer.concat([member, header('after.html', after), Buffer.alloc(1024)])
}

function malformed () {
  const fixed = [['GNU.sparse.size', 4096], ['GNU.sparse.name', 'body.bin']]
  const map = (value, count = 2) => [...fixed, ['GNU.sparse.numblocks', count], ['GNU.sparse.map', value]]
  return [
    ['overlap', { fields: map('0,5,4,5') }],
    ['outside-logical', { fields: map('4095,5,4096,5') }],
    ['packed-short', { fields: map('0,6,513,5') }],
    ['packed-extra', { fields: map('0,4,513,5') }],
    ['count-mismatch', { fields: map('0,5,513,5', 3) }],
    ['unsigned-overflow', { fields: map('0,5,18446744073709551616,5') }],
    ['negative-offset', { fields: map('0,5,-2,5') }],
    ['missing-map-number', { fields: map('0,5,513,') }],
    ['unknown-version', { version: '1.0', fields: [['GNU.sparse.major', 2], ['GNU.sparse.minor', 0], ['GNU.sparse.name', 'body.bin'], ['GNU.sparse.realsize', 4096]] }],
    ['partial-offset-pair', { version: '0.0', fields: [['GNU.sparse.size', 4096], ['GNU.sparse.numblocks', 1], ['GNU.sparse.offset', 0]] }],
    ['sparse-symlink', { type: '2' }],
    ['global-sparse', { paxType: 'g' }],
    ['v1-no-newline', { version: '1.0', payload: Buffer.alloc(512, 49) }],
    ['v1-count-budget', { version: '1.0', payload: Buffer.concat([Buffer.from('65537\n'), Buffer.alloc(506)]) }],
    ['v1-short-map-block', { version: '1.0', payload: Buffer.from('1\n0\n1\nA') }],
    ['v1-padding-nonzero', { version: '1.0', payload: Buffer.concat([Buffer.from('0\nX'), Buffer.alloc(509)]) }]
  ].map(([name, options]) => ({ name, bytes: archive(sparseMember(options)) }))
}

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

module.exports = { sparseMember, archive, malformed, oldGnu }
