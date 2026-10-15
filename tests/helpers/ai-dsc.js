'use strict'

// Original EPSI documents. Parent artwork has no preview when the only
// BeginPreview is inside an imported document or an opaque DSC data block.
function cases () {
  const rows = []
  for (const [ending, eol] of [['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n'], ['lfcr', '\n\r']]) {
    const preview = ['%%BeginPreview: 1 1 8 1', '% ff', '%%EndPreview']
    const head = ['%!PS-Adobe-3.0 EPSF-3.0', '%%BoundingBox: 0 0 1 1', '%%EndComments']
    const nested = ['%%BeginDocument: child.eps', ...head, ...preview, '%%EOF', '%%EndDocument']
    const payload = preview.join(eol) + eol
    const forms = [
      ['nested-only', [...head, ...nested, '%%EOF'], false],
      ['data-lines-only', [...head, '%%BeginData: 3 ASCII Lines', ...preview, '%%EndData', '%%EOF'], false],
      ['data-bytes-only', [...head, '%%BeginData: ' + Buffer.byteLength(payload) + ' ASCII Bytes', ...preview, '%%EndData', '%%EOF'], false],
      ['binary-only', [...head, '%%BeginBinary: ' + Buffer.byteLength(payload), ...preview, '%%EndBinary', '%%EOF'], false],
      ['pdf-title', ['%!PS-Adobe-3.0 EPSF-3.0', '%%Title: A guide to %PDF-1.7', ...head.slice(1), ...preview, '%%EOF'], true],
      ['valid-control', [...head, ...preview, '%%EOF'], true]
    ]
    for (const [kind, lines, preview] of forms) rows.push({ name: kind + '-' + ending, bytes: Buffer.from(lines.join(eol) + eol), preview })
    const boxLines = ['%!PS-Adobe-3.0 EPSF-3.0', '%%BoundingBox: (atend)', '%%EndComments', '%%BeginDocument: child.eps', ...head, '%%EOF', '%%EndDocument', '1 0 0 setrgbcolor', '0 0 moveto', '40 0 lineto', '40 20 lineto', '0 20 lineto', 'closepath fill', '%%Trailer', '%%BoundingBox: 0 0 40 20', '%%EOF']
    rows.push({ name: 'parent-box-' + ending, bytes: Buffer.from(boxLines.join(eol) + eol), box: [40, 20] })
  }
  const imported = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 20\n%%EndComments\n' +
    '% Ordinary PostScript comment without executable content.\n'.repeat(100) + '% A guide to %PDF-1.7\n' +
    '%%BeginDocument: child.eps\n%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 1 1\n%%EndComments\n' +
    '1 0 0 setrgbcolor\n0 0 moveto\n20 0 lineto\n20 20 lineto\n0 20 lineto\nclosepath fill\n%%EOF\n%%EndDocument\n' +
    '0 0 1 setrgbcolor\n20 0 moveto\n40 0 lineto\n40 20 lineto\n20 20 lineto\nclosepath fill\n%%EOF\n'
  rows.push({ name: 'imported-two-color', bytes: Buffer.from(imported), box: [40, 20], paths: 2, colors: [[255, 0, 0, 255], [0, 0, 255, 255]] })
  return rows
}
function dataCases () {
  const rows = [], head = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 1\n%%EndComments\n'
  const body = '0 0 1 setrgbcolor\n0 0 moveto\n2 0 lineto\n2 1 lineto\n0 1 lineto\nclosepath fill\n%%EOF\n'
  for (const [ending, eol] of [['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n'], ['lfcr', '\n\r']]) {
    for (const [index, suffix] of ['', ' Binary', ' Binary Bytes', ' ASCII Bytes', ' Hex Bytes', ' ASCII Lines', ' Binary Lines', ' Hex Lines'].entries()) {
      const payload = (suffix.includes('Hex') ? ['00 A1 FF', 'ab cd EF', '11 22 33'] : [suffix.includes('ASCII') ? '% ASCII text' : '% 中文 😀', '%%EndDocument', '%%BeginPreview: false']).join(eol) + eol
      const data = 'discard' + eol + payload, count = suffix.endsWith('Lines') ? 4 : Buffer.byteLength(data)
      const procedure = '/discard { currentfile ' + Buffer.byteLength(payload) + ' string readstring pop pop } bind def' + eol
      rows.push({ name: 'data-' + index + '-' + ending, bytes: Buffer.from(head + procedure + '%%BeginData: ' + count + suffix + eol + data + '%%EndData' + eol + body), box: [2, 1], colors: [[0, 0, 255, 255]] })
    }
  }
  return rows
}
module.exports = { cases, dataCases }
