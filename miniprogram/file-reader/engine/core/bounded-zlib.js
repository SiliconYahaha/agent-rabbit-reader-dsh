'use strict'

// RFC 1950/1951 decoder for a single size-declared document stream. Unlike a
// growable inflater, every literal/match/stored block is checked BEFORE writing
// to the one fixed output allocation. No host APIs, code execution or I/O.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const MAX_BLOCKS = 16384
const MAX_EMPTY_TRAILING_STREAMS = 4
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function tree (lengths, kind) {
  const counts = new Uint16Array(16)
  let max = 0
  for (const length of lengths) { counts[length]++; if (length > max) max = length }
  if (!max) {
    if (kind === 'distance') return { table: new Uint16Array(1), bits: 0 }
    throw new Error('DEFLATE Huffman 码表为空')
  }
  let left = 1
  for (let bits = 1; bits <= 15; bits++) {
    left = left * 2 - counts[bits]
    if (left < 0) throw new Error('DEFLATE Huffman 码表重叠')
  }
  if (left && (kind === 'codes' || max !== 1)) throw new Error('DEFLATE Huffman 码表不完整')
  const next = new Uint16Array(16)
  let code = 0
  for (let bits = 1; bits <= max; bits++) { code = (code + (bits === 1 ? 0 : counts[bits - 1])) * 2; next[bits] = code }
  const table = new Uint16Array(1 << max)
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol]
    if (!length) continue
    let value = next[length]++; let reversed = 0
    for (let bit = 0; bit < length; bit++) { reversed = (reversed << 1) | (value & 1); value >>>= 1 }
    for (let at = reversed; at < table.length; at += 1 << length) table[at] = (symbol << 4) | length
  }
  return { table, bits: max }
}

let fixedTrees
function fixed () {
  if (!fixedTrees) {
    const lengths = new Uint8Array(288)
    lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280)
    fixedTrees = [tree(lengths, 'literal'), tree(new Uint8Array(32).fill(5), 'distance')]
  }
  return fixedTrees
}

