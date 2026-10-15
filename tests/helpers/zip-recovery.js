'use strict'

const { zipMember } = require('./zip-integrity')
const { combineZips } = require('./archive-duplicates')

// Model the Apache fault: inserted descriptors, central flags/offsets still
// describe the archive before insertion. Local bytes and payloads are intact.
function omittedDescriptors (members) {
  const bytes = combineZips(members.map(zipMember))
  const eocd = bytes.length - 22, central = bytes.readUInt32LE(eocd + 16)
  let cursor = central, omitted = 0
  for (const member of members) {
    bytes.writeUInt32LE(bytes.readUInt32LE(cursor + 42) - omitted, cursor + 42)
    if (member.descriptor) {
      bytes.writeUInt16LE(bytes.readUInt16LE(cursor + 8) & ~8, cursor + 8)
      omitted += member.descriptor === 'signed' ? 16 : 12
    }
    cursor += 46 + bytes.readUInt16LE(cursor + 28)
  }
  bytes.writeUInt32LE(central - omitted, eocd + 16)
  return bytes
}

const recoveryMembers = [
  { name: '资料/正文.txt', content: '第一份恢复的正文 😀', method: 0, descriptor: 'signed' },
  { name: '资料/正文.txt', content: '同名第二份，不能互换', method: 8, descriptor: 'unsigned' },
  { name: 'other.txt', content: 'untouched member', method: 8 }
]
module.exports = { omittedDescriptors, recoveryMembers }
