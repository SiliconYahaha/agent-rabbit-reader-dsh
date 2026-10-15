'use strict'

const assert = require('node:assert/strict')
const SevenZip = require('../../miniprogram/file-reader/sevenzip/runtime/7zz')
const password = 'mixed-blocks-fixture'
const names = ['000-first.html', '001-same-block.html', '100-independent.html', '101-independent-tail.html']

async function mixedBlocksFixture (wasmBinary, methods = ['LZMA:d=1m', 'PPMd:mem=1m']) {
  const output = []
  const engine = await SevenZip({ wasmBinary, print: line => output.push(line), printErr: line => output.push(line) })
  const bodies = names.map((name, index) => Buffer.from(`<h1>混合压缩正文 ${index + 1}</h1>` + `<p>${name}：完整正文，顺序与内容均应保留。</p>`.repeat(2048)))
  for (let block = 0; block < 2; block++) {
    const blockNames = names.slice(block * 2, block * 2 + 2)
    for (let i = 0; i < blockNames.length; i++) engine.FS.writeFile('/' + blockNames[i], bodies[block * 2 + i])
    assert.equal(engine.callMain(['a', '-t7z', '-m0=' + methods[block], '-ms=on', '-mqs=off', '-mhe=on', '-p' + password, '/mixed.7z', '--', ...blockNames.map(name => '/' + name)]), 0)
  }
  output.length = 0
  assert.equal(engine.callMain(['l', '-slt', '-p' + password, '/mixed.7z']), 0)
  const listing = output.join('\n')
  const rows = listing.split(/\n\s*\n/).filter(row => /^Path = (?:000|001|100|101)-/m.test(row))
  assert.equal(rows.length, 4, 'native fixture listing must contain all four members')
  const packed = rows.map(row => Number((row.match(/^Packed Size = (\d+)/m) || [])[1] || 0))
  const blockIds = rows.map(row => Number(row.match(/^Block = (\d+)/m)[1]))
  assert.equal(blockIds[0], 0)
  assert.notEqual(blockIds[1], blockIds[2], 'appending a different codec starts a new block')
  const archive = new Uint8Array(engine.FS.readFile('/mixed.7z'))
  let packedOffset = 32
  const offsets = packed.filter(size => size > 0).map(size => {
    assert.ok(size > 16)
    const offset = packedOffset + 16
    packedOffset += size
    return offset
  })
  const damaged = offsets.map(offset => {
    assert.ok(offset < archive.length)
    const result = new Uint8Array(archive)
    result[offset] ^= 1
    return result
  })
  return { archive, damaged, offsets, blockIds, names, bodies, password, methods, listing }
}

function splitMixedVolumes (bytes) {
  const size = Math.ceil(bytes.length / 3)
  return Array.from({ length: 3 }, (_, index) => ({ name: `mixed.7z.00${index + 1}`, bytes: bytes.slice(index * size, (index + 1) * size) }))
}

module.exports = { mixedBlocksFixture, splitMixedVolumes }
