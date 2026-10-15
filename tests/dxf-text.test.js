'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const iconv = require('iconv-lite')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { decodeDxfText, decodeDxfValue } = require('../miniprogram/file-reader/engine/core/dxf-text')
const { readerPage } = require('./helpers/reader-host')
const originals = require('./fixtures/dxf-text/samples.json').rows
function source (label, { version = 'AC1021', codepage = 'ANSI_1252', eol = '\n', kind = 'TEXT', chunks = [] } = {}) {
  return ['0','SECTION','2','HEADER','9','$ACADVER','1',version,'9','$DWGCODEPAGE','3',codepage,'0','ENDSEC','0','SECTION','2','ENTITIES','0',kind,'10','0','20','0','40','3',...chunks.flatMap(s => ['3',s]),'1',label,'0','LINE','10','0','20','-5','11','20','21','-5','0','ENDSEC','0','EOF',''].join(eol)
}
const inspect = bytes => inspectFileBytes(bytes, { name: 'text.dxf' })
const texts = svg => Array.from(svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g), m => m[1])

test('original ezdxf drawings preserve native label contents across versions and codepages', () => {
  for (const c of originals) {
    const bytes = Buffer.from(c.sourceBase64, 'base64')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), c.sha256)
    const result = inspect(bytes)
    // The retained independent original has real MTEXT paragraphs. The old
    // flattened expectation joined them with spaces, which hid this defect.
    const expected = c.nativeTexts.flatMap(t => t.type === 'MTEXT' ? t.unicode.split('\n') : [t.unicode])
    assert.deepEqual(texts(result.previewSvg), expected, c.name)
    assert.equal(result.entries.find(e => e.name === 'LINE').detail, '1 个实体')
  }
})

test('physical line endings and legacy multibyte runs do not consume following entities', () => {
  for (const eol of ['\r\n','\n','\r']) for (const [encoding,cp,label] of [['windows1252',1252,'Café Øresund'],['gbk',936,'中文图纸'],['shift_jis',932,'日本語'],['windows1251',1251,'Привет'],['big5',950,'繁體中文']]) {
    const result = inspect(iconv.encode(source(label, { version:'AC1015',codepage:'ANSI_'+cp,eol }),encoding))
    assert.deepEqual(texts(result.previewSvg), [label])
    assert.equal(result.entries.find(e => e.name === 'LINE').detail, '1 个实体')
  }
  const padded=source('Привет',{version:'AC1015',codepage:'ANSI_1251'}).split('\n').map((s,i)=>i%2===0&&s ? s.padStart(3,'0'):s).join('\n')
  assert.deepEqual(texts(inspect(iconv.encode(padded,'windows1251')).previewSvg),['Привет'])
  const longPadding=source('Привет',{version:'AC1015',codepage:' '.repeat(200)+'ANSI_1251'+' '.repeat(200)})
  assert.deepEqual(texts(inspect(iconv.encode(longPadding,'windows1251')).previewSvg),['Привет'])
})

test('CIF applies once inside values and after MTEXT chunk assembly', () => {
  assert.equal(decodeDxfValue('1', String.raw`\U+4E2D\U+6587`), '中文')
  assert.equal(decodeDxfValue('1', String.raw`\U+005CU+0041`), String.raw`\U+0041`)
  assert.equal(decodeDxfValue('10', String.raw`\U+0031`), String.raw`\U+0031`)
  assert.equal(decodeDxfValue('1', String.raw`\u+0041`), String.raw`\u+0041`)
  assert.deepEqual(texts(inspect(Buffer.from(source('2D tail', {kind:'MTEXT',chunks:['x'.repeat(246)+String.raw`\U+4E`]}))).previewSvg), ['x'.repeat(246)+'中 tail'])
  assert.deepEqual(texts(inspect(Buffer.from(source(String.raw`\U+005CU+0041`, {kind:'MTEXT'}))).previewSvg), [String.raw`\U+0041`])
  assert.deepEqual(texts(inspect(Buffer.from(source(String.raw`\U+DE80`, {kind:'MTEXT',chunks:[String.raw`\U+D83D`]}))).previewSvg), ['🚀'])
})

test('escaped structure and markup remain text and cannot introduce a new entity or SVG element', () => {
  const label=String.raw`A\U+000A0\U+000ALINE\U+000A10\U+000A999 \U+003Cscript\U+003E`
  const r=inspect(Buffer.from(source(label)))
  assert.equal(r.entries.find(e=>e.name==='LINE').detail,'1 个实体')
  assert.match(r.previewSvg,/A\n0\nLINE\n10\n999 &lt;script&gt;/)
  assert.doesNotMatch(r.previewSvg,/<script/)
  const withTail=inspect(Buffer.from(source('body')+'\n0\nLINE\n10\n999\n20\n999\n'))
  assert.equal(withTail.entries.find(e=>e.name==='LINE').detail,'1 个实体')
})

