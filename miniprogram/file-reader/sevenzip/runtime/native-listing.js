'use strict'

// The terminal's Path = ... output is lossy. Native UTF-8 callbacks are the
// only member identity source; stdout remains diagnostic/archive-summary text.
const MAX_MEMBERS = 10000
const MAX_METADATA_CHARS = 2 * 1024 * 1024
const MAX_FIELD_CHARS = 65536
const FIELD_NAMES = ['Size', 'Packed Size', 'Encrypted', 'Method', 'CRC', 'Symbolic Link', 'Hard Link', 'Copy Link', 'AttributesRaw', 'PosixAttributesRaw', 'Characteristics']

function createNativeListing () {
  let total = null
  let ended = false
  let chars = 0
  const entries = []
  const byIndex = new Map()
  function invalid () { throw new Error('7z 原生成员目录不完整或标识无效') }
  function text (value) {
    if (typeof value !== 'string' || value.includes('\0')) invalid()
    chars += value.length
    if (value.length > MAX_FIELD_CHARS || chars > MAX_METADATA_CHARS) throw new Error('7z 目录文字超过安全上限')
    return value
  }
  return {
    boundary (phase, count) {
      if (!Number.isSafeInteger(count) || count < 0) invalid()
      if (phase === 'begin') {
        if (total !== null || ended) invalid()
        if (count > MAX_MEMBERS) throw new Error('7z 目录项超过 10000 项安全上限')
        total = count
      } else if (phase === 'end') {
        if (total === null || ended || count !== entries.length || count > total) invalid()
        ended = true
      } else invalid()
    },
    entry (index, name, directory) {
      if (total === null || ended || !Number.isSafeInteger(index) || index < 0 || index >= total || byIndex.has(index) || typeof directory !== 'boolean') invalid()
      const row = { index, directory, fields: Object.create(null) }
      row.fields.Path = text(name)
      if (!name) invalid()
      byIndex.set(index, row)
      entries.push(row)
    },
    field (index, key, value) {
      const row = byIndex.get(index)
      if (!row || ended || !FIELD_NAMES.includes(key) || Object.prototype.hasOwnProperty.call(row.fields, key)) invalid()
      row.fields[key] = text(value)
    },
    finish () {
      if (total === null || !ended) invalid()
      for (const row of entries) {
        if (FIELD_NAMES.some(key => typeof row.fields[key] !== 'string')) invalid()
        for (const key of ['Size', 'Packed Size']) {
          const value = row.fields[key]
          if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) invalid()
        }
        for (const key of ['AttributesRaw', 'PosixAttributesRaw']) {
          const value = row.fields[key]
          if (value && (!/^\d+$/.test(value) || Number(value) > 0xffffffff)) invalid()
        }
        if (row.fields.CRC && !/^[a-f\d]{8}$/i.test(row.fields.CRC)) invalid()
        if (!['', '+', '-'].includes(row.fields.Encrypted)) invalid()
      }
      return entries
    }
  }
}

module.exports = { createNativeListing, MAX_MEMBERS, MAX_METADATA_CHARS, MAX_FIELD_CHARS }
