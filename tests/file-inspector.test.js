'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const zlib = require('node:zlib')

const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')
const iconv = require('iconv-lite')
const { extractArchiveEntry, extractZipEntry, inspectFileBytes, inspectZipCentral, readZipDirectoryDescriptor, rtfToText } = require('../miniprogram/file-reader/engine/core/file-inspector')

const { cdrCompressedVectorFixture } = require('./helpers/cdr-zlib')

function zipFixture () {
  const name = Buffer.from('folder/readme.txt')
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(7, 20)
  central.writeUInt32LE(12, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(0, 16)
  return Buffer.concat([central, eocd])
}

function crc32Bytes (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZipWithUnicodePath ({ rawName, unicodeName, unicodeNameCrc, unicodePaths, extraTail = Buffer.alloc(0), flags = 0, content = 'ZIP Unicode Path 正文' }) {
  const name = Buffer.from(rawName)
  const payload = Buffer.from(content)
  const extra = Buffer.concat([...(unicodePaths || (unicodeName != null ? [{ name: unicodeName, crc: unicodeNameCrc }] : [])).map(record => {
    const unicode = Buffer.from(record.name, 'utf8')
    const unicodePayload = Buffer.alloc(5 + unicode.length)
    unicodePayload[0] = 1
    unicodePayload.writeUInt32LE(record.crc == null ? crc32Bytes(name) : record.crc, 1)
    unicode.copy(unicodePayload, 5)
    const field = Buffer.alloc(4 + unicodePayload.length)
    field.writeUInt16LE(0x7075, 0)
    field.writeUInt16LE(unicodePayload.length, 2)
    unicodePayload.copy(field, 4)
    return field
  }), extraTail])

  const payloadCrc = crc32Bytes(payload)
  const local = Buffer.alloc(30 + name.length + extra.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(payloadCrc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(extra.length, 28)
  name.copy(local, 30)
  extra.copy(local, 30 + name.length)

  const central = Buffer.alloc(46 + name.length + extra.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(payloadCrc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(extra.length, 30)
  name.copy(central, 46)
  extra.copy(central, 46 + name.length)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + payload.length, 16)
  return Buffer.concat([local, payload, central, eocd])
}

function rar4StoredFixture () {
  const name = Buffer.from('资料/说明.txt')
  const content = Buffer.from('RAR 里的正文')
  const header = Buffer.alloc(32 + name.length)
  header[2] = 0x74
  header.writeUInt16LE(0x8000, 3)
  header.writeUInt16LE(header.length, 5)
  header.writeUInt32LE(content.length, 7)
  header.writeUInt32LE(content.length, 11)
  header[25] = 0x30
  header.writeUInt16LE(name.length, 26)
  name.copy(header, 32)
  header.writeUInt32LE(require('./helpers/archive-duplicates').crc32(content), 16)
  header.writeUInt16LE(require('./helpers/archive-duplicates').crc32(header.subarray(2)) & 0xffff, 0)
  return Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), header, content])
}

test('RTF 提取 Unicode、十六进制字符和段落', () => {
  const text = rtfToText('{\\rtf1\\ansi Hello \\u20320?\\u22909?\\par Caf\\\'e9}')
  assert.equal(text, 'Hello 你好\nCafé')
})

test('ZIP 中央目录会列出文件名、大小和压缩方法', () => {
  const inspection = inspectFileBytes(zipFixture(), { name: '资料.zip', type: 'application/zip' })
  const file = inspection.entries.find(entry => entry.canOpen)
  assert.equal(inspection.title, 'ZIP 压缩包')
  assert.equal(inspection.entries[0].name, 'folder/')
  assert.equal(file.name, 'folder/readme.txt')
  assert.equal(file.displayName, 'readme.txt')
  assert.equal(file.depth, 1)
  assert.match(file.detail, /12 B.*Deflate/)
})

test('ZIP 中文目录名正常显示、隐藏 macOS 垃圾项并能提取正文', () => {
  const archive = zipSync({
    '资料/说明.txt': Buffer.from('压缩包里的正文'),
    '__MACOSX/资料/._说明.txt': Buffer.from([1, 2, 3]),
    '资料/.DS_Store': Buffer.from([4, 5, 6])
  })
  const inspection = inspectFileBytes(archive, { name: '中文资料.zip', type: 'application/zip' })
  const file = inspection.entries.find(entry => entry.canOpen)
  assert.equal(inspection.entries.length, 2)
  assert.equal(inspection.entries[0].name, '资料/')
  assert.equal(file.name, '资料/说明.txt')
  assert.equal(file.canOpen, true)
  assert.match(inspection.summary, /已隐藏 2 个 macOS 系统项/)
  assert.equal(Buffer.from(extractZipEntry(archive, file)).toString(), '压缩包里的正文')
})

test('ZIP 采用 CRC 匹配的 Unicode Path 扩展字段并打开真实正文', () => {
  const archive = storedZipWithUnicodePath({
    rawName: Buffer.from('docs/????.html', 'ascii'),
    unicodeName: '资料/海报/最终版.html'
  })
  const inspection = inspectFileBytes(archive, { name: 'unicode-path.zip', type: 'application/zip' })
  const file = inspection.entries.find(entry => entry.canOpen)
  assert.deepEqual(inspection.entries.map(entry => entry.name), ['资料/', '资料/海报/', '资料/海报/最终版.html'])
  assert.equal(Buffer.from(extractZipEntry(archive, file)).toString(), 'ZIP Unicode Path 正文')
})

test('ZIP 忽略 CRC 不匹配的陈旧 Unicode Path，不能让扩展字段篡改真实路径', () => {
  const utf8Name = Buffer.from('真实/正文.txt', 'utf8')
  const archive = storedZipWithUnicodePath({
    rawName: utf8Name,
    unicodeName: '陈旧/错误.exe',
    unicodeNameCrc: 0x12345678,
    flags: 0x0800
  })
  const inspection = inspectFileBytes(archive, { name: 'stale-unicode-path.zip', type: 'application/zip' })
  const file = inspection.entries.find(entry => entry.canOpen)
  assert.equal(file.name, '真实/正文.txt')
  assert.equal(file.displayName, '正文.txt')
  assert.equal(Buffer.from(extractZipEntry(archive, file)).toString(), 'ZIP Unicode Path 正文')
})

test('ZIP 无 UTF-8 标记时也忽略 CRC 不匹配的 Unicode Path', () => {
  const archive = storedZipWithUnicodePath({
    rawName: Buffer.from('safe/readme.txt', 'ascii'),
    unicodeName: '../伪造.html',
    unicodeNameCrc: 0
  })
  const inspection = inspectFileBytes(archive, { name: 'corrupt-unicode-path.zip', type: 'application/zip' })
  const file = inspection.entries.find(entry => entry.canOpen)
  assert.equal(file.name, 'safe/readme.txt')
  assert.equal(file.displayName, 'readme.txt')
})

test('ZIP 重复 Unicode Path 字段无论顺序或内容都不静默替换原始名称', () => {
  const rawName = Buffer.from('safe/raw-name.txt', 'ascii')
  const crc = crc32Bytes(rawName)
  const cases = [
    [{ name: 'first.txt' }, { name: 'second.txt' }],
    [{ name: 'same.txt' }, { name: 'same.txt' }],
    [{ name: 'valid.txt' }, { name: 'bad.txt', crc: (crc ^ 0xffffffff) >>> 0 }],
    [{ name: 'bad.txt', crc: (crc ^ 0xffffffff) >>> 0 }, { name: 'valid.txt' }]
  ]
  for (const unicodePaths of cases) {
    const archive = storedZipWithUnicodePath({ rawName, unicodePaths })
    const file = inspectFileBytes(archive, { name: 'duplicate-unicode-path.zip', type: 'application/zip' }).entries.find(entry => entry.canOpen)
    assert.equal(file.name, 'safe/raw-name.txt')
    assert.equal(Buffer.from(extractZipEntry(archive, file)).toString(), 'ZIP Unicode Path 正文')
  }
})

test('ZIP 有效 Unicode Path 后跟截断 extra 字段时回退原始名称', () => {
  const archive = storedZipWithUnicodePath({
    rawName: Buffer.from('safe/raw-name.txt', 'ascii'),
    unicodeName: 'unicode-name.txt',
    extraTail: Buffer.from([0x75, 0x70, 0x20, 0x00, 0x01])
  })
  const file = inspectFileBytes(archive, { name: 'truncated-extra.zip', type: 'application/zip' }).entries.find(entry => entry.canOpen)
  assert.equal(file.name, 'safe/raw-name.txt')
  assert.equal(Buffer.from(extractZipEntry(archive, file)).toString(), 'ZIP Unicode Path 正文')
})

test('7-Zip 真实公开样本按 ZIP 标准 CP437 显示文件名而不是误猜成中文', () => {
  // Apache Commons Compress test fixture, Apache-2.0:
  // src/test/resources/utf8-7zip-test.zip, SHA-256 411daee9…4d4c571
  const archive = Buffer.from('UEsDBAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAYXNjaWkudHh0YXNjaWlQSwMECgAAAAAA5npGOubG5usNAAAADQAAAAwAAACZbGaEc3Nlci50eHRIZWxsbywgd29ybGQhUEsDBAoAAAgAAPR6RjpgmWdMEwAAABMAAAASAAAA4oKsX2Zvcl9Eb2xsYXIudHh0R2l2ZSBtZSB5b3VyIG1vbmV5IVBLAQIUAAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAAAAAAAAAIAAAAAAAAABhc2NpaS50eHRQSwECFAAKAAAAAADmekY65sbm6w0AAAANAAAADAAAAAAAAAAAAIAAAAAsAAAAmWxmhHNzZXIudHh0UEsBAhQACgAACAAA9HpGOmCZZ0wTAAAAEwAAABIAAAAAAAAAAACAAAAAYwAAAOKCrF9mb3JfRG9sbGFyLnR4dFBLBQYAAAAAAwADALEAAACmAAAAAAA=', 'base64')
  const inspection = inspectFileBytes(archive, { name: 'utf8-7zip-test.zip', type: 'application/zip' })
  assert.deepEqual(inspection.entries.map(entry => entry.name), ['ascii.txt', 'Ölfässer.txt', '€_for_Dollar.txt'])
  assert.equal(inspection.filenameEncoding, 'auto')
  assert.equal(inspection.ambiguousFilenameCount, 1)
})

test('无编码标记的旧式中文 ZIP 可显式切换 GBK/GB18030，而不继续自动误猜', () => {
  const archive = storedZipWithUnicodePath({
    rawName: iconv.encode('李白/月下独酌.txt', 'gb18030'),
    content: '花间一壶酒，独酌无相亲。'
  })
  const descriptor = readZipDirectoryDescriptor(archive)
  const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
  const standard = inspectZipCentral(central, descriptor)
  const chinese = inspectZipCentral(central, descriptor, { legacyEncoding: 'gb18030' })
  assert.notEqual(standard.entries.find(entry => entry.canOpen).name, '李白/月下独酌.txt')
  assert.equal(chinese.entries.find(entry => entry.canOpen).name, '李白/月下独酌.txt')
  assert.equal(chinese.filenameEncoding, 'gb18030')
  assert.deepEqual(chinese.filenameEncodingOptions.filter(item => item.active).map(item => item.value), ['gb18030'])
})

test('ZIP CP437 的全部 128 个高位字节与标准映射一致，不能混用 CP850', () => {
  for (let byte = 0x80; byte <= 0xff; byte++) {
    const rawName = Buffer.concat([Buffer.from('symbol-'), Buffer.from([byte]), Buffer.from('.txt')])
    const expected = iconv.decode(rawName, 'cp437')
    const archive = storedZipWithUnicodePath({ rawName })
    const inspection = inspectFileBytes(archive, { name: 'cp437-symbol.zip', type: 'application/zip' })
    const entry = inspection.entries.find(item => item.canOpen)
    assert.equal(entry.name, expected, `CP437 byte 0x${byte.toString(16)}`)
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString(), 'ZIP Unicode Path 正文')
  }
})

test('无编码标记的日文、韩文与繁体 ZIP 可由用户明确选择原始编码', () => {
  const cases = [
    { encoding: 'shift_jis', name: '日本語/設計資料.txt', label: '日文 Shift_JIS' },
    { encoding: 'cp949', name: '한글/폴더/읽기.txt', label: '韩文 CP949 / EUC-KR' },
    { encoding: 'cp949', name: '갂힣/확장.txt', label: '韩文 CP949 / EUC-KR' },
    { encoding: 'big5', name: '繁體中文/設計圖.ai', label: '繁体 Big5' }
  ]
  for (const sample of cases) {
    const archive = storedZipWithUnicodePath({ rawName: iconv.encode(sample.name, sample.encoding), content: `${sample.label} 正文` })
    const descriptor = readZipDirectoryDescriptor(archive)
    const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
    const inspection = inspectZipCentral(central, descriptor, { legacyEncoding: sample.encoding })
    const entry = inspection.entries.find(item => item.canOpen)
    assert.equal(entry.name, sample.name)
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString(), `${sample.label} 正文`)
    assert.equal(inspection.filenameEncodingLabel, sample.label)
    assert.deepEqual(inspection.filenameEncodingOptions.filter(item => item.active).map(item => item.value), [sample.encoding])
  }
})

