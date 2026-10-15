'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib')
const { parseMText, renderMText } = require('../miniprogram/file-reader/engine/core/dxf-mtext')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { readerPage } = require('./helpers/reader-host')
const samples = require('./fixtures/dxf-mtext/samples.json')
const original = c => zlib.gunzipSync(Buffer.from(c.sourceGzipBase64, 'base64'))
const plain = m => m.tokens.map(t => t.type === 'break' ? '\n' : t.type === 'stack' ? t.upper + t.divider + t.lower : t.text).join('')

test('MTEXT content distinguishes escaped punctuation and Unicode from actual formatting commands', () => {
  for (const sample of samples.cases) {
    if (['tolerance-stack', 'unknown-control', 'unterminated-color', 'unterminated-stack', 'trailing-backslash'].includes(sample.case)) continue
    const expected = sample.case === 'literal-cif' ? sample.nativePlain : sample.case === 'nonbreaking-space' ? 'A\u00a0B' : sample.nativeDecodedHelper
    assert.equal(plain(parseMText(sample.authored, 3)), expected, sample.name)
    const result = inspectFileBytes(original(sample), { name: sample.name + '.dxf' })
    assert.ok(result.previewSvg.includes('data-dxf-mtext="true"'))
  }
  for (const [source, expected] of [[String.raw`\U+005CU+0041`, String.raw`\U+0041`], [String.raw`\U+007Btext\U+007D`, '{text}'], [String.raw`\U+D83D\U+DE80`, '🚀'], [String.raw`\\U+0000`, String.raw`\U+0000`]]) assert.equal(plain(parseMText(source)), expected)
})

test('MTEXT style groups restore color, relative height and decorations without affecting literals', () => {
  const m = parseMText(String.raw`a{\C1;red {\H2x;large} red}z\Lunder\l`, 3)
  assert.deepEqual(m.tokens.map(t => [t.text, t.style.height, t.style.color, t.style.underline]), [
    ['a', 1, '#171715', false], ['red ', 1, '#ff0000', false], ['large', 2, '#ff0000', false], [' red', 1, '#ff0000', false], ['z', 1, '#171715', false], ['under', 1, '#171715', true]
  ])
  const font = parseMText(String.raw`A{\fArial|b1|i1;bold italic}B`)
  assert.equal(font.tokens[1].style.bold, true); assert.equal(font.tokens[1].style.italic, true)
  assert.equal(font.tokens[2].style.bold, false)
  const svg = renderMText(m, 3, 0, 0).svg
  assert.match(svg, /<tspan[^>]*font-size="6"[^>]*fill="#ff0000"[^>]*>large/)
  assert.match(svg, /text-decoration="underline"/)
})

test('TEXT literal paragraph codes, MTEXT paragraphs and editor-authored stacks follow separate roles', () => {
  for (const sample of samples.roleCases) {
    const result = inspectFileBytes(original(sample), { name: 'role.dxf' })
    if (sample.kind === 'TEXT') assert.match(result.previewSvg, /A\\PB<\/text>/)
    else if (sample.name.includes('editor-tolerance')) {
      assert.match(result.previewSvg, /data-dxf-stack="numerator"[^>]*>\+0.010/)
      assert.match(result.previewSvg, /data-dxf-stack="denominator"[^>]*>-0.000/)
      assert.doesNotMatch(result.previewSvg, /data-dxf-stack="divider"/)
    } else {
      assert.equal(plain(parseMText(sample.content)), 'A\nB')
      assert.match(result.previewSvg, /translate\(0 5.1\)/)
    }
  }
  const m = parseMText(String.raw`first\P\Pthird`)
  assert.equal(m.tokens.filter(t => t.type === 'break').length, 2)
  const svg = renderMText(m, 3, 0, 0).svg
  assert.match(svg, /translate\(0 10.2\)/)
  for (const sep of ['/', '#']) assert.match(renderMText(parseMText('1\\S1' + sep + '2;'), 3, 0, 0).svg, /data-dxf-stack="divider"/)
})

