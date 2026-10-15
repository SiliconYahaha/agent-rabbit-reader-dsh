'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const zlib = require('node:zlib')
const fs = require('node:fs')
const vm = require('node:vm')
const { inflateZlibBounded, MAX_OUTPUT_BYTES, MAX_BLOCKS } = require('../miniprogram/file-reader/engine/core/bounded-zlib')

function bytes (length, seed, kind) {
  let state = seed >>> 0
  return Buffer.from(Array.from({ length }, (_, i) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return kind === 0 ? 0 : kind === 1 ? i % 251 : kind === 2 ? state & 255 : (i % 317 < 280 ? i % 7 : state & 255)
  }))
}

function bitWriter () {
  const output = []; let value = 0; let count = 0
  return {
    write (n, width) {
      for (let i = 0; i < width; i++) {
        value |= ((n >>> i) & 1) << count
        if (++count === 8) { output.push(value); value = 0; count = 0 }
      }
    },
    fixed (symbol) {
      const width = symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8
      const code = symbol < 144 ? symbol + 48 : symbol < 256 ? symbol - 144 + 400 : symbol < 280 ? symbol - 256 : symbol - 280 + 192
      for (let i = width - 1; i >= 0; i--) this.write((code >>> i) & 1, 1)
    },
    end () { return Buffer.from(count ? [...output, value] : output) }
  }
}

function wrap (raw) { return Buffer.concat([Buffer.from([0x78, 0x01]), raw, Buffer.from([0, 0, 0, 1])]) }

test('有界 ZLIB 与 Node 原生解压逐字节一致：192 个尺寸、策略、窗口和数据组合', () => {
  const strategies = [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE]
  let cases = 0
  for (const length of [0, 1, 17, 5553, 32769, 70001]) {
    for (let kind = 0; kind < 4; kind++) {
      for (let variant = 0; variant < 8; variant++) {
        const input = bytes(length, 81231 + cases, kind)
        const packed = zlib.deflateSync(input, { level: variant === 0 ? 0 : variant % 2 ? 1 : 9, strategy: strategies[variant % 4], windowBits: variant < 4 ? 9 : 15 })
        assert.deepEqual(Buffer.from(inflateZlibBounded(packed, input.length)), input, `case ${cases}`)
        assert.deepEqual(zlib.inflateSync(packed), input)
        cases++
      }
    }
  }
  assert.equal(cases, 192)
})

test('跨块回溯以及 Huffman 后的 stored 字节对齐：sync/full flush 均与原生一致', async () => {
  for (const flush of [zlib.constants.Z_SYNC_FLUSH, zlib.constants.Z_FULL_FLUSH]) {
    const stream = zlib.createDeflate({ level: 9 }); const chunks = []; const plain = []
    stream.on('data', chunk => chunks.push(chunk))
    const done = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject) })
    for (let i = 0; i < 10; i++) {
      const part = bytes(1703 + i * 13, i + 1, i % 4); plain.push(part)
      stream.write(part)
      await new Promise((resolve, reject) => stream.flush(flush, error => error ? reject(error) : resolve()))
    }
    stream.end(); await done
    const packed = Buffer.concat(chunks); const expected = Buffer.concat(plain)
    assert.deepEqual(Buffer.from(inflateZlibBounded(packed, expected.length)), expected)
    assert.deepEqual(zlib.inflateSync(packed), expected)
  }
})

test('输出内存按可信声明一次分配，2 MiB 膨胀在首个越界写入前拒绝', () => {
  const allocations = []
  class U8 extends Uint8Array { constructor (...args) { super(...args); allocations.push({ type: 8, bytes: this.byteLength }) } }
  class U16 extends Uint16Array { constructor (...args) { super(...args); allocations.push({ type: 16, bytes: this.byteLength }) } }
  const context = { module: { exports: {} }, Uint8Array: U8, Uint16Array: U16 }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/file-reader/engine/core/bounded-zlib'), 'utf8'), context)
  const decode = context.module.exports.inflateZlibBounded
  for (const options of [{ level: 0 }, { strategy: zlib.constants.Z_FIXED }, { level: 9 }]) {
    const packed = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024), options)
    allocations.length = 0
    let reads = 0
    const observed = new Proxy(packed, { get (target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, target) } })
    assert.throws(() => decode(observed, 20, 80), /长度.*上限/)
    assert.ok(allocations.some(item => item.type === 8 && item.bytes === 20))
    assert.ok(allocations.every(item => item.bytes <= 65536), JSON.stringify(allocations))
    assert.ok(allocations.reduce((sum, item) => sum + item.bytes, 0) < 140000)
    assert.ok(reads < 1024, `拒绝前读取了 ${reads} 字节，而非在第一个越界写入时停止`)
  }
})

