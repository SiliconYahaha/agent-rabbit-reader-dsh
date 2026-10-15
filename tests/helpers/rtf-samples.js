'use strict'

const iconv = require('iconv-lite')

const windowsCodepageCases = [
  { encoding: 'windows-874', codepage: 874, charset: 222, source: 'ภาษาไทย: สวัสดีชาวโลก' },
  { encoding: 'windows-1250', codepage: 1250, charset: 238, source: 'Čeština: Příliš žluťoučký kůň' },
  { encoding: 'windows-1251', codepage: 1251, charset: 204, source: 'Русский: Привет, мир!' },
  { encoding: 'windows-1252', codepage: 1252, charset: 0, source: 'Français: Café — déjà vu €' },
  { encoding: 'windows-1253', codepage: 1253, charset: 161, source: 'Ελληνικά: Καλημέρα κόσμε!' },
  { encoding: 'windows-1254', codepage: 1254, charset: 162, source: 'Türkçe: İstanbul, ğüşiöç' },
  { encoding: 'windows-1255', codepage: 1255, charset: 177, source: 'עברית: שלום עולם' },
  { encoding: 'windows-1256', codepage: 1256, charset: 178, source: 'العربية: مرحبا بالعالم' },
  { encoding: 'windows-1257', codepage: 1257, charset: 186, source: 'Lietuvių: Ąžuolas, žąsis, ūdra' },
  // CP1258 stores many Vietnamese tone marks as combining bytes.
  { encoding: 'windows-1258', codepage: 1258, charset: 163, source: 'Tiê\u0301ng Viê\u0323t: Cô\u0323ng ho\u0300a, Trươ\u0300ng Sa' }
]

// Independent byte generator, not built using the reader under test.
function encodedRtf (text, encoding = 'gbk', codepage = 936, variant = 0) {
  const body = Array.from(iconv.encode(text, encoding), (byte, index) => {
    const syntax = byte === 0x5c || byte === 0x7b || byte === 0x7d
    const escaped = syntax || (variant > 0 && (index + variant) % 3 !== 0)
    return escaped ? `\\'${byte.toString(16).padStart(2, '0')}${variant > 1 && index % 2 === 0 ? '\r\n' : ''}` : String.fromCharCode(byte)
  }).join('')
  return Buffer.from(`{\\rtf1\\ansi\\ansicpg${codepage} ${body}}`, 'latin1')
}

module.exports = { encodedRtf, windowsCodepageCases }
