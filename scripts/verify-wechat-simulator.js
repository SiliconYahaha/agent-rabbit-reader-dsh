'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const iconv = require('iconv-lite')
const { psdAlphaFixture } = require('../tests/helpers/psd-alpha')
const jpegCodec = require('jpeg-js')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const automator = require('miniprogram-automator')
const { duplicateRar, duplicateSevenZip, duplicateZip } = require('../tests/helpers/archive-duplicates')
const { BZIP2_LINK_ZIP, BZIP2_ZIP, forceZip64Archive, renameSingleMemberZip, splitClassicZip, splitClassicZip64 } = require('../tests/helpers/zip-legacy-compat')
const {
  automationCliArgs,
  automationPortForProject,
  installAutomatorVersionCompatibility
} = require('./miniprogram-automator-compat')

installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()

const projectRoot = path.resolve(__dirname, '..')
const { testMaterialRoot } = require('./local-test-materials')
const materialRoot = testMaterialRoot(process.argv[2])
const outputRoot = path.resolve(process.argv[3] || path.join(projectRoot, 'outputs', 'handbook-validation-2026-08-23', 'simulator'))
const projectPort = automationPortForProject(projectRoot)
const endpoint = process.env.WECHAT_AUTOMATOR_ENDPOINT || `ws://127.0.0.1:${projectPort}`
const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const projectAppId = require('../project.config.json').appid
const execFileAsync = promisify(execFile)
// Real WXML text/style/size/tap assertions are the default gate. Capturing the
// many optional evidence images keeps DevTools busy long enough to make its
// automation bridge unstable, so screenshots are opt-in for review sessions.
const captureScreenshots = process.env.WECHAT_SIMULATOR_SCREENSHOTS === '1'

async function compressedRarFixtureBase64 () {
  const source = await fs.readFile(path.join(projectRoot, 'tests', 'rar-runtime.test.js'), 'utf8')
  const match = source.match(/const COMPRESSED_RAR = Buffer\.from\('([^']+)', 'base64'\)/)
  assert.ok(match, 'RAR 自动化样本没有写入 tests/rar-runtime.test.js')
  return match[1]
}

async function compressedSevenZipFixtureBase64 () {
  const source = await fs.readFile(path.join(projectRoot, 'tests', '7z-runtime.test.js'), 'utf8')
  const match = source.match(/const LZMA2_7Z = Buffer\.from\('([^']+)', 'base64'\)/)
  assert.ok(match, '7z 自动化样本没有写入 tests/7z-runtime.test.js')
  return match[1]
}

async function headerEncryptedRarFixtureBase64 () {
  const source = await fs.readFile(path.join(projectRoot, 'tests', 'rar-runtime.test.js'), 'utf8')
  const match = source.match(/const HEADER_ENCRYPTED_RAR = Buffer\.from\('([^']+)', 'base64'\)/)
  assert.ok(match, 'RAR 密码自动化样本没有写入 tests/rar-runtime.test.js')
  return match[1]
}

async function encryptedSevenZipFixtureBase64 () {
  const source = await fs.readFile(path.join(projectRoot, 'tests', '7z-runtime.test.js'), 'utf8')
  const match = source.match(/const ENCRYPTED_7Z = Buffer\.from\('([^']+)', 'base64'\)/)
  assert.ok(match, '7z 密码自动化样本没有写入 tests/7z-runtime.test.js')
  return match[1]
}

async function zipCompatibilityFixtureBase64 (name) {
  const source = await fs.readFile(path.join(projectRoot, 'tests', '7z-runtime.test.js'), 'utf8')
  const match = source.match(new RegExp(`const ${name} = Buffer\\.from\\('([^']+)', 'base64'\\)`))
  assert.ok(match, `ZIP 兼容自动化样本 ${name} 不存在`)
  return match[1]
}

function zipLegacyFilenameFixtureBase64 () {
  // Apache Commons Compress utf8-7zip-test.zip (Apache-2.0). The archive
  // deliberately mixes ASCII, unflagged CP437 and EFS UTF-8 entry names.
  return 'UEsDBAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAYXNjaWludHh0YXNjaWlQSwMECgAAAAAA5npGOubG5usNAAAADQAAAAwAAACZbGaEc3Nlci50eHRIZWxsbywgd29ybGQhUEsDBAoAAAgAAPR6RjpgmWdMEwAAABMAAAASAAAA4oKsX2Zvcl9Eb2xsYXIudHh0R2l2ZSBtZSB5b3VyIG1vbmV5IVBLAQIUAAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAAAAAAAAAIAAAAAAAAABhc2NpaS50eHRQSwECFAAKAAAAAADmekY65sbm6w0AAAANAAAADAAAAAAAAAAAAIAAAAAsAAAAmWxmhHNzZXIudHh0UEsBAhQACgAACAAA9HpGOmCZZ0wTAAAAEwAAABIAAAAAAAAAAACAAAAAYwAAAOKCrF9mb3JfRG9sbGFyLnR4dFBLBQYAAAAAAwADALEAAACmAAAAAAA='
}

function zipLegacyBzip2FixtureBase64 (name, encoding) {
  return renameSingleMemberZip(BZIP2_ZIP, iconv.encode(name, encoding)).toString('base64')
}

function zipLegacyCjkFixtureBase64 (name, encoding) {
  const rawName = iconv.encode(name, encoding)
  const payload = Buffer.from(`${name} 正文`)
  const crc32 = bytes => {
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const payloadCrc = crc32(payload)
  const local = Buffer.alloc(30 + rawName.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(payloadCrc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(rawName.length, 26)
  rawName.copy(local, 30)
  const central = Buffer.alloc(46 + rawName.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(payloadCrc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(rawName.length, 28)
  rawName.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + payload.length, 16)
  return Buffer.concat([local, payload, central, eocd]).toString('base64')
}

async function multipleEntry7zFixtureBase64 (literalNames = false, keywordNames = false, corrupt = false, selectionNames = false) {
  const SevenZip = require('../miniprogram/file-reader/sevenzip/runtime/7zz')
  const wasmBinary = zlib.brotliDecompressSync(await fs.readFile(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  engine.FS.mkdir('/docs')
  engine.FS.writeFile('/docs/first.txt', Buffer.from('这是第一个文件，不能在目录中丢失'))
  engine.FS.writeFile('/docs/second.txt', Buffer.from('这是第二个文件，也必须保留'))
  engine.FS.writeFile('/empty.txt', Buffer.alloc(0))
  const additional = selectionNames ? ['report*.txt', 'report-broken.txt', 'note?.txt', 'note1.txt', '@list.txt'] : keywordNames ? ['Data Error.txt', 'Wrong password.txt', 'Can not open.txt'] : literalNames ? [' report----------final.txt', 'trailing.txt '] : []
  for (const name of additional) engine.FS.writeFile(`/${name}`, Buffer.from(`特殊文件名正文：${JSON.stringify(name)}`))
  assert.equal(engine.callMain(['a', '-t7z', '-spd', corrupt || selectionNames ? '-m0=copy' : '-m0=lzma2', '-ms=on', '/multiple.7z', '--', '/docs', '/empty.txt', ...additional.map(name => `/${name}`)]), 0)
  const archive = Buffer.from(engine.FS.readFile('/multiple.7z'))
  if (corrupt || selectionNames) {
    const damagedName = selectionNames ? 'report-broken.txt' : 'Wrong password.txt'
    const position = archive.indexOf(Buffer.from(`特殊文件名正文：${JSON.stringify(damagedName)}`))
    assert.ok(position >= 32, 'CRC 损坏样本没有找到真实正文数据')
    archive[position] ^= 0xff
  }
  return archive.toString('base64')
}

function zipPrediction16BitPsdFixtureBase64 () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 3, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, 3, false)
  view.setUint16(22, 16, false)
  view.setUint16(24, 3, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const predicted = Uint8Array.from([[255, 0, 128], [0, 255, 64], [0, 0, 255]].flatMap(samples => {
    let previous = 0
    return samples.flatMap((sample8, index) => {
      const sample = sample8 * 257
      const delta = index ? (sample - previous + 0x10000) & 0xffff : sample
      previous = sample
      return [delta >>> 8, delta & 0xff]
    })
  }))
  return Buffer.from(Uint8Array.from([...header, ...sections, ...zlib.deflateSync(predicted)])).toString('base64')
}

function zipPrediction32BitPsdFixtureBase64 () {
  const width = 3
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 3, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, width, false)
  view.setUint16(22, 32, false)
  view.setUint16(24, 3, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const predicted = Uint8Array.from([[0, 0.21404114, 1], [1, 0.21404114, 0], [0, 0, 1]].flatMap(samples => {
    const raw = new Uint8Array(width * 4)
    const rawView = new DataView(raw.buffer)
    samples.forEach((sample, index) => rawView.setFloat32(index * 4, sample, false))
    const shuffled = new Uint8Array(raw.length)
    for (let byte = 0; byte < 4; byte++) for (let column = 0; column < width; column++) shuffled[byte * width + column] = raw[column * 4 + byte]
    for (let index = shuffled.length - 1; index > 0; index--) shuffled[index] = (shuffled[index] - shuffled[index - 1] + 256) & 0xff
    return Array.from(shuffled)
  }))
  return Buffer.from(Uint8Array.from([...header, ...sections, ...zlib.deflateSync(predicted)])).toString('base64')
}

function zipPrediction16BitLabPsdFixtureBase64 () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 3, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, 3, false)
  view.setUint16(22, 16, false)
  view.setUint16(24, 9, false)
  const sections = new Uint8Array(10)
  new DataView(sections.buffer).setUint16(8, 3, false)
  const predicted = Uint8Array.from([[255, 0, 138], [128, 128, 209], [128, 128, 198]].flatMap(samples => {
    let previous = 0
    return samples.flatMap((sample8, index) => {
      const sample = sample8 * 257
      const delta = index ? (sample - previous + 0x10000) & 0xffff : sample
      previous = sample
      return [delta >>> 8, delta & 0xff]
    })
  }))
  return Buffer.from(Uint8Array.from([...header, ...sections, ...zlib.deflateSync(predicted)])).toString('base64')
}

function zipPredictionIndexedPsdFixtureBase64 () {
  const header = new Uint8Array(30)
  header.set(Buffer.from('8BPS'))
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, false)
  view.setUint16(12, 1, false)
  view.setUint32(14, 1, false)
  view.setUint32(18, 4, false)
  view.setUint16(22, 8, false)
  view.setUint16(24, 2, false)
  view.setUint32(26, 768, false)
  const palette = new Uint8Array(768)
  palette[0] = palette[256] = palette[512] = 255
  palette[1] = 255
  palette[256 + 2] = 255
  palette[512 + 3] = 255
  const transparencyResource = Uint8Array.from([
    ...Buffer.from('8BIM'), 0x04, 0x17, 0, 0, 0, 0, 0, 2, 0, 2
  ])
  const sections = new Uint8Array(10 + transparencyResource.length)
  const sectionView = new DataView(sections.buffer)
  sectionView.setUint32(0, transparencyResource.length, false)
  sections.set(transparencyResource, 4)
  sectionView.setUint16(8 + transparencyResource.length, 3, false)
  const predicted = Uint8Array.from([1, 1, 1, 253])
  return Buffer.from(Uint8Array.from([...header, ...palette, ...sections, ...zlib.deflateSync(predicted)])).toString('base64')
}

function legacyAiFixtureBase64 () {
  return Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator(R) 8.0
%%HiResBoundingBox: 0 0 180 100
0.12 0.78 0.32 r
5 5 m 175 5 l 175 95 l 5 95 l h f
0 0 0 R 3 w
15 20 m 55 90 125 90 165 20 c S
showpage
%%EOF`).toString('base64')
}

function legacyAiEpsiFixtureBase64 () {
  return Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator(R) 8.0
%%BoundingBox: 0 0 8 4
%%BeginPreview: 8 4 1 4
% 81
% 42
% 24
% 18
%%EndPreview
showpage
%%EOF`).toString('base64')
}

function wavFixtureBase64 () {
  const sampleRate = 8000
  const sampleCount = sampleRate
  const bytes = Buffer.alloc(44 + sampleCount * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(sampleCount * 2, 40)
  for (let index = 0; index < sampleCount; index++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 6000), 44 + index * 2)
  return bytes.toString('base64')
}

function dxfFixtureBase64 () {
  return Buffer.from([
    '0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'SYMBOL', '10', '0', '20', '0',
    '0', 'LINE', '10', '0', '20', '0', '11', '20', '21', '0', '0', 'CIRCLE', '10', '10', '20', '5', '40', '3',
    '0', 'ENDBLK', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '2', 'SYMBOL', '10', '100', '20', '50', '41', '2', '42', '2', '50', '90',
    '0', 'SPLINE', '70', '0', '71', '2', '72', '6', '73', '3',
    '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
    '10', '0', '20', '30', '10', '20', '20', '50', '10', '40', '20', '30',
    '0', 'LWPOLYLINE', '90', '2', '70', '0', '10', '50', '20', '30', '42', '1', '10', '70', '20', '30',
    '0', 'HATCH', '2', 'SOLID', '70', '1', '91', '2', '92', '2', '72', '0', '73', '1', '93', '4',
    '10', '0', '20', '0', '10', '40', '20', '0', '10', '40', '20', '20', '10', '0', '20', '20',
    '92', '1', '93', '2', '72', '2', '10', '90', '20', '10', '40', '10', '50', '0', '51', '180', '73', '1',
    '72', '1', '10', '80', '20', '10', '11', '100', '21', '10', '97', '0',
    '0', 'DIMENSION', '70', '32', '11', '50', '21', '35', '13', '0', '23', '0', '14', '100', '24', '0', '1', '<>',
    '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n')).toString('base64')
}

function dxf3dFixtureBase64 () {
  return Buffer.from([
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
  ].join('\n')).toString('base64')
}

function stepCubeFixtureBase64 () {
  const points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]]
  const loops = [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]
  const data = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const faces = loops.map((loop, index) => `#${201 + index}=POLY_LOOP('',(${loop.map(id => `#${id}`).join(',')}));#${301 + index}=FACE_OUTER_BOUND('',#${201 + index},.T.);#${401 + index}=FACE('',(#${301 + index}));`).join('')
  return Buffer.from(`ISO-10303-21;HEADER;FILE_NAME('faceted-cube.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${data}${faces}#501=CLOSED_SHELL('',(#401,#402,#403,#404,#405,#406));#502=FACETED_BREP('',#501);ENDSEC;END-ISO-10303-21;`).toString('base64')
}