test('每个截断位置、Adler/头校验、预设字典和额外尾数据不能假成功', () => {
  const input = bytes(713, 4123, 3)
  const packed = zlib.deflateSync(input)
  for (let i = 0; i < packed.length; i++) assert.throws(() => inflateZlibBounded(packed.subarray(0, i), input.length), undefined, `truncate ${i}`)
  for (const offset of [0, 1, packed.length - 4, packed.length - 3, packed.length - 2, packed.length - 1]) {
    const bad = Buffer.from(packed); bad[offset] ^= 1
    assert.throws(() => zlib.inflateSync(bad))
    assert.throws(() => inflateZlibBounded(bad, input.length), /校验|文件头/)
  }
  assert.throws(() => inflateZlibBounded(zlib.deflateSync(input, { dictionary: Buffer.from('dictionary') }), input.length), /字典/)
  assert.throws(() => inflateZlibBounded(Buffer.concat([packed.subarray(0, -4), Buffer.from([0]), packed.subarray(-4)]), input.length), /额外/)
  assert.throws(() => inflateZlibBounded(packed, input.length - 1), /长度/)
  assert.throws(() => inflateZlibBounded(packed, input.length + 1), /长度/)
})

test('损坏 stored 长度、保留块/长度/距离、越界回溯和无效动态树都拒绝', () => {
  const invalid = [Buffer.from([7]), Buffer.from([1, 1, 0, 1, 0, 65])]
  for (const literal of [286, 287]) { const bits = bitWriter(); bits.write(3, 3); bits.fixed(literal); invalid.push(bits.end()) }
  for (const distance of [0, 15, 31]) { const bits = bitWriter(); bits.write(3, 3); bits.fixed(257); bits.write(distance, 5); invalid.push(bits.end()) }
  const dynamic = bitWriter(); dynamic.write(5, 3); dynamic.write(0, 5); dynamic.write(0, 5); dynamic.write(0, 4); dynamic.write(0, 12); invalid.push(dynamic.end())
  const oversized = bitWriter(); oversized.write(5, 3); oversized.write(31, 5); oversized.write(0, 5); oversized.write(0, 4); invalid.push(oversized.end())
  for (const raw of invalid) {
    const packed = wrap(raw)
    assert.throws(() => zlib.inflateSync(packed))
    assert.throws(() => inflateZlibBounded(packed, 64), /DEFLATE/)
  }
})

test('2304 个固定种子单比特变体：不得接受原生拒绝或内容不同的数据', () => {
  let accepted = 0
  for (let seed = 1; seed <= 24; seed++) {
    const plain = bytes(301 + seed, seed * 7123, seed % 4)
    const packed = zlib.deflateSync(plain)
    for (let i = 0; i < 96; i++) {
      const changed = Buffer.from(packed)
      changed[(i * 37 + seed) % changed.length] ^= 1 << (i % 8)
      let actual
      try { actual = inflateZlibBounded(changed, plain.length) } catch (_) { continue }
      assert.deepEqual(Buffer.from(actual), zlib.inflateSync(changed), `seed=${seed}, mutation=${i}`)
      accepted++
    }
  }
  assert.ok(accepted > 0, '合法 padding 位变化也必须能通过，不能全部拒绝')
})

test('空流、显式零预算、非法预算及过量空区块的资源边界', () => {
  const empty = zlib.deflateSync(Buffer.alloc(0))
  assert.equal(inflateZlibBounded(empty, 0, 0).length, 0)
  for (const limit of [-1, NaN, Infinity, 0.5]) assert.throws(() => inflateZlibBounded(empty, 0, limit), /上限/)
  assert.throws(() => inflateZlibBounded(empty, MAX_OUTPUT_BYTES + 1), /上限/)
  assert.throws(() => inflateZlibBounded(empty, 1, 0), /上限/)
  const blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => Buffer.from([i === MAX_BLOCKS ? 1 : 0, 0, 0, 255, 255]))
  const excessive = wrap(Buffer.concat(blocks))
  assert.equal(zlib.inflateSync(excessive).length, 0)
  assert.throws(() => inflateZlibBounded(excessive, 0), /区块数量.*上限/)
  blocks.shift()
  assert.equal(inflateZlibBounded(wrap(Buffer.concat(blocks)), 0).length, 0)
})