test('无标记 ZIP 即使字节恰好是合法 UTF-8，手动编码也必须真正生效', () => {
  const rawName = Buffer.concat([Buffer.from('nested/symbol-'), Buffer.from([0xc2, 0xa5]), Buffer.from('.txt')])
  const archive = storedZipWithUnicodePath({ rawName, content: '歧义文件里的真实正文' })
  const descriptor = readZipDirectoryDescriptor(archive)
  const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
  for (const encoding of ['cp437', 'gb18030', 'shift_jis', 'cp949', 'big5', 'utf-8', 'auto']) {
    const inspection = inspectZipCentral(central, descriptor, { legacyEncoding: encoding })
    const entry = inspection.entries.find(item => item.canOpen)
    assert.equal(entry.name, iconv.decode(rawName, encoding === 'auto' ? 'utf-8' : encoding), encoding)
    assert.equal(inspection.filenameEncoding, encoding)
    assert.equal(inspection.ambiguousFilenameCount, 1)
    assert.deepEqual(inspection.filenameEncodingOptions.filter(item => item.active).map(item => item.value), [encoding])
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString(), '歧义文件里的真实正文')
  }
})

test('全部 1920 种合法双字节 UTF-8 组合都能明确切换回 CP437', () => {
  for (let lead = 0xc2; lead <= 0xdf; lead++) {
    for (let trail = 0x80; trail <= 0xbf; trail++) {
      const rawName = Buffer.concat([Buffer.from('symbol-'), Buffer.from([lead, trail]), Buffer.from('.txt')])
      const archive = storedZipWithUnicodePath({ rawName })
      const descriptor = readZipDirectoryDescriptor(archive)
      const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
      const inspection = inspectZipCentral(central, descriptor, { legacyEncoding: 'cp437' })
      assert.equal(inspection.entries.find(item => item.canOpen).name, iconv.decode(rawName, 'cp437'), rawName.toString('hex'))
    }
  }
})

