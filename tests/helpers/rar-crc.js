'use strict'

const { crc32 } = require('./archive-duplicates')
const before = require('../../compatibility/runs/2026-09-05-next-rar-crc.json')
const { rar4Links, rar5Links } = require('./rar-links')

function vint (value) {
  const bytes = []
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)) } while (value)
  return Buffer.from(bytes)
}
function block (header, data = Buffer.alloc(0)) {
  const body = Buffer.concat([vint(header.length), header])
  const crc = Buffer.alloc(4); crc.writeUInt32LE(crc32(body))
  return Buffer.concat([crc, body, data])
}
function rar5 (options = {}) {
  const data = Buffer.from('RAR checksum 正文\n')
  const crc = Buffer.alloc(4); crc.writeUInt32LE(crc32(data))
  const name = Buffer.from('entry.txt')
  const extra = options.extra || Buffer.alloc(0)
  const fields = options.fields || [vint(options.fileFlags == null ? 4 : options.fileFlags), vint(data.length), vint(0), crc, vint(0), vint(1), options.nameSize || vint(name.length), name]
  const file = block(Buffer.concat([vint(2), vint(2 | (extra.length ? 1 : 0) | (options.split || 0)), ...(extra.length ? [options.extraSize || vint(extra.length)] : []), options.dataSize || vint(data.length), ...fields, extra]), data)
  return Buffer.concat([Buffer.from('526172211a070100', 'hex'), block(Buffer.from([1, 0, 0])), ...(options.before || []), file, block(Buffer.from([5, 0, 0]))])
}
function samples () {
  const out = before.results.map(row => ({ name: row.name, bytes: Buffer.from(row.sourceBase64, 'base64'), accept: row.unrar.accepted, hex: row.unrar.hex, baseline: row }))
  for (const version of [4, 5]) {
    const valid = out.find(row => row.name === `rar${version}-valid`).bytes
    const add = (suffix, bytes, accept, hex) => out.push({ name: `rar${version}-${suffix}`, bytes, accept, hex })
    add('truncated-data', valid.subarray(0, valid.length - (version === 4 ? 8 : 9)), false)
    add('truncated-tail-header', valid.subarray(0, valid.length - 2), false)
    add('missing-end-marker', valid.subarray(0, valid.length - (version === 4 ? 7 : 8)), true, out.find(row => row.name === `rar${version}-valid`).hex)
    const linked = (version === 4 ? rar4Links : rar5Links)([{name:'entry.txt',target:'target.txt'}, {name:'target.txt',content:'TARGET'}])
    out.push({name:`rar${version}-link-fallback-blocked`,bytes:linked,openable:false,nativeOnly:true})
    if (version === 4) {
      const fix = b => { const size = b.readUInt16LE(25); b.writeUInt16LE(crc32(b.subarray(22,20+size)) & 0xffff,20); return b }
      const name = Buffer.from(valid); name.writeUInt16LE(65535,46); add('name-crosses-header',fix(name),false)
      const split = Buffer.from(valid); split.writeUInt16LE(split.readUInt16LE(23)|2,23); out.push({name:'rar4-split-fallback-blocked',bytes:fix(split),openable:false,nativeOnly:true})
      // LARGE adds two uint32 sizes before the filename, even when both high words are zero.
      const size=valid.readUInt16LE(25), large=Buffer.concat([valid.subarray(0,52),Buffer.alloc(8),valid.subarray(52)])
      large.writeUInt16LE(large.readUInt16LE(23)|0x100,23);large.writeUInt16LE(size+8,25)
      add('large-zero-high',fix(large),true,out.find(row=>row.name==='rar4-valid').hex)
      const high=Buffer.from(large);high.writeUInt32LE(1,52);add('large-packed-truncated',fix(high),false)
    }
  }
  const hex=Buffer.from('RAR checksum 正文\n').toString('hex')
  const add=(name,options,accept=false)=>out.push({name:`rar5-${name}`,bytes:rar5(options),accept,hex:accept?hex:undefined})
  add('name-crosses-header',{nameSize:vint(500)})
  add('name-vint-crosses-header',{fields:[vint(4),vint(1),vint(0),Buffer.alloc(4),vint(0),vint(1),Buffer.from([128])]})
  add('mtime-crosses-header',{fields:[vint(6),vint(1),vint(0),Buffer.alloc(2)]})
  add('crc-crosses-header',{fields:[vint(4),vint(1),vint(0),Buffer.alloc(2)]})
  add('data-size-unsafe',{dataSize:Buffer.from([255,255,255,255,255,255,255,127])})
  add('extra-size-crosses-header',{extra:Buffer.from([1,127]),extraSize:vint(500)})
  add('extra-record-crosses-header',{extra:Buffer.from([127,127])})
  add('extra-record-empty',{extra:Buffer.from([0])})
  add('unknown-extra',{extra:Buffer.from([1,127])},true)
  add('padded-name-vint',{nameSize:Buffer.from([137,0])},true)
  add('unknown-block',{before:[block(Buffer.from([127,4]))]},true)
  out.push({name:'rar5-split-fallback-blocked',bytes:rar5({split:16}),openable:false,nativeOnly:true})
  out.push({name:'rar5-unknown-size-fallback-blocked',bytes:rar5({fileFlags:12}),openable:false,nativeOnly:true})
  return out
}
module.exports = { samples }
