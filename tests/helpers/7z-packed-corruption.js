'use strict'

const { solidArchive } = require('./7z-solid')

const password = 'packed-corruption-fixture-93'
const packedDataOffset = 64

function uint32 (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function uint64 (bytes, offset) {
  return uint32(bytes, offset) + uint32(bytes, offset + 4) * 0x100000000
}

function deterministicAscii (size, seed) {
  const alphabet = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ')
  const output = Buffer.alloc(size)
  let state = seed >>> 0
  for (let index = 0; index < output.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    output[index] = alphabet[state % alphabet.length]
  }
  return output
}

function htmlBody (title, seed, size = 600 * 1024) {
  const prefix = Buffer.from(`<h1>${title}</h1><pre>`)
  const suffix = Buffer.from('</pre>')
  return Buffer.concat([prefix, deterministicAscii(size - prefix.length - suffix.length, seed), suffix])
}

async function packedCorruptionFixture (wasmBinary, options = {}) {
  const firstBody = htmlBody('第一固实块完整正文', 1)
  const secondBody = htmlBody('第二固实块完整正文', 2)
  const archive = await solidArchive(wasmBinary, [
    { name: '000-first.html', bytes: firstBody },
    { name: '999-second.html', bytes: secondBody }
  ], { password, solid: '1m', ...options })
  const nextHeaderStart = 32 + uint64(archive, 12)
  if (packedDataOffset < 32 || packedDataOffset >= nextHeaderStart) throw new Error('测试损坏位置不在7z数据区')
  const damaged = new Uint8Array(archive)
  damaged[packedDataOffset] ^= 0x01
  return { archive, damaged, firstBody, secondBody, nextHeaderStart, packedDataOffset, password }
}

module.exports = { packedCorruptionFixture, password }