test('ZIP 编码选择保护自带 Unicode 标记，非法手动 UTF-8 不伪装成成功', () => {
  for (const sample of [
    { rawName: Buffer.from('真实/正文.txt'), flags: 0x0800, expected: '真实/正文.txt' },
    { rawName: Buffer.from('legacy.txt'), unicodeName: '资料/标题.txt', expected: '资料/标题.txt' }
  ]) {
    const archive = storedZipWithUnicodePath(sample)
    const descriptor = readZipDirectoryDescriptor(archive)
    const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
    for (const encoding of ['auto', 'utf-8', 'cp437', 'gb18030', 'shift_jis', 'cp949', 'big5']) {
      const inspection = inspectZipCentral(central, descriptor, { legacyEncoding: encoding })
      assert.equal(inspection.entries.find(item => item.canOpen).name, sample.expected)
      assert.deepEqual(inspection.filenameEncodingOptions, [])
    }
  }
  const invalid = storedZipWithUnicodePath({ rawName: Buffer.from([0x81, 0x2e, 0x74, 0x78, 0x74]) })
  const descriptor = readZipDirectoryDescriptor(invalid)
  const central = invalid.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
  assert.throws(() => inspectZipCentral(central, descriptor, { legacyEncoding: 'utf-8' }), /UTF-8/)
})

test('ZIP 文件名达到 65535 字节边界仍能切换编码而不截断或改写正文', () => {
  const rawName = Buffer.concat([Buffer.from('p/'), Buffer.from(Array.from({ length: 65528 }, (_, index) => index % 2 ? 0xa5 : 0xc2)), Buffer.from('-.txt')])
  assert.equal(rawName.length, 65535)
  const archive = storedZipWithUnicodePath({ rawName })
  const descriptor = readZipDirectoryDescriptor(archive)
  const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
  for (const encoding of ['cp437', 'utf-8', 'auto']) {
    const inspection = inspectZipCentral(central, descriptor, { legacyEncoding: encoding })
    const entry = inspection.entries.find(item => item.canOpen)
    assert.equal(entry.name, iconv.decode(rawName, encoding === 'auto' ? 'utf-8' : encoding))
    assert.equal(Buffer.from(extractZipEntry(archive, entry)).toString(), 'ZIP Unicode Path 正文')
  }
})

test('7z 会校验签名并读取版本和目录位置', () => {
  const bytes = Buffer.alloc(32)
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]).copy(bytes)
  bytes.writeUInt32LE(40, 12)
  bytes.writeUInt32LE(24, 20)
  const inspection = inspectFileBytes(bytes, { name: '工程.7z' })
  assert.equal(inspection.title, '7z 压缩包')
  assert.equal(inspection.metadata.find(item => item.label === '版本').value, '0.4')
})

test('RAR 4 和 RAR 5 都会识别容器，RAR 4 还能列出文件头', () => {
  const name = Buffer.from('poster.ai')
  const header = Buffer.alloc(32 + name.length)
  header[2] = 0x74
  header.writeUInt16LE(header.length, 5)
  header.writeUInt32LE(2048, 11)
  header[25] = 0x30
  header.writeUInt16LE(name.length, 26)
  name.copy(header, 32)
  header.writeUInt16LE(require('./helpers/archive-duplicates').crc32(header.subarray(2)) & 0xffff, 0)
  const rar4 = inspectFileBytes(Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), header]), { name: '资料.rar' })
  assert.equal(rar4.title, 'RAR 4.x 压缩包')
  assert.equal(rar4.entries[0].name, 'poster.ai')

  const rar5 = inspectFileBytes(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), { name: '新版.rar' })
  assert.equal(rar5.title, 'RAR 5.x 压缩包')
})

test('RAR4 未压缩文件会列为可打开并提取真实正文', () => {
  const archive = rar4StoredFixture()
  const inspection = inspectFileBytes(archive, { name: '资料.rar', type: 'application/vnd.rar' })
  assert.equal(inspection.entries[0].name, '资料/说明.txt')
  assert.equal(inspection.entries[0].canOpen, true)
  assert.equal(Buffer.from(extractArchiveEntry(archive, inspection.entries[0])).toString(), 'RAR 里的正文')
})

test('DXF 统计常见图元并读取版本和单位', () => {
  const dxf = '9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n0\nLINE\n10\n0\n20\n0\n11\n100\n21\n100\n0\nCIRCLE\n10\n50\n20\n50\n40\n20\n0\nLINE\n10\n0\n20\n100\n11\n100\n21\n0\n0\nELLIPSE\n10\n50\n20\n50\n11\n30\n21\n0\n40\n0.5\n0\nTEXT\n10\n10\n20\n20\n40\n5\n1\n入口 A\n0\nEOF\n'
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '图纸.dxf' })
  assert.equal(inspection.title, 'DXF 工程图')
  assert.deepEqual(inspection.entries, [{ name: 'CIRCLE', detail: '1 个实体' }, { name: 'ELLIPSE', detail: '1 个实体' }, { name: 'LINE', detail: '2 个实体' }, { name: 'TEXT', detail: '1 个实体' }])
  assert.match(inspection.previewSvg, /<svg/)
  assert.match(inspection.previewSvg, /<path d="M 0 0 L 100 -100"/)
  assert.match(inspection.previewSvg, /<path d="M 80 -50/)
  assert.match(inspection.previewSvg, />入口 A<\/text>/)
})

test('DXF 展开块引用并绘制填充边界和真实尺寸文字', () => {
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'SYMBOL', '10', '0', '20', '0',
    '0', 'LINE', '10', '0', '20', '0', '11', '20', '21', '0',
    '0', 'CIRCLE', '10', '10', '20', '5', '40', '3',
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '2', 'SYMBOL', '10', '100', '20', '50', '41', '2', '42', '2', '50', '90',
    '0', 'HATCH', '2', 'SOLID', '70', '1', '91', '1', '92', '2', '72', '0', '73', '1', '93', '4',
    '10', '0', '20', '0', '10', '40', '20', '0', '10', '40', '20', '20', '10', '0', '20', '20',
    '0', 'DIMENSION', '70', '32', '10', '0', '20', '30', '11', '50', '21', '35', '13', '0', '23', '0', '14', '100', '24', '0', '1', '<>',
    '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '块与尺寸.dxf' })

  assert.equal(inspection.metadata.find(item => item.label === '块定义/展开引用').value, '1 / 1')
  assert.equal(inspection.metadata.find(item => item.label === '填充边界/尺寸').value, '1 / 1')
  assert.match(inspection.previewSvg, /data-dxf-block="SYMBOL"/)
  assert.match(inspection.previewSvg, /data-dxf-hatch="boundary"/)
  assert.match(inspection.previewSvg, /data-dxf-dimension="line"/)
  assert.match(inspection.previewSvg, />100<\/text>/)
  assert.match(inspection.previewSvg, /marker-start="url\(#dxf-arrow\)"/)
})