function stepCylinderFixtureBase64 () {
  return Buffer.from([
    "ISO-10303-21;HEADER;FILE_NAME('cylinder.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=CYLINDRICAL_SURFACE('',#4,5.);",
    "#11=CARTESIAN_POINT('',(5.,0.,0.));#12=CARTESIAN_POINT('',(-5.,0.,0.));#13=CARTESIAN_POINT('',(-5.,0.,10.));#14=CARTESIAN_POINT('',(5.,0.,10.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);",
    "#90=CIRCLE('',#4,5.);#91=CIRCLE('',#4,5.);#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);",
    "#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')).toString('base64')
}

function stepConeFixtureBase64 () {
  return Buffer.from([
    "ISO-10303-21;HEADER;FILE_NAME('cone.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=CONICAL_SURFACE('',#4,5.,0.4636476090008061);",
    "#11=CARTESIAN_POINT('',(5.,0.,0.));#12=CARTESIAN_POINT('',(-5.,0.,0.));#13=CARTESIAN_POINT('',(-10.,0.,10.));#14=CARTESIAN_POINT('',(10.,0.,10.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#4,5.);#91=CIRCLE('',#4,10.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')).toString('base64')
}

function stepSphereFixtureBase64 () {
  return Buffer.from([
    "ISO-10303-21;HEADER;FILE_NAME('sphere.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=SPHERICAL_SURFACE('',#4,5.);",
    "#11=CARTESIAN_POINT('',(4.,0.,-3.));#12=CARTESIAN_POINT('',(-4.,0.,-3.));#13=CARTESIAN_POINT('',(-4.,0.,3.));#14=CARTESIAN_POINT('',(4.,0.,3.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#4,4.);#91=CIRCLE('',#4,4.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')).toString('base64')
}

function stepTorusFixtureBase64 () {
  return Buffer.from([
    "ISO-10303-21;HEADER;FILE_NAME('torus.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=DIRECTION('',(0.,0.,1.));#3=DIRECTION('',(1.,0.,0.));#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);#5=TOROIDAL_SURFACE('',#4,10.,3.);",
    "#6=CARTESIAN_POINT('',(0.,0.,-3.));#7=CARTESIAN_POINT('',(0.,0.,3.));#8=AXIS2_PLACEMENT_3D('',#6,#2,#3);#9=AXIS2_PLACEMENT_3D('',#7,#2,#3);",
    "#11=CARTESIAN_POINT('',(10.,0.,-3.));#12=CARTESIAN_POINT('',(-10.,0.,-3.));#13=CARTESIAN_POINT('',(-10.,0.,3.));#14=CARTESIAN_POINT('',(10.,0.,3.));",
    "#21=VERTEX_POINT('',#11);#22=VERTEX_POINT('',#12);#23=VERTEX_POINT('',#13);#24=VERTEX_POINT('',#14);#90=CIRCLE('',#8,10.);#91=CIRCLE('',#9,10.);",
    "#31=EDGE_CURVE('',#21,#22,#90,.T.);#32=EDGE_CURVE('',#22,#23,#92,.T.);#33=EDGE_CURVE('',#23,#24,#91,.T.);#34=EDGE_CURVE('',#24,#21,#92,.T.);",
    "#41=ORIENTED_EDGE('',*,*,#31,.T.);#42=ORIENTED_EDGE('',*,*,#32,.T.);#43=ORIENTED_EDGE('',*,*,#33,.T.);#44=ORIENTED_EDGE('',*,*,#34,.T.);#51=EDGE_LOOP('',(#41,#42,#43,#44));#52=FACE_OUTER_BOUND('',#51,.T.);#60=ADVANCED_FACE('',(#52),#5,.T.);ENDSEC;END-ISO-10303-21;"
  ].join('')).toString('base64')
}

function stepFreeformFixtureBase64 () {
  const points = [[0, 0, 0], [0, 5, 1], [0, 10, 0], [5, 0, 1], [5, 5, 4], [5, 10, 1], [10, 0, 0], [10, 5, 1], [10, 10, 0]]
  const data = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  return Buffer.from(`ISO-10303-21;HEADER;FILE_NAME('freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${data}#11=VERTEX_POINT('',#1);#12=VERTEX_POINT('',#3);#13=VERTEX_POINT('',#9);#14=VERTEX_POINT('',#7);#21=EDGE_CURVE('',#11,#12,#90,.T.);#22=EDGE_CURVE('',#12,#13,#90,.T.);#23=EDGE_CURVE('',#13,#14,#90,.T.);#24=EDGE_CURVE('',#14,#11,#90,.T.);#31=ORIENTED_EDGE('',*,*,#21,.T.);#32=ORIENTED_EDGE('',*,*,#22,.T.);#33=ORIENTED_EDGE('',*,*,#23,.T.);#34=ORIENTED_EDGE('',*,*,#24,.T.);#41=EDGE_LOOP('',(#31,#32,#33,#34));#42=FACE_OUTER_BOUND('',#41,.T.);#50=B_SPLINE_SURFACE_WITH_KNOTS('',2,2,((#1,#2,#3),(#4,#5,#6),(#7,#8,#9)),.UNSPECIFIED.,.F.,.F.,.F.,(3,3),(3,3),(0.,1.),(0.,1.),.UNSPECIFIED.);#60=ADVANCED_FACE('',(#42),#50,.T.);ENDSEC;END-ISO-10303-21;`).toString('base64')
}

function stepMappedAssemblyFixtureBase64 () {
  return Buffer.from("ISO-10303-21;HEADER;FILE_NAME('mapped-assembly.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=CARTESIAN_POINT('',(0.,10.,0.));#10=POLY_LOOP('',(#1,#2,#3));#11=FACE_OUTER_BOUND('',#10,.T.);#12=FACE('',(#11));#13=CLOSED_SHELL('',(#12));#14=FACETED_BREP('',#13);#20=SHAPE_REPRESENTATION('',(#14),#99);#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#33=DIRECTION('',(0.,1.,0.));#34=DIRECTION('',(0.,0.,1.));#37=DIRECTION('',(0.,1.,0.));#38=DIRECTION('',(-1.,0.,0.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);#35=CARTESIAN_POINT('',(20.,0.,0.));#36=CARTESIAN_POINT('',(-20.,0.,0.));#40=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#32,#33,#35,1.,#34);#41=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#37,#38,#36,2.,#34);#50=REPRESENTATION_MAP(#31,#20);#51=MAPPED_ITEM('',#50,#40);#52=MAPPED_ITEM('',#50,#41);#60=SHAPE_REPRESENTATION('',(#51,#52),#99);ENDSEC;END-ISO-10303-21;").toString('base64')
}

function stepRelationshipAssemblyFixtureBase64 () {
  return Buffer.from("ISO-10303-21;HEADER;FILE_NAME('relationship-assembly.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=CARTESIAN_POINT('',(0.,10.,0.));#10=POLY_LOOP('',(#1,#2,#3));#11=FACE_OUTER_BOUND('',#10,.T.);#12=FACE('',(#11));#13=CLOSED_SHELL('',(#12));#14=FACETED_BREP('',#13);#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#34=DIRECTION('',(0.,0.,1.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);#20=SHAPE_REPRESENTATION('',(#14,#31),#99);#35=CARTESIAN_POINT('',(20.,0.,0.));#37=DIRECTION('',(0.,1.,0.));#41=AXIS2_PLACEMENT_3D('',#35,#34,#37);#42=AXIS2_PLACEMENT_3D('',#30,#34,#32);#60=SHAPE_REPRESENTATION('',(#41,#42),#99);#70=(REPRESENTATION_RELATIONSHIP('','',#20,#60) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#71) SHAPE_REPRESENTATION_RELATIONSHIP());#71=ITEM_DEFINED_TRANSFORMATION('','',#31,#41);#72=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#70,#73);#73=PRODUCT_DEFINITION_SHAPE('Placement','',#74);#80=CARTESIAN_POINT('',(0.,100.,0.));#81=AXIS2_PLACEMENT_3D('',#80,#34,#32);#90=SHAPE_REPRESENTATION('',(#81),#99);#91=(REPRESENTATION_RELATIONSHIP('','',#60,#90) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#92) SHAPE_REPRESENTATION_RELATIONSHIP());#92=ITEM_DEFINED_TRANSFORMATION('','',#42,#81);#93=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#91,#94);#94=PRODUCT_DEFINITION_SHAPE('Placement','',#95);ENDSEC;END-ISO-10303-21;").toString('base64')
}

function cdrDispFixtureBase64 () {
  const version = Buffer.alloc(10)
  version.write('vrsn', 0)
  version.writeUInt32LE(2, 4)
  version.writeUInt16LE(600, 8)
  const dispData = Buffer.alloc(1072)
  dispData.writeUInt32LE(2, 8)
  dispData.writeUInt32LE(2, 12)
  dispData[44 + 4 + 2] = 255
  dispData[44 + 8 + 1] = 255
  dispData[44 + 12] = 255
  dispData[1068] = 1
  dispData[1069] = 2
  dispData[1070] = 3
  dispData[1071] = 1
  const disp = Buffer.alloc(8 + dispData.length)
  disp.write('DISP', 0)
  disp.writeUInt32LE(dispData.length, 4)
  dispData.copy(disp, 8)
  const riff = Buffer.concat([Buffer.from('RIFF\0\0\0\0CDR6'), version, disp])
  riff.writeUInt32LE(riff.length - 8, 4)
  return riff.toString('base64')
}

function cdrCompressedVectorFixtureBase64 () {
  const lengths = []
  const record = (id, data) => {
    const index = lengths.length
    lengths.push(data.length)
    const header = Buffer.alloc(8)
    header.write(id, 0, 'latin1')
    header.writeUInt32LE(index, 4)
    return Buffer.concat([header, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  }
  const list = (type, children) => record('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...children]))
  const fillId = 0x12345678
  const fill = Buffer.alloc(20)
  fill.writeUInt32LE(fillId, 0)
  fill.writeUInt16LE(1, 4)
  fill.writeUInt16LE(5, 8)
  fill.writeUInt16LE(5, 10)
  fill.writeUInt32LE(0x00ff5b43, 16)
  const geometry = Buffer.alloc(31)
  geometry.writeUInt16LE(3, 0)
  ;[[0, 0], [254000, 0], [0, 254000]].forEach((point, index) => {
    geometry.writeInt32LE(point[0], 4 + index * 8)
    geometry.writeInt32LE(point[1], 8 + index * 8)
  })
  geometry.set([0x00, 0x40, 0x48], 28)
  const loda = Buffer.alloc(44 + geometry.length + 8)
  loda.writeUInt32LE(loda.length, 0)
  loda.writeUInt32LE(3, 4)
  loda.writeUInt32LE(20, 8)
  loda.writeUInt32LE(32, 12)
  loda.writeUInt32LE(3, 16)
  loda.writeUInt32LE(44, 20)
  loda.writeUInt32LE(44 + geometry.length, 24)
  loda.writeUInt32LE(48 + geometry.length, 28)
  loda.writeUInt32LE(0x0a, 32)
  loda.writeUInt32LE(0x14, 36)
  loda.writeUInt32LE(0x1e, 40)
  geometry.copy(loda, 44)
  loda.writeUInt32LE(fillId, 44 + geometry.length)
  const transform = Buffer.alloc(72)
  transform.writeUInt32LE(transform.length, 0)
  transform.writeUInt32LE(1, 4)
  transform.writeUInt32LE(12, 8)
  transform.writeUInt32LE(16, 12)
  transform.writeUInt16LE(0x08, 16)
  ;[1, 0, 2 * 254000, 0, 1, 3 * 254000].forEach((value, index) => transform.writeDoubleLE(value, 24 + index * 8))
  const object = list('obj ', [list('lgob', [record('loda', loda), list('trfl', [record('trfd', transform)])])])
  const part1 = list('doc ', [record('fild', fill), list('page', [object])])
  const lengthBytes = Buffer.alloc(lengths.length * 4)
  lengths.forEach((length, index) => lengthBytes.writeUInt32LE(length, index * 4))
  const first = zlib.deflateSync(part1); const second = zlib.deflateSync(lengthBytes)
  const cpng = compressed => {
    const header = Buffer.alloc(8)
    header.write('CPng', 0)
    header.writeUInt16LE(1, 4)
    header.writeUInt16LE(4, 6)
    return Buffer.concat([header, compressed])
  }
  const compressedData = Buffer.alloc(20)
  compressedData.write('cmpr', 0)
  compressedData.writeUInt32LE(first.length + 8, 4)
  compressedData.writeUInt32LE(part1.length, 8)
  compressedData.writeUInt32LE(second.length + 8, 12)
  compressedData.writeUInt32LE(lengthBytes.length, 16)
  const data = Buffer.concat([compressedData, cpng(first), cpng(second)])
  const outer = Buffer.alloc(8)
  outer.write('LIST', 0)
  outer.writeUInt32LE(data.length, 4)
  const riff = Buffer.concat([Buffer.from('RIFF\0\0\0\0CDRA'), outer, data])
  riff.writeUInt32LE(riff.length - 8, 4)
  return riff.toString('base64')
}

async function connectWithRetry (timeout = 60000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeout) {
    try {
      return await automator.connect({ wsEndpoint: endpoint })
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  throw lastError || new Error(`无法连接微信模拟器：${endpoint}`)
}

async function connectSimulator () {
  let connected
  try {
    connected = await automator.connect({ wsEndpoint: endpoint })
    const pageCount = await connected.evaluate(() => getCurrentPages().length)
    if (pageCount > 0) return connected
    // An automation port can survive after its project webview has gone away.
    // A successful websocket handshake is therefore not sufficient proof that
    // the current worktree is loaded. Re-open this exact project below.
    await connected.disconnect()
  } catch (connectError) {
    if (connected) {
      try { await connected.disconnect() } catch (_) {}
    }
    connected = null
  }
  const port = Number(new URL(endpoint).port || projectPort)
  try {
    await execFileAsync(cliPath, automationCliArgs(projectRoot, port), { timeout: 60000 })
    return await connectWithRetry()
  } catch (launchError) {
    launchError.message = `${launchError.message}\n自动化端口未加载当前项目：${endpoint}`
    throw launchError
  }
}

async function reLaunchWhenReady (miniProgram, route, requiredMethod = '', timeout = 20000) {
  const normalizedRoute = route.replace(/^\//, '')
  const startedAt = Date.now()
  let lastError
  let lastState
  let nextLaunchAt = 0
  while (Date.now() - startedAt < timeout) {
    if (Date.now() >= nextLaunchAt) {
      try {
        await miniProgram.reLaunch(route)
      } catch (error) {
        // 稳定版开发者工具偶尔会先丢失旧 webview 元数据，但路由命令已经送达。
        // 继续检查实际页面，并在两秒后才重发，避免把瞬态错误误判成项目失败。
        lastError = error
      }
      nextLaunchAt = Date.now() + 2000
    }
    try {
      const state = await miniProgram.evaluate((expectedRoute, methodName) => {
        const pages = getCurrentPages()
        const host = pages[pages.length - 1]
        // 阅读能力在 file-reader 组件上；宿主页面只保留路由与队列。
        const reader = host && typeof host.selectComponent === 'function' ? (host.selectComponent('#reader') || host.selectComponent('#preview')) : null
        return {
          route: host && host.route,
          methodReady: !methodName || Boolean(reader && typeof reader[methodName] === 'function')
        }
      }, normalizedRoute, requiredMethod)
      lastState = state
      if (state.route === normalizedRoute && state.methodReady) {
        try {
          const page = await miniProgram.currentPage()
          if (page) return page
        } catch (error) {
          // 新版工具会先广播路由完成，再补齐 webview 元数据；下一轮重试即可。
          lastError = error
        }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${route} 在 ${timeout}ms 内未完成启动${lastState ? `：${JSON.stringify(lastState)}` : lastError ? `：${lastError.message}` : ''}`)
}

// 宿主页面 data（队列、名称）与组件 data（阅读/预览状态）合并，供旧断言继续使用。
async function componentState (page, selector = '#reader') {
  const element = await page.$(selector)
  const own = await page.data()
  const inner = element ? await element.data() : {}
  // Queue state belongs to the host. The reader still has legacy defaults;
  // those must not overwrite the actual visible queue's position/buttons.
  return { ...own, ...inner, queueCount: own.queueCount, queuePosition: own.queuePosition,
    hasPreviousFile: own.hasPreviousFile, hasNextFile: own.hasNextFile }
}

async function screenshot (miniProgram, name) {
  if (!captureScreenshots) return ''
  const outputPath = path.join(outputRoot, name)
  await miniProgram.screenshot({ path: outputPath })
  return outputPath
}

async function readOriginalPath (filePath) {
  return fs.readFile(filePath, 'utf8')
}

async function currentSnapshot (miniProgram) {
  return miniProgram.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1].selectComponent('#reader')
    return {
      data: {
        sourceName: page.data.sourceName,
        hasContent: page.data.hasContent,
        domMode: page.data.domMode,
        error: page.data.error,
        domTreeCount: Array.isArray(page.data.domTree) ? page.data.domTree.length : 0,
        domFrameStyle: page.data.domFrameStyle,
        standaloneSvgPath: page.data.standaloneSvgPath,
        standaloneSvgSource: page.data.standaloneSvgSource ? 'data-uri' : '',
        isLoading: page.data.isLoading
      },
      diagnostics: page.getReaderDiagnostics()
    }
  })
}

async function waitForReady (miniProgram, page, expectedName, timeout = 20000) {
  const startedAt = Date.now()
  let snapshot
  while (Date.now() - startedAt < timeout) {
    snapshot = await currentSnapshot(miniProgram)
    if (snapshot.data.sourceName === expectedName && snapshot.data.error) {
      throw new Error(`${expectedName} 打开失败：${snapshot.data.error}`)
    }
    if (snapshot.data.sourceName === expectedName && snapshot.data.hasContent && !snapshot.data.isLoading) return snapshot
    await page.waitFor(180)
  }
  throw new Error(`${expectedName} 在 ${timeout}ms 内没有结束加载：${JSON.stringify(snapshot)}`)
}

async function scheduleReadMaterial (miniProgram, material, html) {
  const accepted = await miniProgram.evaluate(payload => {
    const pages = getCurrentPages()
    const reader = pages[pages.length - 1].selectComponent('#reader')
    if (!reader || typeof reader.readMaterial !== 'function') return false
    // Give the DevTools automator bridge enough time to send this RPC response
    // before a large synchronous parse starts on the mini-program thread.
    setTimeout(() => reader.readMaterial(payload.material, payload.html), 500)
    return true
  }, { material, html })
  assert.equal(accepted, true, `${material.name} 未能交给阅读页`)
}

async function openSampleReader (miniProgram, homePage) {
  // Reopening index intentionally resumes the current queue (which may be PSD/Ai).
  // Start the next independent scenario through the real home control instead.
  const home = homePage || await reLaunchWhenReady(miniProgram, '/pages/home/home')
  const buttons = await home.$$('.source-button')
  assert.equal(buttons.length, 2, '首页缺少打开示例按钮')
  assert.match(await buttons[1].text(), /打开示例/)
  await buttons[1].tap()
  const started = Date.now()
  while (Date.now() - started < 20000) {
    const page = await miniProgram.currentPage()
    if (page && page.path === 'pages/index/index') {
      await waitForReady(miniProgram, page, 'html-css-js-local-test.html')
      return page
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('首页打开示例按钮未进入阅读页')
}

async function assertHealthy (miniProgram, expectedName) {
  const { data, diagnostics } = await currentSnapshot(miniProgram)
  assert.equal(data.sourceName, expectedName)
  assert.equal(data.hasContent, true)
  assert.equal(data.domMode, true)
  assert.equal(data.error, '')
  assert.ok(data.domTreeCount > 0)
  assert.ok(diagnostics, '开发版诊断接口不可用')
  assert.deepEqual(diagnostics.runtimeErrors, [])
  return { data, diagnostics }
}

async function inject (miniProgram, page, name) {
  return injectPath(miniProgram, page, path.join(materialRoot, name))
}

async function resolveMaterialPath (name, subdirectories = []) {
  const candidates = [materialRoot, ...subdirectories.map(directory => path.join(materialRoot, directory))]
    .map(directory => path.join(directory, name))
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }
  throw new Error(`${name} 不在测试素材目录或候选子目录中：${candidates.join('、')}`)
}

async function injectPath (miniProgram, page, filePath) {
  const name = path.basename(filePath)
  const html = await readOriginalPath(filePath)
  await scheduleReadMaterial(miniProgram, { path: `/__original__/${name}`, name }, html)
  await waitForReady(miniProgram, page, name)
  return assertHealthy(miniProgram, name)
}

async function injectSvgPath (miniProgram, page, filePath) {
  const name = path.basename(filePath)
  const svg = await readOriginalPath(filePath)
  assert.equal(await miniProgram.evaluate((material, svgText) => {
    const pages = getCurrentPages()
    return pages[pages.length - 1].selectComponent('#reader').readSvgMaterial(material, svgText)
  }, { path: `/__original__/${name}`, name }, svg), true)
  await waitForReady(miniProgram, page, name)
  const { data, diagnostics } = await currentSnapshot(miniProgram)
  assert.equal(data.sourceName, name)
  assert.equal(data.hasContent, true)
  assert.equal(data.domMode, false)
  assert.equal(data.error, '')
  assert.equal(data.standaloneSvgSource, 'data-uri')
  assert.ok(diagnostics, '开发版诊断接口不可用')
  return { data, diagnostics }
}

async function tapRequired (miniProgram, page, selector, textIncludes = '') {
  const resolveRuntimeTarget = () => miniProgram.evaluate(({ cssSelector, expectedText }) => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1].selectComponent('#reader')
    const document = page._htmlRuntime && page._htmlRuntime.document
    const node = document && (expectedText
      ? document.querySelectorAll(cssSelector).find(item => item.textContent.includes(expectedText))
      : document.querySelector(cssSelector))
    if (!node) return { found: false }
    return { found: true, nid: node._nid, text: node.textContent }
  }, { cssSelector: selector, expectedText: textIncludes })
  let target = await resolveRuntimeTarget()
  assert.equal(target.found, true, `模拟器运行时中找不到元素：${selector}`)
  const initialNid = target.nid
  const startedAt = Date.now()
  let elements = []
  while (Date.now() - startedAt < 3000) {
    const currentTarget = await resolveRuntimeTarget()
    if (currentTarget.found) target = currentTarget
    elements = await page.$$(`#reader >>> [data-nid="${target.nid}"]`)
    if (elements.length > 0) break
    await page.waitFor(100)
  }
  const waitedMs = Date.now() - startedAt
  if (waitedMs >= 100 || initialNid !== target.nid) {
    console.log(`HTML control view sync: ${selector}${textIncludes ? ` text=${JSON.stringify(textIncludes)}` : ''} waited ${waitedMs}ms, nid ${initialNid} -> ${target.nid}`)
  }
  const element = elements.find(item => item.tagName === 'text') || elements[0]
  if (!element) {
    const expectedView = await page.$(`#reader >>> #dom-nid-${target.nid}`)
    const buttonViews = await page.$$('#reader >>> .dom-button')
    const buttonViewSummary = []
    for (const buttonView of buttonViews.slice(0, 24)) {
      buttonViewSummary.push({
        nid: await buttonView.attribute('data-nid'),
        text: await buttonView.text()
      })
    }
    const runtimeDiagnostics = await miniProgram.evaluate(({ cssSelector, expectedText, nid }) => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const document = reader._htmlRuntime && reader._htmlRuntime.document
      const runtimeNode = document && (expectedText
        ? document.querySelectorAll(cssSelector).find(item => item.textContent.includes(expectedText))
        : document.querySelector(cssSelector))
      const runtimePath = []
      for (let node = runtimeNode; node && runtimePath.length < 20; node = node.parentNode) {
        runtimePath.unshift({ name: node.localName || node.nodeName, nid: node._nid })
      }
      const findSerialized = (value, path = [], depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 40) return null
        if (!Array.isArray(value) && Number(value.nid) === Number(nid)) {
          return {
            path,
            depth,
            name: value.name,
            type: value.type,
            childCount: Array.isArray(value.children) ? value.children.length : 0,
            keys: Object.keys(value)
          }
        }
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index++) {
            const found = findSerialized(value[index], path.concat(index), depth + 1)
            if (found) return found
          }
          return null
        }
        for (const key of Object.keys(value)) {
          const found = findSerialized(value[key], path.concat(key), depth + 1)
          if (found) return found
        }
        return null
      }
      const visibleTextMatches = []
      const collectVisibleText = value => {
        if (!value || typeof value !== 'object' || visibleTextMatches.length >= 12) return
        if (Array.isArray(value)) {
          value.forEach(collectVisibleText)
          return
        }
        if (value.type === 'text' && expectedText && String(value.text || '').includes(expectedText)) {
          const tapNid = value.tapNid
          const live = tapNid != null && reader._htmlRuntime && reader._htmlRuntime.getNode(tapNid)
          visibleTextMatches.push({
            text: value.text,
            tapNid,
            live: Boolean(live),
            liveName: live && (live.localName || live.nodeName),
            liveText: live && live.textContent
          })
        }
        Object.keys(value).forEach(key => collectVisibleText(value[key]))
      }
      collectVisibleText(reader.data.domTree)
      return {
        runtimePath,
        serialized: findSerialized(reader.data.domTree),
        visibleTextMatches
      }
    }, { cssSelector: selector, expectedText: textIncludes, nid: target.nid })
    const renderDiagnostics = {
      ...runtimeDiagnostics,
      expectedViewById: Boolean(expectedView),
      buttonViewSummary
    }
    assert.fail(`模拟器视图中找不到真实控件：${selector} (nid ${target.nid}) ${JSON.stringify(renderDiagnostics)}`)
  }
  assert.equal(element.tagName, 'text', `没有找到可直接点击的文字层：${selector} (nid ${target.nid})`)
  await element.tap()
  await page.waitFor(120)
  return target
}

async function assertCompleteSectionFrame (miniProgram, page, selector) {
  const target = await miniProgram.evaluate(cssSelector => {
    const pages = getCurrentPages()
    const reader = pages[pages.length - 1].selectComponent('#reader')
    const node = reader._htmlRuntime && reader._htmlRuntime.document.querySelector(cssSelector)
    return node ? { nid: node._nid } : null
  }, selector)
  assert.ok(target, `运行时找不到边框元素：${selector}`)
  const elements = await page.$$(`#reader >>> [data-nid="${target.nid}"]`)
  const element = elements.find(item => item.tagName === 'view')
  assert.ok(element, `视图层找不到边框元素：${selector}`)
  const [offset, size, viewportWidth] = await Promise.all([
    element.offset(),
    element.size(),
    miniProgram.evaluate(() => wx.getWindowInfo().windowWidth)
  ])
  assert.ok(offset.left >= 12, `${selector} 左边框贴边：${offset.left}`)
  assert.ok(offset.left + size.width <= viewportWidth - 12, `${selector} 右边框超出：${offset.left + size.width}/${viewportWidth}`)
  return { left: offset.left, right: viewportWidth - offset.left - size.width, width: size.width }
}

async function renderedStylesForSelector (miniProgram, page, selector) {
  const target = await miniProgram.evaluate(cssSelector => {
    const pages = getCurrentPages()
    const reader = pages[pages.length - 1].selectComponent('#reader')
    const node = reader._htmlRuntime && reader._htmlRuntime.document.querySelector(cssSelector)
    return node ? { nid: node._nid } : null
  }, selector)
  assert.ok(target, `运行时找不到样式元素：${selector}`)
  const elements = await page.$$(`#reader >>> [data-nid="${target.nid}"]`)
  assert.ok(elements.length > 0, `视图层找不到样式元素：${selector}`)
  const styles = []
  for (const element of elements) {
    const style = await element.attribute('style')
    if (style) styles.push(style)
  }
  assert.ok(styles.length > 0, `视图层元素没有样式：${selector}`)
  return styles.join(';')
}

async function main () {
  await fs.mkdir(outputRoot, { recursive: true })
  const artifacts = []
  let miniProgram
  try {
    miniProgram = await connectSimulator()
    const homePage = await reLaunchWhenReady(miniProgram, '/pages/home/home')
    await homePage.waitFor(500)
    const simulatorIdentity = await miniProgram.evaluate(() => {
      const account = wx.getAccountInfoSync()
      return {
        appid: account && account.miniProgram && account.miniProgram.appId,
        envVersion: account && account.miniProgram && account.miniProgram.envVersion
      }
    })
    // 稳定版开发者工具 2.02.2608040 的 automation 会在已正确加载项目时
    // 仍把 wx.getAccountInfoSync().miniProgram.appId 返回为空。非空时继续做
    // 严格一致性校验；为空时以已通过生产配置检查的 project.config.json 为准。
    assert.ok(/^wx[0-9a-f]+$/i.test(projectAppId), '项目配置缺少有效 AppID')
    if (simulatorIdentity.appid) assert.equal(simulatorIdentity.appid, projectAppId, '微信模拟器 AppID 与项目配置不一致')
    assert.equal(simulatorIdentity.envVersion, 'develop', '微信模拟器不是开发版环境')
    const shareButton = await homePage.$('.share-button')
    assert.ok(shareButton, '微信模拟器首页中找不到分享按钮')
    assert.equal(await shareButton.attribute('open-type'), 'share')
    // 2.02.2608040 在 automation 截取首页后会让后续 reLaunch 固定回首页。
    // 首页分享已用真实节点断言；先进入阅读页，再连续截取本轮关注的内容页。

    let page = await openSampleReader(miniProgram, homePage)
    await page.waitFor(500)

    const rarFixture = await compressedRarFixtureBase64()
    const rarStarted = await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      return pages[pages.length - 1].selectComponent('#reader').startRarRuntimeProbeForDevelopment(fixture)
    }, rarFixture)
    assert.equal(rarStarted.state, 'running', 'RAR 微信运行层探针没有启动')
    let rarRuntime
    const rarStartedAt = Date.now()
    while (Date.now() - rarStartedAt < 20000) {
      rarRuntime = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        return pages[pages.length - 1].selectComponent('#reader')._rarRuntimeProbe || null
      })
      if (rarRuntime && rarRuntime.state !== 'running') break
      await page.waitFor(250)
    }
    assert.ok(rarRuntime, 'RAR 微信运行层探针没有返回结果')
    assert.equal(rarRuntime.state, 'done', `RAR 微信运行层解压失败：${JSON.stringify(rarRuntime)}`)
    assert.equal(rarRuntime.method, 'Normal')
    assert.equal(rarRuntime.length, 1049076)

    const sevenZipFixture = await compressedSevenZipFixtureBase64()
    const sevenZipStarted = await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      return pages[pages.length - 1].selectComponent('#reader').startSevenZipRuntimeProbeForDevelopment(fixture)
    }, sevenZipFixture)
    assert.equal(sevenZipStarted.state, 'running', '7z 微信运行层探针没有启动')
    let sevenZipRuntime
    const sevenZipStartedAt = Date.now()
    while (Date.now() - sevenZipStartedAt < 30000) {
      sevenZipRuntime = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        return pages[pages.length - 1].selectComponent('#reader')._sevenZipRuntimeProbe || null
      })
      if (sevenZipRuntime && sevenZipRuntime.state !== 'running') break
      await page.waitFor(250)
    }
    assert.ok(sevenZipRuntime, '7z 微信运行层探针没有返回结果')
    assert.equal(sevenZipRuntime.state, 'done', `7z 微信运行层解压失败：${JSON.stringify(sevenZipRuntime)}`)
    assert.equal(sevenZipRuntime.method, 'LZMA2:15')
    assert.equal(sevenZipRuntime.length, 31000)

    const sevenZipPageOpened = await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-automation.7z`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-真实内容.7z', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/x-7z-compressed' })
      return true
    }, sevenZipFixture)
    assert.equal(sevenZipPageOpened, true)
    let sevenZipPage
    const sevenZipPageStartedAt = Date.now()
    while (Date.now() - sevenZipPageStartedAt < 15000) {
      sevenZipPage = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const reader = pages[pages.length - 1].selectComponent('#reader')
        return {
          inspectorMode: reader.data.inspectorMode,
          isLoading: reader.data.isLoading,
          error: reader.data.error,
          title: reader.data.inspectorTitle,
          entries: reader.data.inspectorEntries
        }
      })
      if (sevenZipPage.error || (sevenZipPage.inspectorMode && !sevenZipPage.isLoading && sevenZipPage.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(sevenZipPage.error, '')
    assert.equal(sevenZipPage.title, '7z 压缩包')
    const sevenZipEntryIndex = sevenZipPage.entries.findIndex(entry => entry.name === '资料/说明.txt' && entry.canOpen)
    assert.ok(sevenZipEntryIndex >= 0, '7z 页面目录里没有可打开的中文正文')
    assert.equal(await miniProgram.evaluate(index => {
      const pages = getCurrentPages()
      pages[pages.length - 1].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } })
      return true
    }, sevenZipEntryIndex), true)
    const sevenZipOpened = await waitForReady(miniProgram, page, '说明.txt', 15000)
    assert.equal(sevenZipOpened.data.domMode, true)
    assert.equal(await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      return /这是 7z 里的真实正文/.test(pages[pages.length - 1].selectComponent('#reader')._staticHtmlFallback || '')
    }), true)

    assert.equal(await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = new Uint8Array(wx.base64ToArrayBuffer(fixture))
      const partSize = Math.ceil(archive.length / 3)
      const queue = []
      for (let index = 0; index < 3; index++) {
        const part = archive.slice(index * partSize, Math.min(archive.length, (index + 1) * partSize))
        const name = `自动化-分卷.7z.${String(index + 1).padStart(3, '0')}`
        const filePath = `${wx.env.USER_DATA_PATH}/${name}`
        wx.getFileSystemManager().writeFileSync(filePath, part.buffer)
        queue.push({ name, path: filePath, tempFilePath: filePath, size: part.byteLength, type: 'application/octet-stream' })
      }
      getApp().globalData.fileQueue = queue
      getApp().globalData.fileQueueIndex = 0
      reader.open(queue[0], queue)
      return true
    }, sevenZipFixture), true)
    let sevenZipVolumeState
    const sevenZipVolumeStartedAt = Date.now()
    while (Date.now() - sevenZipVolumeStartedAt < 15000) {
      sevenZipVolumeState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const volumeCount = (reader.data.inspectorMetadata || []).find(item => item.label === '分卷数量')
        return {
          isLoading: reader.data.isLoading,
          error: reader.data.error,
          title: reader.data.inspectorTitle,
          entries: reader.data.inspectorEntries,
          volumeCount: volumeCount ? volumeCount.value : ''
        }
      })
      if (sevenZipVolumeState.error || (!sevenZipVolumeState.isLoading && sevenZipVolumeState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(sevenZipVolumeState.error, '')
    assert.equal(sevenZipVolumeState.title, '7z 分卷压缩包')
    assert.equal(sevenZipVolumeState.volumeCount, '3')
    const sevenZipVolumeEntryIndex = sevenZipVolumeState.entries.findIndex(entry => entry.name === '资料/说明.txt' && entry.canOpen)
    assert.ok(sevenZipVolumeEntryIndex >= 0, '7z 分卷目录里没有可打开的中文正文')
    await miniProgram.evaluate(index => getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } }), sevenZipVolumeEntryIndex)
    await waitForReady(miniProgram, page, '说明.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /这是 7z 里的真实正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const zip64VolumeArchive = forceZip64Archive(BZIP2_LINK_ZIP)
    const zip64VolumePartSize = Math.ceil(zip64VolumeArchive.length / 3)
    const zip64VolumeFixture = Array.from({ length: 3 }, (_, index) => ({
      name: `automation-linked.zip.${String(index + 1).padStart(3, '0')}`,
      bytes: zip64VolumeArchive.subarray(index * zip64VolumePartSize, Math.min(zip64VolumeArchive.length, (index + 1) * zip64VolumePartSize))
    }))
    const openZip64Volume = async () => {
      await miniProgram.evaluate(volumes => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const queue = volumes.map(volume => {
          const bytes = wx.base64ToArrayBuffer(volume.base64)
          const filePath = `${wx.env.USER_DATA_PATH}/${volume.name}`
          wx.getFileSystemManager().writeFileSync(filePath, bytes)
          return { name: volume.name, path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/octet-stream' }
        })
        getApp().globalData.fileQueue = queue
        getApp().globalData.fileQueueIndex = 0
        reader.open(queue[0], queue)
      }, zip64VolumeFixture.map(volume => ({ name: volume.name, base64: volume.bytes.toString('base64') })))
      let state
      const startedAt = Date.now()
      while (Date.now() - startedAt < 15000) {
        state = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return { isLoading: reader.data.isLoading, error: reader.data.error, title: reader.data.inspectorTitle, entries: reader.data.inspectorEntries }
        })
        if (state.error || (!state.isLoading && state.entries.length)) break
        await page.waitFor(250)
      }
      assert.equal(state.error, '')
      assert.equal(state.title, 'ZIP 分卷压缩包')
      const index = state.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
      assert.ok(index >= 0, 'ZIP64 数字分卷目录没有显示可打开链接')
      const rows = await page.$$('#reader >>> .entry-row')
      await rows[index].tap()
      await waitForReady(miniProgram, page, 'page.html', 15000)
      assert.match(await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || ''), /链接成员BZip2真实正文/)
      return state
    }
    const zip64VolumeFirstState = await openZip64Volume()
    const zip64VolumeSecondState = await openZip64Volume()

    const classicZipVolumeParts = splitClassicZip(BZIP2_LINK_ZIP, [67, 134])
    const classicZipVolumeFixture = classicZipVolumeParts.map((bytes, index) => ({
      name: index === classicZipVolumeParts.length - 1 ? 'automation-classic.zip' : `automation-classic.z${String(index + 1).padStart(2, '0')}`,
      bytes
    }))
    const openClassicZipVolume = async () => {
      await miniProgram.evaluate(volumes => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const queue = volumes.map(volume => {
          const bytes = wx.base64ToArrayBuffer(volume.base64)
          const filePath = `${wx.env.USER_DATA_PATH}/${volume.name}`
          wx.getFileSystemManager().writeFileSync(filePath, bytes)
          return { name: volume.name, path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/octet-stream' }
        })
        getApp().globalData.fileQueue = queue
        getApp().globalData.fileQueueIndex = queue.length - 1
        reader.open(queue[queue.length - 1], queue)
      }, classicZipVolumeFixture.map(volume => ({ name: volume.name, base64: volume.bytes.toString('base64') })))
      let state
      const startedAt = Date.now()
      while (Date.now() - startedAt < 15000) {
        state = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return { isLoading: reader.data.isLoading, error: reader.data.error, title: reader.data.inspectorTitle, entries: reader.data.inspectorEntries }
        })
        if (state.error || (!state.isLoading && state.entries.length)) break
        await page.waitFor(250)
      }
      assert.equal(state.error, '')
      assert.equal(state.title, 'ZIP 分卷压缩包')
      const index = state.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
      assert.ok(index >= 0, '经典 ZIP 分卷目录没有显示可打开链接')
      const rows = await page.$$('#reader >>> .entry-row')
      assert.ok(rows[index], '经典 ZIP 分卷链接没有可点击的真实 WXML 行')
      await rows[index].tap()
      await waitForReady(miniProgram, page, 'page.html', 15000)
      assert.match(await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || ''), /链接成员BZip2真实正文/)
      return state
    }
    const classicZipFirstState = await openClassicZipVolume()
    const classicZipSecondState = await openClassicZipVolume()
    const classicZipStoredBytes = await miniProgram.evaluate(names => names.map(name => {
      const bytes = wx.getFileSystemManager().readFileSync(`${wx.env.USER_DATA_PATH}/${name}`)
      return wx.arrayBufferToBase64(bytes)
    }), classicZipVolumeFixture.map(volume => volume.name))
    assert.deepEqual(classicZipStoredBytes, classicZipVolumeFixture.map(volume => volume.bytes.toString('base64')), '经典 ZIP 分卷连续打开不得改写用户文件')

    const classicZip64VolumeParts = splitClassicZip64(forceZip64Archive(BZIP2_LINK_ZIP), [67, 134])
    const classicZip64VolumeFixture = classicZip64VolumeParts.map((bytes, index) => ({
      name: index === classicZip64VolumeParts.length - 1 ? 'automation-classic64.zip' : `automation-classic64.z${String(index + 1).padStart(2, '0')}`,
      bytes
    }))
    const openClassicZip64Volume = async () => {
      await miniProgram.evaluate(volumes => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const queue = volumes.map(volume => {
          const bytes = wx.base64ToArrayBuffer(volume.base64)
          const filePath = `${wx.env.USER_DATA_PATH}/${volume.name}`
          wx.getFileSystemManager().writeFileSync(filePath, bytes)
          return { name: volume.name, path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/octet-stream' }
        })
        getApp().globalData.fileQueue = queue
        getApp().globalData.fileQueueIndex = queue.length - 1
        reader.open(queue[queue.length - 1], queue)
      }, classicZip64VolumeFixture.map(volume => ({ name: volume.name, base64: volume.bytes.toString('base64') })))
      let state
      const startedAt = Date.now()
      while (Date.now() - startedAt < 15000) {
        state = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return { isLoading: reader.data.isLoading, error: reader.data.error, title: reader.data.inspectorTitle, entries: reader.data.inspectorEntries }
        })
        if (state.error || (!state.isLoading && state.entries.length)) break
        await page.waitFor(250)
      }
      assert.equal(state.error, '')
      assert.equal(state.title, 'ZIP 分卷压缩包')
      const index = state.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
      assert.ok(index >= 0, 'ZIP64 经典分卷目录没有显示可打开链接')
      const rows = await page.$$('#reader >>> .entry-row')
      assert.ok(rows[index], 'ZIP64 经典分卷链接没有可点击的真实 WXML 行')
      await rows[index].tap()
      await waitForReady(miniProgram, page, 'page.html', 15000)
      assert.match(await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || ''), /链接成员BZip2真实正文/)
      return state
    }
    const classicZip64FirstState = await openClassicZip64Volume()
    const classicZip64SecondState = await openClassicZip64Volume()
    const classicZip64StoredBytes = await miniProgram.evaluate(names => names.map(name => {
      const bytes = wx.getFileSystemManager().readFileSync(`${wx.env.USER_DATA_PATH}/${name}`)
      return wx.arrayBufferToBase64(bytes)
    }), classicZip64VolumeFixture.map(volume => volume.name))
    assert.deepEqual(classicZip64StoredBytes, classicZip64VolumeFixture.map(volume => volume.bytes.toString('base64')), 'ZIP64 经典分卷连续打开不得改写用户文件')

    const { rar5HeaderEncryptedVolumeLinks, rar5VolumeLinks } = require('../tests/helpers/rar-links')
    const rarVolumeLinkFixture = rar5VolumeLinks()
    await miniProgram.evaluate(volumes => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const queue = volumes.map(volume => {
        const bytes = wx.base64ToArrayBuffer(volume.base64)
        const filePath = `${wx.env.USER_DATA_PATH}/${volume.name}`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        return { name: volume.name, path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/vnd.rar' }
      })
      getApp().globalData.fileQueue = queue
      getApp().globalData.fileQueueIndex = 0
      reader.open(queue[0], queue)
    }, rarVolumeLinkFixture.map(volume => ({ name: volume.name, base64: volume.bytes.toString('base64') })))
    let rarVolumeLinkState
    const rarVolumeLinkStartedAt = Date.now()
    while (Date.now() - rarVolumeLinkStartedAt < 15000) {
      rarVolumeLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { isLoading: reader.data.isLoading, error: reader.data.error, title: reader.data.inspectorTitle, entries: reader.data.inspectorEntries }
      })
      if (rarVolumeLinkState.error || (!rarVolumeLinkState.isLoading && rarVolumeLinkState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(rarVolumeLinkState.error, '')
    assert.equal(rarVolumeLinkState.title, 'RAR 分卷压缩包')
    const rarVolumeLinkIndex = rarVolumeLinkState.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
    assert.ok(rarVolumeLinkIndex >= 0, 'RAR 分卷目录没有显示可打开链接')
    const rarVolumeLinkRows = await page.$$('#reader >>> .entry-row')
    await rarVolumeLinkRows[rarVolumeLinkIndex].tap()
    await waitForReady(miniProgram, page, 'page.html', 15000)
    const rarVolumeLinkContent = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
    assert.match(rarVolumeLinkContent, /分卷链接真实正文/)

    const encryptedRarVolumeLinkFixture = rar5HeaderEncryptedVolumeLinks()
    await miniProgram.evaluate(volumes => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const queue = volumes.map(volume => {
        const bytes = wx.base64ToArrayBuffer(volume.base64)
        const filePath = `${wx.env.USER_DATA_PATH}/${volume.name}`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        return { name: volume.name, path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/vnd.rar' }
      })
      getApp().globalData.fileQueue = queue
      getApp().globalData.fileQueueIndex = 0
      reader.open(queue[0], queue)
    }, encryptedRarVolumeLinkFixture.map(volume => ({ name: volume.name, base64: volume.bytes.toString('base64') })))
    let encryptedRarVolumeLinkState
    const encryptedRarVolumeLinkLockedAt = Date.now()
    while (Date.now() - encryptedRarVolumeLinkLockedAt < 15000) {
      encryptedRarVolumeLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { title: reader.data.inspectorTitle, needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, error: reader.data.error }
      })
      if (encryptedRarVolumeLinkState.error || (encryptedRarVolumeLinkState.needsPassword && !encryptedRarVolumeLinkState.isLoading)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarVolumeLinkState.error, '')
    assert.equal(encryptedRarVolumeLinkState.title, 'RAR 加密分卷压缩包')
    assert.equal(encryptedRarVolumeLinkState.needsPassword, true)
    await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      reader.onArchivePasswordInput({ detail: { value: '1234' } })
      reader.unlockArchive()
    })
    const encryptedRarVolumeLinkUnlockedAt = Date.now()
    while (Date.now() - encryptedRarVolumeLinkUnlockedAt < 15000) {
      encryptedRarVolumeLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, status: reader.data.inspectorPasswordStatus, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (encryptedRarVolumeLinkState.error || encryptedRarVolumeLinkState.status || (!encryptedRarVolumeLinkState.needsPassword && !encryptedRarVolumeLinkState.isLoading && encryptedRarVolumeLinkState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarVolumeLinkState.error, '')
    assert.equal(encryptedRarVolumeLinkState.status, '')
    const encryptedRarVolumeLinkIndex = encryptedRarVolumeLinkState.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
    assert.ok(encryptedRarVolumeLinkIndex >= 0, 'RAR 加密分卷解锁后没有显示可打开链接')
    const encryptedRarVolumeLinkRows = await page.$$('#reader >>> .entry-row')
    await encryptedRarVolumeLinkRows[encryptedRarVolumeLinkIndex].tap()
    await waitForReady(miniProgram, page, 'page.html', 15000)
    const encryptedRarVolumeLinkContent = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
    assert.match(encryptedRarVolumeLinkContent, /加密分卷链接真实正文/)

    const encryptedRarFixture = await headerEncryptedRarFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-encrypted.rar`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-加密.rar', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/vnd.rar' })
      return true
    }, encryptedRarFixture), true)
    let encryptedRarState
    const encryptedRarStartedAt = Date.now()
    while (Date.now() - encryptedRarStartedAt < 15000) {
      encryptedRarState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { title: reader.data.inspectorTitle, needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (encryptedRarState.error || (encryptedRarState.needsPassword && !encryptedRarState.isLoading)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarState.error, '')
    assert.equal(encryptedRarState.title, 'RAR 加密压缩包')
    assert.equal(encryptedRarState.needsPassword, true)
    assert.equal(await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      reader.onArchivePasswordInput({ detail: { value: '1234' } })
      reader.unlockArchive()
      return true
    }), true)
    const encryptedRarUnlockedAt = Date.now()
    while (Date.now() - encryptedRarUnlockedAt < 15000) {
      encryptedRarState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, status: reader.data.inspectorPasswordStatus, entries: reader.data.inspectorEntries }
      })
      if (encryptedRarState.status || (!encryptedRarState.needsPassword && !encryptedRarState.isLoading && encryptedRarState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarState.status, '')
    const encryptedRarEntryIndex = encryptedRarState.entries.findIndex(entry => entry.name === '1File.txt' && entry.canOpen)
    assert.ok(encryptedRarEntryIndex >= 0, 'RAR 输入密码后没有出现可打开正文')
    await miniProgram.evaluate(index => {
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } })
    }, encryptedRarEntryIndex)
    await waitForReady(miniProgram, page, '1File.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /1File/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const { rar5HeaderEncryptedLinks } = require('../tests/helpers/rar-links')
    const encryptedRarLinkFixture = rar5HeaderEncryptedLinks([
      { name: 'docs/page.html', content: '<!doctype html><h1>加密头部链接真实正文</h1>' },
      { name: 'shortcut', target: 'docs/page.html' }
    ])
    await miniProgram.evaluate(base64 => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(base64)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-encrypted-link.rar`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-加密链接.rar', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/vnd.rar' })
    }, encryptedRarLinkFixture.toString('base64'))
    let encryptedRarLinkState
    const encryptedRarLinkLockedAt = Date.now()
    while (Date.now() - encryptedRarLinkLockedAt < 15000) {
      encryptedRarLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (encryptedRarLinkState.error || (encryptedRarLinkState.needsPassword && !encryptedRarLinkState.isLoading)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarLinkState.error, '')
    assert.equal(encryptedRarLinkState.needsPassword, true)
    await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      reader.onArchivePasswordInput({ detail: { value: '1234' } })
      reader.unlockArchive()
    })
    const encryptedRarLinkUnlockedAt = Date.now()
    while (Date.now() - encryptedRarLinkUnlockedAt < 15000) {
      encryptedRarLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, status: reader.data.inspectorPasswordStatus, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (encryptedRarLinkState.error || encryptedRarLinkState.status || (!encryptedRarLinkState.needsPassword && !encryptedRarLinkState.isLoading && encryptedRarLinkState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedRarLinkState.error, '')
    assert.equal(encryptedRarLinkState.status, '')
    const encryptedRarLinkIndex = encryptedRarLinkState.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink)
    assert.ok(encryptedRarLinkIndex >= 0, 'RAR 加密头部解锁后没有保留链接类型')
    const encryptedRarLinkRows = await page.$$('#reader >>> .entry-row')
    await encryptedRarLinkRows[encryptedRarLinkIndex].tap()
    await waitForReady(miniProgram, page, 'page.html', 15000)
    const encryptedRarLinkContent = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
    assert.match(encryptedRarLinkContent, /加密头部链接真实正文/)

    const encryptedSevenZipFixture = await encryptedSevenZipFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-encrypted.7z`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-加密.7z', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/x-7z-compressed' })
      return true
    }, encryptedSevenZipFixture), true)
    let encryptedSevenZipState
    const encryptedSevenZipStartedAt = Date.now()
    while (Date.now() - encryptedSevenZipStartedAt < 15000) {
      encryptedSevenZipState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { title: reader.data.inspectorTitle, needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (encryptedSevenZipState.error || (encryptedSevenZipState.needsPassword && !encryptedSevenZipState.isLoading)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedSevenZipState.error, '')
    assert.equal(encryptedSevenZipState.title, '7z 加密压缩包')
    assert.equal(encryptedSevenZipState.needsPassword, true)
    assert.equal(await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      reader.onArchivePasswordInput({ detail: { value: 'test-兔子-147' } })
      reader.unlockArchive()
      return true
    }), true)
    const encryptedSevenZipUnlockedAt = Date.now()
    while (Date.now() - encryptedSevenZipUnlockedAt < 15000) {
      encryptedSevenZipState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, status: reader.data.inspectorPasswordStatus, entries: reader.data.inspectorEntries }
      })
      if (encryptedSevenZipState.status || (!encryptedSevenZipState.needsPassword && !encryptedSevenZipState.isLoading && encryptedSevenZipState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(encryptedSevenZipState.status, '')
    const encryptedSevenZipEntryIndex = encryptedSevenZipState.entries.findIndex(entry => entry.name === '说明.txt' && entry.canOpen)
    assert.ok(encryptedSevenZipEntryIndex >= 0, '7z 输入密码后没有出现可打开正文')
    await miniProgram.evaluate(index => {
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } })
    }, encryptedSevenZipEntryIndex)
    await waitForReady(miniProgram, page, '说明.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /加密压缩包里的真实正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const aesZipFixture = await zipCompatibilityFixtureBase64('AES_ZIP')
    assert.equal(await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-aes.zip`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-AES.zip', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
      return true
    }, aesZipFixture), true)
    let aesZipState
    const aesZipStartedAt = Date.now()
    while (Date.now() - aesZipStartedAt < 15000) {
      aesZipState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { title: reader.data.inspectorTitle, needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (aesZipState.error || (aesZipState.needsPassword && !aesZipState.isLoading)) break
      await page.waitFor(250)
    }
    assert.equal(aesZipState.error, '')
    assert.equal(aesZipState.title, 'ZIP 压缩包')
    assert.equal(aesZipState.needsPassword, true)
    await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      reader.onArchivePasswordInput({ detail: { value: 'zip-rabbit-149' } })
      reader.unlockArchive()
    })
    const aesZipUnlockedAt = Date.now()
    while (Date.now() - aesZipUnlockedAt < 15000) {
      aesZipState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { needsPassword: reader.data.inspectorNeedsPassword, isLoading: reader.data.isLoading, status: reader.data.inspectorPasswordStatus, entries: reader.data.inspectorEntries }
      })
      if (aesZipState.status || (!aesZipState.needsPassword && !aesZipState.isLoading && aesZipState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(aesZipState.status, '')
    const aesZipEntryIndex = aesZipState.entries.findIndex(entry => entry.name === '说明.txt' && entry.canOpen)
    assert.ok(aesZipEntryIndex >= 0, 'AES ZIP 解锁后没有可打开正文')
    await miniProgram.evaluate(index => getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } }), aesZipEntryIndex)
    await waitForReady(miniProgram, page, '说明.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /加密 ZIP 里的真实正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const bzip2ZipFixture = await zipCompatibilityFixtureBase64('BZIP2_ZIP')
    await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-bzip2.zip`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-BZip2.zip', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
    }, bzip2ZipFixture)
    let bzip2ZipState
    const bzip2ZipStartedAt = Date.now()
    while (Date.now() - bzip2ZipStartedAt < 15000) {
      bzip2ZipState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { title: reader.data.inspectorTitle, isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries }
      })
      if (bzip2ZipState.error || (!bzip2ZipState.isLoading && bzip2ZipState.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(bzip2ZipState.error, '')
    const bzip2ZipEntryIndex = bzip2ZipState.entries.findIndex(entry => entry.name === '说明.txt' && entry.canOpen && /BZip2/i.test(entry.method))
    assert.ok(bzip2ZipEntryIndex >= 0, 'BZip2 ZIP 没有被兼容内核列为可打开正文')
    await miniProgram.evaluate(index => getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } }), bzip2ZipEntryIndex)
    await waitForReady(miniProgram, page, '说明.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /BZip2 ZIP 里的真实正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const bzip2LinkFixture = BZIP2_LINK_ZIP.toString('base64')
    let bzip2LinkState
    for (let attempt = 0; attempt < 2; attempt++) {
      await miniProgram.evaluate(fixture => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const archive = wx.base64ToArrayBuffer(fixture)
        const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-bzip2-link.zip`
        wx.getFileSystemManager().writeFileSync(filePath, archive)
        reader.openSelectedFile({ name: '自动化-BZip2-包内链接.zip', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
      }, bzip2LinkFixture)
      const startedAt = Date.now()
      while (Date.now() - startedAt < 15000) {
        bzip2LinkState = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return { isLoading: reader.data.isLoading, error: reader.data.error, entries: reader.data.inspectorEntries, runtimeErrors: reader._runtimeErrors || [] }
        })
        if (bzip2LinkState.error || (!bzip2LinkState.isLoading && bzip2LinkState.entries.length)) break
        await page.waitFor(200)
      }
      assert.equal(bzip2LinkState.error, '')
      assert.deepEqual(bzip2LinkState.runtimeErrors, [])
      const linkIndex = bzip2LinkState.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink && entry.canOpen)
      assert.ok(linkIndex >= 0, '兼容内核 ZIP 链接没有进入真实 WXML 目录')
      const rows = await page.$$('#reader >>> .entry-row')
      assert.ok(rows[linkIndex], '兼容内核 ZIP 链接没有可点击的真实 WXML 行')
      await rows[linkIndex].tap()
      await waitForReady(miniProgram, page, 'page.html', 15000)
      bzip2LinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { content: reader._staticHtmlFallback || '', visibleText: reader._htmlRuntime && reader._htmlRuntime.document.body.textContent || '', runtimeErrors: reader._runtimeErrors || [] }
      })
      assert.ok(bzip2LinkState.content.includes('链接成员BZip2真实正文'))
      assert.doesNotMatch(bzip2LinkState.visibleText.trim(), /^docs\/page\.html$/)
      assert.deepEqual(bzip2LinkState.runtimeErrors, [])
    }

    const legacyBzip2Name = '한글/읽기.txt'
    const legacyBzip2Fixture = zipLegacyBzip2FixtureBase64(legacyBzip2Name, 'cp949')
    await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-legacy-bzip2.zip`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-旧编码-BZip2.zip', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
    }, legacyBzip2Fixture)
    let legacyBzip2State
    const legacyBzip2StartedAt = Date.now()
    while (Date.now() - legacyBzip2StartedAt < 15000) {
      legacyBzip2State = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { isLoading: reader.data.isLoading, error: reader.data.error, encoding: reader.data.inspectorNameEncoding, options: reader.data.inspectorNameEncodingOptions, entries: reader.data.inspectorEntries }
      })
      if (legacyBzip2State.error || (!legacyBzip2State.isLoading && legacyBzip2State.entries.length)) break
      await page.waitFor(250)
    }
    assert.equal(legacyBzip2State.error, '')
    assert.equal(legacyBzip2State.encoding, '自动（UTF-8 / CP437）')
    assert.ok(legacyBzip2State.options.some(option => option.value === 'cp949'))
    const legacyBzip2Encoding = await page.$('#reader >>> .archive-name-encoding-cp949')
    assert.ok(legacyBzip2Encoding, '兼容内核 ZIP 没有保留韩文编码按钮')
    await legacyBzip2Encoding.tap()
    await page.waitFor(150)
    legacyBzip2State = await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      return { error: reader.data.error, encoding: reader.data.inspectorNameEncoding, entries: reader.data.inspectorEntries }
    })
    assert.equal(legacyBzip2State.error, '')
    assert.equal(legacyBzip2State.encoding, '韩文 CP949 / EUC-KR')
    const legacyBzip2EntryIndex = legacyBzip2State.entries.findIndex(entry => entry.name === legacyBzip2Name && entry.canOpen && /BZip2/i.test(entry.method))
    assert.ok(legacyBzip2EntryIndex >= 0, '兼容内核没有按 CP949 显示 BZip2 ZIP 条目')
    await miniProgram.evaluate(index => getCurrentPages().slice(-1)[0].selectComponent('#reader').openInspectorEntry({ currentTarget: { dataset: { index } } }), legacyBzip2EntryIndex)
    await waitForReady(miniProgram, page, '읽기.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /BZip2 ZIP 里的真实正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const zipLegacyFilenameFixture = zipLegacyFilenameFixtureBase64()
    await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-legacy-filenames.zip`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      reader.openSelectedFile({ name: '自动化-旧式文件名.zip', path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
    }, zipLegacyFilenameFixture)
    const readZipFilenameState = () => miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      return {
        isLoading: reader.data.isLoading,
        error: reader.data.error,
        encoding: reader.data.inspectorNameEncoding,
        options: reader.data.inspectorNameEncodingOptions,
        names: reader.data.inspectorEntries.map(entry => entry.name)
      }
    })
    let zipFilenameState
    const zipFilenameStartedAt = Date.now()
    while (Date.now() - zipFilenameStartedAt < 8000) {
      zipFilenameState = await readZipFilenameState()
      if (zipFilenameState.error || (!zipFilenameState.isLoading && zipFilenameState.names.length)) break
      await page.waitFor(150)
    }
    assert.equal(zipFilenameState.error, '')
    assert.equal(zipFilenameState.encoding, '自动（UTF-8 / CP437）')
    assert.deepEqual(zipFilenameState.options.map(item => item.value), ['auto', 'utf-8', 'cp437', 'gb18030', 'shift_jis', 'cp949', 'big5'])
    assert.deepEqual(zipFilenameState.names, ['ascii.txt', 'Ölfässer.txt', '€_for_Dollar.txt'])
    let zipFilenameToggle = await page.$('#reader >>> .archive-name-encoding-gb18030')
    assert.ok(zipFilenameToggle, 'ZIP GBK 编码按钮没有进入真实 WXML')
    await zipFilenameToggle.tap()
    await page.waitFor(150)
    zipFilenameState = await readZipFilenameState()
    assert.equal(zipFilenameState.encoding, 'GBK')
    assert.deepEqual(zipFilenameState.names, ['ascii.txt', '€_for_Dollar.txt', '檒f剆ser.txt'])
    zipFilenameToggle = await page.$('#reader >>> .archive-name-encoding-cp437')
    assert.ok(zipFilenameToggle, 'ZIP CP437 编码恢复按钮没有进入真实 WXML')
    await zipFilenameToggle.tap()
    await page.waitFor(150)
    zipFilenameState = await readZipFilenameState()
    assert.equal(zipFilenameState.encoding, 'ZIP 标准 CP437')
    assert.deepEqual(zipFilenameState.names, ['ascii.txt', 'Ölfässer.txt', '€_for_Dollar.txt'])

    const verifyLegacyCjkZip = async ({ name, encoding, expectedLabel, expectedAutoName, openEntry = false }) => {
      const fixture = zipLegacyCjkFixtureBase64(name, encoding)
      await miniProgram.evaluate((base64, fileName) => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const archive = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-${fileName}`
        wx.getFileSystemManager().writeFileSync(filePath, archive)
        reader.openSelectedFile({ name: fileName, path: filePath, tempFilePath: filePath, size: archive.byteLength, type: 'application/zip' })
      }, fixture, `${encoding}.zip`)
      const startedAt = Date.now()
      let state
      while (Date.now() - startedAt < 8000) {
        state = await readZipFilenameState()
        if (state.error || (!state.isLoading && state.names.length)) break
        await page.waitFor(150)
      }
      assert.equal(state.error, '')
      if (expectedAutoName) {
        assert.equal(state.encoding, '自动（UTF-8 / CP437）')
        assert.ok(state.names.includes(expectedAutoName), 'ZIP 自动模式没有保留可读 UTF-8 名称')
      }
      const choice = await page.$(`#reader >>> .archive-name-encoding-${encoding}`)
      assert.ok(choice, `${expectedLabel} 编码按钮没有进入真实 WXML`)
      await choice.tap()
      await page.waitFor(150)
      state = await readZipFilenameState()
      assert.equal(state.encoding, expectedLabel)
      assert.ok(state.names.includes(name), `${expectedLabel} 没有显示标准文件名 ${name}`)
      if (openEntry) {
        const entry = await page.$('#reader >>> .entry-row-actionable')
        assert.ok(entry, `${expectedLabel} 没有可点击的真实 ZIP 条目`)
        await entry.tap()
        const basename = name.split('/').pop()
        await waitForReady(miniProgram, page, basename, 15000)
        assert.equal(await miniProgram.evaluate(expected => (getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '').includes(expected), `${name} 正文`), true)
      }
      return state
    }
    const zipCp437SymbolsState = await verifyLegacyCjkZip({ name: 'symbols/╡╢╖╕αΓπΣΩ∞.txt', encoding: 'cp437', expectedLabel: 'ZIP 标准 CP437' })
    const zipShiftJisState = await verifyLegacyCjkZip({ name: '日本語/設計資料.txt', encoding: 'shift_jis', expectedLabel: '日文 Shift_JIS' })
    const zipCp949State = await verifyLegacyCjkZip({ name: '한글/폴더/읽기.txt', encoding: 'cp949', expectedLabel: '韩文 CP949 / EUC-KR', openEntry: true })
    const zipBig5State = await verifyLegacyCjkZip({ name: '繁體中文/設計圖.ai', encoding: 'big5', expectedLabel: '繁体 Big5' })

    const zipAmbiguousStates = []
    await verifyLegacyCjkZip({ name: 'nested/symbol-┬Ñ.txt', encoding: 'cp437', expectedLabel: 'ZIP 标准 CP437', expectedAutoName: 'nested/symbol-¥.txt' })
    for (const encoding of ['utf-8', 'auto', 'cp437']) {
      const choice = await page.$(`#reader >>> .archive-name-encoding-${encoding}`)
      assert.ok(choice, `ZIP ${encoding} 选择按钮没有上屏`)
      await choice.tap()
      await page.waitFor(150)
      const state = await readZipFilenameState()
      assert.equal(state.error, '')
      assert.ok(state.names.includes(encoding === 'cp437' ? 'nested/symbol-┬Ñ.txt' : 'nested/symbol-¥.txt'))
      assert.deepEqual(state.options.filter(item => item.active).map(item => item.value), [encoding])
      zipAmbiguousStates.push(state)
    }
    const ambiguousEntry = await page.$('#reader >>> .entry-row-actionable')
    assert.ok(ambiguousEntry, 'ZIP 切换编码后没有真实可打开条目')
    await ambiguousEntry.tap()
    await waitForReady(miniProgram, page, 'symbol-┬Ñ.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /nested\/symbol-┬Ñ.txt 正文/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const multipleEntry7z = await multipleEntry7zFixtureBase64()
    await miniProgram.evaluate(base64 => {
      const bytes = wx.base64ToArrayBuffer(base64)
      const filePath = `${wx.env.USER_DATA_PATH}/multiple-entry-regression.7z`
      wx.getFileSystemManager().writeFileSync(filePath, bytes)
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'multiple-entry-regression.7z', path: filePath, tempFilePath: filePath, size: bytes.byteLength, type: 'application/x-7z-compressed' })
    }, multipleEntry7z)
    let multipleEntryState
    const multipleEntryStartedAt = Date.now()
    while (Date.now() - multipleEntryStartedAt < 15000) {
      multipleEntryState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { error: reader.data.error, loading: reader.data.isLoading, entries: reader.data.inspectorEntries }
      })
      if (multipleEntryState.error || (!multipleEntryState.loading && multipleEntryState.entries.length)) break
      await page.waitFor(150)
    }
    assert.equal(multipleEntryState.error, '')
    assert.deepEqual(multipleEntryState.entries.filter(item => !item.isDirectory).map(item => item.name).sort(), ['docs/first.txt', 'docs/second.txt', 'empty.txt'])
    const firstArchiveEntry = await page.$('#reader >>> .entry-row-actionable')
    assert.ok(firstArchiveEntry, '多条目 7z 没有可打开正文')
    await firstArchiveEntry.tap()
    await waitForReady(miniProgram, page, 'first.txt', 15000)
    assert.equal(await miniProgram.evaluate(() => /这是第一个文件，不能在目录中丢失/.test(getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')), true)

    const literalNames7z = await multipleEntry7zFixtureBase64(true)
    const literalNameStates = []
    const keywordNames7z = await multipleEntry7zFixtureBase64(false, true)
    const keywordNameStates = []
    const selectionNames7z = await multipleEntry7zFixtureBase64(false, false, false, true)
    const selectionNameStates = []
    for (const scenario of [
      { fixture: literalNames7z, targets: [' report----------final.txt', 'trailing.txt '], results: literalNameStates },
      { fixture: keywordNames7z, targets: ['Data Error.txt', 'Wrong password.txt', 'Can not open.txt'], results: keywordNameStates },
      { fixture: selectionNames7z, targets: ['report*.txt', 'note?.txt', '@list.txt'], extraNames: ['report-broken.txt', 'note1.txt'], results: selectionNameStates }
    ]) {
      for (const targetName of scenario.targets) {
        await miniProgram.evaluate(base64 => {
          const bytes = wx.base64ToArrayBuffer(base64)
          const filePath = `${wx.env.USER_DATA_PATH}/literal-names.7z`
          wx.getFileSystemManager().writeFileSync(filePath, bytes)
          getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'literal-names.7z', path: filePath, tempFilePath: filePath, size: bytes.byteLength })
        }, scenario.fixture)
        let state
        const started = Date.now()
        while (Date.now() - started < 15000) {
          state = await miniProgram.evaluate(() => {
            const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
            return { error: reader.data.error, loading: reader.data.isLoading, needsPassword: reader.data.inspectorNeedsPassword, names: reader.data.inspectorEntries.filter(item => !item.isDirectory).map(item => item.name) }
          })
          if (state.error || (!state.loading && state.names.length)) break
          await page.waitFor(150)
        }
        assert.equal(state.error, '')
        assert.equal(state.needsPassword, false)
        assert.deepEqual(state.names.slice().sort(), [...scenario.targets, ...(scenario.extraNames || []), 'docs/first.txt', 'docs/second.txt', 'empty.txt'].sort())
        const entryIndex = await miniProgram.evaluate(name => getCurrentPages().slice(-1)[0].selectComponent('#reader').data.inspectorEntries.findIndex(item => item.name === name), targetName)
        const rows = await page.$$('#reader >>> .entry-row')
        assert.ok(rows[entryIndex], '特殊文件名条目未显示')
        await rows[entryIndex].tap()
        await waitForReady(miniProgram, page, targetName, 15000)
        const content = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
        assert.ok(content.includes(`特殊文件名正文：${JSON.stringify(targetName)}`), '点击特殊名称后正文与该成员不一致')
        scenario.results.push({ ...state, opened: targetName, contentVerified: true })
      }
    }

    const duplicateMembers = [
      { name: 'same.txt', content: '第一份同名文件，不能被覆盖' },
      { name: 'same.txt', content: '第二份同名文件，不能被替换' }
    ]
    const duplicateWasm = zlib.brotliDecompressSync(await fs.readFile(path.join(projectRoot, 'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
    const duplicateFixtures = [
      { name: 'duplicates.zip', bytes: duplicateZip(duplicateMembers) },
      { name: 'duplicates.rar', bytes: duplicateRar(duplicateMembers) },
      { name: 'duplicates.7z', bytes: await duplicateSevenZip(duplicateMembers, duplicateWasm) }
    ]
    const duplicateMemberStates = []
    for (const fixture of duplicateFixtures) {
      for (let selected = 0; selected < duplicateMembers.length; selected++) {
        await miniProgram.evaluate(({ base64, name }) => {
          const bytes = wx.base64ToArrayBuffer(base64)
          const filePath = `${wx.env.USER_DATA_PATH}/${name}`
          wx.getFileSystemManager().writeFileSync(filePath, bytes)
          getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: filePath, size: bytes.byteLength })
        }, { name: fixture.name, base64: Buffer.from(fixture.bytes).toString('base64') })
        let state
        const started = Date.now()
        while (Date.now() - started < 15000) {
          state = await miniProgram.evaluate(() => {
            const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
            return { error: reader.data.error, loading: reader.data.isLoading, entries: reader.data.inspectorEntries }
          })
          if (state.error || (!state.loading && state.entries.length)) break
          await page.waitFor(150)
        }
        assert.equal(state.error, '')
        assert.deepEqual(state.entries.map(entry => entry.displayName), ['same.txt（同名 1/2）', 'same.txt（同名 2/2）'])
        const rows = await page.$$('#reader >>> .entry-row')
        assert.equal(rows.length, 2)
        await rows[selected].tap()
        await waitForReady(miniProgram, page, 'same.txt', 15000)
        const content = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
        assert.ok(content.includes(duplicateMembers[selected].content), `${fixture.name} 同名 ${selected + 1} 显示错误正文`)
        assert.ok(!content.includes(duplicateMembers[1 - selected].content))
        duplicateMemberStates.push({ archive: fixture.name, selected, labels: state.entries.map(entry => entry.displayName), contentVerified: true })
      }
    }

    const { zipMember: integrityZip } = require('../tests/helpers/zip-integrity')
    const { localNameMismatch, localZip64 } = require('../tests/helpers/zip-local-identity')
    const nativeZlib = require('node:zlib')
    const zipIntegrityStates = []
    const integrityText = 'ZIP 校验后的真实正文，不能只识别文件名。'
    const emptyTailText = 'ZIP 空尾随Deflate流后的真实正文。'
    for (const fixture of [
      { bytes: integrityZip({ content: integrityText, crc: 0 }), error: 'CRC' },
      { bytes: localNameMismatch({ content: integrityText }), error: '文件名不一致' },
      { bytes: integrityZip({ content: Buffer.alloc(4 * 1024 * 1024, 65), size: 20 }), error: '实际解压' },
      { bytes: localZip64({ content: integrityText, descriptor: 'signed' }) },
      { bytes: integrityZip({ content: integrityText, descriptor: 'signed' }) },
      { bytes: integrityZip({ content: emptyTailText, packed: Buffer.concat([nativeZlib.deflateRawSync(emptyTailText), Buffer.from([0x03, 0x00])]) }), content: emptyTailText }
    ]) {
      await miniProgram.evaluate(base64 => {
        const bytes = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/zip-integrity.zip`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'zip-integrity.zip', path: filePath, size: bytes.byteLength })
      }, fixture.bytes.toString('base64'))
      let row
      const started = Date.now()
      while (Date.now() - started < 10000) {
        row = await page.$('#reader >>> .entry-row')
        if (row && (await row.text()).includes('正文.txt')) break
        await page.waitFor(100)
      }
      assert.ok(row && (await row.text()).includes('正文.txt'), 'ZIP 校验案例目录未上屏')
      await row.tap()
      let visibleText = ''
      if (fixture.error) {
        while (Date.now() - started < 15000) {
          const card = await page.$('#reader >>> .error-card')
          if (card) visibleText = await card.text()
          if (visibleText.includes(fixture.error)) break
          await page.waitFor(100)
        }
        assert.ok(visibleText.includes(fixture.error), visibleText)
        assert.equal(await page.$('#reader >>> .dom-render-root'), null, '坏 ZIP 内容不能进入正文视图')
      } else {
        await waitForReady(miniProgram, page, '正文.txt')
        const root = await page.$('#reader >>> .dom-render-root')
        assert.ok(root)
        visibleText = (await root.text()).trim()
        assert.equal(visibleText, fixture.content || integrityText)
      }
      zipIntegrityStates.push({ expectedError: fixture.error || '', visibleText, entryTapped: true })
    }

    const { omittedDescriptors, recoveryMembers } = require('../tests/helpers/zip-recovery')
    const recoveryZip = omittedDescriptors(recoveryMembers)
    const zipRecoveryStates = []
    for (const member of recoveryMembers) {
      await miniProgram.evaluate(base64 => {
        const bytes = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/zip-recovery.zip`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'zip-recovery.zip', path: filePath, size: bytes.byteLength })
      }, recoveryZip.toString('base64'))
      const duplicateIndex = recoveryMembers.filter(m => m.name === member.name).indexOf(member)
      const basename = member.name.split('/').pop()
      let matches = [], started = Date.now()
      while (Date.now() - started < 10000) {
        matches = []
        for (const row of await page.$$('#reader >>> .entry-row')) if ((await row.text()).includes(basename)) matches.push(row)
        if (matches.length > duplicateIndex) break
        await page.waitFor(100)
      }
      assert.ok(matches.length > duplicateIndex, 'ZIP 恢复目录必须实际上屏')
      await matches[duplicateIndex].tap()
      await waitForReady(miniProgram, page, basename)
      const root = await page.$('#reader >>> .dom-render-root')
      assert.ok(root)
      const visible = (await root.text()).trim()
      assert.equal(visible, member.content)
      zipRecoveryStates.push({ name: member.name, duplicateIndex, visible, entryTapped: true })
    }

    const { encodedRtf, windowsCodepageCases } = require('../tests/helpers/rtf-samples')
    const { wrap: wrapRtf, pair: pairRtf, unicode: unicodeRtf } = require('../tests/helpers/rtf-alternatives')
    const { zipSync: zipRtf } = require('../miniprogram/file-reader/document/vendor/fflate')
    const rtfBodyStates = []
    const rtfFixtures = [
      ...require('../tests/helpers/rtf-hidden').cases.filter(c => ['nested-visible', 'unicode-fallback', 'font-restored-by-plain', 'field-result'].includes(c.name))
        .map(c => ({ name: '隐藏格式-' + c.name + '.rtf', bytes: Buffer.from(c.source), expected: c.expected })),
      { name: '嵌套表格.rtf', bytes: await fs.readFile(path.join(__dirname, '../tests/fixtures/rtf-tables/libreoffice-nested.rtf')), expected: require('../tests/fixtures/rtf-tables/samples.json').find(c => c.name === 'libreoffice-nested.rtf').expected },
      { name: '中文正文.rtf', bytes: encodedRtf('中文正文：会议纪要'), expected: '中文正文：会议纪要' },
      { name: '繁體正文.rtf', bytes: encodedRtf('繁體中文：閱讀器功能', 'big5', 950, 2), expected: '繁體中文：閱讀器功能' },
      { name: '日本語.rtf', bytes: encodedRtf('日本語の本文：表示と機能', 'shift_jis', 932, 2), expected: '日本語の本文：表示と機能' },
      { name: '控制字.rtf', bytes: Buffer.from('{\\rtf1\\uc1\\u20320\\par X{\\pict\\bin7 }SECRET}tail}'), expected: '你Xtail' },
      { name: 'Unicode备选.rtf', bytes: Buffer.from(wrapRtf(pairRtf('OLD PLACEHOLDER', unicodeRtf('中文正文 <b>原样保留</b>')))), expected: '中文正文 <b>原样保留</b>' },
      { name: '嵌套备选.rtf', bytes: Buffer.from(wrapRtf(pairRtf('OLD', 'A'+pairRtf('OLD2', unicodeRtf('新正文'))+'Z'))), expected: 'A新正文Z' },
      ...windowsCodepageCases.map(({ encoding, codepage, source }) => ({ name: `代码页-${codepage}.rtf`, bytes: encodedRtf(source, encoding, codepage, 2), expected: source }))
    ]
    for (const fixture of rtfFixtures) {
      await miniProgram.evaluate(base64 => {
        const bytes = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/rtf-body.zip`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'rtf-body.zip', path: filePath, size: bytes.byteLength })
      }, Buffer.from(zipRtf({ [fixture.name]: fixture.bytes })).toString('base64'))
      let entry
      const started = Date.now()
      while (Date.now() - started < 10000) {
        entry = await page.$('#reader >>> .entry-row')
        if (entry && (await entry.text()).includes(fixture.name)) break
        await page.waitFor(100)
      }
      assert.ok(entry, 'RTF 所在压缩包目录没有上屏')
      assert.ok((await entry.text()).includes(fixture.name))
      await entry.tap()
      await waitForReady(miniProgram, page, fixture.name)
      const root = await page.$('#reader >>> .dom-render-root')
      assert.ok(root, 'RTF 正文没有进入真实渲染视图')
      const visibleText = await root.text()
      assert.equal(visibleText.trim().normalize('NFC'), fixture.expected.normalize('NFC'))
      rtfBodyStates.push({ name: fixture.name, visibleText, entryTapped: true, elapsedMs: Date.now() - started })
    }

    const { zipWithLinks } = require('../tests/helpers/archive-links')
    const zipLinkArchive = zipWithLinks([
      { name: 'docs/page.html', content: '<!doctype html><h1>ZIP 链接真实正文</h1>' },
      { name: 'shortcut', target: 'docs/page.html' }
    ])
    await miniProgram.evaluate(base64 => {
      const bytes = wx.base64ToArrayBuffer(base64)
      const filePath = `${wx.env.USER_DATA_PATH}/linked.zip`
      wx.getFileSystemManager().writeFileSync(filePath, bytes)
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'linked.zip', path: filePath, size: bytes.byteLength })
    }, zipLinkArchive.toString('base64'))
    let zipLinkState
    const zipLinkStarted = Date.now()
    while (Date.now() - zipLinkStarted < 10000) {
      zipLinkState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return {
          error: reader.data.error,
          loading: reader.data.isLoading,
          entries: reader.data.inspectorEntries,
          runtimeErrors: reader._runtimeErrors || []
        }
      })
      if (zipLinkState.error || (!zipLinkState.loading && zipLinkState.entries.length)) break
      await page.waitFor(100)
    }
    assert.equal(zipLinkState.error, '')
    assert.deepEqual(zipLinkState.runtimeErrors, [])
    const zipLinkIndex = zipLinkState.entries.findIndex(entry => entry.name === 'shortcut' && entry.isLink)
    assert.ok(zipLinkIndex >= 0, 'ZIP Unix 符号链接没有进入真实 WXML 目录')
    const zipLinkRows = await page.$$('#reader >>> .entry-row')
    assert.ok(zipLinkRows[zipLinkIndex], 'ZIP Unix 符号链接没有可点击的真实 WXML 行')
    await zipLinkRows[zipLinkIndex].tap()
    await waitForReady(miniProgram, page, 'page.html')
    zipLinkState = await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      return {
        content: reader._staticHtmlFallback || '',
        visibleText: reader._htmlRuntime && reader._htmlRuntime.document.body.textContent || '',
        runtimeErrors: reader._runtimeErrors || []
      }
    })
    assert.ok(zipLinkState.content.includes('ZIP 链接真实正文'), 'ZIP 链接点开后没有进入目标 HTML 正文')
    assert.doesNotMatch(zipLinkState.visibleText.trim(), /^docs\/page\.html$/)
    assert.deepEqual(zipLinkState.runtimeErrors, [])

    const { rar4Links, rar5Links } = require('../tests/helpers/rar-links')
    const rarLinkStates = []
    const legacyRarTargetName = '日本語/設計資料.html'
    const legacyRarTargetBytes = iconv.encode(legacyRarTargetName, 'shift_jis')
    const rarLinkFixtures = [
      { name: 'links-rar4.rar', bytes: rar4Links([{ name: 'docs/page.html', content: '<!doctype html><h1>RAR4 链接真实正文</h1>' }, { name: 'shortcut', target: 'docs/page.html' }]), expected: 'RAR4 链接真实正文' },
      { name: 'links-rar5.rar', bytes: rar5Links([{ name: 'docs/page.html', content: '<!doctype html><h1>RAR5 链接真实正文</h1>' }, { name: 'shortcut', target: 'docs/page.html' }]), expected: 'RAR5 链接真实正文' },
      { name: 'links-hard.rar', bytes: rar5Links([{ name: 'docs/page.html', content: '<!doctype html><h1>硬链接真实正文</h1>' }, { name: 'sub/shortcut', target: 'docs/page.html', linkType: 4 }]), expected: '硬链接真实正文' },
      { name: 'links-intermediate-directory.rar', bytes: rar5Links([{ name: 'real/docs/page.html', content: '<!doctype html><h1>中间目录链接真实正文</h1>' }, { name: 'aliases/folder', target: '../real/docs', directory: true }, { name: 'shortcut', target: 'aliases/folder/page.html' }]), openName: 'shortcut', expected: '中间目录链接真实正文' },
      { name: 'links-rar4-legacy-path.rar', bytes: rar4Links([{ name: legacyRarTargetBytes, content: '<!doctype html><h1>旧式路径编码真实正文</h1>' }, { name: 'shortcut', target: legacyRarTargetBytes }]), openName: 'shortcut', legacyEncoding: 'shift_jis', expectedEncoding: '日文 Shift_JIS（手动）', expectedTargetName: legacyRarTargetName, expected: '旧式路径编码真实正文' },
      { name: 'links-empty.rar', bytes: rar5Links([{ name: 'empty', directory: true }, { name: 'shortcut', target: 'empty', directory: true }]), directory: true },
      { name: 'links-unsafe.rar', bytes: rar5Links([{ name: 'shortcut', target: '../../outside.txt' }]), unsafe: true }
    ]
    for (const fixture of rarLinkFixtures) {
      await miniProgram.evaluate(({ name, base64 }) => {
        const bytes = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/${name}`
        wx.getFileSystemManager().writeFileSync(filePath, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: filePath, size: bytes.byteLength })
      }, { name: fixture.name, base64: fixture.bytes.toString('base64') })
      let state
      const started = Date.now()
      while (Date.now() - started < 15000) {
        state = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
          return { error: p.data.error, loading: p.data.isLoading, encoding: p.data.inspectorNameEncoding, entries: p.data.inspectorEntries }
        })
        if (state.error || (!state.loading && state.entries.length)) break
        await page.waitFor(150)
      }
      assert.equal(state.error, '')
      if (fixture.legacyEncoding) {
        assert.equal(state.encoding, '自动（UTF-8 / CP437）')
        const choice = await page.$(`#reader >>> .archive-name-encoding-${fixture.legacyEncoding}`)
        assert.ok(choice, 'RAR 旧式路径编码按钮没有进入真实 WXML')
        await choice.tap()
        const encodingStarted = Date.now()
        while (Date.now() - encodingStarted < 10000) {
          state = await miniProgram.evaluate(() => {
            const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
            return { error: p.data.error, loading: p.data.isLoading, encoding: p.data.inspectorNameEncoding, entries: p.data.inspectorEntries }
          })
          if (state.error || (!state.loading && state.encoding === fixture.expectedEncoding)) break
          await page.waitFor(100)
        }
        assert.equal(state.error, '')
        assert.equal(state.encoding, fixture.expectedEncoding)
        assert.ok(state.entries.some(entry => entry.name === fixture.expectedTargetName), 'RAR 旧式路径没有按所选编码显示真实名称')
      }
      const index = state.entries.findIndex(e => e.isLink && (!fixture.openName || e.name === fixture.openName))
      assert.ok(index >= 0, 'RAR 链接类型丢失')
      assert.match(state.entries[index].detail, /链接 →/)
      const rows = await page.$$('#reader >>> .entry-row')
      await rows[index].tap()
      if (fixture.directory || fixture.unsafe) {
        await page.waitFor(350)
        const result = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
          return { error: p.data.error, folder: p.data.inspectorLinkFolder, count: p.data.inspectorEntries.length, loading: p.data.isLoading }
        })
        assert.equal(result.loading, false)
        if (fixture.unsafe) assert.match(result.error, /超出压缩包范围/)
        else {
          assert.equal(result.error, '')
          assert.equal(result.folder, 'empty')
          assert.equal(result.count, 0)
          const back = await page.$('#reader >>> .archive-link-back')
          assert.ok(back, '文件夹链接必须能返回压缩包目录')
          await back.tap()
          let rootCount = 0
          const returnStarted = Date.now()
          while (Date.now() - returnStarted < 3000) {
            rootCount = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader').data.inspectorEntries.length)
            if (rootCount === state.entries.length) break
            await page.waitFor(100)
          }
          assert.equal(rootCount, state.entries.length)
        }
        rarLinkStates.push({ archive: fixture.name, ...result, verified: true })
      } else {
        await waitForReady(miniProgram, page, fixture.expectedTargetName ? fixture.expectedTargetName.split('/').pop() : 'page.html', 15000)
        const content = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._staticHtmlFallback || '')
        assert.ok(content.includes(fixture.expected), 'RAR 链接点开后的正文不是目标内容')
        rarLinkStates.push({ archive: fixture.name, target: fixture.expectedTargetName || 'page.html', encoding: fixture.expectedEncoding || '', contentVerified: true })
      }
    }

    const corruptedKeyword7z = await multipleEntry7zFixtureBase64(false, true, true)
    await miniProgram.evaluate(base64 => {
      const bytes = wx.base64ToArrayBuffer(base64)
      const filePath = `${wx.env.USER_DATA_PATH}/corrupt-keyword.7z`
      wx.getFileSystemManager().writeFileSync(filePath, bytes)
      getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: 'corrupt-keyword.7z', path: filePath, size: bytes.byteLength })
    }, corruptedKeyword7z)
    let corruptKeywordState
    const corruptStarted = Date.now()
    while (Date.now() - corruptStarted < 15000) {
      corruptKeywordState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { error: reader.data.error, loading: reader.data.isLoading, index: reader.data.inspectorEntries.findIndex(item => item.name === 'Wrong password.txt') }
      })
      if (corruptKeywordState.error || (!corruptKeywordState.loading && corruptKeywordState.index >= 0)) break
      await page.waitFor(150)
    }
    assert.equal(corruptKeywordState.error, '')
    assert.ok(corruptKeywordState.index >= 0)
    const corruptRows = await page.$$('#reader >>> .entry-row')
    await corruptRows[corruptKeywordState.index].tap()
    const failureStarted = Date.now()
    while (Date.now() - failureStarted < 15000) {
      corruptKeywordState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return { error: reader.data.error, loading: reader.data.isLoading, needsPassword: reader.data.inspectorNeedsPassword }
      })
      if (!corruptKeywordState.loading && (corruptKeywordState.error || corruptKeywordState.needsPassword)) break
      await page.waitFor(150)
    }
    assert.match(corruptKeywordState.error, /CRC Failed/)
    assert.equal(corruptKeywordState.needsPassword, false, 'CRC 错误不能被文件名里的 password 诱导成密码框')

    const psdFixture = zipPrediction16BitPsdFixtureBase64()
    const psdFixturePrepared = await miniProgram.evaluate(fixture => {
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-zip-prediction.psd`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-16位-ZIP-Prediction.psd',
        path: filePath,
        tempFilePath: filePath,
        size: archive.byteLength,
        type: 'application/x-photoshop'
      }
      return archive.byteLength
    }, psdFixture)
    assert.ok(psdFixturePrepared > 40)
    const psdPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadPsd')
    let psdPreview
    const psdStartedAt = Date.now()
    while (Date.now() - psdStartedAt < 15000) {
      psdPreview = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const preview = pages[pages.length - 1].selectComponent('#preview')
        return {
          loading: preview.data.loading,
          error: preview.data.error,
          message: preview.data.message,
          previewPath: preview.data.previewPath,
          metadata: preview.data.metadata
        }
      })
      if (psdPreview.error || (!psdPreview.loading && psdPreview.previewPath)) break
      await psdPage.waitFor(200)
    }
    assert.equal(psdPreview.error, '')
    assert.match(psdPreview.previewPath, /psd-composite-\d+-\d+\.jpg$/, `PSD ZIP Prediction 没有生成预览：${JSON.stringify(psdPreview)}`)
    assert.ok(psdPreview.metadata.some(item => item.label === '合成预览' && /16 bit · ZIP Prediction/.test(item.value)))
    const psdJpeg = await miniProgram.evaluate(filePath => {
      const data = new Uint8Array(wx.getFileSystemManager().readFileSync(filePath))
      return { size: data.length, first: data[0], second: data[1] }
    }, psdPreview.previewPath)
    assert.ok(psdJpeg.size > 100)
    assert.equal(psdJpeg.first, 0xff)
    assert.equal(psdJpeg.second, 0xd8)
    const psdImage = await psdPage.$('#preview >>> .preview-image')
    assert.ok(psdImage, '16-bit PSD JPEG 没有进入真实 WXML image 节点')
    assert.equal(await psdImage.attribute('src'), psdPreview.previewPath)

    const psd32Fixture = zipPrediction32BitPsdFixtureBase64()
    const psd32FixturePrepared = await miniProgram.evaluate(fixture => {
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-32bit-zip-prediction.psd`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-32位浮点-ZIP-Prediction.psd',
        path: filePath,
        tempFilePath: filePath,
        size: archive.byteLength,
        type: 'application/x-photoshop'
      }
      return archive.byteLength
    }, psd32Fixture)
    assert.ok(psd32FixturePrepared > 40)
    const psd32Page = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadPsd')
    let psd32Preview
    const psd32StartedAt = Date.now()
    while (Date.now() - psd32StartedAt < 15000) {
      psd32Preview = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const preview = pages[pages.length - 1].selectComponent('#preview')
        return {
          loading: preview.data.loading,
          error: preview.data.error,
          previewPath: preview.data.previewPath,
          metadata: preview.data.metadata
        }
      })
      if (psd32Preview.error || (!psd32Preview.loading && psd32Preview.previewPath)) break
      await psd32Page.waitFor(200)
    }
    assert.equal(psd32Preview.error, '')
    assert.match(psd32Preview.previewPath, /psd-composite-\d+-\d+\.jpg$/, `32-bit PSD ZIP Prediction 没有生成预览：${JSON.stringify(psd32Preview)}`)
    assert.ok(psd32Preview.metadata.some(item => item.label === '合成预览' && /32 bit · ZIP Prediction/.test(item.value)))
    const psd32Jpeg = await miniProgram.evaluate(filePath => {
      const data = new Uint8Array(wx.getFileSystemManager().readFileSync(filePath))
      return { size: data.length, first: data[0], second: data[1] }
    }, psd32Preview.previewPath)
    assert.ok(psd32Jpeg.size > 100)
    assert.equal(psd32Jpeg.first, 0xff)
    assert.equal(psd32Jpeg.second, 0xd8)
    const psd32Image = await psd32Page.$('#preview >>> .preview-image')
    assert.ok(psd32Image, '32-bit PSD JPEG 没有进入真实 WXML image 节点')
    assert.equal(await psd32Image.attribute('src'), psd32Preview.previewPath)

    const psdLabFixture = zipPrediction16BitLabPsdFixtureBase64()
    const psdLabPrepared = await miniProgram.evaluate(fixture => {
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-16bit-lab.psd`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-16位-Lab-ZIP-Prediction.psd',
        path: filePath,
        tempFilePath: filePath,
        size: archive.byteLength,
        type: 'application/x-photoshop'
      }
      return archive.byteLength
    }, psdLabFixture)
    assert.ok(psdLabPrepared > 40)
    const psdLabPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadPsd')
    let psdLabPreview
    const psdLabStartedAt = Date.now()
    while (Date.now() - psdLabStartedAt < 15000) {
      psdLabPreview = await miniProgram.evaluate(() => {
        const preview = getCurrentPages().slice(-1)[0].selectComponent('#preview')
        return { loading: preview.data.loading, error: preview.data.error, previewPath: preview.data.previewPath, metadata: preview.data.metadata }
      })
      if (psdLabPreview.error || (!psdLabPreview.loading && psdLabPreview.previewPath)) break
      await psdLabPage.waitFor(200)
    }
    assert.equal(psdLabPreview.error, '')
    assert.match(psdLabPreview.previewPath, /psd-composite-\d+-\d+\.jpg$/, `16-bit Lab PSD 没有生成预览：${JSON.stringify(psdLabPreview)}`)
    assert.ok(psdLabPreview.metadata.some(item => item.label === '颜色' && item.value === 'Lab · 16 bit'))
    assert.ok(psdLabPreview.metadata.some(item => item.label === '合成预览' && /16 bit · ZIP Prediction/.test(item.value)))
    const psdLabJpeg = await miniProgram.evaluate(filePath => {
      const data = new Uint8Array(wx.getFileSystemManager().readFileSync(filePath))
      return { size: data.length, first: data[0], second: data[1] }
    }, psdLabPreview.previewPath)
    assert.ok(psdLabJpeg.size > 100)
    assert.equal(psdLabJpeg.first, 0xff)
    assert.equal(psdLabJpeg.second, 0xd8)
    assert.ok(await psdLabPage.$('#preview >>> .preview-image'), '16-bit Lab PSD JPEG 没有进入真实 WXML image 节点')

    const psdIndexedFixture = zipPredictionIndexedPsdFixtureBase64()
    await miniProgram.evaluate(fixture => {
      const archive = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-indexed.psd`
      wx.getFileSystemManager().writeFileSync(filePath, archive)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-索引色-ZIP-Prediction.psd',
        path: filePath,
        tempFilePath: filePath,
        size: archive.byteLength,
        type: 'application/x-photoshop'
      }
    }, psdIndexedFixture)
    const psdIndexedPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadPsd')
    let psdIndexedPreview
    const psdIndexedStartedAt = Date.now()
    while (Date.now() - psdIndexedStartedAt < 15000) {
      psdIndexedPreview = await miniProgram.evaluate(() => {
        const preview = getCurrentPages().slice(-1)[0].selectComponent('#preview')
        return { loading: preview.data.loading, error: preview.data.error, previewPath: preview.data.previewPath, metadata: preview.data.metadata }
      })
      if (psdIndexedPreview.error || (!psdIndexedPreview.loading && psdIndexedPreview.previewPath)) break
      await psdIndexedPage.waitFor(200)
    }
    assert.equal(psdIndexedPreview.error, '')
    assert.match(psdIndexedPreview.previewPath, /psd-composite-\d+-\d+\.jpg$/, `索引色 PSD 没有生成预览：${JSON.stringify(psdIndexedPreview)}`)
    assert.ok(psdIndexedPreview.metadata.some(item => item.label === '颜色' && item.value === '索引色 · 8 bit'))
    assert.ok(psdIndexedPreview.metadata.some(item => item.label === '透明索引' && item.value === '2 · 1 像素'))
    const psdIndexedJpeg = await miniProgram.evaluate(filePath => {
      const data = new Uint8Array(wx.getFileSystemManager().readFileSync(filePath))
      return { size: data.length, first: data[0], second: data[1] }
    }, psdIndexedPreview.previewPath)
    assert.ok(psdIndexedJpeg.size > 100)
    assert.equal(psdIndexedJpeg.first, 0xff)
    assert.equal(psdIndexedJpeg.second, 0xd8)
    assert.ok(await psdIndexedPage.$('#preview >>> .preview-image'), '索引色 PSD JPEG 没有进入真实 WXML image 节点')

    const psdAlphaStates = []
    const alphaValues = Array(16).fill(0).concat(Array(16).fill(0.5), Array(32).fill(1))
    const alphaFixtures = [8, 16, 32].map(depth => ({
      name: `composite-alpha-${depth}.${depth === 16 ? 'psb' : 'psd'}`, width: 64, height: 32, generated: true,
      bytes: psdAlphaFixture({ depth, version: depth === 16 ? 2 : 1, width: 64, height: 32, compression: 3,
        flag: { 8: 'count', 16: 'Lr16', 32: 'Mt32' }[depth], alpha: alphaValues })
    }))
    if (process.env.PSD_REAL_SAMPLE_DIR) {
      for (const sample of require('../compatibility/profiles/psd.json').publicSamples) {
        const bytes = await fs.readFile(path.join(process.env.PSD_REAL_SAMPLE_DIR, sample.name))
        assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), sample.sha256)
        const header = require('../miniprogram/file-reader/engine/core/design-file').parsePsdHeader(bytes)
        alphaFixtures.push({ name: sample.name, width: header.width, height: header.height, generated: false, bytes })
      }
    }
    if (process.env.PSD_ZIP_SAMPLE_DIR) {
      const crypto = require('node:crypto')
      const design = require('../miniprogram/file-reader/engine/core/design-file')
      for (const sample of require('../compatibility/profiles/psd.json').zipPublicSamples) {
        const original = await fs.readFile(path.join(process.env.PSD_ZIP_SAMPLE_DIR, sample.name))
        assert.equal(crypto.createHash('sha256').update(original).digest('hex'), sample.sha256)
        const expected = design.extractPsdComposite(original)
        const expectedJpeg = jpegCodec.encode({ data: expected.rgba, width: expected.width, height: expected.height }, 82).data
        for (const compression of ['zip', 'prediction']) {
          const suffix = path.extname(sample.name)
          const name = `${path.basename(sample.name, suffix)}-${compression}${suffix}`
          const bytes = await fs.readFile(path.join(process.env.PSD_ZIP_SAMPLE_DIR, name))
          alphaFixtures.push({ name, bytes, width: expected.width, height: expected.height,
            derived: true, expectedJpeg, generated: false })
        }
      }
    }
    const zlibFailures = require('../tests/helpers/psd-zlib').psdZlibFailureFixtures()
    alphaFixtures.push(...zlibFailures.map(item => ({ ...item, expectFailure: true })))
    alphaFixtures.push({ ...alphaFixtures[0], name: 'valid-after-zlib-errors.psd' })
    await miniProgram.evaluate(inputs => {
      const queue = inputs.map(input => {
        const data = wx.base64ToArrayBuffer(input.base64)
        const filePath = `${wx.env.USER_DATA_PATH}/${input.name}`
        wx.getFileSystemManager().writeFileSync(filePath, data)
        return { name: input.name, path: filePath, size: data.byteLength, type: 'application/x-photoshop' }
      })
      const app = getApp()
      app.globalData.fileQueue = queue
      app.globalData.fileQueueIndex = 0
      app.globalData.pendingFilePreview = queue[0]
    }, alphaFixtures.map(fixture => ({ name: fixture.name, base64: fixture.bytes.toString('base64') })))
    const alphaPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadPsd')
    for (let fixtureIndex = 0; fixtureIndex < alphaFixtures.length; fixtureIndex++) {
      const fixture = alphaFixtures[fixtureIndex]
      console.log(`PSD alpha: opening ${fixture.name} via ${fixtureIndex ? 'next-file button' : 'initial route'}`)
      const started = Date.now()
      const page = alphaPage
      if (fixtureIndex) {
        const next = (await page.$$('.queue-button'))[1]
        assert.ok(next, '缺少真实的下一份文件按钮')
        await next.tap()
      }
      let state
      while (Date.now() - started < 15000) {
        state = await componentState(page, '#preview')
        if ((state.name === fixture.name && !state.loading) || state.error) break
        await page.waitFor(150)
      }
      assert.equal(state.error, '', `${fixture.name}: ${state.error}`)
      assert.equal(state.name, fixture.name)
      assert.equal(state.queuePosition, fixtureIndex + 1)
      if (fixture.expectFailure) {
        assert.equal(state.loading, false)
        assert.equal(state.previewPath, '', '失败文件不能保留上一份文件的画面')
        assert.equal(await page.$('#preview >>> .preview-image'), null)
        assert.ok(state.message.includes(fixture.message), `${fixture.name}: ${state.message}`)
        const messageNode = await page.$('#preview >>> .message-card')
        assert.ok(messageNode)
        assert.ok((await messageNode.text()).includes(fixture.message))
        if (process.env.PSD_ALPHA_SCREENSHOTS === '1') {
          const captureRoot = process.env.PSD_ALPHA_SCREENSHOT_DIR || outputRoot
          await miniProgram.screenshot({ path: path.join(captureRoot, `psd-rejected-${fixture.name}.png`) })
        }
        psdAlphaStates.push({ name: fixture.name, rejected: true, actualImage: false,
          message: state.message, queueButtonTapped: true, elapsedMs: Date.now() - started })
        console.log(`PSD ZIP: rejected ${fixture.name} without stale image`)
        continue
      }
      assert.match(state.previewPath, /psd-composite-\d+-\d+\.jpg$/, `${fixture.name}: full composite was bypassed`)
      const imageNode = await page.$('#preview >>> .preview-image')
      assert.ok(imageNode, `${fixture.name}: no actual image node`)
      assert.equal(await imageNode.attribute('src'), state.previewPath)
      const base64 = await miniProgram.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), state.previewPath)
      const decoded = jpegCodec.decode(Buffer.from(base64, 'base64'))
      assert.equal(decoded.width, fixture.width); assert.equal(decoded.height, fixture.height)
      if (fixture.generated) {
        assert.ok(state.metadata.some(item => item.label === '合成透明度' && /1024/.test(item.value)))
        for (const [x, expected] of [[3, [248, 248, 248]], [11, [224, 224, 224]], [19, [252, 124, 124]], [40, [255, 0, 0]]]) {
          const pixel = Array.from(decoded.data.subarray((3 * 64 + x) * 4, (3 * 64 + x) * 4 + 3))
          assert.ok(pixel.every((value, i) => Math.abs(value - expected[i]) <= 5), `${fixture.name}/${x}/${pixel}`)
        }
      } else if (fixture.derived) {
        assert.deepEqual(Buffer.from(base64, 'base64'), Buffer.from(fixture.expectedJpeg), `${fixture.name}: simulator JPEG differs from oracle-verified original`)
      } else if (fixture.name !== 'semi-transparent-layers.psd') {
        const count = fixture.name === 'transparentbg.psd' ? '12540' : '1219'
        assert.ok(state.metadata.some(item => item.label === '合成透明度' && item.value.includes(count)))
      }
      if (process.env.PSD_ALPHA_SCREENSHOTS === '1') {
        await page.waitFor(500)
        // Keep optional captures outside the watched project during regression.
        const captureRoot = process.env.PSD_ALPHA_SCREENSHOT_DIR || outputRoot
        await miniProgram.screenshot({ path: path.join(captureRoot, `psd-alpha-${fixture.name}.png`) })
      }
      console.log(`PSD alpha: verified ${fixture.name} (${decoded.width}x${decoded.height})`)
      psdAlphaStates.push({ name: fixture.name, generated: fixture.generated, derived: !!fixture.derived, width: decoded.width, height: decoded.height,
        metadata: state.metadata, actualImage: true, queueButtonTapped: fixtureIndex > 0, elapsedMs: Date.now() - started })
    }

    const legacyAiFixture = legacyAiFixtureBase64()
    const legacyAiPrepared = await miniProgram.evaluate(fixture => {
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-legacy-vector.ai`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-旧式矢量.ai',
        path: filePath,
        tempFilePath: filePath,
        size: data.byteLength,
        type: 'application/postscript'
      }
      return data.byteLength
    }, legacyAiFixture)
    assert.ok(legacyAiPrepared > 100)
    const legacyAiPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadAi')
    let legacyAiState
    const legacyAiStartedAt = Date.now()
    while (Date.now() - legacyAiStartedAt < 10000) {
      legacyAiState = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const preview = pages[pages.length - 1].selectComponent('#preview')
        return {
          loading: preview.data.loading,
          error: preview.data.error,
          message: preview.data.message,
          previewPath: preview.data.previewPath,
          metadata: preview.data.metadata
        }
      })
      if (legacyAiState.error || (!legacyAiState.loading && legacyAiState.previewPath)) break
      await legacyAiPage.waitFor(150)
    }
    assert.equal(legacyAiState.error, '')
    assert.match(legacyAiState.previewPath, /illustrator-legacy-preview-\d+-\d+\.svg$/, `旧式 Ai 没有生成 SVG：${JSON.stringify(legacyAiState)}`)
    assert.ok(legacyAiState.metadata.some(item => item.label === '基础路径' && /^2 条/.test(item.value)))
    assert.match(legacyAiState.message, /本机安全还原旧式 Ai/)
    const legacyAiPreview = await legacyAiPage.$('#preview >>> .preview-image')
    assert.ok(legacyAiPreview, '旧式 Ai SVG 没有进入真实 WXML image 节点')
    assert.equal(await legacyAiPreview.attribute('src'), legacyAiState.previewPath)

    const legacyAiEpsiFixture = legacyAiEpsiFixtureBase64()
    await miniProgram.evaluate(fixture => {
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-legacy-epsi.ai`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      getApp().globalData.pendingFilePreview = {
        name: '自动化-旧式位图预览.ai', path: filePath, tempFilePath: filePath,
        size: data.byteLength, type: 'application/postscript'
      }
    }, legacyAiEpsiFixture)
    const legacyAiEpsiPage = await reLaunchWhenReady(miniProgram, '/pages/file-preview/file-preview', 'loadAi')
    let legacyAiEpsiState
    const legacyAiEpsiStartedAt = Date.now()
    while (Date.now() - legacyAiEpsiStartedAt < 10000) {
      legacyAiEpsiState = await miniProgram.evaluate(() => {
        const preview = getCurrentPages().slice(-1)[0].selectComponent('#preview')
        return { loading: preview.data.loading, error: preview.data.error, message: preview.data.message, previewPath: preview.data.previewPath, metadata: preview.data.metadata }
      })
      if (legacyAiEpsiState.error || (!legacyAiEpsiState.loading && legacyAiEpsiState.previewPath)) break
      await legacyAiEpsiPage.waitFor(150)
    }
    assert.equal(legacyAiEpsiState.error, '')
    assert.match(legacyAiEpsiState.previewPath, /illustrator-epsi-preview-\d+-\d+\.jpg$/, `旧式 Ai EPSI 没有生成 JPEG：${JSON.stringify(legacyAiEpsiState)}`)
    assert.ok(legacyAiEpsiState.metadata.some(item => item.label === '屏幕预览' && item.value === '8 × 4 px · 1 bit'))
    assert.match(legacyAiEpsiState.message, /EPSI 位图预览/)
    const legacyAiEpsiJpeg = await miniProgram.evaluate(filePath => {
      const data = new Uint8Array(wx.getFileSystemManager().readFileSync(filePath))
      return { size: data.length, first: data[0], second: data[1] }
    }, legacyAiEpsiState.previewPath)
    assert.ok(legacyAiEpsiJpeg.size > 100)
    assert.equal(legacyAiEpsiJpeg.first, 0xff)
    assert.equal(legacyAiEpsiJpeg.second, 0xd8)

    page = await openSampleReader(miniProgram)
    await page.waitFor(300)

    const wavFixture = wavFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-tone.wav`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-真实音轨.wav', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'audio/wav' })
      return true
    }, wavFixture), true)
    let audioState
    const audioStartedAt = Date.now()
    while (Date.now() - audioStartedAt < 8000) {
      audioState = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const reader = pages[pages.length - 1].selectComponent('#reader')
        return {
          mode: reader.data.mediaMode,
          format: reader.data.mediaFormatLabel,
          canPlay: reader.data.mediaCanPlay,
          diagnostic: reader.data.mediaDiagnostic,
          error: reader.data.error,
          loading: reader.data.isLoading
        }
      })
      if (audioState.error || (audioState.mode === 'audio' && audioState.format === 'WAV' && !audioState.loading)) break
      await page.waitFor(150)
    }
    assert.equal(audioState.error, '')
    assert.equal(audioState.format, 'WAV')
    assert.equal(audioState.canPlay, true)
    const audioButton = await page.$('#reader >>> .audio-play-button')
    assert.ok(audioButton, '真实 WAV 没有上屏播放按钮')
    await audioButton.tap()
    await page.waitFor(200)
    const audioAfterTap = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      return { playing: reader.data.mediaPlaying, diagnostic: reader.data.mediaDiagnostic, error: reader.data.error }
    })
    assert.equal(audioAfterTap.error, '')
    assert.match(audioAfterTap.diagnostic, /已请求播放|可以播放|正在播放/)

    const playlist = Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\npart-001.ts\n').toString('base64')
    assert.equal(await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-local.m3u8`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-本地清单.m3u8', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/vnd.apple.mpegurl' })
      return true
    }, playlist), true)
    await page.waitFor(300)
    const playlistState = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      return {
        mode: reader.data.mediaMode,
        format: reader.data.mediaFormatLabel,
        canPlay: reader.data.mediaCanPlay,
        details: reader.data.mediaDetails,
        diagnostic: reader.data.mediaDiagnostic,
        error: reader.data.error
      }
    })
    assert.equal(playlistState.error, '')
    assert.equal(playlistState.format, 'HLS 播放列表')
    assert.equal(playlistState.canPlay, false)
    assert.ok(playlistState.details.includes('part-001.ts'))
    assert.match(playlistState.diagnostic, /分片、子清单或密钥文件/)
    assert.equal(await page.$('#reader >>> .video-player'), null, '单独 M3U8 不应上屏空视频播放器')
    assert.ok(await page.$('#reader >>> .media-unavailable'), '单独 M3U8 应上屏内容限制说明')

    const dxfFixture = dxfFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-dxf-curves.dxf`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-块填充尺寸.dxf', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/dxf' })
      return true
    }, dxfFixture), true)
    await page.waitFor(300)
    const dxfState = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      return {
        mode: reader.data.inspectorMode,
        title: reader.data.inspectorTitle,
        preview: /^data:image\/svg\+xml;base64,/.test(reader.data.inspectorPreviewSource || ''),
        block: (reader.data.inspectorMetadata.find(item => item.label === '块定义/展开引用') || {}).value,
        hatchDimension: (reader.data.inspectorMetadata.find(item => item.label === '填充边界/尺寸') || {}).value,
        splineBulge: (reader.data.inspectorMetadata.find(item => item.label === '样条/多段线弧') || {}).value,
        curvedHatch: (reader.data.inspectorMetadata.find(item => item.label === 'HATCH 曲线边') || {}).value,
        error: reader.data.error
      }
    })
    assert.deepEqual(dxfState, { mode: true, title: 'DXF 工程图', preview: true, block: '1 / 1', hatchDimension: '2 / 1', splineBulge: '1 / 1', curvedHatch: '1', error: '' })
    const dxfPreview = await page.$('#reader >>> .inspector-preview')
    assert.ok(dxfPreview, 'DXF SVG 预览没有进入真实 WXML image 节点')
    const dxfPreviewSource = await dxfPreview.attribute('src')
    assert.match(dxfPreviewSource, /^data:image\/svg\+xml;base64,/)
    const dxfPreviewSvg = Buffer.from(dxfPreviewSource.split(',')[1], 'base64').toString()
    assert.match(dxfPreviewSvg, /data-dxf-spline="curve"/)
    assert.match(dxfPreviewSvg, /data-dxf-bulge="arc"/)

    const dxf3dFixture = dxf3dFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-3d-face.dxf`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-三维面.dxf', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/dxf' })
      return true
    }, dxf3dFixture), true)
    let dxf3dState
    const dxf3dStartedAt = Date.now()
    while (Date.now() - dxf3dStartedAt < 8000) {
      dxf3dState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return {
          mode: reader.data.inspectorModelMode,
          ready: reader.data.inspectorModelReady,
          status: reader.data.inspectorModelStatus,
          geometry: (reader.data.inspectorMetadata.find(item => item.label === '三维点/边/面') || {}).value,
          error: reader.data.error
        }
      })
      if (dxf3dState.error || dxf3dState.ready) break
      await page.waitFor(150)
    }
    assert.deepEqual(dxf3dState, { mode: 'engineering-wireframe', ready: true, status: '可拖动旋转 · 5 点 / 5 边 / 2 面片', geometry: '5 / 5 / 2', error: '' })
    assert.ok(await page.$('#reader >>> #step-model-canvas'), 'DXF 三维几何没有进入真实可旋转 Canvas')

    const stepFixture = stepCubeFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-cube.step`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-可旋转立方体.step', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/step' })
      return true
    }, stepFixture), true)
    let stepState
    const stepStartedAt = Date.now()
    while (Date.now() - stepStartedAt < 8000) {
      stepState = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const reader = pages[pages.length - 1].selectComponent('#reader')
        return {
          mode: reader.data.inspectorModelMode,
          ready: reader.data.inspectorModelReady,
          status: reader.data.inspectorModelStatus,
          view: reader.data.inspectorModelView,
          revision: reader.data.inspectorModelRevision,
          faces: (reader.data.inspectorMetadata.find(item => item.label === '可见面片') || {}).value,
          error: reader.data.error
        }
      })
      if (stepState.error || stepState.ready) break
      await page.waitFor(150)
    }
    assert.equal(stepState.error, '')
    assert.equal(stepState.mode, 'step-wireframe')
    assert.equal(stepState.ready, true)
    assert.match(stepState.status, /8 点 \/ 12 边 \/ 12 面片/)
    assert.equal(stepState.faces, '12')
    const stepCanvas = await page.$('#reader >>> #step-model-canvas')
    assert.ok(stepCanvas, 'STEP 可旋转 Canvas 没有进入真实 WXML 节点')
    await stepCanvas.touchstart({ touches: [{ clientX: 100, clientY: 100 }] })
    await stepCanvas.touchmove({ touches: [{ clientX: 160, clientY: 125 }] })
    await stepCanvas.touchend({ touches: [] })
    await page.waitFor(100)
    const rotatedStep = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      return { view: reader.data.inspectorModelView, revision: reader.data.inspectorModelRevision }
    })
    assert.equal(rotatedStep.view, 'custom')
    assert.ok(rotatedStep.revision > 0, 'STEP 真实触摸没有改变三维视角')
    const topView = await page.$('#reader >>> .step-view-top')
    assert.ok(topView, 'STEP 俯视按钮没有进入真实 WXML')
    await topView.tap()
    await page.waitFor(100)
    assert.equal(await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      return pages[pages.length - 1].selectComponent('#reader').data.inspectorModelView
    }), 'top')

    const stepCylinderFixture = stepCylinderFixtureBase64()
    await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-cylinder.step`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-圆柱.step', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/step' })
    }, stepCylinderFixture)
    let stepCylinderState
    const cylinderStartedAt = Date.now()
    while (Date.now() - cylinderStartedAt < 8000) {
      stepCylinderState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return {
          ready: reader.data.inspectorModelReady,
          status: reader.data.inspectorModelStatus,
          faces: (reader.data.inspectorMetadata.find(item => item.label === '可见面片') || {}).value,
          error: reader.data.error
        }
      })
      if (stepCylinderState.error || stepCylinderState.ready) break
      await page.waitFor(150)
    }
    assert.equal(stepCylinderState.error, '')
    assert.equal(stepCylinderState.ready, true)
    assert.match(stepCylinderState.status, /69 点 \/ 68 边 \/ 64 面片/)
    assert.equal(stepCylinderState.faces, '64')

    const verifyStepSurface = async (name, fixture, expectedStatus, expectedFaces) => {
      await miniProgram.evaluate((fileName, base64) => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const data = wx.base64ToArrayBuffer(base64)
        const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-${fileName}`
        wx.getFileSystemManager().writeFileSync(filePath, data)
        reader.openSelectedFile({ name: fileName, path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/step' })
      }, name, fixture)
      let state
      const startedAt = Date.now()
      while (Date.now() - startedAt < 10000) {
        state = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return {
            ready: reader.data.inspectorModelReady,
            status: reader.data.inspectorModelStatus,
            faces: (reader.data.inspectorMetadata.find(item => item.label === '可见面片') || {}).value,
            instances: (reader.data.inspectorMetadata.find(item => item.label === '装配实例') || {}).value,
            relationshipInstances: (reader.data.inspectorMetadata.find(item => item.label === '关系型装配') || {}).value,
            error: reader.data.error
          }
        })
        if (state.error || state.ready) break
        await page.waitFor(150)
      }
      assert.equal(state.error, '')
      assert.equal(state.ready, true)
      assert.match(state.status, expectedStatus)
      assert.equal(state.faces, expectedFaces)
      return state
    }
    const stepConeState = await verifyStepSurface('自动化-圆锥.step', stepConeFixtureBase64(), /69 点 \/ 68 边 \/ 64 面片/, '64')
    const stepSphereState = await verifyStepSurface('自动化-球面.step', stepSphereFixtureBase64(), /421 点 \/ 420 边 \/ 768 面片/, '768')
    const stepTorusState = await verifyStepSurface('自动化-环面.step', stepTorusFixtureBase64(), /423 点 \/ 420 边 \/ 768 面片/, '768')
    const stepFreeformState = await verifyStepSurface('自动化-自由曲面.step', stepFreeformFixtureBase64(), /178 点 \/ 316 边 \/ 288 面片/, '288')
    const stepAssemblyState = await verifyStepSurface('自动化-装配映射.step', stepMappedAssemblyFixtureBase64(), /6 点 \/ 6 边 \/ 2 面片/, '2')
    assert.equal(stepAssemblyState.instances, '2')
    const stepRelationshipAssemblyState = await verifyStepSurface('自动化-关系型装配.step', stepRelationshipAssemblyFixtureBase64(), /3 点 \/ 3 边 \/ 1 面片/, '1')
    assert.equal(stepRelationshipAssemblyState.instances, '1')
    assert.equal(stepRelationshipAssemblyState.relationshipInstances, '1')

    assert.equal(await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const data = wx.base64ToArrayBuffer('QUMxMDMycmFiYml0LXJlYWRlci1kd2ctd2l0aG91dC1wcmV2aWV3')
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-no-preview.dwg`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-无预览图纸.dwg', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/acad' })
      return true
    }), true)
    let dwgUnsupportedState
    const dwgStartedAt = Date.now()
    while (Date.now() - dwgStartedAt < 8000) {
      dwgUnsupportedState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const metadata = Object.fromEntries((reader.data.inspectorMetadata || []).map(item => [item.label, item.value]))
        return {
          loading: reader.data.isLoading,
          error: reader.data.error,
          title: reader.data.inspectorTitle,
          summary: reader.data.inspectorSummary,
          previewPath: reader.data.inspectorPreviewPath,
          previewSource: reader.data.inspectorPreviewSource,
          metadata
        }
      })
      if (dwgUnsupportedState.error || !dwgUnsupportedState.loading) break
      await page.waitFor(150)
    }
    assert.equal(dwgUnsupportedState.error, '')
    assert.equal(dwgUnsupportedState.title, 'DWG 文件（图纸内容未支持）')
    assert.equal(dwgUnsupportedState.previewPath, '')
    assert.equal(dwgUnsupportedState.previewSource, '')
    assert.equal(dwgUnsupportedState.metadata['图纸内容'], '未支持（不是图纸预览）')
    assert.equal(dwgUnsupportedState.metadata['可行操作'], '在 CAD 软件中另存为 DXF 后打开')
    assert.match(dwgUnsupportedState.summary, /不能解码 DWG 图纸几何/)

    const cdrFixture = cdrDispFixtureBase64()
    assert.equal(await miniProgram.evaluate(fixture => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-disp.cdr`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-DISP画布.cdr', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/x-cdr' })
      return true
    }, cdrFixture), true)
    let cdrState
    const cdrStartedAt = Date.now()
    while (Date.now() - cdrStartedAt < 8000) {
      cdrState = await miniProgram.evaluate(() => {
        const pages = getCurrentPages()
        const reader = pages[pages.length - 1].selectComponent('#reader')
        return {
          mode: reader.data.inspectorMode,
          title: reader.data.inspectorTitle,
          summary: reader.data.inspectorSummary,
          previewPath: reader.data.inspectorPreviewPath,
          entries: reader.data.inspectorEntries.map(entry => entry.name),
          canvas: (reader.data.inspectorMetadata.find(item => item.label === '画布预览') || {}).value,
          error: reader.data.error
        }
      })
      if (cdrState.error || cdrState.previewPath) break
      await page.waitFor(150)
    }
    assert.equal(cdrState.error, '')
    assert.equal(cdrState.mode, true)
    assert.equal(cdrState.title, 'CorelDRAW 文件')
    assert.equal(cdrState.canvas, '2 × 2 px')
    assert.deepEqual(cdrState.entries, ['vrsn', 'DISP'])
    assert.match(cdrState.summary, /DISP 画布缩略图/)
    assert.match(cdrState.previewPath, /\.jpg$/)
    const cdrPreview = await page.$('#reader >>> .inspector-preview')
    assert.ok(cdrPreview, 'CDR DISP 还原图没有进入真实 WXML image 节点')
    assert.equal(await cdrPreview.attribute('src'), cdrState.previewPath)

    const compressedCdrFixture = cdrCompressedVectorFixtureBase64()
    await miniProgram.evaluate(fixture => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
      const data = wx.base64ToArrayBuffer(fixture)
      const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-compressed-vector.cdr`
      wx.getFileSystemManager().writeFileSync(filePath, data)
      reader.openSelectedFile({ name: '自动化-无缩略图压缩矢量.cdr', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/x-cdr' })
    }, compressedCdrFixture)
    let compressedCdrState
    const compressedCdrStartedAt = Date.now()
    while (Date.now() - compressedCdrStartedAt < 8000) {
      compressedCdrState = await miniProgram.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        return {
          title: reader.data.inspectorTitle,
          summary: reader.data.inspectorSummary,
          previewSource: reader.data.inspectorPreviewSource,
          previewPath: reader.data.inspectorPreviewPath,
          vectors: (reader.data.inspectorMetadata.find(item => item.label === '基础矢量对象') || {}).value,
          points: (reader.data.inspectorMetadata.find(item => item.label === '矢量控制点') || {}).value,
          error: reader.data.error
        }
      })
      if (compressedCdrState.error || compressedCdrState.previewSource) break
      await page.waitFor(150)
    }
    assert.equal(compressedCdrState.error, '')
    assert.equal(compressedCdrState.title, 'CorelDRAW 文件')
    assert.equal(compressedCdrState.vectors, '1')
    assert.equal(compressedCdrState.points, '3')
    assert.equal(compressedCdrState.previewPath, '')
    assert.match(compressedCdrState.previewSource, /^data:image\/svg\+xml;base64,/)
    assert.match(compressedCdrState.summary, /即使文件没有 DISP 缩略图，也会显示真实矢量内容/)
    const compressedCdrPreview = await page.$('#reader >>> .inspector-preview')
    assert.ok(compressedCdrPreview, 'CDR LIST cmpr 矢量没有进入真实 WXML image 节点')
    assert.equal(await compressedCdrPreview.attribute('src'), compressedCdrState.previewSource)

    let officialCdrRave = null
    const officialCdrPath = process.env.CDR_OFFICIAL_SAMPLE_PATH
    if (officialCdrPath) {
      const officialFixture = (await fs.readFile(path.resolve(officialCdrPath))).toString('base64')
      await miniProgram.evaluate(fixture => {
        const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
        const data = wx.base64ToArrayBuffer(fixture)
        const filePath = `${wx.env.USER_DATA_PATH}/rabbit-reader-official-rave.cdr`
        wx.getFileSystemManager().writeFileSync(filePath, data)
        reader.openSelectedFile({ name: 'CoffeeShop.cdr', path: filePath, tempFilePath: filePath, size: data.byteLength, type: 'application/x-cdr' })
      }, officialFixture)
      const startedAt = Date.now()
      while (Date.now() - startedAt < 8000) {
        officialCdrRave = await miniProgram.evaluate(() => {
          const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader')
          return {
            title: reader.data.inspectorTitle,
            previewSource: reader.data.inspectorPreviewSource,
            previewPath: reader.data.inspectorPreviewPath,
            form: (reader.data.inspectorMetadata.find(item => item.label === '容器标识') || {}).value,
            canvas: (reader.data.inspectorMetadata.find(item => item.label === '画布预览') || {}).value,
            vectors: (reader.data.inspectorMetadata.find(item => item.label === '基础矢量对象') || {}).value,
            error: reader.data.error
          }
        })
        if (officialCdrRave.error || officialCdrRave.previewPath || officialCdrRave.previewSource) break
        await page.waitFor(150)
      }
      assert.equal(officialCdrRave.error, '')
      assert.equal(officialCdrRave.title, 'Corel R.A.V.E. / CDR 文件')
      assert.equal(officialCdrRave.form, 'CARA')
      assert.equal(officialCdrRave.canvas, '96 × 96 px')
      assert.equal(officialCdrRave.vectors, '11')
      assert.match(officialCdrRave.previewSource, /^data:image\/svg\+xml;base64,/)
    }

    // Exercise the visible queue, not only inspectFileBytes or page methods.
    const cdrFixtures = require('../tests/helpers/cdr-zlib')
    const cdrQueue = [{ name: 'cdr-valid-before.cdr', bytes: cdrFixtures.cdrCompressedVectorFixture(), generated: true }]
    const { cdrOutlineFixture } = require('../tests/helpers/cdr-outline')
    cdrQueue.push(...[
      { name: 'cdr-no-outline.cdr', options: { type: 1 }, stroke: { stroke: 'none', 'stroke-width': '0' } },
      { name: 'cdr-fine-outline.cdr', options: { type: 2, width: 1 }, stroke: { stroke: '#112233', 'stroke-width': '0.00000393700787402' } },
      { name: 'cdr-square-bevel.cdr', options: { type: 2, caps: 2, join: 2, stretch: 125 }, stroke: { 'stroke-width': '0.125', 'stroke-linecap': 'square', 'stroke-linejoin': 'bevel' } },
      { name: 'cdr-dashed-outline.cdr', options: { type: 4, dashes: [4, 2] }, stroke: { 'stroke-dasharray': '0.4 0.2' } },
      { name: 'cdr-wide-outline.cdr', options: { type: 2, width: 254000 }, stroke: { 'stroke-width': '1' } }
    ].map(item => ({ name: item.name, bytes: cdrOutlineFixture(item.options), expectedStroke: item.stroke, generated: true })))
    cdrQueue.push(...cdrFixtures.cdrZlibFailureFixtures().map(item => ({ ...item, expectFailure: true })))
    if (process.env.CDR_REAL_SAMPLE_DIR) {
      for (const sample of require('../compatibility/profiles/cdr.json').publicSamples) {
        const bytes = await fs.readFile(path.join(process.env.CDR_REAL_SAMPLE_DIR, sample.name))
        assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), sample.sha256)
        cdrQueue.push({ name: sample.name, bytes, expectedSvg: require('../miniprogram/file-reader/engine/core/file-inspector').inspectFileBytes(bytes, { name: sample.name }).previewSvg })
        // Keep the independent DISP thumbnail; damage only a real cmpr Adler.
        const bad = Buffer.from(bytes)
        let damaged = false
        for (let offset = 12; offset + 8 <= bytes.length;) {
          const length = bytes.readUInt32LE(offset + 4), start = offset + 8
          assert.ok(start + length <= bytes.length)
          if (bytes.toString('ascii', offset, offset + 4) === 'LIST' && bytes.toString('ascii', start, start + 4) === 'cmpr' && bytes.readUInt32LE(start + 8) > 0) {
            const end = start + 28 + bytes.readUInt32LE(start + 4) - 8
            bad[end - 1] ^= 1; damaged = true; break
          }
          offset = start + length + (length & 1)
        }
        assert.ok(damaged)
        cdrQueue.push({ name: `bad-adler-${sample.name}`, bytes: bad, thumbnailFallback: true })
      }
    }
    cdrQueue.push({ name: 'cdr-valid-after.cdr', bytes: cdrFixtures.cdrCompressedVectorFixture(), generated: true })
    await miniProgram.evaluate(inputs => {
      getApp().globalData.fileQueue = inputs.map(input => {
        const data = wx.base64ToArrayBuffer(input.base64)
        const filePath = `${wx.env.USER_DATA_PATH}/${input.name}`
        wx.getFileSystemManager().writeFileSync(filePath, data)
        return { name: input.name, path: filePath, size: data.byteLength, type: 'application/x-cdr' }
      })
      getCurrentPages().slice(-1)[0].openQueueIndex(0)
    }, cdrQueue.map(item => ({ name: item.name, base64: item.bytes.toString('base64') })))
    const cdrIntegrityStates = []
    for (let index = 0; index < cdrQueue.length; index++) {
      const sample = cdrQueue[index], started = Date.now()
      if (index) {
        const next = (await page.$$('.queue-button'))[1]
        assert.ok(next, 'CDR 缺少下一份按钮')
        await next.tap()
      }
      let state
      while (Date.now() - started < 15000) {
        state = await componentState(page, '#reader')
        if (state.queuePosition === index + 1 && !state.isLoading && state.inspectorMode) break
        await page.waitFor(150)
      }
      assert.equal(state.error, '', `${sample.name}: ${state.error}`)
      assert.equal(state.isLoading, false)
      assert.equal(state.queuePosition, index + 1)
      assert.equal(state.sourceName, sample.name)
      const summaryNode = await page.$('#reader >>> .inspector-summary')
      assert.ok(summaryNode)
      assert.equal(await summaryNode.text(), state.inspectorSummary)
      const imageNode = await page.$('#reader >>> .inspector-preview')
      if (sample.expectFailure) {
        assert.equal(state.inspectorPreviewSource, '')
        assert.equal(state.inspectorPreviewPath, '')
        assert.equal(imageNode, null, '异常 CDR 不能保留上一份图像')
        assert.ok(state.inspectorSummary.includes(sample.message), `${sample.name}: ${state.inspectorSummary}`)
      } else if (sample.thumbnailFallback) {
        assert.equal(state.inspectorPreviewSource, '')
        assert.ok(state.inspectorPreviewPath)
        assert.match(state.inspectorSummary, /校验失败.*仅显示独立内嵌缩略图.*不代表完整正文/)
        assert.ok(imageNode)
        assert.equal(await imageNode.attribute('src'), state.inspectorPreviewPath)
      } else {
        assert.ok(imageNode)
        assert.equal(await imageNode.attribute('src'), state.inspectorPreviewSource)
        assert.match(state.inspectorPreviewSource, /^data:image\/svg\+xml;base64,/)
        const svg = Buffer.from(state.inspectorPreviewSource.split(',')[1], 'base64').toString('utf8')
        if (sample.generated) { assert.ok(svg.includes('M2 -3L3 -3L2 -4Z')); assert.ok(svg.includes('fill="#ff5b43"')) }
        else assert.equal(svg, sample.expectedSvg, '微信画面必须与已独立对照的 SVG 相同')
        if (sample.expectedStroke) {
          const path = svg.match(/<path\b[^>]+>/)?.[0]
          assert.ok(path)
          for (const [name, value] of Object.entries(sample.expectedStroke)) assert.ok(path.includes(`${name}="${value}"`), `${sample.name}: ${name} not applied`)
        }
      }
      if (process.env.CDR_SCREENSHOT_DIR) {
        await page.waitFor(300)
        await miniProgram.screenshot({ path: path.join(process.env.CDR_SCREENSHOT_DIR, `cdr-${index}.png`) })
      }
      cdrIntegrityStates.push({ name: sample.name, actualImage: !!imageNode, rejected: !!sample.expectFailure,
        thumbnailFallback: !!sample.thumbnailFallback, expectedStroke: sample.expectedStroke, summary: state.inspectorSummary, queueButtonTapped: index > 0, elapsedMs: Date.now() - started })
      console.log(`CDR queue: ${sample.name} / ${sample.expectFailure ? 'rejected-no-stale-image' : sample.thumbnailFallback ? 'explicit-thumbnail-only' : 'actual-vector'}`)
    }

    const rawTextBoundaryHtml = `<html><head><title>结构边界标题</title>
      <style>#after-raw{color:rgb(1,2,3)}#after-raw::before{content:"</head>"}</style>
      </head><body>
      <textarea id="raw-notes">&lt;保留&gt; </body> 仍是输入内容</textarea>
      <button id="raw-change">更新</button><p id="after-raw">后续正文完整</p>
      <script>const fakeBodyEnd="</body>";document.getElementById('raw-change').onclick=()=>{document.getElementById('after-raw').textContent='点击仍可交互'}</script>
      </body></html>`
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/rawtext-boundary.html', name: 'rawtext-boundary.html' }, rawTextBoundaryHtml)
    await waitForReady(miniProgram, page, 'rawtext-boundary.html')
    await assertHealthy(miniProgram, 'rawtext-boundary.html')
    const rawTextBoundaryState = await miniProgram.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], reader = host.selectComponent('#reader'), document = reader._htmlRuntime.document
      return {
        title: document.title,
        notes: document.getElementById('raw-notes').value,
        after: document.getElementById('after-raw').textContent,
        notesNid: document.getElementById('raw-notes')._nid,
        afterNid: document.getElementById('after-raw')._nid
      }
    })
    assert.deepEqual({ title: rawTextBoundaryState.title, notes: rawTextBoundaryState.notes, after: rawTextBoundaryState.after }, {
      title: '结构边界标题', notes: '<保留> </body> 仍是输入内容', after: '后续正文完整'
    })
    const rawNotes = await page.$(`#reader >>> textarea[data-nid="${rawTextBoundaryState.notesNid}"]`)
    const rawAfter = await page.$(`#reader >>> #dom-nid-${rawTextBoundaryState.afterNid}`)
    assert.ok(rawNotes); assert.equal(await rawNotes.value(), rawTextBoundaryState.notes)
    assert.ok(rawAfter); assert.equal(await rawAfter.text(), '</head>后续正文完整')
    assert.match(await rawAfter.style('color'), /^(?:rgb\(1,\s*2,\s*3\)|#010203)$/)
    await tapRequired(miniProgram, page, '#raw-change')
    assert.equal(await rawAfter.text(), '</head>点击仍可交互')
    rawTextBoundaryState.actualTextBefore = '</head>后续正文完整'
    rawTextBoundaryState.actualTextAfter = '</head>点击仍可交互'
    rawTextBoundaryState.actualView = true
    console.log('HTML RAWTEXT/RCDATA: structural pseudo-end tags preserve title, CSS, textarea, prose and tap')

    const { visualHtml: whitespaceHtml } = require('../tests/helpers/html-whitespace')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/whitespace.html', name: 'whitespace.html' }, whitespaceHtml)
    await waitForReady(miniProgram, page, 'whitespace.html')
    await assertHealthy(miniProgram, 'whitespace.html')
    const whitespaceStates = []
    async function checkWhitespace (id, expected, expectedHeight) {
      const target = await miniProgram.evaluate(id => {
        const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), source = p._htmlRuntime.document.getElementById(id)
        const find = nodes => { for (const n of nodes || []) { if (n.nid === source._nid) return n; const hit = find(n.children); if (hit) return hit } }
        const text = node => node.type === 'text' ? node.text : (node.children || []).map(text).join('')
        const n = find(p.data.domTree)
        return { nid: source._nid, sourceText: source.textContent, renderedText: n && text(n) }
      }, id)
      assert.equal(target.renderedText, expected, `whitespace ${id}: content`)
      const element = await page.$(`#reader >>> #dom-nid-${target.nid}`)
      assert.ok(element, `whitespace ${id}: actual view missing`)
      const size = await element.size()
      assert.ok(Math.abs(size.height - expectedHeight) < 1, `whitespace ${id}: height ${size.height} != ${expectedHeight}`)
      whitespaceStates.push({ id, text: target.renderedText, actualView: true, height: size.height })
    }
    await checkWhitespace('blank', 'A\n\nB', 84)
    await checkWhitespace('nbsp', 'A\u00a0\u00a0B', 28)
    await checkWhitespace('wide', '\u3000\u3000正文', 28)
    await checkWhitespace('split', 'A\n\nB', 84)
    await checkWhitespace('normal', 'A B', 28)
    if (process.env.WHITESPACE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.WHITESPACE_SCREENSHOT_DIR, 'before-update.png') })
    await tapRequired(miniProgram, page, '#update')
    await checkWhitespace('dynamic', '更新A\n\n更新B\u00a0\u00a0结束', 84)
    if (process.env.WHITESPACE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.WHITESPACE_SCREENSHOT_DIR, 'after-update.png') })
    console.log('HTML whitespace: six actual content/height assertions and real update-button tap passed')

    const { visualHtml: entitiesHtml } = require('../tests/helpers/html-entities')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/entities.html', name: 'entities.html' }, entitiesHtml)
    await waitForReady(miniProgram, page, 'entities.html')
    await assertHealthy(miniProgram, 'entities.html')
    const entityStates = []
    async function checkEntity (id, expected, control = false) {
      const target = await miniProgram.evaluate(({ id, control }) => {
        const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'), source = p._htmlRuntime.document.getElementById(id)
        const find = nodes => { for (const n of nodes || []) { if (n.nid === source._nid) return n; const hit = find(n.children); if (hit) return hit } }
        const text = n => n.type === 'text' ? n.text : (n.children || []).map(text).join('')
        const n = find(p.data.domTree)
        return { nid: source._nid, tag: source.localName, sourceValue: control ? source.value : source.textContent, renderedValue: control ? n.attrs.value : text(n) }
      }, { id, control })
      assert.equal(target.sourceValue, expected, `entity ${id}: runtime`)
      assert.equal(target.renderedValue, expected, `entity ${id}: rendered content`)
      // Native controls carry data-nid, while generic view nodes have an id.
      const element = await page.$(control ? `#reader >>> ${target.tag}[data-nid="${target.nid}"]` : `#reader >>> #dom-nid-${target.nid}`)
      assert.ok(element, `entity ${id}: actual view missing`)
      if (control) assert.equal(await element.value(), expected, `entity ${id}: native control value`)
      else assert.equal(await element.text(), expected, `entity ${id}: actual view text`)
      entityStates.push({ id, value: expected, nativeControl: control, actualView: true })
    }
    await checkEntity('symbols', '© € ≂̸ 🐰')
    await checkEntity('invalid', '前�中�后�结束')
    await checkEntity('once', '&copy; &amP; ¬it;')
    await checkEntity('value', '© € �', true)
    await checkEntity('area', '€ &copy;', true)
    if (process.env.ENTITY_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.ENTITY_SCREENSHOT_DIR, 'before-update.png') })
    await tapRequired(miniProgram, page, '#entity-update')
    await checkEntity('updated', '© € � &copy;')
    await checkEntity('area', '€ <b>原样标签</b> �', true)
    if (process.env.ENTITY_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.ENTITY_SCREENSHOT_DIR, 'after-update.png') })
    console.log('HTML entities: actual text/input/textarea and real update-button tap passed')

    const { visualHtml: cssEscapesHtml } = require('../tests/helpers/css-escapes')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/css-escapes.html', name: 'css-escapes.html' }, cssEscapesHtml)
    await waitForReady(miniProgram, page, 'css-escapes.html')
    await assertHealthy(miniProgram, 'css-escapes.html')
    const cssEscapeStates = []
    async function checkCssEscapeText (id, expected) {
      const nid = await miniProgram.evaluate(id => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById(id)._nid, id)
      const el = await page.$(`#reader >>> #dom-nid-${nid}`)
      assert.ok(el, `CSS escape actual view missing: ${id}`)
      assert.equal(await el.text(), expected, `CSS escape actual text: ${id}`)
      const size = await el.size()
      assert.ok(Math.abs(size.height - 32) < 1, `CSS escape ${id}: inline paragraph height ${size.height} != 32`)
      if (id === 'AB') assert.match(await el.style('font-weight'), /^(?:bold|700)$/, 'escaped selector actual font weight')
      cssEscapeStates.push({ id, text: expected, actualView: true, height: size.height })
    }
    await checkCssEscapeText('bad', '�后续正文完整')
    await checkCssEscapeText('spaces', 'A B · 不换行空格保留')
    await checkCssEscapeText('literal', '属性原文：\\110000')
    await checkCssEscapeText('AB', '转义选择器命中')
    if (process.env.CSS_ESCAPE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_ESCAPE_SCREENSHOT_DIR, 'before-update.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkCssEscapeText('literal', '属性原文：更新完成')
    await checkCssEscapeText('result', '点击已生效')
    if (process.env.CSS_ESCAPE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_ESCAPE_SCREENSHOT_DIR, 'after-update.png') })
    console.log('CSS escapes: six actual text assertions and real update-button tap passed')

    const { visualHtml: cssStructureHtml } = require('../tests/helpers/css-structure')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/css-structure.html', name: 'css-structure.html' }, cssStructureHtml)
    await waitForReady(miniProgram, page, 'css-structure.html')
    await assertHealthy(miniProgram, 'css-structure.html')
    const cssStructureStates = []
    async function checkCssStructureText (id, expected) {
      const nid = await miniProgram.evaluate(id => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById(id)._nid, id)
      const el = await page.$(`#reader >>> #dom-nid-${nid}`)
      assert.ok(el, `CSS structure actual view missing: ${id}`)
      assert.equal(await el.text(), expected, `CSS structure actual text: ${id}`)
      const size = await el.size()
      assert.ok(Math.abs(size.height - 28.8) < 1, `CSS structure ${id}: paragraph height ${size.height} != 28.8`)
      if (id === 'foo ') assert.match(await el.style('font-weight'), /^(?:bold|700)$/)
      cssStructureStates.push({ id, text: expected, actualView: true, height: size.height })
    }
    await checkCssStructureText('braces', '{前缀} 正文保留')
    await checkCssStructureText('literal', '/*原文*/ @media { }')
    await checkCssStructureText('url', 'url(test) / var(--x)')
    await checkCssStructureText('foo ', '转义空格选择器')
    await checkCssStructureText('dynamic', '{等待更新}')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'before-update.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkCssStructureText('dynamic', '{更新完成}')
    await checkCssStructureText('result', '点击已生效')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'after-update.png') })
    const publicCssStructureStates = []
    for (const name of ['blocks-and-strings-001.xht', 'comments-001.xht', 'escaped-ident-spaces-001.xht']) {
      const html = await fs.readFile(path.join(projectRoot, 'tests/fixtures/css-structure', name), 'utf8')
      await scheduleReadMaterial(miniProgram, { path: `/__generated__/${name}.html`, name: `${name}.html` }, html)
      await waitForReady(miniProgram, page, `${name}.html`)
      await assertHealthy(miniProgram, `${name}.html`)
      const nid = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.querySelector('div')._nid)
      const el = await page.$(`#reader >>> #dom-nid-${nid}`)
      assert.ok(el); assert.equal(await el.text(), 'Filler Text')
      const color = await el.style('color')
      assert.match(color, /^(?:green|rgb\(0,\s*128,\s*0\))$/)
      publicCssStructureStates.push({ name, text: 'Filler Text', color, actualView: true })
    }
    console.log('CSS structure: seven actual texts/heights, real tap and three public green views passed')

    const { visualHtml: cssIdentifierHtml } = require('../tests/helpers/css-identifiers')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/css-identifiers.html', name: 'css-identifiers.html' }, cssIdentifierHtml)
    await waitForReady(miniProgram, page, 'css-identifiers.html')
    await assertHealthy(miniProgram, 'css-identifiers.html')
    const cssIdentifierStates = []
    async function checkCssIdentifierView (id, expectedText, expectedColor) {
      const nid = await miniProgram.evaluate(id => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById(id)._nid, id)
      const el = await page.$(`#reader >>> #dom-nid-${nid}`)
      assert.ok(el, `CSS identifier actual view missing: ${id}`)
      assert.equal(await el.text(), expectedText)
      const color = await el.style('color'), size = await el.size()
      assert.ok(Math.abs(size.height - 28.8) < 1, `CSS identifier height ${size.height} != 28.8`)
      assert.match(color, expectedColor === 'green' ? /^(?:green|rgb\(0,\s*128,\s*0\))$/ : /^(?:blue|rgb\(0,\s*0,\s*255\))$/)
      cssIdentifierStates.push({ id, text: expectedText, color, height: size.height, actualView: true })
    }
    await checkCssIdentifierView('escaped', '转义属性：绿色', 'green')
    await checkCssIdentifierView('variable', '大小写变量：绿色', 'green')
    await checkCssIdentifierView('inline', '行内变量：绿色', 'green')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'identifiers-before.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkCssIdentifierView('variable', '大小写变量：蓝色', 'blue')
    await checkCssIdentifierView('inline', '行内变量：蓝色', 'blue')
    await checkCssIdentifierView('escaped', '转义属性：绿色', 'green')
    const resultNid = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('result')._nid)
    assert.equal(await (await page.$(`#reader >>> #dom-nid-${resultNid}`)).text(), '点击已生效')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'identifiers-after.png') })
    console.log('CSS identifiers: six actual color/text/height assertions and real update-button tap passed')

    const { visualHtml: cssVariableHtml } = require('../tests/helpers/css-variables')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/css-variables.html', name: 'css-variables.html' }, cssVariableHtml)
    await waitForReady(miniProgram, page, 'css-variables.html')
    await assertHealthy(miniProgram, 'css-variables.html')
    const cssVariableStart = cssIdentifierStates.length
    await checkCssIdentifierView('inherited', '继承别名：绿色', 'green')
    await checkCssIdentifierView('cycle', '循环备用：绿色', 'green')
    await checkCssIdentifierView('updated', '动态别名：绿色', 'green')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'variables-before.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkCssIdentifierView('inherited', '继承别名：蓝色', 'blue')
    await checkCssIdentifierView('updated', '动态别名：蓝色', 'blue')
    await checkCssIdentifierView('cycle', '循环备用：绿色', 'green')
    const cssVariableStates = cssIdentifierStates.splice(cssVariableStart)
    const variableResultNid = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('result')._nid)
    assert.equal(await (await page.$(`#reader >>> #dom-nid-${variableResultNid}`)).text(), '点击已生效')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'variables-after.png') })
    console.log('CSS variable dependency: six actual colors/texts/heights and real root-variable update tap passed')

    const { visualHtml: computedStyleHtml } = require('../tests/helpers/computed-style')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/computed-style.html', name: 'computed-style.html' }, computedStyleHtml)
    await waitForReady(miniProgram, page, 'computed-style.html')
    await assertHealthy(miniProgram, 'computed-style.html')
    const computedStyleStates = []
    const checkComputedStyleView = async (expectedColor, expectedWidth, expectedText) => {
      const start = cssIdentifierStates.length
      await checkCssIdentifierView('probe', '可交互正文', expectedColor)
      const state = cssIdentifierStates.splice(start)[0]
      const ids = await miniProgram.evaluate(() => { const d = getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document; return ['probe', 'result'].map(id => d.getElementById(id)._nid) })
      const actualWidth = (await (await page.$(`#reader >>> #dom-nid-${ids[0]}`)).size()).width
      assert.ok(Math.abs(actualWidth - expectedWidth) < 1, `computed style width ${actualWidth} != ${expectedWidth}`)
      assert.equal(await (await page.$(`#reader >>> #dom-nid-${ids[1]}`)).text(), expectedText)
      computedStyleStates.push({ ...state, width: actualWidth, output: expectedText })
    }
    await checkComputedStyleView('green', 200, 'green / 200px')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'computed-style-before.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkComputedStyleView('blue', 240, 'blue / 240px')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'computed-style-after.png') })
    console.log('Computed styles: actual output, color, width and height verified before/after real tap')

    const directionHtml = `<!doctype html><div id="direction-scope" dir="rtl"><p id="direction-probe">אבג 123</p><p id="direction-result"></p><button id="direction-change">切换方向</button></div><script>
      const scope=document.getElementById('direction-scope'), probe=document.getElementById('direction-probe'), result=document.getElementById('direction-result'), style=getComputedStyle(probe);
      function show(){result.textContent=style.direction} show();
      document.getElementById('direction-change').onclick=()=>{scope.setAttribute('dir','ltr');show()}
    </script>`
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/direction-inheritance.html', name: 'direction-inheritance.html' }, directionHtml)
    await waitForReady(miniProgram, page, 'direction-inheritance.html')
    await assertHealthy(miniProgram, 'direction-inheritance.html')
    const directionNids = await miniProgram.evaluate(() => {
      const d = getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document
      return ['direction-scope', 'direction-result'].map(id => d.getElementById(id)._nid)
    })
    const directionScope = await page.$(`#reader >>> #dom-nid-${directionNids[0]}`)
    const directionResult = await page.$(`#reader >>> #dom-nid-${directionNids[1]}`)
    assert.ok(directionScope); assert.ok(directionResult)
    assert.equal(await directionResult.text(), 'rtl')
    assert.match(await directionScope.attribute('style'), /(?:^|;)direction:rtl(?:;|$)/)
    await tapRequired(miniProgram, page, '#direction-change')
    assert.equal(await directionResult.text(), 'ltr')
    assert.match(await directionScope.attribute('style'), /(?:^|;)direction:ltr(?:;|$)/)
    const directionStates = { before: 'rtl', after: 'ltr', actualView: true, realTap: true }
    console.log('HTML dir inheritance: actual WXML direction and live computed style update passed')

    // Recreate the reader before the final HTML group. A single page instance has
    // already processed every binary fixture and many interactive DOMs above;
    // keeping that instance makes DevTools automation time out during the next
    // synchronous parse even though the same document passes in a fresh page.
    page = await openSampleReader(miniProgram)
    await page.waitFor(500)

    const { visualHtml: cascadeOrderHtml } = require('../tests/helpers/css-cascade-order')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/cascade-order.html', name: 'cascade-order.html' }, cascadeOrderHtml)
    await waitForReady(miniProgram, page, 'cascade-order.html')
    await assertHealthy(miniProgram, 'cascade-order.html')
    const cascadeOrderStates = []
    const checkCascadeOrderView = async (color, font, padding, output) => {
      const ids = await miniProgram.evaluate(() => { const d = getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document; return ['card', 'result'].map(id => d.getElementById(id)._nid) })
      const card = await page.$(`#reader >>> #dom-nid-${ids[0]}`)
      assert.ok(card)
      assert.equal(await card.text(), '标题和正文应保持字号、底色与间距。')
      const actualColor = (await card.style('background-color')).replace(/\s/g, '').toLowerCase()
      assert.ok(color.includes(actualColor), `cascade background ${actualColor}`)
      assert.equal(await card.style('font-size'), `${font}px`)
      assert.equal(await card.style('padding-left'), `${padding}px`)
      assert.equal(await (await page.$(`#reader >>> #dom-nid-${ids[1]}`)).text(), output)
      const size = await card.size()
      assert.ok(size.width > 0 && size.height > 0)
      cascadeOrderStates.push({ color: actualColor, font, padding, output, size, actualView: true })
    }
    await checkCascadeOrderView(['#f2ffc9', 'rgb(242,255,201)'], 24, 28, '初始状态')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'cascade-order-before.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkCascadeOrderView(['#daf0ff', 'rgb(218,240,255)'], 28, 36, '切换已生效')
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'cascade-order-after.png') })

    // Pending gate: these are real WeChat view/tap assertions, not Node results.
    const { visualHtml: xhtmlSource } = require('../tests/helpers/xhtml')
    await scheduleReadMaterial(miniProgram, { path: '/__generated__/raw.xhtml', name: 'raw.xhtml', type: 'application/xhtml+xml' }, xhtmlSource)
    await waitForReady(miniProgram, page, 'raw.xhtml')
    await assertHealthy(miniProgram, 'raw.xhtml')
    const xhtmlStates = []
    const checkXhtmlView = async (text, colors) => {
      const nid = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('probe')._nid)
      const probe = await page.$(`#reader >>> #dom-nid-${nid}`)
      assert.ok(probe)
      assert.equal(await probe.text(), text)
      const color = (await probe.style('color')).replace(/\s/g, '').toLowerCase()
      assert.ok(colors.includes(color), `XHTML actual color: ${color}`)
      const size = await probe.size()
      assert.ok(size.width > 0 && size.height > 0)
      xhtmlStates.push({ text, color, size, actualView: true })
    }
    await checkXhtmlView('<b>原文</b> &amp;', ['green', '#008000', 'rgb(0,128,0)'])
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'xhtml-before.png') })
    await tapRequired(miniProgram, page, '#change')
    await checkXhtmlView('更新成功 <保持原文>', ['blue', '#0000ff', 'rgb(0,0,255)'])
    if (process.env.CSS_STRUCTURE_SCREENSHOT_DIR) await miniProgram.screenshot({ path: path.join(process.env.CSS_STRUCTURE_SCREENSHOT_DIR, 'xhtml-after.png') })
    const xhtmlPublic = await fs.readFile(path.join(projectRoot, 'tests/fixtures/css-cascade-order/sort-by-order-001.xht'), 'utf8')
    await scheduleReadMaterial(miniProgram, { path: '/__public__/sort-by-order-001.xht', name: 'sort-by-order-001.xht' }, xhtmlPublic)
    await waitForReady(miniProgram, page, 'sort-by-order-001.xht')
    await assertHealthy(miniProgram, 'sort-by-order-001.xht')
    const xhtmlPublicNid = await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document.getElementById('child')._nid)
    const xhtmlSquare = await page.$(`#reader >>> #dom-nid-${xhtmlPublicNid}`)
    assert.ok(xhtmlSquare)
    assert.ok(['green', '#008000', 'rgb(0,128,0)'].includes((await xhtmlSquare.style('background-color')).replace(/\s/g, '').toLowerCase()))
    const xhtmlSquareSize = await xhtmlSquare.size()
    assert.ok(Math.abs(xhtmlSquareSize.width - 100) < 1 && Math.abs(xhtmlSquareSize.height - 100) < 1)

    const comprehensiveName = 'html-css-js-local-test.html'
    const comprehensive = await inject(miniProgram, page, comprehensiveName)
    assert.ok(comprehensive.diagnostics.canvasRevisions.length > 0)
    const sampleFrame = await assertCompleteSectionFrame(miniProgram, page, '#typography')
    artifacts.push(await screenshot(miniProgram, '02-html-original.png'))

    await tapRequired(miniProgram, page, '#themeToggle')
    await tapRequired(miniProgram, page, '#plusBtn')
    let diagnostics = (await currentSnapshot(miniProgram)).diagnostics
    assert.match(diagnostics.rootClass, /(?:^|\s)theme-dark(?:\s|$)/)
    const counterText = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      return pages[pages.length - 1].selectComponent('#reader')._htmlRuntime.document.getElementById('counter').textContent
    })
    assert.equal(counterText, '1')
    artifacts.push(await screenshot(miniProgram, '03-html-interactive.png'))

    const calculatorName = '日常计算器.html'
    await inject(miniProgram, page, calculatorName)
    for (const selector of ['[data-action="clear"]', '[data-value="7"]', '[data-value="+"]', '[data-value="8"]', '[data-action="equals"]']) {
      await tapRequired(miniProgram, page, selector)
    }
    const calculatorResult = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const document = pages[pages.length - 1].selectComponent('#reader')._htmlRuntime.document
      return { result: document.getElementById('result').textContent, expression: document.getElementById('expression').textContent }
    })
    assert.equal(calculatorResult.result, '15')
    assert.equal(calculatorResult.expression, '7 + 8 =')
    artifacts.push(await screenshot(miniProgram, '04-calculator-result.png'))

    const cardsName = '2026-0416 结尾卡片-10个.html'
    const cards = await inject(miniProgram, page, cardsName)
    assert.match(cards.data.domFrameStyle, /transform:scale\(/)
    assert.doesNotMatch(cards.data.domFrameStyle, /margin-left:/)
    artifacts.push(await screenshot(miniProgram, '05-cards-fit-scale.png'))

    const recommendationName = '2026-0416 结尾推荐卡片-4个.html'
    const recommendation = await inject(miniProgram, page, recommendationName)
    assert.match(recommendation.data.domFrameStyle, /transform:scale\(/)
    assert.doesNotMatch(recommendation.data.domFrameStyle, /margin-left:/)
    artifacts.push(await screenshot(miniProgram, '06-recommendation-fit-scale.png'))

    const largeHtmlPath = await resolveMaterialPath('牛来-glm 5.2.html', ['牛来二创'])
    const largeHtmlName = path.basename(largeHtmlPath)
    await injectPath(miniProgram, page, largeHtmlPath)
    artifacts.push(await screenshot(miniProgram, '07-niu-glm.png'))

    const universeHtmlPath = await resolveMaterialPath('牛来宇宙-Vol.01.html', ['牛来二创'])
    const universeHtmlName = path.basename(universeHtmlPath)
    await injectPath(miniProgram, page, universeHtmlPath)
    artifacts.push(await screenshot(miniProgram, '08-niu-universe.png'))
    const posterWallButton = await tapRequired(miniProgram, page, 'button', '海报墙')
    assert.match(posterWallButton.text, /海报墙/)
    await page.waitFor(800)
    const actionScrollTop = Number(await page.scrollTop())
    if (actionScrollTop <= 300) {
      // 新版开发者工具 automation 偶尔不执行 wx.pageScrollTo，但运行时桥已由
      // 单元测试验证；视觉验收仍需把视口移到海报墙区域。
      await miniProgram.pageScrollTo(1700)
      await page.waitFor(300)
    }
    const posterWallScrollTop = Number(await page.scrollTop())
    const posterWall = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      const wallHeading = reader._htmlRuntime.document.querySelectorAll('h1,h2,h3').find(item => /海报已经失控/.test(item.textContent))
      const images = reader._htmlRuntime.document.querySelectorAll('img')
      return { opened: Boolean(wallHeading), imageCount: images.length, blankImages: images.filter(image => !image.getAttribute('src')).length }
    })
    assert.equal(posterWall.opened, true)
    assert.ok(posterWall.imageCount >= 50)
    assert.equal(posterWall.blankImages, 0)
    artifacts.push(await screenshot(miniProgram, '08b-niu-universe-poster-wall.png'))

    const lightArticlePath = path.join(materialRoot, '我的女友景甜_关系分析.html')
    const lightArticleName = path.basename(lightArticlePath)
    const lightArticle = await injectPath(miniProgram, page, lightArticlePath)
    assert.deepEqual(lightArticle.diagnostics.runtimeErrors, [])
    const lightArticleStyles = {
      question: await renderedStylesForSelector(miniProgram, page, '.question'),
      article: await renderedStylesForSelector(miniProgram, page, '.article'),
      strong: await renderedStylesForSelector(miniProgram, page, 'strong'),
      blockquote: await renderedStylesForSelector(miniProgram, page, 'blockquote')
    }
    assert.match(lightArticleStyles.question, /padding:22px 20px/)
    assert.match(lightArticleStyles.question, /background:linear-gradient\(145deg, rgba\(255,255,255,\.94\)/)
    assert.match(lightArticleStyles.article, /background:rgba\(255,255,255,\.88\)/)
    assert.match(lightArticleStyles.strong, /color:#111/)
    assert.match(lightArticleStyles.blockquote, /color:#3d342d/)
    assert.doesNotMatch(Object.values(lightArticleStyles).join(';'), /rgba\(31,31,28|color:#f1f1ee|background:#11110f/)
    const visibleCitationArtifacts = await miniProgram.evaluate(() => {
      const pages = getCurrentPages()
      const reader = pages[pages.length - 1].selectComponent('#reader')
      return (JSON.stringify(reader.data.domTree).match(/filecite|\uE200|\uE201|\uE202/g) || []).length
    })
    assert.equal(visibleCitationArtifacts, 0)
    artifacts.push(await screenshot(miniProgram, '09-light-article.png'))

    const svgPath = path.join(materialRoot, 'svg-test-animated-dashboard-01.svg')
    const svgName = path.basename(svgPath)
    await injectSvgPath(miniProgram, page, svgPath)
    artifacts.push(await screenshot(miniProgram, '10-svg-preview.png'))

    const resultSummary = {
      endpoint,
      materialRoot,
      outputRoot,
      files: [comprehensiveName, calculatorName, cardsName, recommendationName, largeHtmlName, universeHtmlName, lightArticleName, svgName],
      assertions: {
        simulatorIdentity,
        homeAndReaderSeparated: true,
        shareButton: 'open-type=share',
        nativeReaderNavigation: true,
        originalHtmlDomMode: true,
        runtimeErrors: 0,
        rawTextBoundary: rawTextBoundaryState,
        directionInheritance: directionStates,
        htmlWhitespace: whitespaceStates,
        htmlCharacterReferences: entityStates,
        cssEscapes: cssEscapeStates,
        cssStructure: cssStructureStates,
        publicCssStructure: publicCssStructureStates,
        cssIdentifiers: cssIdentifierStates,
        cssVariables: cssVariableStates,
        computedStyles: computedStyleStates,
        cascadeOrder: cascadeOrderStates,
        xhtml: { states: xhtmlStates, publicSquare: xhtmlSquareSize },
        themeToggle: 'theme-dark',
        counter: '1',
        calculator: '7 + 8 = 15',
        calculatorTapTarget: 'inner-text',
        sampleFrame,
        fixedWidthCards: 'fit-scale',
        reportedLargeHtmlFiles: 'dom-mode',
        posterWall: { ...posterWall, actionScrollTop, screenshotScrollTop: posterWallScrollTop },
        reportedLightArticle: {
          runtimeErrors: 0,
          citationArtifacts: visibleCitationArtifacts,
          theme: 'light',
          styles: lightArticleStyles
        },
        rarRuntime,
        sevenZipRuntime,
        sevenZipPage: 'directory-and-opened-text',
        sevenZipVolumes: sevenZipVolumeState,
        zip64NumericVolumes: { volumes: 3, target: 'docs/page.html', repeatedOpens: 2, first: zip64VolumeFirstState, second: zip64VolumeSecondState },
        classicZipVolumes: { volumes: 3, target: 'docs/page.html', repeatedOpens: 2, sourceMutations: 0, first: classicZipFirstState, second: classicZipSecondState },
        classicZip64Volumes: { volumes: 3, target: 'docs/page.html', repeatedOpens: 2, sourceMutations: 0, first: classicZip64FirstState, second: classicZip64SecondState },
        rarVolumeLink: { volumes: 2, target: 'docs/page.html', contentVerified: true },
        encryptedArchives: { ordinary: 'rar-and-7z-password-directory-and-opened-text', rarHeaderLink: { target: 'docs/page.html', contentVerified: true }, rarVolumeLink: { volumes: 2, target: 'docs/page.html', contentVerified: true } },
        zipCompatibility: { methods: 'aes-password-and-bzip2-opened-text', filenameEncoding: zipFilenameState, cp437Symbols: zipCp437SymbolsState, shiftJis: zipShiftJisState, cp949: zipCp949State, cp949EntryOpened: true, big5: zipBig5State, ambiguousEncoding: zipAmbiguousStates, ambiguousEntryOpened: true, unixSymlink: { target: 'docs/page.html', contentVerified: true, runtimeErrors: 0 }, compatibilitySymlink: { target: 'docs/page.html', compressedLink: 'BZip2', repeatedOpens: 2, runtimeErrors: bzip2LinkState.runtimeErrors.length } },
        multiEntrySevenZip: { state: multipleEntryState, firstEntryOpened: true },
        literalArchiveNames: literalNameStates,
        keywordArchiveNames: { opened: keywordNameStates, realCrcFailure: corruptKeywordState },
        literalArchiveSelection: { opened: selectionNameStates, unselectedMatchingMemberHasBadCrc: true },
        duplicateArchiveMembers: duplicateMemberStates,
        zipIntegrity: zipIntegrityStates,
        zipRecovery: zipRecoveryStates,
        rarLinkTargets: rarLinkStates,
        rtfBody: rtfBodyStates,
        psd16BitZipPrediction: 'composite-to-jpeg',
        psd32BitZipPrediction: 'linear-float-to-srgb-jpeg',
        psdLab16BitZipPrediction: 'lab-d50-to-srgb-jpeg',
        psdIndexedZipPrediction: 'palette-index-and-transparency-to-checkerboard-jpeg',
        psdCompositeAlpha: psdAlphaStates,
        legacyAiVector: legacyAiState,
        legacyAiEpsi: legacyAiEpsiState,
        mediaPlayback: { wav: audioAfterTap, localM3u8: playlistState },
        dxfBlockHatchDimension: dxfState,
        dxfInteractive3d: dxf3dState,
        stepInteractive3d: { initial: stepState, rotated: rotatedStep, finalView: 'top' },
        stepCylinderSurface: stepCylinderState,
        stepConeSurface: stepConeState,
        stepSphereSurface: stepSphereState,
        stepTorusSurface: stepTorusState,
        stepFreeformSurface: stepFreeformState,
        stepMappedAssembly: stepAssemblyState,
        stepRelationshipAssembly: stepRelationshipAssemblyState,
        dwgUnsupported: dwgUnsupportedState,
        cdrDispCanvas: cdrState,
        officialCdrRave,
        cdrIntegrity: cdrIntegrityStates,
        standaloneSvg: 'sanitized-data-uri'
      },
      artifacts: artifacts.filter(Boolean)
    }
    await fs.writeFile(path.join(outputRoot, 'result.json'), `${JSON.stringify(resultSummary, null, 2)}\n`)
    console.log(JSON.stringify(resultSummary, null, 2))
  } finally {
    if (miniProgram) miniProgram.disconnect()
  }
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