test('text-only drawing bounds contain glyphs and long labels without enlarging their font again', () => {
  const only = label => Buffer.from(['0','TEXT','10','0','20','0','40','3','1',label,'0','EOF',''].join('\n'))
  for (const [label,minimumWidth] of [['中文',6],['x'.repeat(250),370]]) {
    const svg=inspect(only(label)).previewSvg
    const box=/viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number)
    assert.ok(box[0]<=0 && box[1]<=-3 && box[0]+box[2]>=minimumWidth && box[1]+box[3]>=0)
    assert.match(svg,/font-size="3"/)
    assert.deepEqual(texts(svg),[label])
    assert.doesNotMatch(svg,/textLength|lengthAdjust/)
  }
})

test('invalid bytes, unsupported high-byte codepages and non-displayable Unicode explicitly fail', () => {
  const invalid=Buffer.concat([Buffer.from(source('MARKER').split('MARKER')[0]),Buffer.from([0xc3,10]),Buffer.from(source('MARKER').split('MARKER')[1])])
  assert.throws(()=>inspect(invalid),/字符编码/)
  assert.throws(()=>inspect(iconv.encode(source('é',{version:'AC1015',codepage:'ANSI_9999'}),'windows1252')),/暂不支持/)
  assert.deepEqual(texts(inspect(Buffer.from(source(String.raw`\U+4E2D`,{version:'AC1015',codepage:'ANSI_9999'}))).previewSvg),['中'])
  for(const value of [String.raw`\U+0000`,String.raw`\U+0001`,String.raw`\U+FFFF`,String.raw`\U+D83D`,String.raw`\U+DE80`]) assert.throws(()=>inspect(Buffer.from(source(value))),/控制字符|完整字符/)
  assert.throws(()=>decodeDxfText(Buffer.from('AutoCAD Binary DXF\r\n\x1a\0payload')),/二进制 DXF/)
  assert.throws(()=>inspect(Buffer.from('0\nTEXT\n1')),/不完整/)
  assert.throws(()=>inspect(Buffer.from('0\nTEXT\nbad\nvalue\n')),/组码无效/)
  assert.throws(()=>inspect(Buffer.from(source('A',{version:'AC1015',codepage:'ANSI_'+ '1'.repeat(200)}))),/编码声明/)
})

test('modern DXF ignores legacy codepage labels, UTF8 BOM works and metadata-like text is harmless', () => {
  assert.deepEqual(texts(inspect(Buffer.from(source('中文',{codepage:'ANSI_932'}))).previewSvg),['中文'])
  assert.deepEqual(texts(inspect(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(source('中文'))])).previewSvg),['中文'])
  assert.deepEqual(texts(inspect(Buffer.from(source('$DWGCODEPAGE ANSI_936 中文'))).previewSvg),['$DWGCODEPAGE ANSI_936 中文'])
  const noHeader='0\nTEXT\n10\n0\n20\n0\n40\n3\n1\n中文\n0\nEOF\n'
  assert.deepEqual(texts(inspect(Buffer.from(noHeader)).previewSvg),['中文'])
})

test('actual DXF entry clears failed previews and ignores stale reads after recovery', async () => {
  let bytes,late
  const host=readerPage({getFileSystemManager:()=>({readFile:o=>{if(o.filePath==='/local/late.dxf')late=o;else o.success({data:bytes})}})})
  async function open(b,name='text.dxf'){bytes=b;host.openSelectedFile({name,path:'/local/'+name,size:b.length});await new Promise(setImmediate)}
  try {
    await open(Buffer.from(originals.find(c=>c.name==='R2000-gbk').sourceBase64,'base64'))
    assert.equal(host.data.error,'');assert.ok(host.data.inspectorPreviewSource)
    await open(Buffer.from(source(String.raw`\U+0000`)))
    assert.match(host.data.error,/控制字符/);assert.equal(host.data.hasContent,false)
    assert.equal(host.data.inspectorPreviewSource,'')
    await open(Buffer.from(source('stale')),'late.dxf')
    await open(Buffer.from(source('recovered 中文')))
    const uri=host.data.inspectorPreviewSource
    late.success({data:Buffer.from(source('stale'))});await new Promise(setImmediate)
    assert.equal(host.data.error,'');assert.equal(host.data.inspectorPreviewSource,uri)
    assert.match(Buffer.from(uri.split(',')[1],'base64').toString(),/recovered 中文/)
  } finally {host.detached()}
})