test('DXF HATCH 的直线边界路径不会因重复组码被覆盖', () => {
  const dxf = [
    '0', 'HATCH', '2', 'ANSI31', '70', '0', '91', '1', '92', '1', '93', '4',
    '72', '1', '10', '0', '20', '0', '11', '30', '21', '0',
    '72', '1', '10', '30', '20', '0', '11', '30', '21', '20',
    '72', '1', '10', '30', '20', '20', '11', '0', '21', '20',
    '72', '1', '10', '0', '20', '20', '11', '0', '21', '0',
    '97', '0', '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '边界填充.dxf' })
  assert.equal(inspection.metadata.find(item => item.label === '填充边界/尺寸').value, '1 / 0')
  assert.match(inspection.previewSvg, /data-dxf-hatch="boundary"/)
  assert.match(inspection.previewSvg, /M 0 0 L 30 0 L 30 -20 L 0 -20 L 0 0 Z/)
})

test('DXF 求值 SPLINE 并把 LWPOLYLINE bulge 还原为弧段', () => {
  const dxf = [
    '0', 'SPLINE', '70', '0', '71', '2', '72', '6', '73', '3',
    '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
    '10', '0', '20', '0', '10', '10', '20', '20', '10', '20', '20', '0',
    '0', 'LWPOLYLINE', '90', '2', '70', '0',
    '10', '30', '20', '0', '42', '1', '10', '50', '20', '0', '42', '0',
    '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '样条与弧段.dxf' })

  assert.equal(inspection.metadata.find(item => item.label === '样条/多段线弧').value, '1 / 1')
  assert.match(inspection.previewSvg, /data-dxf-spline="curve"/)
  assert.match(inspection.previewSvg, /data-dxf-bulge="arc"/)
  assert.match(inspection.previewSvg, /M 0 0 L 0\.8333 -1\.5972/)
  assert.match(inspection.previewSvg, /M 30 0 L 30\.1921 1\.9509/)
})

test('DXF 有理 SPLINE 使用权重还原四分之一圆', () => {
  const dxf = [
    '0', 'SPLINE', '70', '4', '71', '2', '72', '6', '73', '3',
    '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
    '41', '1', '41', '0.7071067812', '41', '1',
    '10', '1', '20', '0', '10', '1', '20', '1', '10', '0', '20', '1',
    '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '有理圆弧.dxf' })

  assert.equal(inspection.metadata.find(item => item.label === '样条/多段线弧').value, '1 / 0')
  assert.match(inspection.previewSvg, /L 0\.7071 -0\.7071/)
})

test('DXF HATCH 绘制圆弧、椭圆弧和样条边界', () => {
  const dxf = [
    '0', 'HATCH', '2', 'SOLID', '70', '1', '91', '3',
    '92', '1', '93', '2',
    '72', '2', '10', '0', '20', '0', '40', '10', '50', '0', '51', '180', '73', '1',
    '72', '1', '10', '-10', '20', '0', '11', '10', '21', '0', '97', '0',
    '92', '1', '93', '2',
    '72', '3', '10', '30', '20', '0', '11', '10', '21', '0', '40', '0.5', '50', '0', '51', '180', '73', '1',
    '72', '1', '10', '20', '20', '0', '11', '40', '21', '0', '97', '0',
    '92', '1', '93', '2',
    '72', '4', '94', '2', '73', '0', '74', '0', '95', '6', '96', '3',
    '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
    '10', '60', '20', '0', '10', '70', '20', '20', '10', '80', '20', '0', '97', '0',
    '72', '1', '10', '80', '20', '0', '11', '60', '21', '0', '97', '0',
    '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '曲线填充.dxf' })

  assert.equal(inspection.metadata.find(item => item.label === '填充边界/尺寸').value, '3 / 0')
  assert.equal(inspection.metadata.find(item => item.label === 'HATCH 曲线边').value, '3')
  assert.equal((inspection.previewSvg.match(/data-dxf-hatch="boundary"/g) || []).length, 3)
  assert.match(inspection.previewSvg, /M 10 0 L 9\.9144 -1\.3053/)
  assert.match(inspection.previewSvg, /M 40 0 L 39\.9144 -0\.6526/)
  assert.match(inspection.previewSvg, /M 60 0 L 60\.8333 -1\.5972/)
})

test('DXF 节点数据损坏时用真实拟合点回退而不是生成空白预览', () => {
  const dxf = [
    '0', 'SPLINE', '70', '0', '71', '3', '72', '2', '73', '2', '74', '3',
    '40', '0', '40', '1', '10', '0', '20', '0', '10', '20', '20', '0',
    '11', '0', '21', '0', '11', '10', '21', '10', '11', '20', '21', '0',
    '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '拟合点回退.dxf' })

  assert.equal(inspection.metadata.find(item => item.label === '样条/多段线弧').value, '1 / 0')
  assert.match(inspection.previewSvg, /data-dxf-spline="curve"/)
  assert.match(inspection.previewSvg, /M 0 0 L 10 -10 L 20 0/)
})

test('DXF 3DFACE 与 3D POLYLINE 生成真实可旋转点边面模型', () => {
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', '3DFACE',
    '10', '0', '20', '0', '30', '0',
    '11', '10', '21', '0', '31', '0',
    '12', '10', '22', '10', '32', '5',
    '13', '0', '23', '10', '33', '5',
    '0', 'POLYLINE', '70', '8',
    '0', 'VERTEX', '10', '0', '20', '0', '30', '0', '70', '32',
    '0', 'VERTEX', '10', '0', '20', '0', '30', '10', '70', '32',
    '0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '三维支架.dxf' })

  assert.equal(inspection.interactiveModel.kind, 'engineering-wireframe')
  assert.equal(inspection.interactiveModel.points.length, 5)
  assert.equal(inspection.interactiveModel.edges.length, 5)
  assert.equal(inspection.interactiveModel.faces.length, 2)
  assert.ok(inspection.interactiveModel.points.some(point => point[2] === 10))
  assert.equal(inspection.metadata.find(item => item.label === '三维点/边/面').value, '5 / 5 / 2')
  assert.match(inspection.summary, /可旋转几何/)
})

test('DXF POLYFACE 顶点索引还原四边面，负索引只隐藏对应边', () => {
  const dxf = [
    '0', 'POLYLINE', '70', '64',
    '0', 'VERTEX', '70', '192', '10', '0', '20', '0', '30', '0',
    '0', 'VERTEX', '70', '64', '10', '10', '20', '0', '30', '0',
    '0', 'VERTEX', '70', '64', '10', '10', '20', '10', '30', '4',
    '0', 'VERTEX', '70', '64', '10', '0', '20', '10', '30', '4',
    '0', 'VERTEX', '70', '128', '71', '1', '72', '-2', '73', '3', '74', '4',
    '0', 'SEQEND', '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '多面网格.dxf' })

  assert.equal(inspection.interactiveModel.points.length, 4)
  assert.equal(inspection.interactiveModel.faces.length, 2)
  assert.equal(inspection.interactiveModel.edges.length, 3)
  assert.deepEqual(inspection.interactiveModel.faces, [[0, 1, 2], [0, 2, 3]])
})

test('DXF 三角 3DFACE 缺少第四点时复用第三点，并遵守不可见边标志', () => {
  const dxf = [
    '0', '3DFACE', '70', '2',
    '10', '5', '20', '5', '30', '1',
    '11', '15', '21', '5', '31', '1',
    '12', '10', '22', '12', '32', '4',
    '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '三角面.dxf' })

  assert.equal(inspection.interactiveModel.points.length, 3)
  assert.equal(inspection.interactiveModel.faces.length, 1)
  assert.equal(inspection.interactiveModel.edges.length, 2)
  assert.equal(inspection.interactiveModel.points.some(point => point[0] === 0 && point[1] === 0 && point[2] === 0), false)
})

test('DXF 3D polygon mesh 按 M/N 网格关系生成边与面', () => {
  const dxf = [
    '0', 'POLYLINE', '70', '16', '71', '2', '72', '2',
    '0', 'VERTEX', '10', '0', '20', '0', '30', '0',
    '0', 'VERTEX', '10', '0', '20', '10', '30', '2',
    '0', 'VERTEX', '10', '10', '20', '0', '30', '2',
    '0', 'VERTEX', '10', '10', '20', '10', '30', '4',
    '0', 'SEQEND', '0', 'EOF', ''
  ].join('\n')
  const inspection = inspectFileBytes(Buffer.from(dxf), { name: '规则网格.dxf' })

  assert.equal(inspection.interactiveModel.points.length, 4)
  assert.equal(inspection.interactiveModel.edges.length, 4)
  assert.equal(inspection.interactiveModel.faces.length, 2)
})

test('STEP 读取模式、文件名和实体统计', () => {
  const step = "ISO-10303-21;HEADER;FILE_NAME('part.stp','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,5.,3.));#3=VERTEX_POINT('',#1);#4=VERTEX_POINT('',#2);#5=EDGE_CURVE('',#3,#4,#9,.T.);ENDSEC;END-ISO-10303-21;"
  const inspection = inspectFileBytes(Buffer.from(step), { name: '零件.stp' })
  assert.equal(inspection.title, 'STEP 三维交换文件')
  assert.equal(inspection.metadata.find(item => item.label === '文件名').value, 'part.stp')
  assert.equal(inspection.entries[0].name, 'CARTESIAN_POINT')
  assert.match(inspection.previewSvg, /<line/)
  assert.match(inspection.previewSvg, /<circle/)
  assert.equal(inspection.metadata.find(item => item.label === '线框点\/边').value, '2 / 1')
  assert.deepEqual(inspection.interactiveModel, { kind: 'step-wireframe', points: [[0, 0, 0], [10, 5, 3]], edges: [[0, 1]], faces: [] })
})

test('STEP 立方体保留可旋转三维点边模型', () => {
  const points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]]
  const edges = [[1, 2], [2, 3], [3, 4], [4, 1], [5, 6], [6, 7], [7, 8], [8, 5], [1, 5], [2, 6], [3, 7], [4, 8]]
  const data = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const vertices = points.map((_, index) => `#${101 + index}=VERTEX_POINT('',#${index + 1});`).join('')
  const curves = edges.map((edge, index) => `#${201 + index}=EDGE_CURVE('',#${100 + edge[0]},#${100 + edge[1]},#999,.T.);`).join('')
  const step = `ISO-10303-21;HEADER;FILE_NAME('cube.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${data}${vertices}${curves}ENDSEC;END-ISO-10303-21;`
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'cube.step' })

  assert.equal(inspection.interactiveModel.points.length, 8)
  assert.equal(inspection.interactiveModel.edges.length, 12)
  assert.deepEqual(inspection.interactiveModel.edges[0], [0, 1])
  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '8 / 12')
})

test('STEP FACETED_BREP 的 POLY_LOOP 会生成可见三角面而不是只显示结构统计', () => {
  const points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]]
  const loops = [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]
  const pointData = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const loopData = loops.map((loop, index) => `#${201 + index}=POLY_LOOP('',(${loop.map(id => `#${id}`).join(',')}));#${301 + index}=FACE_OUTER_BOUND('',#${201 + index},.T.);#${401 + index}=FACE('',(#${301 + index}));`).join('')
  const step = `ISO-10303-21;HEADER;FILE_NAME('faceted-cube.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${pointData}${loopData}#501=CLOSED_SHELL('',(#401,#402,#403,#404,#405,#406));#502=FACETED_BREP('',#501);ENDSEC;END-ISO-10303-21;`
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'faceted-cube.step' })

  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '8 / 12')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '12')
  assert.equal(inspection.interactiveModel.faces.length, 12)
  assert.match(inspection.previewSvg, /data-step-faces="12"/)
  assert.equal((inspection.previewSvg.match(/<polygon /g) || []).length, 12)
})

