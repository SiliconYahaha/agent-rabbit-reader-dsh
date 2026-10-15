'use strict'
const zlib = require('node:zlib')
const { cdrCompressedVectorFixture, repackCdrStreams } = require('./cdr-zlib')
function decodedTree (fixture) {
  const firstEnd = 48 + fixture.readUInt32LE(24) - 8
  const stream = zlib.inflateSync(fixture.subarray(48, firstEnd)), table = zlib.inflateSync(fixture.subarray(firstEnd + 8))
  const lengths = Array.from({ length: table.length / 4 }, (_, i) => table.readUInt32LE(i * 4))
  function parse (start, end) {
    const nodes = []
    for (let p = start; p + 8 <= end;) {
      const id = stream.subarray(p, p + 4).toString(), size = lengths[stream.readUInt32LE(p + 4)]
      nodes.push(id === 'LIST' ? { id, type: stream.subarray(p + 8, p + 12).toString(), children: parse(p + 12, p + 8 + size) } : { id, data: Buffer.from(stream.subarray(p + 8, p + 8 + size)) })
      p += 8 + size + (size & 1)
    }
    return nodes
  }
  return parse(0, stream.length)
}
function encoded (fixture, nodes, options = {}) {
  const lengths = []
  function build (node) {
    const children = node.children?.map(build), pad = options.nestedPadding || 0
    const data = children ? Buffer.concat([Buffer.from(node.type), ...children.flatMap(c => [Buffer.alloc(pad), c]), Buffer.from(node.tail || [])]) : node.data
    const index = lengths.length; lengths.push(data.length)
    const header = Buffer.alloc(8); header.write(node.id); header.writeUInt32LE(index, 4)
    const result = Buffer.concat([header, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
    return result
  }
  const parts = nodes.map(build)
  let stream = Buffer.concat([Buffer.alloc(options.prefixPadding || 0), ...parts, Buffer.from(options.tail || [])])
  function rewrite (start, end) {
    for (let p = start; p < end;) {
      while (p < end && stream[p] === 0) p++
      if (p + 8 > end) break
      const id = stream.subarray(p, p + 4).toString(), index = stream.readUInt32LE(p + 4), size = lengths[index]
      if (size == null || p + 8 + size > end) break
      if (id === 'LIST') rewrite(p + 12, p + 8 + size)
      if ((options.literal === 'all' || options.literal === id) && size >= lengths.length) stream.writeUInt32LE(size, p + 4)
      p += 8 + size + (size & 1)
    }
  }
  rewrite(0, stream.length)
  const table = Buffer.alloc(lengths.length * 4); lengths.forEach((n, i) => table.writeUInt32LE(n, i * 4))
  const level = options.level ?? 6
  return repackCdrStreams(fixture, zlib.deflateSync(stream, { level }), zlib.deflateSync(table, { level }), stream.length, table.length)
}
function expandedCases () {
  const cases = []
  const broken = Buffer.alloc(8); broken.write('loda'); broken.writeUInt32LE(0xffffffff, 4)
  for (const [variant, color, translation] of [['red', 0xff0000, [0, 0]], ['blue', 0x0000ff, [3, 2]]]) {
    const fixture = cdrCompressedVectorFixture({ color, translation }), tree = decodedTree(fixture)
    const specs = [
      ['indexed', {}], ['literal-all', { literal: 'all' }], ['literal-loda', { literal: 'loda' }],
      ...[1, 2, 3, 16].map(n => [`prefix-zero-${n}`, { prefixPadding: n }]),
      ['nested-zeros', { nestedPadding: 3 }], ['mixed-zeros-literals', { prefixPadding: 3, nestedPadding: 1, literal: 'all' }],
      ['malformed-root-tail', { tail: broken, reject: true }], ['short-root-tail', { tail: Buffer.from('loda123'), reject: true }]
    ]
    for (const [name, options] of specs) cases.push({ name: `${name}-${variant}`, bytes: encoded(fixture, tree, options), category: options.reject ? 'malformed-candidate' : 'native-candidate', variant, color, translation })
    const nestedBad = decodedTree(fixture); nestedBad[0].children.find(x => x.type === 'page').tail = broken
    cases.push({ name: `malformed-nested-tail-${variant}`, bytes: encoded(fixture, nestedBad), category: 'malformed-candidate', variant, color, translation })
    const unknown = decodedTree(fixture); unknown[0].children.unshift({ id: 'JUNK', data: Buffer.from([1, 2, 3]) })
    cases.push({ name: `odd-unknown-${variant}`, bytes: encoded(fixture, unknown), category: 'native-candidate', variant, color, translation })
  }
  return cases
}
module.exports = { decodedTree, encoded, expandedCases }
