'use strict'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto')
const { cdrCompressedVectorFixture, repackCdrStreams } = require('../tests/helpers/cdr-zlib')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const out = path.resolve(process.argv[2] || 'outputs/cdr-record-integrity/discovery')
fs.mkdirSync(out, { recursive: true })
const source = cdrCompressedVectorFixture(), firstEnd = 48 + source.readUInt32LE(24) - 8
const stream = zlib.inflateSync(source.subarray(48, firstEnd)), table = zlib.inflateSync(source.subarray(firstEnd + 8))
const lengths = Array.from({ length: table.length / 4 }, (_, i) => table.readUInt32LE(i * 4)), records = []
function walk (start, end, depth = 0) {
  for (let p = start; p + 8 <= end;) {
    const id = stream.subarray(p, p + 4).toString(), index = stream.readUInt32LE(p + 4), size = lengths[index]
    records.push({ offset: p, id, index, size, depth })
    if (id === 'LIST') walk(p + 12, p + 8 + size, depth + 1)
    p += 8 + size + (size & 1)
  }
}
walk(0, stream.length)
const literal = selected => { const b = Buffer.from(stream); for (const r of records.filter(selected)) b.writeUInt32LE(r.size, r.offset + 4); return b }
const impossible = Buffer.alloc(8); impossible.write('loda'); impossible.writeUInt32LE(0xffffffff, 4)
const oversizedTable = Buffer.from(table); oversizedTable.writeUInt32LE(lengths[records[0].index] + 100, records[0].index * 4)
const scenarios = [
  { name: 'indexed-control', stream, table, category: 'known-good' },
  { name: 'literal-all', stream: literal(() => true), table, category: 'native-source-supported-candidate' },
  { name: 'literal-root', stream: literal(r => r.depth === 0), table, category: 'native-source-supported-candidate' },
  { name: 'literal-loda', stream: literal(r => r.id === 'loda'), table, category: 'native-source-supported-candidate' },
  { name: 'zero-tail-control', stream: Buffer.concat([stream, Buffer.alloc(4)]), table, category: 'native-source-supported-candidate' },
  { name: 'short-header-tail', stream: Buffer.concat([stream, Buffer.from('loda123')]), table, category: 'malformed-candidate' },
  { name: 'impossible-length-tail', stream: Buffer.concat([stream, impossible]), table, category: 'malformed-candidate' },
  { name: 'oversized-root', stream, table: oversizedTable, category: 'malformed-candidate' }
]
const rows = []
for (const level of [0, 6, 9]) for (const scenario of scenarios) {
  const bytes = repackCdrStreams(source, zlib.deflateSync(scenario.stream, { level }), zlib.deflateSync(scenario.table, { level }), scenario.stream.length, scenario.table.length)
  const result = inspectFileBytes(bytes, { name: scenario.name + '.cdr' }), name = `${scenario.name}-z${level}`
  fs.writeFileSync(path.join(out, name + '.cdr'), bytes)
  rows.push({ name, category: scenario.category, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'), preview: !!result.previewSvg, svg: result.previewSvg, summary: result.summary, metadata: result.metadata })
}
const report = { at: new Date().toISOString(), status: 'discovery-needs-native-execution', scenarios: scenarios.length, sources: rows.length, random: false, generation: 'Known authored triangle, independent Node zlib recompression levels0/6/9; modify record size fields, table bounds and trailing records while keeping both compression checksums valid.', independentSource: 'https://github.com/LibreOffice/libcdr/blob/77f52f694362ba0f01b3fdac6ebcc91e5debe400/src/lib/CDRParser.cpp#L565', important: 'Native source maps a size through the table only when it is within range; otherwise it retains literal length. Do not reject every non-index as invalid. Native binary not currently located; no native rendering success or corruption verdict claimed.', records, rows }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(rows.map(({ name, preview, category }) => ({ name, preview, category })), null, 2))