test('STEP 平面 ADVANCED_FACE 会沿 EDGE_LOOP 生成面片', () => {
  const step = [
    'ISO-10303-21;HEADER;FILE_NAME(\'planar-face.step\',\'\',(\'\'),(\'\'),\'\',\'\',\'\');FILE_SCHEMA((\'AP214\'));ENDSEC;DATA;',
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(20.,0.,0.));#3=CARTESIAN_POINT('',(20.,10.,0.));#4=CARTESIAN_POINT('',(0.,10.,0.));",
    "#11=VERTEX_POINT('',#1);#12=VERTEX_POINT('',#2);#13=VERTEX_POINT('',#3);#14=VERTEX_POINT('',#4);",
    "#21=EDGE_CURVE('',#11,#12,#90,.T.);#22=EDGE_CURVE('',#12,#13,#90,.T.);#23=EDGE_CURVE('',#13,#14,#90,.T.);#24=EDGE_CURVE('',#14,#11,#90,.T.);",
    "#31=ORIENTED_EDGE('',*,*,#21,.T.);#32=ORIENTED_EDGE('',*,*,#22,.T.);#33=ORIENTED_EDGE('',*,*,#23,.T.);#34=ORIENTED_EDGE('',*,*,#24,.T.);",
    "#41=EDGE_LOOP('',(#31,#32,#33,#34));#42=FACE_BOUND('',#41,.T.);#50=PLANE('',#99);#60=ADVANCED_FACE('',(#42),#50,.T.);",
    'ENDSEC;END-ISO-10303-21;'
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'planar-face.step' })

  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '4 / 4')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '2')
  assert.equal(inspection.interactiveModel.faces.length, 2)
})

test('STEP 圆柱 ADVANCED_FACE 会按真实轴向和半径生成可旋转侧面', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('cylinder.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=CYLINDRICAL_SURFACE('',#4,5.);",
    "#11=CARTESIAN_POINT('',(5.,0.,0.));#12=CARTESIAN_POINT('',(-5.,0.,0.));#13=CARTESIAN_POINT('',(-5.,0.,10.));#14=CARTESIAN_POINT('',(5.,0.,10.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);",
    "#90=CIRCLE('',#4,5.);#91=CIRCLE('',#4,5.);#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);",
    "#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);",
    'ENDSEC;END-ISO-10303-21;'
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'cylinder.step' })

  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '69 / 68')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '64')
  assert.equal(inspection.interactiveModel.faces.length, 64)
  const generated = inspection.interactiveModel.points.slice(5)
  assert.ok(generated.some(point => Math.abs(Math.hypot(point[0], point[1]) - 5) < 1e-8 && point[2] === 10))
})