test('unknown, incomplete and ambiguous controls keep their content with an explicit warning', () => {
  for (const sample of samples.cases.filter(c => ['tolerance-stack', 'unknown-control', 'unterminated-color', 'unterminated-stack', 'trailing-backslash'].includes(c.case))) {
    const m = parseMText(sample.authored)
    assert.equal(plain(m), sample.authored, sample.name)
    assert.ok(m.warnings.length)
    const result = inspectFileBytes(original(sample), { name: 'incomplete.dxf' })
    assert.ok(result.metadata.some(r => /未完整还原/.test(r.value)))
  }
  assert.equal(plain(parseMText(String.raw`A\C1{body}\Ptail`)), String.raw`A\C1body` + '\ntail')
  assert.equal(plain(parseMText(String.raw`\S1\;/2;`)), '1;/2')
})

test('MTEXT text and metadata cannot introduce SVG markup; bounded errors leave later parses intact', () => {
  const m = parseMText(String.raw`\U+003Cscript\U+003E {\fA" onload="x|b1;safe}`)
  const svg = renderMText(m, 3, 0, 0).svg
  assert.doesNotMatch(svg, /<script| onload="x"/)
  assert.ok(svg.includes('&lt;script&gt;'))
  for (const source of [String.raw`\U+0000`, String.raw`\U+D800`, String.raw`\U+DE80`, 'x'.repeat(200001), '{'.repeat(65), String.raw`\H99999999x;text`]) assert.throws(() => parseMText(source), /字符|长度|嵌套|范围/)
  const start = performance.now()
  const many = parseMText(String.raw`\C1`.repeat(20000))
  assert.equal(plain(many), String.raw`\C1`.repeat(20000))
  assert.ok(performance.now() - start < 3000, 'malformed control scanning must remain linear')
  assert.equal(plain(parseMText('AFTER')), 'AFTER')
})

test('actual DXF host clears invalid MTEXT then restores visible paragraphs without stale overwrite', async () => {
  const sample = samples.cases.find(c => c.name === 'R2007-paragraphs')
  const bytes = original(sample), reads = []
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => reads.push(o) }) })
  async function open (data) { host.openSelectedFile({ name: 'mtext.dxf', path: '/fixture/in.dxf', size: data.length }); await reads.shift().success({ data }); await new Promise(setImmediate) }
  try {
    await open(bytes); assert.equal(host.data.error, '')
    const uri = host.data.inspectorPreviewSource
    const invalid = Buffer.from('0\nMTEXT\n1\n\\U+0000\n0\nEOF\n')
    await open(invalid); assert.ok(host.data.error); assert.equal(host.data.inspectorPreviewSource, '')
    host.openSelectedFile({ name: 'old.dxf', path: '/fixture/old.dxf' }); const late = reads.shift()
    await open(bytes); assert.equal(host.data.error, ''); assert.equal(host.data.inspectorPreviewSource, uri)
    await late.success({ data: invalid }); assert.equal(host.data.error, ''); assert.equal(host.data.inspectorPreviewSource, uri)
  } finally { host.detached() }
})

test('physical MTEXT fragments preserve spaces and escaped characters across every split position', () => {
  for (const value of ['  left  right  ', String.raw`A\\P\P\U+D83D\U+DE80`, String.raw`{\C1;red} end`]) {
    const one = inspectFileBytes(Buffer.from(['0','MTEXT','1',value,'40','3','0','EOF',''].join('\n')), { name: 'one.dxf' }).previewSvg
    for (let split = 1; split < value.length; split++) {
      const splitFile = Buffer.from(['0','MTEXT','3',value.slice(0, split),'1',value.slice(split),'40','3','0','EOF',''].join('\n'))
      assert.equal(inspectFileBytes(splitFile, { name: 'split.dxf' }).previewSvg, one, value + '/' + split)
    }
  }
})


test('small positive MTEXT dimensions stay positive in SVG rather than rounding text out of existence', () => {
  const width = renderMText(parseMText(String.raw`\W0.00001;text`), 3, 0, 0).svg
  const height = renderMText(parseMText(String.raw`\H0.00001x;text`), 3, 0, 0).svg
  assert.equal(Number(/scale\(([^ ]+)/.exec(width)[1]), 0.00001)
  assert.equal(Number(/font-size="([^"]+)"/.exec(height)[1]), 0.00003)
  const tiny = '0.' + '0'.repeat(199) + '1'
  assert.throws(() => parseMText('\\H' + tiny + 'x;\\H' + tiny + 'x;text'), /范围/)
  assert.equal(plain(parseMText('AFTER')), 'AFTER')
})