function inflateBounded (input, expectedBytes, maxOutputBytes, raw, reportConsumed = false, blockLimit = MAX_BLOCKS) {
  const label = raw ? 'DEFLATE' : 'ZLIB'
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || expectedBytes > Math.min(maxOutputBytes, MAX_OUTPUT_BYTES)) throw new Error(`${label} 声明长度超过本机解压上限`)
  if (!input || input.length < (raw ? 1 : 6)) throw new Error(`${label} 数据不完整`)
  let windowBytes = 32768
  if (!raw) {
    const cmf = input[0]; const flg = input[1]
    if ((cmf & 15) !== 8 || (cmf >>> 4) > 7 || (cmf * 256 + flg) % 31) throw new Error('ZLIB 文件头校验失败')
    if (flg & 32) throw new Error('ZLIB 预设字典未提供，不能还原内容')
    windowBytes = 1 << ((cmf >>> 4) + 8)
  }
  const end = input.length - (raw ? 0 : 4)
  let cursor = raw ? 0 : 2; let bits = 0; let bitCount = 0
  const fill = count => {
    while (bitCount < count && cursor < end) { bits |= input[cursor++] << bitCount; bitCount += 8 }
  }
  const read = count => {
    fill(count)
    if (bitCount < count) throw new Error('DEFLATE 数据不完整')
    const result = bits & ((1 << count) - 1)
    bits >>>= count; bitCount -= count
    return result
  }
  const decode = table => {
    fill(table.bits)
    const entry = table.table[bits & ((1 << table.bits) - 1)]
    const length = entry & 15
    if (!length) throw new Error('DEFLATE Huffman 编码损坏')
    if (length > bitCount) throw new Error('DEFLATE Huffman 数据不完整')
    bits >>>= length; bitCount -= length
    return entry >>> 4
  }
  const dynamic = () => {
    const literals = read(5) + 257; const distances = read(5) + 1; const count = read(4) + 4
    if (literals > 286) throw new Error('DEFLATE 字面量码表长度错误')
    const codes = new Uint8Array(19)
    for (let i = 0; i < count; i++) codes[CODE_ORDER[i]] = read(3)
    const codeTree = tree(codes, 'codes')
    const lengths = new Uint8Array(literals + distances)
    let index = 0
    while (index < lengths.length) {
      const symbol = decode(codeTree)
      if (symbol < 16) { lengths[index++] = symbol; continue }
      if (symbol === 16 && !index) throw new Error('DEFLATE 首个码长不能重复')
      const count = symbol === 16 ? read(2) + 3 : symbol === 17 ? read(3) + 3 : read(7) + 11
      if (index + count > lengths.length) throw new Error('DEFLATE 重复码长越界')
      lengths.fill(symbol === 16 ? lengths[index - 1] : 0, index, index + count)
      index += count
    }
    if (!lengths[256]) throw new Error('DEFLATE 缺少结束编码')
    return [tree(lengths.subarray(0, literals), 'literal'), tree(lengths.subarray(literals), 'distance')]
  }
  const output = new Uint8Array(expectedBytes)
  let written = 0; let final = false; let blocks = 0
  const ensure = count => {
    if (written + count > expectedBytes) throw new Error(`${label} 实际解压长度超过声明上限 ${expectedBytes}`)
  }
  while (!final) {
    if (++blocks > blockLimit) throw new Error('DEFLATE 区块数量超过本机处理上限')
    final = !!read(1)
    const type = read(2)
    if (type === 0) {
      // Discard only byte-alignment bits, retaining any prefetched full bytes.
      read(bitCount % 8)
      const length = read(16); const complement = read(16)
      if ((length ^ complement) !== 65535) throw new Error('DEFLATE 未压缩块长度校验失败')
      ensure(length)
      for (let i = 0; i < length; i++) output[written++] = read(8)
      continue
    }
    if (type === 3) throw new Error('DEFLATE 保留区块类型损坏')
    const [literalTree, distanceTree] = type === 1 ? fixed() : dynamic()
    while (true) {
      const symbol = decode(literalTree)
      if (symbol < 256) { ensure(1); output[written++] = symbol; continue }
      if (symbol === 256) break
      if (symbol > 285) throw new Error('DEFLATE 保留长度编码损坏')
      const index = symbol - 257
      const count = LENGTH_BASE[index] + read(LENGTH_EXTRA[index])
      const distanceSymbol = decode(distanceTree)
      if (distanceSymbol > 29) throw new Error('DEFLATE 保留距离编码损坏')
      const distance = DIST_BASE[distanceSymbol] + read(DIST_EXTRA[distanceSymbol])
      if (distance > written || distance > windowBytes) throw new Error('DEFLATE 引用距离越界')
      ensure(count)
      // Overlapping LZ77 matches intentionally copy forward, one byte at a time.
      for (let i = 0; i < count; i++) { output[written] = output[written - distance]; written++ }
    }
  }
  const consumedBytes = cursor - Math.floor(bitCount / 8)
  if (!reportConsumed && consumedBytes !== end) throw new Error(`${label} 合成流结尾存在额外数据`)
  if (written !== expectedBytes) throw new Error(`${label} 合成数据长度不符：预期 ${expectedBytes}，实际 ${written}`)
  if (raw) return reportConsumed ? { output, consumedBytes, blocks } : output // ZIP validates its own CRC32, not an Adler trailer.
  let a = 1; let b = 0
  for (let start = 0; start < output.length; start += 5552) {
    const stop = Math.min(start + 5552, output.length)
    for (let i = start; i < stop; i++) { a += output[i]; b += a }
    a %= 65521; b %= 65521
  }
  const checksum = ((b << 16) | a) >>> 0
  const declared = ((input[end] << 24) | (input[end + 1] << 16) | (input[end + 2] << 8) | input[end + 3]) >>> 0
  if (checksum !== declared) throw new Error('ZLIB Adler-32 校验失败，合成数据已损坏')
  return output
}

function inflateZlibBounded (input, expectedBytes, maxOutputBytes = MAX_OUTPUT_BYTES) {
  return inflateBounded(input, expectedBytes, maxOutputBytes, false)
}

function inflateRawBounded (input, expectedBytes, maxOutputBytes = MAX_OUTPUT_BYTES) {
  return inflateBounded(input, expectedBytes, maxOutputBytes, true)
}

// A small set of old ZIP writers included one complete, empty raw Deflate
// stream in the declared compressed size after the real stream. Recover only
// that structured case: the first stream must already produce the exact
// declared output and each suffix must be a complete zero-output stream. A
// random byte, truncated suffix, visible second payload or unbounded chain is
// still rejected; the ZIP layer subsequently verifies the central CRC32.
function inflateRawZipBounded (input, expectedBytes, maxOutputBytes = MAX_OUTPUT_BYTES) {
  const first = inflateBounded(input, expectedBytes, maxOutputBytes, true, true)
  let offset = first.consumedBytes
  let totalBlocks = first.blocks
  let trailingStreams = 0
  while (offset < input.length) {
    if (++trailingStreams > MAX_EMPTY_TRAILING_STREAMS) throw new Error('ZIP DEFLATE 空尾随流数量超过兼容上限')
    const trailing = inflateBounded(input.subarray(offset), 0, 0, true, true, MAX_BLOCKS - totalBlocks)
    if (!trailing.consumedBytes) throw new Error('ZIP DEFLATE 空尾随流无效')
    offset += trailing.consumedBytes
    totalBlocks += trailing.blocks
  }
  return first.output
}

module.exports = { inflateZlibBounded, inflateRawBounded, inflateRawZipBounded, MAX_OUTPUT_BYTES, MAX_BLOCKS, MAX_EMPTY_TRAILING_STREAMS }