test('STEP 圆锥 ADVANCED_FACE 会按基准半径和半角生成截锥侧面', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('cone.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=CONICAL_SURFACE('',#4,5.,0.4636476090008061);",
    "#11=CARTESIAN_POINT('',(5.,0.,0.));#12=CARTESIAN_POINT('',(-5.,0.,0.));#13=CARTESIAN_POINT('',(-10.,0.,10.));#14=CARTESIAN_POINT('',(10.,0.,10.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#4,5.);#91=CIRCLE('',#4,10.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'cone.step' })
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '64')
  const generated = inspection.interactiveModel.points.slice(5)
  assert.ok(generated.some(point => Math.abs(Math.hypot(point[0], point[1]) - 10) < 1e-7 && point[2] === 10))
})

test('STEP 球面 ADVANCED_FACE 会按半径和纬度边界生成球带', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('sphere.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=SPHERICAL_SURFACE('',#4,5.);",
    "#11=CARTESIAN_POINT('',(4.,0.,-3.));#12=CARTESIAN_POINT('',(-4.,0.,-3.));#13=CARTESIAN_POINT('',(-4.,0.,3.));#14=CARTESIAN_POINT('',(4.,0.,3.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#4,4.);#91=CIRCLE('',#4,4.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'sphere.step' })
  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '421 / 420')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '768')
  const generated = inspection.interactiveModel.points.slice(5)
  assert.ok(generated.every(point => Math.abs(Math.hypot(point[0], point[1], point[2]) - 5) < 1e-7))
})

test('STEP 环面 ADVANCED_FACE 会按主半径、管半径和双圆周边界生成曲面带', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('torus.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=TOROIDAL_SURFACE('',#4,10.,3.);",
    "#6=CARTESIAN_POINT('',(0.,0.,-3.));#7=CARTESIAN_POINT('',(0.,0.,3.));#8=AXIS2_PLACEMENT_3D('',#6,#2,#3);#9=AXIS2_PLACEMENT_3D('',#7,#2,#3);",
    "#11=CARTESIAN_POINT('',(10.,0.,-3.));#12=CARTESIAN_POINT('',(-10.,0.,-3.));#13=CARTESIAN_POINT('',(-10.,0.,3.));#14=CARTESIAN_POINT('',(10.,0.,3.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#8,10.);#91=CIRCLE('',#9,10.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'torus.step' })
  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '423 / 420')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '768')
  const generated = inspection.interactiveModel.points.slice(7)
  assert.ok(generated.every(point => Math.abs(Math.hypot(Math.hypot(point[0], point[1]) - 10, point[2]) - 3) < 1e-7))
  const nonAxial = step.replace("#8=AXIS2_PLACEMENT_3D('',#6,#2,#3);#9=AXIS2_PLACEMENT_3D('',#7,#2,#3);", "#20=DIRECTION('',(0.,1.,0.));#8=AXIS2_PLACEMENT_3D('',#6,#20,#3);#9=AXIS2_PLACEMENT_3D('',#7,#20,#3);")
  const guarded = inspectFileBytes(Buffer.from(nonAxial), { name: 'partial-torus.step' })
  assert.equal(guarded.metadata.find(item => item.label === '可见面片').value, '0')
})

test('STEP B_SPLINE_SURFACE_WITH_KNOTS 会按控制点、次数和节点生成自由曲面网格', () => {
  const points = [
    [0, 0, 0], [0, 5, 1], [0, 10, 0],
    [5, 0, 1], [5, 5, 4], [5, 10, 1],
    [10, 0, 0], [10, 5, 1], [10, 10, 0]
  ]
  const pointData = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    pointData,
    "#11=VERTEX_POINT('',#1);#12=VERTEX_POINT('',#3);#13=VERTEX_POINT('',#9);#14=VERTEX_POINT('',#7);",
    "#21=EDGE_CURVE('',#11,#12,#90,.T.);#22=EDGE_CURVE('',#12,#13,#90,.T.);#23=EDGE_CURVE('',#13,#14,#90,.T.);#24=EDGE_CURVE('',#14,#11,#90,.T.);",
    "#31=ORIENTED_EDGE('',*,*,#21,.T.);#32=ORIENTED_EDGE('',*,*,#22,.T.);#33=ORIENTED_EDGE('',*,*,#23,.T.);#34=ORIENTED_EDGE('',*,*,#24,.T.);#41=EDGE_LOOP('',(#31,#32,#33,#34));#42=FACE_OUTER_BOUND('',#41,.T.);",
    "#50=B_SPLINE_SURFACE_WITH_KNOTS('',2,2,((#1,#2,#3),(#4,#5,#6),(#7,#8,#9)),.UNSPECIFIED.,.F.,.F.,.F.,(3,3),(3,3),(0.,1.),(0.,1.),.UNSPECIFIED.);#60=ADVANCED_FACE('',(#42),#50,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'freeform.step' })

  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '288')
  assert.equal(inspection.metadata.find(item => item.label === '自由曲面').value, '完整参数域近似网格（复杂裁切待完善）')
  assert.equal(inspection.interactiveModel.faces.length, 288)
  assert.ok(inspection.interactiveModel.points.some(point => Math.abs(point[0] - 5) < 1e-8 && Math.abs(point[1] - 5) < 1e-8 && point[2] > 1.7))
  assert.match(inspection.previewSvg, /data-step-faces="288"/)
})

test('STEP 自由曲面的节点数量不合法时不会伪造面片', () => {
  const step = "ISO-10303-21;HEADER;FILE_NAME('broken-freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(0.,1.,0.));#3=CARTESIAN_POINT('',(1.,0.,0.));#4=CARTESIAN_POINT('',(1.,1.,0.));#50=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.,(1,1),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);#60=ADVANCED_FACE('',(),#50,.T.);ENDSEC;END-ISO-10303-21;"
  assert.throws(() => inspectFileBytes(Buffer.from(step), { name: 'broken-freeform.step' }), /曲面节点参数无效/)

})

