'use strict'
// Exhaustive bounded byte batch, with separately downloaded reference data and
// native Cocoa output. References are never loaded from the product lookup table.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const { readerPage } = require('../tests/helpers/reader-host')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/rtf-symbol/mapping')
  fs.mkdirSync(out, { recursive: true })
  const appleBytes = fs.readFileSync(process.env.RTF_SYMBOL_APPLE)
  const adobeBytes = fs.readFileSync(process.env.RTF_SYMBOL_ADOBE)
  const apple = {}, adobe = {}
  for (const line of appleBytes.toString().split('\n')) {
    const m = /^(0x[0-9A-F]+)\s+((?:0x[0-9A-F]+)(?:\+0x[0-9A-F]+)*)/.exec(line)
    if (m) apple[Number(m[1])] = m[2].split('+').map(Number)
  }
  for (const line of adobeBytes.toString().split('\n')) {
    const m = /^([0-9A-F]+)\s+([0-9A-F]+)/.exec(line)
    if (m) (adobe[parseInt(m[2], 16)] ||= []).push(parseInt(m[1], 16))
  }
  const header = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset2 Symbol;}}`
  let nativeSource = header
  for (let byte = 32; byte < 256; byte++) nativeSource += String.raw`\f0 ` + byte + String.raw`: {\f1 \'` + byte.toString(16) + String.raw`} X\par` + '\n'
  nativeSource += '}'
  const nativePath = path.join(out, 'native-original.rtf')
  fs.writeFileSync(nativePath, nativeSource)
  const native = execFileSync(process.env.RTF_TEXTUTIL || '/usr/bin/textutil', ['-convert', 'txt', '-stdout', nativePath], { encoding: 'utf8', timeout: 20000 })
  fs.writeFileSync(path.join(out, 'native-original.txt'), native)
  const cocoa = {}
  for (const line of native.split('\n')) { const m = /^(\d+): (.*) X$/.exec(line); if (m) cocoa[m[1]] = m[2] }
  let bytes
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const rows = []
  try {
    for (let byte = 32; byte < 256; byte++) {
      // The reference header, unlike the mapping rows, defines DEL as a control.
      const code = byte === 127 ? [127] : apple[byte]
      // F87F is Apple's font-variant hint, not another displayed character.
      // Other private-use glyphs need a font renderer and remain explicit errors.
      const semantic = code && code.filter(c => c !== 0xf87f)
      const supported = semantic && semantic.every(c => c < 0xe000 || c > 0xf8ff)
      const expected = supported ? String.fromCodePoint(...semantic) : null
      const variants = {
        hex: String.raw`\'` + byte.toString(16),
        raw: [92, 123, 125].includes(byte) ? '\\' + String.fromCharCode(byte) : String.fromCharCode(byte),
        private: '\\u' + (0xf000 + byte - 65536) + '?'
      }
      for (const [form, payload] of Object.entries(variants)) {
        bytes = Buffer.from(header + String.raw`\f0 BEGIN {\f1 ` + payload + '} END}', 'latin1')
        let text, error
        try { text = rtfToText(bytes) } catch (e) { error = e.message }
        if (supported) assert.equal(text, 'BEGIN ' + expected + ' END', byte + '/' + form)
        else assert.match(error, /字形/, byte + '/' + form)
        host.openSelectedFile({ name: 'glyph-' + byte + '-' + form + '.rtf', path: '/local/glyph.rtf', size: bytes.length })
        await new Promise(setImmediate)
        if (supported) {
          assert.equal(host.data.error, '')
          assert.equal(host._htmlRuntime.document.body.textContent.trim(), text)
        } else {
          assert.match(host.data.error, /字形/)
          assert.equal(host.data.hasContent, false)
        }
        rows.push({ byte, form, sourceBase64: bytes.toString('base64'), sha256: hash(bytes), apple: code, adobe: adobe[byte], cocoa: cocoa[byte], expected, text, error, hostError: host.data.error, nativeExact: supported && cocoa[byte] === expected })
      }
    }
  } finally { host.detached() }
  const unique = rows.filter(r => r.form === 'hex')
  const result = { schemaVersion: 1, testedAt: new Date().toISOString(), node: process.version, references: { apple: { url: 'https://www.unicode.org/Public/MAPPINGS/VENDORS/APPLE/SYMBOL.TXT', sha256: hash(appleBytes) }, adobe: { url: 'https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt', sha256: hash(adobeBytes) } }, nativeSourceBase64: Buffer.from(nativeSource).toString('base64'), nativeSourceSha256: hash(Buffer.from(nativeSource)), nativeOutput: native, rows, summary: { originalSources: rows.length, actualHostOpens: rows.length, definedGlyphs: unique.filter(r => r.expected != null && r.byte !== 127).length, standardControls: unique.filter(r => r.expected != null && r.byte === 127).length, supportedCharacters: unique.filter(r => r.expected != null).length, unsupportedOrUndefined: unique.filter(r => r.expected == null).length, nativeExactGlyphs: unique.filter(r => r.nativeExact).length, nativeDifferences: unique.filter(r => r.expected != null && !r.nativeExact).map(({ byte, expected, cocoa }) => ({ byte, expected, cocoa })) }, limits: ['Fixed charset2 named Symbol; other symbol faces do not share this map.', 'Unicode text extraction, not original font face/layout rendering. Private radical extender, Apple logo and undefined slots reject.', 'Copyright serif/sans-serif distinctions collapse to their same abstract text. Apple F87F hints are recorded in raw reference data.', 'Cocoa can use older private-use assignments than published mappings. Native equality is reported without adjustment.'] }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(result.summary)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
