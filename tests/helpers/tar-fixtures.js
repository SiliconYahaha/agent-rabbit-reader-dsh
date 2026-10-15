'use strict'

// Original USTAR/PAX/GNU fixtures; all bytes are constructed locally.
function header (name, body = Buffer.alloc(0), type = '0', target = '', options = {}) {
  body = Buffer.from(body)
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write((options.mode || 0o644).toString(8).padStart(7, '0') + '\0', 100)
  h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
  h.write('00000000000\0', 136); h.fill(32, 148, 156)
  h.write(type, 156); h.write(target, 157, 100)
  h.write('ustar\0', 257); h.write('00', 263)
  if (options.prefix) h.write(options.prefix, 345, 155)
  h.write(h.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return Buffer.concat([h, body, Buffer.alloc((512 - body.length % 512) % 512)])
}

function paxField (key, value) {
  let length = Buffer.byteLength(' ' + key + '=' + value + '\n') + 1
  for (;;) {
    const text = length + ' ' + key + '=' + value + '\n', next = Buffer.byteLength(text)
    if (next === length) return text
    length = next
  }
}

function tar (members, format = 'ustar') {
  const blocks = []
  for (const member of members) {
    let name = member.name, target = member.target || '', prefix = ''
    if (format === 'pax') {
      const fields = paxField('path', name) + (target ? paxField('linkpath', target) : '')
      blocks.push(header('PaxHeader', fields, 'x'))
      name = 'placeholder'; target = target ? 'placeholder-target' : ''
    } else if (format === 'gnu') {
      if (Buffer.byteLength(name) > 100) { blocks.push(header('././@LongLink', name + '\0', 'L')); name = 'placeholder' }
      if (Buffer.byteLength(target) > 100) { blocks.push(header('././@LongLink', target + '\0', 'K')); target = 'placeholder-target' }
    } else if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/')
      prefix = name.slice(0, split); name = name.slice(split + 1)
      if (split < 0 || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) throw new Error('USTAR fixture name exceeds split header fields')
    }
    if (Buffer.byteLength(target) > 100) throw new Error('USTAR fixture link target exceeds header field')
    blocks.push(header(name, member.body || '', member.type || '0', target, { prefix, mode: member.mode }))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}

module.exports = { header, paxField, tar }