test('STEP 复合实体里的 RATIONAL_B_SPLINE_SURFACE 会按权重生成曲面', () => {
  const points = [
    [0, 0, 0], [0, 5, 0], [0, 10, 0],
    [5, 0, 0], [5, 5, 4], [5, 10, 0],
    [10, 0, 0], [10, 5, 0], [10, 10, 0]
  ]
  const pointData = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('rational-freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    pointData,
    "#50=(BOUNDED_SURFACE() B_SPLINE_SURFACE(2,2,((#1,#2,#3),(#4,#5,#6),(#7,#8,#9)),.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS((3,3),(3,3),(0.,1.),(0.,1.),.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE(((1.,1.,1.),(1.,4.,1.),(1.,1.,1.))) REPRESENTATION_ITEM('') SURFACE());",
    "#60=ADVANCED_FACE('',(),#50,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'rational-freeform.step' })

  assert.equal(inspection.interactiveModel.faces.length, 288)
  assert.ok(inspection.interactiveModel.points.some(point => Math.abs(point[0] - 5) < 1e-8 && Math.abs(point[1] - 5) < 1e-8 && point[2] > 2.2))
})

test('STEP MAPPED_ITEM 会把同一模板按平移旋转缩放放到两个真实装配位置', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('mapped-assembly.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=CARTESIAN_POINT('',(0.,10.,0.));",
    "#10=POLY_LOOP('',(#1,#2,#3));#11=FACE_OUTER_BOUND('',#10,.T.);#12=FACE('',(#11));#13=CLOSED_SHELL('',(#12));#14=FACETED_BREP('',#13);#20=SHAPE_REPRESENTATION('',(#14),#99);",
    "#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#33=DIRECTION('',(0.,1.,0.));#34=DIRECTION('',(0.,0.,1.));#37=DIRECTION('',(0.,1.,0.));#38=DIRECTION('',(-1.,0.,0.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);",
    "#35=CARTESIAN_POINT('',(20.,0.,0.));#36=CARTESIAN_POINT('',(-20.,0.,0.));#40=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#32,#33,#35,1.,#34);#41=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#37,#38,#36,2.,#34);",
    "#50=REPRESENTATION_MAP(#31,#20);#51=MAPPED_ITEM('',#50,#40);#52=MAPPED_ITEM('',#50,#41);#60=SHAPE_REPRESENTATION('',(#51,#52),#99);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'mapped-assembly.step' })

  assert.equal(inspection.metadata.find(item => item.label === '装配实例').value, '2')
  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '6 / 6')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '2')
  assert.equal(inspection.interactiveModel.points.length, 6)
  assert.equal(inspection.interactiveModel.edges.length, 6)
  assert.equal(inspection.interactiveModel.faces.length, 2)
  assert.ok(inspection.interactiveModel.points.some(point => point[0] === 30 && point[1] === 0))
  assert.ok(inspection.interactiveModel.points.some(point => point[0] === -20 && point[1] === 20))
  assert.ok(inspection.interactiveModel.points.some(point => point[0] === -40 && point[1] === 0))
  assert.ok(!inspection.interactiveModel.points.some(point => point[0] === 10 && point[1] === 0), '模板不应继续重叠显示在原点')
})

test('STEP ITEM_DEFINED_TRANSFORMATION 关系会把组件从 rep_1 坐标放入 rep_2 装配坐标', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('relationship-assembly.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=CARTESIAN_POINT('',(0.,10.,0.));#10=POLY_LOOP('',(#1,#2,#3));#11=FACE_OUTER_BOUND('',#10,.T.);#12=FACE('',(#11));#13=CLOSED_SHELL('',(#12));#14=FACETED_BREP('',#13);",
    "#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#34=DIRECTION('',(0.,0.,1.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);#20=SHAPE_REPRESENTATION('',(#14,#31),#99);",
    "#35=CARTESIAN_POINT('',(20.,0.,0.));#37=DIRECTION('',(0.,1.,0.));#41=AXIS2_PLACEMENT_3D('',#35,#34,#37);#42=AXIS2_PLACEMENT_3D('',#30,#34,#32);#60=SHAPE_REPRESENTATION('',(#41,#42),#99);",
    "#70=(REPRESENTATION_RELATIONSHIP('','',#20,#60) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#71) SHAPE_REPRESENTATION_RELATIONSHIP());#71=ITEM_DEFINED_TRANSFORMATION('','',#31,#41);#72=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#70,#73);#73=PRODUCT_DEFINITION_SHAPE('Placement','',#74);",
    "#80=CARTESIAN_POINT('',(0.,100.,0.));#81=AXIS2_PLACEMENT_3D('',#80,#34,#32);#90=SHAPE_REPRESENTATION('',(#81),#99);#91=(REPRESENTATION_RELATIONSHIP('','',#60,#90) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#92) SHAPE_REPRESENTATION_RELATIONSHIP());#92=ITEM_DEFINED_TRANSFORMATION('','',#42,#81);#93=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#91,#94);#94=PRODUCT_DEFINITION_SHAPE('Placement','',#95);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'relationship-assembly.step' })

  assert.equal(inspection.metadata.find(item => item.label === '装配实例').value, '1')
  assert.equal(inspection.metadata.find(item => item.label === '关系型装配').value, '1')
  assert.equal(inspection.metadata.find(item => item.label === '线框点/边').value, '3 / 3')
  assert.equal(inspection.metadata.find(item => item.label === '可见面片').value, '1')
  assert.ok(inspection.interactiveModel.points.some(point => point[0] === 20 && point[1] === 110))
  assert.ok(inspection.interactiveModel.points.some(point => point[0] === 10 && point[1] === 100))
  assert.ok(!inspection.interactiveModel.points.some(point => point[0] === 0 && point[1] === 0), '组件模板不应留在原点')
})

test('STEP 关系型装配也会变换自由曲面生成的真实网格，不只移动文件里的控制点', () => {
  const step = [
    "ISO-10303-21;HEADER;FILE_NAME('relationship-freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(0.,10.,0.));#3=CARTESIAN_POINT('',(10.,0.,0.));#4=CARTESIAN_POINT('',(10.,10.,2.));#50=(BOUNDED_SURFACE() B_SPLINE_SURFACE(1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS((2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE(((1.,1.),(1.,1.))) REPRESENTATION_ITEM('') SURFACE());#51=ADVANCED_FACE('',(),#50,.T.);",
    "#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#34=DIRECTION('',(0.,0.,1.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);#60=SHAPE_REPRESENTATION('',(#51,#31),#99);",
    "#35=CARTESIAN_POINT('',(50.,0.,0.));#41=AXIS2_PLACEMENT_3D('',#35,#34,#32);#61=SHAPE_REPRESENTATION('',(#41),#99);",
    "#70=(REPRESENTATION_RELATIONSHIP('','',#60,#61) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#71) SHAPE_REPRESENTATION_RELATIONSHIP());#71=ITEM_DEFINED_TRANSFORMATION('','',#31,#41);#72=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#70,#73);#73=PRODUCT_DEFINITION_SHAPE('Placement','',#74);ENDSEC;END-ISO-10303-21;"
  ].join('')
  const inspection = inspectFileBytes(Buffer.from(step), { name: 'relationship-freeform.step' })

  assert.equal(inspection.metadata.find(item => item.label === '关系型装配').value, '1')
  assert.equal(inspection.interactiveModel.faces.length, 128)
  assert.ok(inspection.interactiveModel.points.length > 60)
  assert.ok(inspection.interactiveModel.points.every(point => point[0] >= 50 && point[0] <= 60))
})

