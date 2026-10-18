'use strict'
const { decodeText } = require('./text-decoder')
function sniffMaterial (data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data)
  const at = (...bytes) => bytes.every((value, index) => b[index] === value)
  if (at(0x25,0x50,0x44,0x46,0x2d)) return 'application/pdf'
  if (at(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)) return 'image/png'
  if (at(0xff,0xd8,0xff)) return 'image/jpeg'
  if (at(0x47,0x49,0x46,0x38)) return 'image/gif'
  if (at(0x50,0x4b,3,4) || at(0x50,0x4b,5,6)) return 'application/zip'
  if (at(0x38,0x42,0x50,0x53)) return 'application/x-photoshop'
  let text
  try { text = decodeText(b).text } catch (_) { return '' }
  if (typeof text !== 'string') return ''
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text) || (text.match(/\ufffd/g) || []).length > Math.max(2,text.length/100)) return ''
  if (/^\s*\{\\rtf\d/i.test(text)) return 'application/rtf'
  const start = text.replace(/^\ufeff/, '').trimStart().replace(/^<\?xml[^>]*>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '')
  if (/^<svg(?:\s|>)/i.test(start)) return 'image/svg+xml'
  if (/^(?:<!doctype\s+html|<(?:html|head|body|style|h[1-6]|div|p|table|section|button)(?:\s|>))/i.test(start)) return 'text/html'
  if (/^\s{0,3}(?:#{1,6}\s+|```|~~~|>\s+|[-*+]\s+\[[ xX]\])/m.test(text) || /\n\s*\|?\s*:?-{3,}/.test(text)) return 'text/markdown'
  if (/^[\[{]/.test(start)) { try { JSON.parse(text);return 'application/json' } catch (_) {} }
  return 'text/plain'
}
module.exports = { sniffMaterial }