test('DWG 和 CDR 识别原生文件头', () => {
  const dwg = inspectFileBytes(Buffer.from('AC1032more bytes'), { name: '施工图.dwg' })
  assert.equal(dwg.title, 'DWG 文件（图纸内容未支持）')
  assert.equal(dwg.metadata.find(item => item.label === '保存版本').value, 'AutoCAD 2018–2026')
  assert.equal(dwg.metadata.find(item => item.label === '图纸内容').value, '未支持（不是图纸预览）')
  assert.equal(dwg.metadata.find(item => item.label === '可行操作').value, '在 CAD 软件中另存为 DXF 后打开')
  assert.match(dwg.summary, /暂不支持 DWG 图纸/)
  assert.match(dwg.summary, /另存为 DXF/)
  assert.equal(dwg.preview, null)

  const cdrBytes = Buffer.alloc(16)
  cdrBytes.write('RIFF', 0)
  cdrBytes.writeUInt32LE(8, 4)
  cdrBytes.write('CDR6', 8)
  const cdr = inspectFileBytes(cdrBytes, { name: '插画.cdr' })
  assert.equal(cdr.title, 'CorelDRAW 文件')
})

test('DWG/CDR 内嵌 JPEG 或 PNG 会作为本机缩略图提取', () => {
  const bytes = Buffer.concat([Buffer.from('RIFF\0\0\0\0CDR6'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])])
  bytes.writeUInt32LE(bytes.length - 8, 4)
  const inspection = inspectFileBytes(bytes, { name: '带预览.cdr' })
  assert.equal(inspection.preview.extension, 'jpg')
  assert.deepEqual(Array.from(inspection.preview.bytes.slice(0, 3)), [0xff, 0xd8, 0xff])
})

test('CDR RIFF 会列出真实块目录并还原 DISP 画布缩略图', () => {
  const version = Buffer.alloc(10)
  version.write('vrsn', 0)
  version.writeUInt32LE(2, 4)
  version.writeUInt16LE(600, 8)
  const dispData = Buffer.alloc(1070)
  dispData.writeUInt32LE(2, 8)
  dispData.writeUInt32LE(1, 12)
  dispData[44 + 4 + 2] = 255
  dispData[44 + 8 + 1] = 255
  dispData[1068] = 1
  dispData[1069] = 2
  const disp = Buffer.alloc(8 + dispData.length)
  disp.write('DISP', 0)
  disp.writeUInt32LE(dispData.length, 4)
  dispData.copy(disp, 8)
  const riff = Buffer.concat([Buffer.from('RIFF\0\0\0\0CDR6'), version, disp])
  riff.writeUInt32LE(riff.length - 8, 4)

  const inspection = inspectFileBytes(riff, { name: '带画布.cdr' })
  assert.equal(inspection.entries.length, 2)
  assert.match(inspection.entries[0].displayName, /文档版本/)
  assert.match(inspection.entries[1].displayName, /画布缩略图/)
  assert.equal(inspection.metadata.find(item => item.label === '文档版本').value, '600')
  assert.equal(inspection.metadata.find(item => item.label === '画布预览').value, '2 × 1 px')
  assert.equal(inspection.preview.extension, 'jpg')
  assert.deepEqual(Array.from(inspection.preview.bytes.slice(0, 2)), [0xff, 0xd8])
})

test('Corel 官方旧版 .cdr 使用 CARA 表单时仍会还原可见画布', () => {
  const version = Buffer.alloc(10)
  version.write('vrsn', 0)
  version.writeUInt32LE(2, 4)
  version.writeUInt16LE(1000, 8)
  const dispData = Buffer.alloc(1072)
  dispData.writeUInt32LE(2, 8)
  dispData.writeUInt32LE(2, 12)
  dispData[44 + 4 + 2] = 255
  dispData[44 + 8 + 1] = 255
  dispData[1068] = 1
  dispData[1069] = 2
  dispData[1070] = 2
  dispData[1071] = 1
  const disp = Buffer.alloc(8 + dispData.length)
  disp.write('DISP', 0)
  disp.writeUInt32LE(dispData.length, 4)
  dispData.copy(disp, 8)
  const riff = Buffer.concat([Buffer.from('RIFF\0\0\0\0CARA'), version, disp])
  riff.writeUInt32LE(riff.length - 8, 4)

  const inspection = inspectFileBytes(riff, { name: 'Corel-RAVE示例.cdr' })
  assert.equal(inspection.title, 'Corel R.A.V.E. / CDR 文件')
  assert.equal(inspection.metadata.find(item => item.label === '文档类型').value, 'Corel R.A.V.E. 动画（.cdr）')
  assert.equal(inspection.metadata.find(item => item.label === '文档版本').value, '1000')
  assert.equal(inspection.metadata.find(item => item.label === '画布预览').value, '2 × 2 px')
  assert.equal(inspection.preview.extension, 'jpg')
  assert.deepEqual(Array.from(inspection.preview.bytes.slice(0, 2)), [0xff, 0xd8])
})

test('没有 DISP 的旧 CDR 会解开 LIST cmpr 并显示 loda / trfd 真实矢量', () => {
  const inspection = inspectFileBytes(cdrCompressedVectorFixture(), { name: '只有压缩矢量.cdr' })

  assert.equal(inspection.preview, null)
  assert.match(inspection.summary, /即使文件没有 DISP 缩略图，也会显示真实矢量内容/)
  assert.match(inspection.previewSvg, /data-cdr-vectors="1"/)
  assert.match(inspection.previewSvg, /fill="#ff5b43"/)
  assert.match(inspection.previewSvg, /M2 -3L3 -3L2 -4Z/)
  assert.equal(inspection.metadata.find(item => item.label === '压缩数据列表').value, '1')
  assert.equal(inspection.metadata.find(item => item.label === '基础矢量对象').value, '1')
  assert.equal(inspection.metadata.find(item => item.label === '矢量控制点').value, '3')
  assert.ok(Number(inspection.metadata.find(item => item.label === '压缩内部记录').value) >= 8)
})

test('损坏的 CDR LIST cmpr 不会伪造空白画布', () => {
  const fixture = cdrCompressedVectorFixture()
  fixture.writeUInt32LE(0x7fffffff, 24)
  const inspection = inspectFileBytes(fixture, { name: '损坏压缩矢量.cdr' })

  assert.equal(inspection.previewSvg, '')
  assert.equal(inspection.preview, null)
  assert.match(inspection.summary, /没有得到可显示的基础矢量或缩略图/)
})

test('现代 CDR ZIP 文档包会显示预览、目录并允许打开内部文件', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const archive = zipSync({
    'metadata/preview.png': png,
    'metadata/document.xml': Buffer.from('<document><page name="封面"/></document>'),
    'content/root.dat': Buffer.from([1, 2, 3, 4])
  })
  const inspection = inspectFileBytes(archive, { name: '现代画册.cdr', type: 'application/x-cdr' })

  assert.equal(inspection.title, 'CorelDRAW 文档包')
  assert.equal(inspection.archiveType, 'zip')
  assert.equal(inspection.preview.extension, 'png')
  assert.equal(inspection.entries.filter(entry => entry.canOpen).length, 3)
  const xml = inspection.entries.find(entry => entry.name.endsWith('document.xml'))
  assert.match(Buffer.from(extractArchiveEntry(archive, xml)).toString(), /page name="封面"/)
})

test('未知 application 文件仍提供文件头和本机校验值', () => {
  const inspection = inspectFileBytes(Buffer.from([1, 2, 3, 4]), { name: 'unknown.bin', type: 'application/octet-stream', size: 4 })
  assert.equal(inspection.title, '二进制文件信息')
  assert.match(inspection.metadata.find(item => item.label === '文件头').value, /01 02 03 04/)
  assert.equal(inspection.metadata.find(item => item.label === 'FNV-1a').value.length, 8)
})
