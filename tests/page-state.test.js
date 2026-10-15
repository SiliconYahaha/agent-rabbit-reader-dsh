'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const iconv = require('iconv-lite')
const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')
const { loadReaderHost } = require('./helpers/reader-host')

async function flushPromises () {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

test('RAR 无后缀链接的页面链按目标 HTML 名称路由，不把路径当正文', async () => {
  const zlib = require('node:zlib')
  const { rar5Links } = require('./helpers/rar-links')
  const { inspectRarArchive } = require('../miniprogram/file-reader/archive/rar-runtime')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))
  const archive = rar5Links([{ name: 'docs/page.html', content: '<h1>真正内容</h1>' }, { name: 'shortcut', target: 'docs/page.html' }])
  const inspection = await inspectRarArchive(archive, { wasmBinary })
  let selected
  let saved
  const { page } = loadPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: options => { saved = Buffer.from(options.data); options.success() } }) })
  page._inspectorRarBytes = archive
  page._inspectorEntries = inspection.entries
  page.openSelectedFile = file => { selected = file }
  const previous = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(wasmBinary, imports) }
  try {
    await page.openInspectorEntry({ currentTarget: { dataset: { index: inspection.entries.findIndex(e => e.isLink) } } })
    assert.equal(page.data.error, '')
    assert.equal(selected.name, 'page.html')
    assert.equal(saved.toString(), '<h1>真正内容</h1>')
  } finally {
    if (previous === undefined) delete global.WXWebAssembly
    else global.WXWebAssembly = previous
  }
})

test('RAR4 旧式路径可在阅读页切换编码，显示名变化后仍按内核原名打开真实正文', async () => {
  const zlib = require('node:zlib')
  const { rar4Links } = require('./helpers/rar-links')
  const { inspectRarArchive } = require('../miniprogram/file-reader/archive/rar-runtime')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/archive/vendor/unrar/unrar.wasm.br')))
  const targetName = '日本語/設計資料.html'
  const body = '<h1>RAR4 舊式路徑的真實正文</h1>'
  const archive = rar4Links([
    { name: iconv.encode(targetName, 'shift_jis'), content: body },
    { name: 'shortcut', target: iconv.encode(targetName, 'shift_jis') }
  ])
  let saved = Buffer.alloc(0)
  let selected
  const { page } = loadPage({
    env: { USER_DATA_PATH: '/local' },
    getFileSystemManager: () => ({
      writeFile: options => {
        saved = Buffer.from(options.data)
        options.success()
      }
    })
  })
  const previous = global.WXWebAssembly
  global.WXWebAssembly = { instantiate: (_, imports) => WebAssembly.instantiate(wasmBinary, imports) }
  try {
    const automatic = await inspectRarArchive(archive, { wasmBinary })
    page._inspectorArchiveKind = 'rar'
    page._inspectorRarBytes = archive
    page._inspectorRarLegacyEncoding = 'auto'
    page.presentInspection(automatic, page._fileOpenRevision)
    page.openSelectedFile = file => { selected = file }

    assert.equal(page.data.inspectorNameEncoding, '自动（UTF-8 / CP437）')
    assert.equal(page.data.inspectorEntries.some(entry => entry.name === targetName), false)

    await page.applyArchiveNameEncoding('shift_jis')
    assert.equal(page.data.error, '')
    assert.equal(page.data.isLoading, false)
    assert.equal(page.data.inspectorNameEncoding, '日文 Shift_JIS（手动）')
    assert.ok(page.data.inspectorEntries.some(entry => entry.name === targetName))
    assert.equal(page.data.inspectorEntries.some(entry => Object.hasOwn(entry, 'nativeName')), false)

    const linkIndex = page.data.inspectorEntries.findIndex(entry => entry.isLink)
    await page.openInspectorEntry({ currentTarget: { dataset: { index: linkIndex } } })
    assert.equal(page.data.error, '')
    assert.equal(selected.name, '設計資料.html')
    assert.equal(saved.toString(), body)
  } finally {
    if (previous === undefined) delete global.WXWebAssembly
    else global.WXWebAssembly = previous
  }
})

function rangedReader (bytes, extra = {}) {
  return {
    ...extra,
    readFile: options => {
      const source = Buffer.from(bytes)
      const start = Number(options.position || 0)
      const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
      const data = source.subarray(start, end)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    }
  }
}

function crc32Bytes (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZipWithRawName (rawName, content = '旧式 ZIP 正文') {
  const name = Buffer.from(rawName)
  const payload = Buffer.from(content)
  const payloadCrc = crc32Bytes(payload)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(payloadCrc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(payloadCrc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + payload.length, 16)
  return Buffer.concat([local, payload, central, eocd])
}

function stepCubeFixture () {
  const points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]]
  const loops = [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]
  const data = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  const faces = loops.map((loop, index) => `#${201 + index}=POLY_LOOP('',(${loop.map(id => `#${id}`).join(',')}));#${301 + index}=FACE_OUTER_BOUND('',#${201 + index},.T.);#${401 + index}=FACE('',(#${301 + index}));`).join('')
  return Buffer.from(`ISO-10303-21;HEADER;FILE_NAME('faceted-cube.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${data}${faces}#501=CLOSED_SHELL('',(#401,#402,#403,#404,#405,#406));#502=FACETED_BREP('',#501);ENDSEC;END-ISO-10303-21;`)
}

function stepFreeformFixture () {
  const points = [[0, 0, 0], [0, 5, 1], [0, 10, 0], [5, 0, 1], [5, 5, 4], [5, 10, 1], [10, 0, 0], [10, 5, 1], [10, 10, 0]]
  const data = points.map((point, index) => `#${index + 1}=CARTESIAN_POINT('',(${point.join(',')}));`).join('')
  return Buffer.from(`ISO-10303-21;HEADER;FILE_NAME('freeform.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;${data}#11=VERTEX_POINT('',#1);#12=VERTEX_POINT('',#3);#13=VERTEX_POINT('',#9);#14=VERTEX_POINT('',#7);#21=EDGE_CURVE('',#11,#12,#90,.T.);#22=EDGE_CURVE('',#12,#13,#90,.T.);#23=EDGE_CURVE('',#13,#14,#90,.T.);#24=EDGE_CURVE('',#14,#11,#90,.T.);#31=ORIENTED_EDGE('',*,*,#21,.T.);#32=ORIENTED_EDGE('',*,*,#22,.T.);#33=ORIENTED_EDGE('',*,*,#23,.T.);#34=ORIENTED_EDGE('',*,*,#24,.T.);#41=EDGE_LOOP('',(#31,#32,#33,#34));#42=FACE_OUTER_BOUND('',#41,.T.);#50=B_SPLINE_SURFACE_WITH_KNOTS('',2,2,((#1,#2,#3),(#4,#5,#6),(#7,#8,#9)),.UNSPECIFIED.,.F.,.F.,.F.,(3,3),(3,3),(0.,1.),(0.,1.),.UNSPECIFIED.);#60=ADVANCED_FACE('',(#42),#50,.T.);ENDSEC;END-ISO-10303-21;`)
}

function stepMappedAssemblyFixture () {
  return Buffer.from("ISO-10303-21;HEADER;FILE_NAME('mapped-assembly.step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=CARTESIAN_POINT('',(0.,10.,0.));#10=POLY_LOOP('',(#1,#2,#3));#11=FACE_OUTER_BOUND('',#10,.T.);#12=FACE('',(#11));#13=CLOSED_SHELL('',(#12));#14=FACETED_BREP('',#13);#20=SHAPE_REPRESENTATION('',(#14),#99);#30=CARTESIAN_POINT('',(0.,0.,0.));#32=DIRECTION('',(1.,0.,0.));#33=DIRECTION('',(0.,1.,0.));#34=DIRECTION('',(0.,0.,1.));#37=DIRECTION('',(0.,1.,0.));#38=DIRECTION('',(-1.,0.,0.));#31=AXIS2_PLACEMENT_3D('',#30,#34,#32);#35=CARTESIAN_POINT('',(20.,0.,0.));#36=CARTESIAN_POINT('',(-20.,0.,0.));#40=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#32,#33,#35,1.,#34);#41=CARTESIAN_TRANSFORMATION_OPERATOR_3D('',#37,#38,#36,2.,#34);#50=REPRESENTATION_MAP(#31,#20);#51=MAPPED_ITEM('',#50,#40);#52=MAPPED_ITEM('',#50,#41);#60=SHAPE_REPRESENTATION('',(#51,#52),#99);ENDSEC;END-ISO-10303-21;")
}

// page 是真实的 file-reader 阅读器组件实例；host 是真实的 pages/index 宿主页面实例。
// 阅读状态在 page.data，队列/分享/标题在 host.data，两者按微信方式接线（见 helpers/reader-host.js）。
function loadPage (wxOverrides = {}, appOverride = { globalData: {} }) {
  const { host, reader, calls, internals } = loadReaderHost(wxOverrides, appOverride)
  return { page: reader, host, calls, internals }
}

test('首次进入保持简洁空状态，不自动载入演示 HTML', () => {
  const { page } = loadPage()

  assert.equal(page.data.hasContent, false)
  assert.equal(page.data.renderedHtml, '')
  assert.equal(page.data.sourceName, '')
})

test('XHTML 微信文件入口读取字节、保留正文并让真实按钮生效', async () => {
  const { visualHtml } = require('./helpers/xhtml')
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(Buffer.from(visualHtml)), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }) })
  page.openSelectedFile({ name: '原件.xhtml', path: '/local/original', size: Buffer.byteLength(visualHtml) })
  await flushPromises()
  assert.equal(page.data.error, '')
  assert.equal(page.data.domMode, true)
  assert.equal(page.data.hasContent, true)
  assert.equal(page._staticHtmlFallback, '')
  assert.equal(page._htmlRuntime.document.getElementById('probe').textContent, '<b>原文</b> &amp;')
  page.onDomTap({ currentTarget: { dataset: { nid: page._htmlRuntime.document.getElementById('change')._nid } } })
  await flushPromises()
  assert.equal(page._htmlRuntime.document.getElementById('probe').textContent, '更新成功 <保持原文>')
  assert.equal(page.data.error, '')
  page.disposeHtmlRuntime()
})

test('XML MIME入口支持中文编码，损坏 XML 或编码不回退成成功 HTML', async () => {
  const { wrap } = require('./helpers/xhtml')
  let bytes = iconv.encode('<?xml version="1.0" encoding="GB18030"?>'+wrap('<p id="probe">中文文件</p>'), 'gb18030')
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(bytes) })
  const file = { name: '无后缀', path: '/local/source', type: 'application/xhtml+xml; charset=GB18030' }
  page.openSelectedFile(file)
  await flushPromises()
  assert.equal(page.data.domMode, true)
  assert.equal(page._htmlRuntime.document.getElementById('probe').textContent, '中文文件')
  bytes = Buffer.from(wrap('<p>开始后损坏</div>'))
  page.openSelectedFile(file)
  await flushPromises()
  assert.equal(page.data.hasContent, false)
  assert.equal(page.data.domMode, false)
  assert.match(page.data.error, /XHTML.*不匹配/)
  assert.equal(page.data.renderedHtml, '')
  bytes = Buffer.from([0xff,0x30,0x31])
  page.openSelectedFile(file)
  await flushPromises()
  assert.match(page.data.error, /编码/)
  assert.equal(page.data.hasContent, false)
  page.disposeHtmlRuntime()
})

test('XHTML 之后换普通 HTML 不残留 XML 模式；明确 HTML MIME 优先于后缀', async () => {
  const { wrap } = require('./helpers/xhtml')
  const { page } = loadPage()
  page.openSelectedFile({ name:'one.xht', inlineHtml:wrap('<p>XML正文</p>') })
  await flushPromises()
  page.openSelectedFile({ name:'two.xhtml', type:'text/html', inlineHtml:'<p id="probe">普通 HTML 不需要闭合' })
  await flushPromises()
  assert.equal(page.data.error, '')
  assert.equal(page.data.hasContent, true)
  assert.equal(page._htmlRuntime.document.contentType, 'text/html')
  assert.equal(page._htmlRuntime.document.getElementById('probe').textContent, '普通 HTML 不需要闭合')
  page.disposeHtmlRuntime()
})

test('压缩内核结构化错误优先于文件名中的密码文字', () => {
  const { internals } = loadPage()
  assert.equal(internals.isArchivePasswordError(Object.assign(new Error('ERROR: CRC Failed : Wrong password.txt'), { archiveFailure: 'command-failed', exitCode: 2 })), false)
  assert.equal(internals.isArchivePasswordError(Object.assign(new Error('压缩包文件数据校验失败，文件可能已损坏'), { archiveFailure: 'data-corrupt', archiveIntegrity: 'packed-data' })), false)
  assert.equal(internals.isArchivePasswordError(Object.assign(new Error('压缩包需要密码'), { archiveFailure: 'password-required' })), true)
  assert.equal(internals.isArchivePasswordError(Object.assign(new Error('密码不正确或压缩包损坏'), { archiveFailure: 'password-or-corrupt' })), true)
  assert.equal(internals.isArchivePasswordError({ reason: 'ERAR_MISSING_PASSWORD' }), true)
  assert.equal(internals.isArchivePasswordError({ reason: 'ERAR_BAD_PASSWORD' }), true)
})

test('压缩包密码只保存在页面实例内存，换文件后立即清除', () => {
  const { page } = loadPage()
  page.onArchivePasswordInput({ detail: { value: '仅本次使用-1234' } })

  assert.equal(page._archivePasswordDraft, '仅本次使用-1234')
  assert.doesNotMatch(JSON.stringify(page.data), /仅本次使用-1234/)

  page._archivePassword = '仅本次使用-1234'
  page._archivePasswordRequiredForDirectory = true
  page._archivePasswordVerified = true
  page.resetReaderView('另一个文件.rar')
  assert.equal(page._archivePassword, '')
  assert.equal(page._archivePasswordDraft, '')
  assert.equal(page._archivePasswordRequiredForDirectory, false)
  assert.equal(page._archivePasswordVerified, false)
  assert.equal(page.data.inspectorNeedsPassword, false)
  clearTimeout(page._loadingSlowTimer)
  clearTimeout(page._loadingTimeoutTimer)
})

test('已加密成员的数据校验失败保留目录和密码，不退回密码输入页', async () => {
  const { page } = loadPage()
  page._archivePassword = '已经验证的密码'
  page._archivePasswordVerified = true
  page._inspectorBytes = Buffer.from([0])
  page.data.inspectorMode = true
  page._inspectorEntries = [{
    name: 'damaged.html',
    archiveType: 'zip',
    canOpen: true,
    encrypted: true,
    flags: 0,
    method: 0,
    localHeaderOffset: 0,
    compressedSize: 1,
    uncompressedSize: 1,
    crc: 0,
    zipRawName: ''
  }]

  await page.openInspectorEntry({ currentTarget: { dataset: { index: 0 } } })

  assert.equal(page._archivePassword, '已经验证的密码')
  assert.equal(page._archivePasswordVerified, true)
  assert.equal(page.data.inspectorNeedsPassword, false)
  assert.equal(page.data.inspectorMode, true)
  assert.match(page.data.error, /包内文件打开失败/)
})

test('标题排版兜底不会覆盖原网页继承的文字颜色', () => {
  const { page } = loadPage()

  assert.match(page.data.tagStyle.body, /width:100%/)
  assert.equal(/color\s*:/.test(page.data.tagStyle.h1), false)
  assert.equal(/color\s*:/.test(page.data.tagStyle.h2), false)
  assert.equal(/color\s*:/.test(page.data.tagStyle.h3), false)
})

test('模拟器原文件注入与诊断只在开发版开放', () => {
  const development = loadPage({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } })
  }).page
  assert.equal(development.readMaterial({ name: '原文件.html' }, '<button id="ok">正常</button>'), true)
  const diagnostics = development.getReaderDiagnostics()
  assert.equal(diagnostics.sourceName, '原文件.html')
  assert.equal(diagnostics.domMode, true)
  assert.deepEqual(diagnostics.runtimeErrors, [])
  development.disposeHtmlRuntime()

  const release = loadPage({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } })
  }).page
  assert.equal(release.readMaterial({ name: '不可注入.html' }, '<p>拒绝</p>'), false)
  assert.deepEqual(release.startRarRuntimeProbeForDevelopment('not-an-archive'), { state: 'denied' })
  assert.deepEqual(release.startSevenZipRuntimeProbeForDevelopment('not-an-archive'), { state: 'denied' })
  assert.equal(release.getReaderDiagnostics(), null)
  assert.equal(release.data.hasContent, false)
})

test('模拟器 SVG 原文件注入只在开发版开放并优先走 data URI 预览链', () => {
  let writeOptions
  const development = loadPage({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getWindowInfo: () => ({ windowWidth: 375 }),
    getFileSystemManager: () => ({
      writeFile: options => { writeOptions = options; options.success() }
    }),
    env: { USER_DATA_PATH: '/wx-user-data' }
  }).page
  assert.equal(development.readSvgMaterial({ name: '原图.svg' }, '<svg viewBox="0 0 10 10"><circle r="4"/></svg>'), true)
  assert.equal(writeOptions, undefined)
  assert.equal(development.data.sourceName, '原图.svg')
  assert.equal(development.data.hasContent, true)
  assert.match(development.data.standaloneSvgSource, /^data:image\/svg\+xml;base64,/)
  development.onStandaloneSvgLoad()
  assert.equal(development.data.isLoading, false)

  const release = loadPage({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } })
  }).page
  assert.equal(release.readSvgMaterial({ name: '不可注入.svg' }, '<svg/>'), false)
  assert.equal(release.data.hasContent, false)
})

test('带脚本网页进入 DOM 沙箱链，点击后无需重新选文件即可更新正文', () => {
  const { page } = loadPage()
  page.parseContent(`<body><button id="count">0</button><script>
    const button = document.getElementById('count')
    button.addEventListener('click', () => button.textContent = String(Number(button.textContent) + 1))
  </script></body>`, 'interactive.html')
  const button = page._htmlRuntime.document.getElementById('count')

  assert.equal(page.data.domMode, true)
  page.onDomTap({ currentTarget: { dataset: { nid: button._nid } } })
  page._htmlRuntime.flush(true)
  assert.equal(page._htmlRuntime.document.getElementById('count').textContent, '1')
  assert.equal(page.data.domMode, true)
  page.disposeHtmlRuntime()
})

test('可点击区域的文字携带真实点击目标，真机点文字不会被 selectable 层吞掉', () => {
  const { page } = loadPage()
  page.parseContent(`<body><button id="calc-key">7</button><script>
    document.getElementById('calc-key').addEventListener('click', event => event.target.textContent = '已点击')
  </script></body>`, 'tap-target.html')
  const button = page._htmlRuntime.document.getElementById('calc-key')
  const findNode = nodes => {
    for (const node of nodes || []) {
      if (node.nid === button._nid) return node
      const found = findNode(node.children)
      if (found) return found
    }
    return null
  }
  const textNode = findNode(page.data.domTree).children[0]

  assert.equal(textNode.text, '7')
  assert.equal(textNode.tapNid, button._nid)
  page.onDomTap({ currentTarget: { dataset: { nid: textNode.tapNid } } })
  page._htmlRuntime.flush(true)
  assert.equal(button.textContent, '已点击')
  page.disposeHtmlRuntime()
})

test('大 HTML 使用多批 setData 后明确结束加载状态', () => {
  const sections = Array.from({ length: 1700 }, (_, index) => `<section><h2>第 ${index + 1} 节</h2><p>${'正文'.repeat(40)}</p></section>`).join('')
  const { page } = loadPage()

  page.parseContent(`<style>section{margin:16px;border:1px solid #222;padding:12px}</style><main>${sections}</main>`, 'large.html')

  assert.equal(page.data.error, '')
  assert.equal(page.data.hasContent, true)
  assert.equal(page.data.domMode, true)
  assert.equal(page.data.isLoading, false)
  assert.ok(page._loadMetrics.domChunks > 1)
  assert.ok(page._loadMetrics.domReadyAt >= page._loadMetrics.runtimeStartedAt)
  page.disposeHtmlRuntime()
})

test('contenteditable 点击后使用微信编辑框并将确认内容回写 DOM', () => {
  let modalOptions
  const { page } = loadPage({ showModal: options => { modalOptions = options } })
  page.parseContent('<body><p id="editable" contenteditable>旧内容</p></body>', 'editable.html')
  const editable = page._htmlRuntime.document.getElementById('editable')

  page.onDomTap({ currentTarget: { dataset: { nid: editable._nid } } })
  assert.equal(modalOptions.editable, true)
  assert.equal(modalOptions.content, '旧内容')
  modalOptions.success({ confirm: true, content: '新内容' })
  assert.equal(editable.textContent, '新内容')
  page.disposeHtmlRuntime()
})

test('触摸桥按顺序派发 touch、pointer 和 mouse 兼容事件', () => {
  const { page } = loadPage()
  const events = []
  page._htmlRuntime = { getNode: () => ({ localName: 'div' }), dispatchEvent: (nid, type) => events.push([nid, type]) }

  page.dispatchDomTouch({ currentTarget: { dataset: { nid: 7, touch: true } }, touches: [{ clientX: 8 }], changedTouches: [{ clientX: 8 }], timeStamp: 1 }, 'start')

  assert.deepEqual(events, [[7, 'touchstart'], [7, 'pointerdown'], [7, 'mousedown']])
  page._htmlRuntime = null
})

test('路径 diff 用 null 清除旧字段，超过预算回退整树', () => {
  const { internals } = loadPage()
  const previous = [{ nid: 1, attrs: { class: 'old', style: 'color:red' } }]
  const next = [{ nid: 1, attrs: { style: 'color:red' } }]
  assert.deepEqual(internals.domTreePatch(previous, next), { 'domTree[0].attrs.class': null })

  const manyPrevious = [{ nid: 1, attrs: Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`x${index}`, 'v'])) }]
  assert.deepEqual(internals.domTreePatch(manyPrevious, [{ nid: 1, attrs: {} }]), { domTree: [{ nid: 1, attrs: {} }] })
})

test('原生控件桥区分 input/change、radio 互斥值和日期 picker', () => {
  const calls = []
  const { page } = loadPage()
  page._htmlRuntime = {
    getNode: () => ({ value: 'b' }),
    syncInput: (...args) => calls.push(args)
  }
  page.onDomInput({ currentTarget: { dataset: { nid: 1 } }, detail: { value: 'x' } })
  page.onDomChange({ currentTarget: { dataset: { nid: 2 } }, detail: { value: 3 } })
  page.onDomChoiceChange({ currentTarget: { dataset: { nid: 3, kind: 'radio' } }, detail: { value: 'b' } })
  page.onDomPickerChange({ currentTarget: { dataset: { nid: 4 } }, detail: { value: '2026-08-23' } })

  assert.deepEqual(calls, [
    [1, { value: 'x' }, 'input'],
    [2, { value: 3 }, 'change'],
    [3, { checked: true }, 'change', true],
    [4, { value: '2026-08-23' }, 'change']
  ])
})

test('SVG SMIL 能力判决会按设备写入并读取本地缓存', () => {
  const stored = []
  const { page } = loadPage({
    getStorageSync: key => key === 'html-reader:svg-smil-support' ? 'unsupported' : '',
    setStorageSync: (key, value) => stored.push([key, value])
  })
  page.attached()
  assert.equal(page._smilSupport, 'unsupported')
  page.rememberSmilSupport('supported')
  assert.deepEqual(stored, [['html-reader:svg-smil-support', 'supported']])
})

test('SVG 降级只更新图片资源，并作废 Canvas 屏上句柄缓存', () => {
  const { page } = loadPage()
  page.openSelectedFile({ name: 'media.html', inlineHtml: '<p>正文</p><canvas id="scene" width="4" height="4"></canvas><svg width="20" height="20"><circle cx="10" cy="10" r="8"><animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite"/></circle></svg>' })
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])])
  const initial = flatten(page.data.domTree)
  const svg = initial.find(node => node.svgHasSmil)
  const canvas = initial.find(node => node.name === 'canvas')
  assert.ok(svg)
  assert.ok(canvas)
  const patchStart = page.patches.length
  page._canvasNodeCache = { 7: {} }
  page._canvasRevisions = { 7: 3 }
  page.rememberSmilSupport('unsupported')
  page.downgradeSmilImages()
  const updated = flatten(page.data.domTree)
  assert.equal(updated.find(node => node.nid === svg.nid).attrs.src, svg.svgFallbackSrc)
  assert.equal(updated.find(node => node.nid === canvas.nid).nid, canvas.nid)
  assert.ok(page.patches.slice(patchStart).every(patch => !Object.hasOwn(patch, 'domTree')))
  assert.deepEqual(Object.keys(page._canvasNodeCache), [])
  assert.deepEqual(Object.keys(page._canvasRevisions), [])
  page.disposeHtmlRuntime()
})

test('Canvas 上屏缓存节点句柄，同修订跳过，新修订完整重置绘制状态', async () => {
  let queryCount = 0
  let widthWrites = 0
  let heightWrites = 0
  const dimensionWrites = []
  const calls = []
  const context = {
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args])
  }
  const canvas = {
    _width: 0,
    _height: 0,
    get width () { return this._width },
    set width (value) { widthWrites++; dimensionWrites.push(['width', value]); this._width = value },
    get height () { return this._height },
    set height (value) { heightWrites++; dimensionWrites.push(['height', value]); this._height = value },
    getContext: () => context
  }
  const { page } = loadPage({
    createSelectorQuery: () => {
      queryCount++
      return {
        in () { return this },
        select () { return this },
        fields (_options, callback) { callback({ node: canvas }); return this },
        exec () {}
      }
    }
  })
  const item = { nid: 7, canvas: { width: 120, height: 60, rev: 1, ops: [{ name: 'fillRect', args: [1, 2, 3, 4] }] } }

  await page.presentCanvasItems([item])
  await page.presentCanvasItems([item])
  await page.presentCanvasItems([{ ...item, canvas: { ...item.canvas, rev: 2 } }])

  assert.equal(queryCount, 1)
  assert.equal(widthWrites, 4)
  assert.equal(heightWrites, 2)
  assert.deepEqual(dimensionWrites, [['width', 0], ['height', 60], ['width', 120], ['width', 0], ['height', 60], ['width', 120]])
  assert.equal(calls.filter(call => call[0] === 'fillRect').length, 2)
})

test('WebGL 回读像素按画布坐标系纵向翻转后上屏', async () => {
  let presented
  const context = {
    setTransform () {},
    clearRect () {},
    createImageData: (width, height) => ({ width, height, data: new Uint8Array(width * height * 4) }),
    putImageData: imageData => { presented = Array.from(imageData.data) }
  }
  const canvas = { width: 1, height: 2, getContext: () => context }
  const { page } = loadPage({
    createSelectorQuery: () => ({
      in () { return this },
      select () { return this },
      fields (_options, callback) { callback({ node: canvas }); return this },
      exec () {}
    })
  })

  await page.presentCanvasItems([{ nid: 9, canvas: {
    width: 1,
    height: 2,
    rev: 1,
    ops: [],
    webgl: { width: 1, height: 2, data: [1, 2, 3, 4, 5, 6, 7, 8] }
  } }])

  assert.deepEqual(presented, [5, 6, 7, 8, 1, 2, 3, 4])
})

test('首发包不包含文件上传和高保真远端打开逻辑', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/file-reader/engine/components/reader/reader.js'), 'utf8')

  assert.equal(source.includes('wx.uploadFile'), false)
  assert.equal(source.includes('getFidelityBaseUrl'), false)
  assert.equal(source.includes('confirmFidelityUpload'), false)
})

test('PSD 和 AI 在阅读器内交给内嵌的设计预览组件，不再跳转页面', () => {
  let navigatedTo = ''
  const { page } = loadPage({ redirectTo: options => { navigatedTo = options.url } })

  page.openSelectedFile({ name: '海报.psd', path: '/tmp/poster.psd', size: 1024, type: 'application/x-photoshop' })

  assert.equal(navigatedTo, '')
  assert.equal(page.data.designMode, true)
  assert.equal(page.data.hasContent, true)
  assert.equal(page.data.isLoading, false)
  assert.equal(page.data.error, '')
  assert.deepEqual(page.data.designFile, {
    name: '海报.psd',
    path: '/tmp/poster.psd',
    size: 1024,
    type: 'application/x-photoshop'
  })

  page.openSelectedFile({ name: '正文.html', inlineHtml: '<p>回到网页</p>' })
  assert.equal(page.data.designMode, false)
  assert.equal(page.data.designFile, null)
  page.disposeHtmlRuntime()
})

test('设计文件没有本地路径时直接报错，不显示空白预览', () => {
  const { page } = loadPage()
  page.openSelectedFile({ name: 'broken.ai', path: '', size: 0, type: 'application/postscript' })
  assert.match(page.data.error, /设计文件路径/)
  assert.equal(page.data.designMode, false)
  assert.equal(page.data.isLoading, false)
})

test('PDF 和 Office 文件会直接交给微信文档查看器', () => {
  let opened
  const { page } = loadPage({ openDocument: options => { opened = options } })

  page.openSelectedFile({ name: '方案.pdf', path: '/tmp/plan.pdf', size: 2048 })

  assert.equal(opened.filePath, '/tmp/plan.pdf')
  assert.equal(opened.fileType, 'pdf')
  assert.equal(opened.showMenu, true)
})

test('聊天素材即使没有扩展名也会按 MIME 类型打开文档', () => {
  const app = {
    globalData: {
      pendingMaterial: {
        name: '聊天文件',
        path: '/tmp/document',
        size: 2048,
        type: 'application/pdf'
      }
    }
  }
  let opened
  const { host } = loadPage({ openDocument: options => { opened = options } }, app)

  host.openForwardedMaterial()

  assert.equal(app.globalData.pendingMaterial, null)
  assert.equal(opened.filePath, '/tmp/document')
  assert.equal(opened.fileType, 'pdf')
})

test('微信原生查看器拒绝 docm/xlsm 时会回退读取 OOXML 目录', async () => {
  const zip = Buffer.alloc(22)
  zip.writeUInt32LE(0x06054b50, 0)
  const { page } = loadPage({
    openDocument: options => options.fail({ errMsg: 'unsupported file type' }),
    getFileSystemManager: () => rangedReader(zip)
  })

  page.openSelectedFile({ name: '宏文档.docm', path: '/tmp/macro.docm', size: zip.length })
  await flushPromises()

  assert.equal(page.data.inspectorMode, true)
  assert.equal(page.data.inspectorTitle, 'ZIP 压缩包')
  assert.equal(page.data.error, '')
})

test('图片会直接进入微信图片预览', () => {
  let previewed
  const { page } = loadPage({ previewImage: options => { previewed = options } })

  page.openSelectedFile({ name: '成品.png', path: '/tmp/final.png', size: 4096 })

  assert.equal(previewed.current, '/tmp/final.png')
  assert.deepEqual(previewed.urls, ['/tmp/final.png'])
})

test('文本文件会转义后进入本机阅读页', () => {
  const { page } = loadPage({
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: '<script>不执行</script>\n普通文字' })
    })
  })

  page.openSelectedFile({ name: '说明.txt', path: '/tmp/readme.txt', size: 128 })

  assert.equal(page.data.hasContent, true)
  assert.match(page._staticHtmlFallback, /&lt;script&gt;不执行&lt;\/script&gt;/)
  assert.match(page._staticHtmlFallback, /普通文字/)
})

test('Markdown 文件会渲染标题、表格和任务列表而不是显示源码', async () => {
  const source = Buffer.from('# 使用说明\n\n| 格式 | 状态 |\n| --- | --- |\n| HTML | 可读 |\n\n- [x] 已完成')
  const { page } = loadPage({
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) })
    })
  })

  page.openSelectedFile({ name: 'README.md', path: '/tmp/README.md', size: source.length, type: 'text/markdown' })
  assert.equal(page.data.isLoading, true)
  await flushPromises()

  assert.equal(page.data.hasContent, true)
  assert.match(page._staticHtmlFallback, /<h1[^>]*>使用说明<\/h1>/)
  assert.match(page._staticHtmlFallback, /<table/)
  assert.match(page._staticHtmlFallback, /☐ 复选项/)
  assert.doesNotMatch(page._staticHtmlFallback, /\| 格式 \| 状态 \|/)
})

test('RTF 会按声明代码页提取正文并隔离控制字和嵌入对象', () => {
  const escaped = value => Array.from(require('iconv-lite').encode(value, 'gbk')).map(byte => `\\'${byte.toString(16).padStart(2, '0')}`).join('')
  const source = Buffer.from(`{\\rtf1\\ansi\\ansicpg936 ${escaped('会议纪要')}\\par ${escaped('第二段')}{\\*\\object ignored}}`, 'latin1')
  const { page } = loadPage({
    getFileSystemManager: () => ({ readFile: options => options.success({ data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) }) })
  })

  page.openSelectedFile({ name: '纪要.rtf', path: '/tmp/meeting.rtf', size: source.length, type: 'application/rtf' })

  assert.equal(page.data.hasContent, true)
  assert.match(page._staticHtmlFallback, /会议纪要/)
  assert.match(page._staticHtmlFallback, /第二段/)
  assert.doesNotMatch(page._staticHtmlFallback, /ignored/)
})

test('RTF 原始 GBK 字节从选中文件进入正文页面，Unicode 控制字不泄漏', () => {
  const { encodedRtf } = require('./helpers/rtf-samples')
  const source = encodedRtf('原始中文正文：不是文件信息', 'gbk', 936, 2)
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(source) })
  page.openSelectedFile({ name: '原始中文.rtf', path: '/local/原始中文.rtf', size: source.length })
  assert.equal(page.data.error, '')
  assert.equal(page.data.hasContent, true)
  assert.match(page._staticHtmlFallback, /原始中文正文：不是文件信息/)
  assert.doesNotMatch(page._staticHtmlFallback, /�|ansicpg|rtf1/)
})

test('RTF Unicode 备选从原文件进入页面，不拼接 ANSI、不把正文当 HTML', () => {
  const { wrap, pair, unicode } = require('./helpers/rtf-alternatives')
  const expected = '中文正文 <script>alert(1)</script> & 尾段'
  const source = Buffer.from(wrap(pair('OLD PLACEHOLDER', unicode(expected))))
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(source) })
  page.openSelectedFile({ name: 'Unicode备选.rtf', path: '/local/alternative.rtf', size: source.length })
  assert.equal(page.data.error, '')
  assert.equal(page.data.hasContent, true)
  assert.equal(page._htmlRuntime.document.body.textContent.trim(), expected)
  assert.equal(page._htmlRuntime.document.querySelector('script'), null)
  assert.doesNotMatch(page._staticHtmlFallback, /OLD PLACEHOLDER/)
})

test('RTF 损坏备选入口显示错误，不用旧文本冒充成功正文', () => {
  const source = Buffer.from('{\\rtf1{\\upr{OLD}{\\*\\unknown{NEW}}}}')
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(source) })
  page.openSelectedFile({ name: '坏备选.rtf', path: '/local/broken.rtf', size: source.length })
  assert.match(page.data.error, /RTF/)
  assert.equal(page.data.isLoading, false)
  assert.equal(page.data.hasContent, false)
})

test('RTF 真实嵌套表格经文件入口保留单元格/行分隔，不把内层文字粘连', () => {
  const sample = require('./fixtures/rtf-tables/samples.json').find(c => c.name === 'libreoffice-nested.rtf')
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/rtf-tables', sample.name))
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(source) })
  page.openSelectedFile({ name: sample.name, path: '/local/nested.rtf', size: source.length })
  assert.equal(page.data.error, '')
  assert.equal(page.data.hasContent, true)
  assert.equal(page._htmlRuntime.document.body.textContent.trim(), sample.expected)
  assert.match(page._staticHtmlFallback, /Inner A\tInner B\t\nInner C\tInner D/)
  assert.doesNotMatch(page._staticHtmlFallback, /Inner AInner B|nonesttables|nesttableprops/)
})

test('RTF 实际字节超过上限，即使申报 size 较小也不会进入排版', () => {
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(Buffer.alloc(5 * 1024 * 1024 + 1)) })
  page.openSelectedFile({ name: '大文件.rtf', path: '/local/large.rtf', size: 10 })
  assert.match(page.data.error, /5 MB/)
  assert.equal(page.data.isLoading, false)
  assert.equal(page.data.hasContent, false)
})

test('视频使用本地 video 组件状态，音频使用 InnerAudioContext 控制', () => {
  let played = 0
  let paused = 0
  let destroyed = 0
  const callbacks = {}
  const audio = {
    currentTime: 4,
    duration: 65,
    play: () => { played++; callbacks.play && callbacks.play() },
    pause: () => { paused++; callbacks.pause && callbacks.pause() },
    seek () {},
    destroy: () => { destroyed++ },
    onCanplay: callback => { callbacks.canplay = callback },
    onTimeUpdate: callback => { callbacks.time = callback },
    onWaiting: callback => { callbacks.waiting = callback },
    onSeeking: callback => { callbacks.seeking = callback },
    onSeeked: callback => { callbacks.seeked = callback },
    onPlay: callback => { callbacks.play = callback },
    onPause: callback => { callbacks.pause = callback },
    onStop () {},
    onEnded () {},
    onError: callback => { callbacks.error = callback }
  }
  const mp3Header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64])
  const mp4Header = Buffer.alloc(64)
  mp4Header.writeUInt32BE(24, 0); mp4Header.write('ftyp', 4); mp4Header.write('mp42', 8); mp4Header.write('avc1', 24); mp4Header.write('mp4a', 36)
  const { page } = loadPage({
    getDeviceInfo: () => ({ platform: 'android' }),
    createInnerAudioContext: () => audio,
    getFileSystemManager: () => ({ readFile: options => options.success({ data: options.filePath.endsWith('.mp3') ? mp3Header : mp4Header }) })
  })

  page.openSelectedFile({ name: '录音.mp3', path: '/tmp/audio.mp3', size: 1024, type: 'audio/mpeg' })
  callbacks.canplay()
  callbacks.time()
  assert.equal(audio.src, '/tmp/audio.mp3')
  assert.equal(page.data.mediaMode, 'audio')
  assert.equal(page.data.mediaFormatLabel, 'MPEG Audio')
  assert.match(page.data.mediaDiagnostic, /可以播放/)
  assert.equal(page.data.mediaDurationLabel, '1:05')
  callbacks.waiting()
  assert.match(page.data.mediaDiagnostic, /缓冲/)
  callbacks.seeking()
  assert.match(page.data.mediaDiagnostic, /跳转/)
  callbacks.seeked()
  assert.match(page.data.mediaDiagnostic, /已跳转/)
  page.toggleAudio()
  assert.equal(played, 1)
  page.toggleAudio()
  assert.equal(paused, 1)

  page.openSelectedFile({ name: '演示.mp4', path: '/tmp/video.mp4', size: 2048, type: 'video/mp4' })
  assert.equal(destroyed, 1)
  assert.equal(page.data.mediaMode, 'video')
  assert.equal(page.data.mediaPath, '/tmp/video.mp4')
  assert.match(page.data.mediaFormatLabel, /ISO Base Media/)
  assert.equal(page.data.mediaCodecLabel, 'avc1 · mp4a')
  const currentTarget = { dataset: { mediaSession: page.data.mediaSessions[0].id } }
  page.onVideoLoadedMetadata({ currentTarget, detail: { duration: 125 } })
  assert.equal(page.data.mediaDurationLabel, '2:05')
  page.onVideoWaiting({ currentTarget })
  assert.match(page.data.mediaDiagnostic, /缓冲/)
  page.onVideoError({ currentTarget, detail: { errCode: 10004 } })
  assert.equal(page.data.mediaCanPlay, false)
  assert.match(page.data.error, /当前设备不支持文件里的封装或编码/)
  page.disposeMedia()
})

test('平台不支持和单文件 M3U8 都显示内容说明而不是空播放器', () => {
  let createdAudio = 0
  const playlist = Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\npart-001.ts\n')
  const { page } = loadPage({
    getDeviceInfo: () => ({ platform: 'ios' }),
    createInnerAudioContext: () => { createdAudio++; return {} },
    getFileSystemManager: () => ({ readFile: options => options.success({ data: playlist }) })
  })

  page.openSelectedFile({ name: '安卓录音.flac', path: '/tmp/audio.flac', size: 42, type: 'audio/flac' })
  assert.equal(page.data.mediaCanPlay, false)
  assert.match(page.data.mediaCompatibility, /仅支持 Android/)
  assert.equal(createdAudio, 0)

  page.openSelectedFile({ name: '本地直播.m3u8', path: '/tmp/local.m3u8', size: playlist.length, type: 'application/vnd.apple.mpegurl' })
  assert.equal(page.data.mediaMode, 'video')
  assert.equal(page.data.mediaCanPlay, false)
  assert.equal(page.data.mediaFormatLabel, 'HLS 播放列表')
  assert.deepEqual(page.data.mediaDetails, ['1 个分片/子清单引用', '包含加密密钥引用', 'part-001.ts'])
  assert.match(page.data.mediaDiagnostic, /分片、子清单或密钥文件/)
})

test('ZIP 与工程文件会在本机进入结构检查页', async () => {
  const bytes = Buffer.alloc(22)
  bytes.writeUInt32LE(0x06054b50, 0)
  const { page } = loadPage({
    getFileSystemManager: () => rangedReader(bytes)
  })

  page.openSelectedFile({ name: '空目录.zip', path: '/tmp/empty.zip', size: bytes.length, type: 'application/zip' })
  await flushPromises()

  assert.equal(page.data.inspectorMode, true)
  assert.equal(page.data.inspectorTitle, 'ZIP 压缩包')
  assert.equal(page.data.error, '')
})

test('分卷压缩包缺卷时列出具体文件名而不是打开空页面', () => {
  const selected = { name: '资料.7z.001', path: '/tmp/资料.7z.001', size: 10, type: 'application/octet-stream' }
  const app = { globalData: { fileQueue: [selected, { name: '资料.7z.003', path: '/tmp/资料.7z.003', size: 10, type: 'application/octet-stream' }], fileQueueIndex: 0 } }
  const { page } = loadPage({}, app)

  // 同批文件通过 siblings 传入组件，组件不再读取宿主的全局队列。
  page.open(selected, app.globalData.fileQueue)

  assert.equal(page.data.inspectorMode, true)
  assert.equal(page.data.inspectorTitle, '分卷压缩包不完整')
  assert.match(page.data.inspectorSummary, /资料\.7z\.002/)
  assert.equal(page.data.error, '')
  clearTimeout(page._loadingSlowTimer)
  clearTimeout(page._loadingTimeoutTimer)
})

test('DXF 块、填充和尺寸经过完整页面链生成可见预览', () => {
  const dxf = Buffer.from([
    '0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'SYMBOL', '10', '0', '20', '0',
    '0', 'LINE', '10', '0', '20', '0', '11', '20', '21', '0', '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '2', 'SYMBOL', '10', '100', '20', '50', '41', '2', '42', '2', '50', '90',
    '0', 'HATCH', '2', 'SOLID', '70', '1', '91', '1', '92', '2', '72', '0', '73', '1', '93', '4',
    '10', '0', '20', '0', '10', '40', '20', '0', '10', '40', '20', '20', '10', '0', '20', '20',
    '0', 'DIMENSION', '70', '32', '11', '50', '21', '35', '13', '0', '23', '0', '14', '100', '24', '0', '1', '<>',
    '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n'))
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(dxf) })

  page.openSelectedFile({ name: '完整二维图.dxf', path: '/tmp/complete.dxf', size: dxf.length, type: 'application/dxf' })

  assert.equal(page.data.inspectorMode, true)
  assert.equal(page.data.inspectorTitle, 'DXF 工程图')
  assert.match(page.data.inspectorPreviewSource, /^data:image\/svg\+xml;base64,/)
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '块定义/展开引用').value, '1 / 1')
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '填充边界/尺寸').value, '1 / 1')
  const svg = Buffer.from(page.data.inspectorPreviewSource.split(',')[1], 'base64').toString()
  assert.match(svg, /data-dxf-block="SYMBOL"/)
  assert.match(svg, /data-dxf-hatch="boundary"/)
  assert.match(svg, /data-dxf-dimension="line"/)
})

test('DXF 三维面经过完整页面链进入可旋转 Canvas', async () => {
  const dxf = Buffer.from([
    '0', '3DFACE',
    '10', '0', '20', '0', '30', '0',
    '11', '10', '21', '0', '31', '0',
    '12', '10', '22', '10', '32', '5',
    '13', '0', '23', '10', '33', '5',
    '0', 'EOF', ''
  ].join('\n'))
  const operations = []
  const context = {}
  for (const method of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']) {
    context[method] = (...args) => operations.push([method, ...args])
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  let fieldsCallback
  const query = {
    in () { return this },
    select: () => ({ fields: (_options, callback) => { fieldsCallback = callback } }),
    exec: () => fieldsCallback({ node: canvas, width: 300, height: 210 })
  }
  const { page } = loadPage({
    getWindowInfo: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => query,
    getFileSystemManager: () => rangedReader(dxf)
  })

  page.openSelectedFile({ name: '三维面.dxf', path: '/tmp/3d-face.dxf', size: dxf.length, type: 'application/dxf' })
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(page.data.inspectorModelMode, 'engineering-wireframe')
  assert.equal(page.data.inspectorModelReady, true)
  assert.match(page.data.inspectorModelStatus, /4 点 \/ 4 边 \/ 2 面片/)
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '三维点/边/面').value, '4 / 4 / 2')
  assert.ok(operations.some(operation => operation[0] === 'fill'))
  assert.ok(operations.filter(operation => operation[0] === 'lineTo').length >= 4)
})

test('STEP 完整页面链上屏可旋转 Canvas 并响应触摸和视图按钮', async () => {
  const step = stepCubeFixture()
  const operations = []
  const context = {}
  for (const method of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']) {
    context[method] = (...args) => operations.push([method, ...args])
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  let fieldsCallback
  const query = {
    in () { return this },
    select: () => ({ fields: (_options, callback) => { fieldsCallback = callback } }),
    exec: () => fieldsCallback({ node: canvas, width: 300, height: 210 })
  }
  const { page } = loadPage({
    getWindowInfo: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => query,
    getFileSystemManager: () => rangedReader(step)
  })

  page.openSelectedFile({ name: 'cube.step', path: '/tmp/cube.step', size: step.length, type: 'application/step' })
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(page.data.inspectorModelMode, 'step-wireframe')
  assert.equal(page.data.inspectorModelReady, true)
  assert.match(page.data.inspectorModelStatus, /8 点 \/ 12 边 \/ 12 面片/)
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '可见面片').value, '12')
  assert.equal(canvas.width, 600)
  assert.equal(canvas.height, 420)
  assert.ok(operations.filter(operation => operation[0] === 'lineTo').length >= 12)
  assert.ok(operations.filter(operation => operation[0] === 'fill').length >= 20)

  page.onStepModelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
  page.onStepModelTouchMove({ touches: [{ clientX: 150, clientY: 125 }] })
  page.onStepModelTouchEnd()
  assert.equal(page.data.inspectorModelView, 'custom')
  assert.equal(page.data.inspectorModelRevision, 1)

  page.setStepModelView({ currentTarget: { dataset: { view: 'top' } } })
  assert.equal(page.data.inspectorModelView, 'top')
  assert.equal(page.data.inspectorModelRevision, 2)
})

test('STEP 自由曲面从原始文件读取后在页面 Canvas 生成真实面片', async () => {
  const step = stepFreeformFixture()
  const operations = []
  const context = {}
  for (const method of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']) {
    context[method] = (...args) => operations.push([method, ...args])
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  let fieldsCallback
  const query = {
    in () { return this },
    select: () => ({ fields: (_options, callback) => { fieldsCallback = callback } }),
    exec: () => fieldsCallback({ node: canvas, width: 300, height: 210 })
  }
  const { page } = loadPage({
    getWindowInfo: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => query,
    getFileSystemManager: () => rangedReader(step)
  })

  page.openSelectedFile({ name: 'freeform.step', path: '/tmp/freeform.step', size: step.length, type: 'application/step' })
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(page.data.inspectorModelMode, 'step-wireframe')
  assert.equal(page.data.inspectorModelReady, true)
  assert.match(page.data.inspectorModelStatus, /178 点 \/ 316 边 \/ 288 面片/)
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '可见面片').value, '288')
  assert.ok(operations.filter(operation => operation[0] === 'fill').length >= 288)
  assert.ok(operations.filter(operation => operation[0] === 'lineTo').length >= 316)
})

test('STEP 装配映射从原始文件读取后在页面 Canvas 显示分离实例', async () => {
  const step = stepMappedAssemblyFixture()
  const operations = []
  const context = {}
  for (const method of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']) context[method] = (...args) => operations.push([method, ...args])
  const canvas = { width: 0, height: 0, getContext: () => context }
  let fieldsCallback
  const query = {
    in () { return this },
    select: () => ({ fields: (_options, callback) => { fieldsCallback = callback } }),
    exec: () => fieldsCallback({ node: canvas, width: 300, height: 210 })
  }
  const { page } = loadPage({ getWindowInfo: () => ({ pixelRatio: 2 }), createSelectorQuery: () => query, getFileSystemManager: () => rangedReader(step) })

  page.openSelectedFile({ name: 'mapped-assembly.step', path: '/tmp/mapped-assembly.step', size: step.length, type: 'application/step' })
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(page.data.inspectorModelReady, true)
  assert.match(page.data.inspectorModelStatus, /6 点 \/ 6 边 \/ 2 面片/)
  assert.equal(page.data.inspectorMetadata.find(item => item.label === '装配实例').value, '2')
  assert.ok(operations.filter(operation => operation[0] === 'fill').length >= 2)
  assert.ok(operations.filter(operation => operation[0] === 'lineTo').length >= 6)
})

test('ZIP 真实范围读取入口拒绝坏CRC和膨胀内容，恢复后仍显示正确正文', async () => {
  const { zipMember } = require('./helpers/zip-integrity')
  const content = Buffer.from('ZIP 校验后的真实正文，不能只识别文件名。')
  let archive, extracted = Buffer.alloc(0), writes = 0
  const manager = {
    readFile: options => {
      const source = options.filePath === '/local/integrity.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const data = source.subarray(start, options.length == null ? source.length : start + options.length)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { writes++; extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  const variants = [
    { content, crc: 0, error: /CRC/ },
    { content: Buffer.alloc(4 * 1024 * 1024, 65), size: 20, error: /实际解压.*上限/ },
    { content, descriptor: 'signed' }
  ]
  for (const variant of variants) {
    archive = zipMember(variant)
    page.openSelectedFile({ name: 'integrity.zip', path: '/local/integrity.zip', size: archive.length })
    await flushPromises()
    assert.equal(page.data.error, '')
    const index = page.data.inspectorEntries.findIndex(entry => entry.canOpen)
    assert.ok(index >= 0)
    await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
    if (variant.error) {
      assert.match(page.data.error, variant.error)
      assert.equal(writes, 0)
      assert.equal(page.data.isLoading, false)
      assert.equal(page.data.inspectorMode, true)
    } else {
      assert.equal(page.data.error, '')
      assert.equal(writes, 1)
      assert.deepEqual(extracted, content)
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), content.toString())
    }
  }
})

test('ZIP 页面安全恢复同名文件目录，切换编码后每项仍打开对应正文', async () => {
  const { omittedDescriptors, recoveryMembers } = require('./helpers/zip-recovery')
  const archive = omittedDescriptors(recoveryMembers)
  let extracted = Buffer.alloc(0), writes = 0
  const ranges = []
  const manager = {
    readFile: options => {
      const source = options.filePath === '/local/recovery.zip' ? archive : extracted
      const start = Number(options.position || 0)
      ranges.push([options.filePath, start, options.length])
      const data = source.subarray(start, options.length == null ? source.length : start + options.length)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { writes++; extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  for (const member of recoveryMembers) {
    page.openSelectedFile({ name: 'recovery.zip', path: '/local/recovery.zip', size: archive.length })
    await flushPromises()
    assert.equal(page.data.error, '')
    assert.equal(page._inspectorZipDescriptor.recovered, true)
    page.applyArchiveNameEncoding('cp437')
    const entries = page.data.inspectorEntries
    const same = entries.filter(e => e.name === member.name && !e.isDirectory)
    const duplicateIndex = recoveryMembers.filter(m => m.name === member.name).indexOf(member)
    const index = entries.indexOf(same[duplicateIndex])
    assert.ok(index >= 0)
    await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
    assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), member.content)
    assert.deepEqual(extracted, Buffer.from(member.content))
  }
  assert.equal(writes, 3)
  assert.ok(ranges.some(row => row[1] === 0 && row[2] === archive.length))
})

test('ZIP 页面规范化显示同名路径但逐项打开原始成员，并禁用绝对路径', async () => {
  const { duplicateZip } = require('./helpers/archive-duplicates')
  const members = [{ name: 'docs//same.html', content: '<h1>第一份</h1>' }, { name: 'docs/same.html', content: '<h1>第二份</h1>' }, { name: '/escape.html', content: '<h1>不能打开</h1>' }]
  const archive = duplicateZip(members)
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/local/duplicates.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const data = source.subarray(start, options.length == null ? source.length : start + options.length)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  for (let expectedIndex = 0; expectedIndex < 2; expectedIndex++) {
    page.openSelectedFile({ name: 'duplicates.zip', path: '/local/duplicates.zip', size: archive.length })
    await flushPromises()
    const duplicates = page.data.inspectorEntries.filter(entry => /same\.html/.test(entry.name))
    assert.deepEqual(duplicates.map(entry => entry.displayName), ['same.html（同名 1/2）', 'same.html（同名 2/2）'])
    const unsafe = page.data.inspectorEntries.find(entry => entry.name === '/escape.html')
    assert.equal(unsafe.canOpen, false)
    assert.match(unsafe.detail, /路径不安全/)
    const index = page.data.inspectorEntries.indexOf(duplicates[expectedIndex])
    await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
    assert.equal(page.data.error, '')
    assert.deepEqual(extracted, Buffer.from(members[expectedIndex].content))
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), expectedIndex ? '第二份' : '第一份')
  }
})

test('ZIP 页面遇到重复 Unicode Path 字段时显示原始名称并打开对应 HTML 正文', async () => {
  const { storedZipWithUnicodePaths } = require('./helpers/zip-unicode-path')
  const body = '<h1>重复元数据下的真实正文</h1>'
  const archive = storedZipWithUnicodePaths({ unicodePaths: [{ name: 'first.html' }, { name: 'second.html' }], content: body })
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/local/duplicate-unicode.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const data = source.subarray(start, options.length == null ? source.length : start + Number(options.length))
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  page.openSelectedFile({ name: 'duplicate-unicode.zip', path: '/local/duplicate-unicode.zip', size: archive.length })
  await flushPromises()
  assert.equal(page.data.error, '')
  const index = page.data.inspectorEntries.findIndex(entry => entry.canOpen)
  assert.equal(page.data.inspectorEntries[index].name, 'safe/raw.html')
  await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
  assert.equal(page.data.error, '')
  assert.deepEqual(extracted, Buffer.from(body))
  assert.equal(page._htmlRuntime.document.body.textContent.trim(), '重复元数据下的真实正文')
})

test('两份恢复的公开 ZIP 从真实页面入口打开四份完整 XML 正文', async () => {
  const crypto = require('node:crypto')
  for (const sample of require('./fixtures/zip-integrity/samples.json').filter(s => s.recovered)) {
    const archive = fs.readFileSync(path.join(__dirname, 'fixtures/zip-integrity', sample.name))
    let extracted
    const manager = {
      readFile: options => {
        const source = options.filePath === '/local/public.zip' ? archive : extracted
        const start = options.position || 0
        const bytes = source.subarray(start, options.length == null ? source.length : start + options.length)
        options.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      },
      writeFile: options => { extracted = Buffer.from(options.data); options.success() }
    }
    const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
    for (const expected of sample.entries) {
      page.openSelectedFile({ name: sample.name, path: '/local/public.zip', size: archive.length })
      await flushPromises()
      assert.equal(page.data.error, '')
      const index = page.data.inspectorEntries.findIndex(e => e.name === expected.name)
      assert.ok(index >= 0)
      await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
      assert.equal(page.data.error, '')
      assert.equal(crypto.createHash('sha256').update(extracted).digest('hex'), expected.sha256)
      // Raw extraction is byte-exact above. The escaped HTML <pre> view uses
      // HTML input preprocessing (CRLF/CR -> LF), like a browser, not byte text.
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), extracted.toString().replace(/\r\n?/g, '\n').trim())
      assert.equal(page.data.inspectorMode, false)
    }
  }
})

test('ZIP 页面恢复失败不写文件，超过恢复上限不整包读取', async () => {
  const { omittedDescriptors } = require('./helpers/zip-recovery')
  const { MAX_ZIP_RECOVERY_BYTES } = require('../miniprogram/file-reader/engine/core/file-inspector')
  const small = omittedDescriptors([{ content: '真实正文', method: 0, descriptor: 'signed' }])
  small[30] ^= 1
  for (const size of [small.length, MAX_ZIP_RECOVERY_BYTES + 1]) {
    const ranges = []
    // A sparse padded file with a real EOF directory. The range stub must
    // return exactly the requested bytes, including zero-filled prefix data.
    const offset = size - small.length, image = Buffer.from(small)
    if (offset) image.writeUInt32LE(image.readUInt32LE(image.length - 6) + offset, image.length - 6)
    const manager = {
      readFile: options => {
        ranges.push([options.position, options.length])
        // For the large case only tail/central requests should occur.
        const source = Buffer.alloc(options.length)
        const start = Math.max(options.position || 0, offset), end = Math.min((options.position || 0) + options.length, size)
        if (end > start) image.copy(source, start - (options.position || 0), start - offset, end - offset)
        options.success({ data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) })
      },
      writeFile: () => assert.fail('invalid recovery must not write')
    }
    const { page } = loadPage({ getFileSystemManager: () => manager })
    page.openSelectedFile({ name: 'bad.zip', path: '/local/bad.zip', size })
    await flushPromises()
    assert.match(page.data.error, size === small.length ? /名称不同/ : /8 MB/)
    assert.equal(page.data.isLoading, false)
    if (size > MAX_ZIP_RECOVERY_BYTES) assert.ok(ranges.every(row => row[1] < MAX_ZIP_RECOVERY_BYTES))
  }
})

test('ZIP 页面在读取正文前拒绝名称/标记/方法冲突，私有名称不发送到视图，随后正常条目能打开', async () => {
  const { zipMember } = require('./helpers/zip-integrity')
  const { localNameMismatch, localZip64 } = require('./helpers/zip-local-identity')
  const content = '经本地头校验的真实正文'
  const options = { name: '正文.txt', content, method: 0 }
  const method = zipMember(options); method[8] = 8
  const flags = zipMember(options); flags[6] ^= 8
  let archive, extracted = Buffer.alloc(0), writes = 0
  const ranges = []
  const manager = {
    readFile: o => {
      ranges.push([o.position, o.length])
      const source = o.filePath === '/local/identity.zip' ? archive : extracted
      const start = o.position || 0, bytes = source.subarray(start, o.length == null ? source.length : start + o.length)
      o.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
    },
    writeFile: o => { writes++; extracted = Buffer.from(o.data); o.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  for (const [bytes, error] of [[localNameMismatch(options), /文件名不一致/], [method, /方法/], [flags, /标记/], [localZip64({ ...options, method: 8, descriptor: 'signed' }), null]]) {
    archive = bytes
    page.openSelectedFile({ name: 'identity.zip', path: '/local/identity.zip', size: archive.length })
    await flushPromises()
    assert.equal(page.data.error, '')
    const index = page.data.inspectorEntries.findIndex(e => e.canOpen)
    assert.ok(page._inspectorEntries[index].zipRawName)
    assert.equal(Object.hasOwn(page.data.inspectorEntries[index], 'zipRawName'), false)
    ranges.length = 0
    await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
    if (error) {
      assert.match(page.data.error, error); assert.equal(writes, 0)
      assert.ok(ranges.every(r => r[0] === 0), 'failed header must not reach payload read')
      assert.equal(page.data.isLoading, false)
    } else {
      assert.equal(page.data.error, ''); assert.equal(writes, 1)
      assert.equal(extracted.toString(), content)
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), content)
    }
  }
})

test('三个公开 ZIP 的七个真实成员含空尾随Deflate流均进入正文页', async () => {
  const crypto = require('node:crypto')
  for (const sample of require('./fixtures/zip-local-identity/samples.json').filter(s => !s.readerError)) {
    const archive = fs.readFileSync(path.join(__dirname, 'fixtures/zip-local-identity', sample.name))
    let extracted
    const manager = {
      readFile: o => {
        const source = o.filePath === '/local/public.zip' ? archive : extracted
        const start = o.position || 0, bytes = source.subarray(start, o.length == null ? source.length : start + o.length)
        o.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      },
      writeFile: o => { extracted = Buffer.from(o.data); o.success() }
    }
    const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
    for (const expected of sample.entries) {
      page.openSelectedFile({ name: sample.name, path: '/local/public.zip', size: archive.length })
      await flushPromises()
      const index = page.data.inspectorEntries.findIndex(e => e.name === expected.name)
      assert.ok(index >= 0)
      assert.equal(Object.hasOwn(page.data.inspectorEntries[index], 'zipRawName'), false)
      await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
      assert.equal(page.data.error, '')
      assert.equal(crypto.createHash('sha256').update(extracted).digest('hex'), expected.sha256)
      assert.equal(page._htmlRuntime.document.body.textContent.trim(), extracted.toString().replace(/\r\n?/g, '\n').trim())
    }
  }
})

test('ZIP 头部读取或写出回调期间换文件，旧成功/失败不能覆盖新正文', async () => {
  const { zipMember } = require('./helpers/zip-integrity')
  const archive = zipMember({ name: 'old.txt', content: '旧正文' })
  for (const phase of ['header-success', 'header-fail', 'write-success', 'write-fail']) {
    let pending, opening = false, readsAfterHeader = 0
    const manager = {
      readFile: o => {
        if (opening && phase.startsWith('header') && o.position === 0 && o.length === 30) { pending = o; return }
        if (opening) readsAfterHeader++
        const start = o.position || 0, bytes = archive.subarray(start, o.length == null ? archive.length : start + o.length)
        o.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      },
      writeFile: o => { assert.ok(phase.startsWith('write')); pending = o }
    }
    const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
    page.openSelectedFile({ name: 'old.zip', path: '/local/old.zip', size: archive.length })
    await flushPromises()
    opening = true
    const task = page.openInspectorEntry({ currentTarget: { dataset: { index: 0 } } })
    await flushPromises(); assert.ok(pending)
    page.openSelectedFile({ name: 'new.html', inlineHtml: '<p>新正文不可被覆盖</p>' })
    if (phase.endsWith('fail')) pending.fail({ errMsg: 'old read/write failed' })
    else if (phase.startsWith('header')) pending.success({ data: Uint8Array.from(archive.subarray(0, 30)).buffer })
    else pending.success()
    await task
    assert.equal(page.data.sourceName, 'new.html')
    assert.equal(page.data.error, '')
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), '新正文不可被覆盖')
    if (phase.startsWith('header')) assert.equal(readsAfterHeader, 0)
  }
})

test('ZIP 内容清单里的文本文件可直接解压并进入阅读页', async () => {
  const archive = zipSync({ '资料/正文.txt': Buffer.from('这是压缩包里的真实正文') })
  let extracted = null
  const manager = rangedReader(archive, {
    writeFile: options => {
      extracted = new Uint8Array(options.data)
      options.success()
    }
  })
  manager.readFile = options => {
    const source = options.filePath === '/tmp/资料.zip' ? Buffer.from(archive) : Buffer.from(extracted || [])
    const start = Number(options.position || 0)
    const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
    const data = source.subarray(start, end)
    options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })

  page.openSelectedFile({ name: '资料.zip', path: '/tmp/资料.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  assert.equal(page.data.inspectorMode, true)
  const fileIndex = page.data.inspectorEntries.findIndex(entry => entry.canOpen)
  assert.equal(page.data.inspectorEntries[0].name, '资料/')
  assert.equal(page.data.inspectorEntries[fileIndex].name, '资料/正文.txt')

  await page.openInspectorEntry({ currentTarget: { dataset: { index: fileIndex } } })
  assert.equal(page.data.inspectorMode, false)
  assert.match(page._staticHtmlFallback, /这是压缩包里的真实正文/)
})

test('ZIP Unix 符号链接从真实页面入口打开目标正文，不把链接路径当正文', async () => {
  const { zipWithLinks } = require('./helpers/archive-links')
  const targetHtml = '<main><h1>ZIP 链接后的真实页面</h1><p>不是路径文本。</p></main>'
  const archive = zipWithLinks([
    { name: 'docs/page.html', content: targetHtml },
    { name: 'shortcut', target: 'docs/page.html' }
  ])
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/tmp/linked.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
      const data = source.subarray(start, end)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => {
      extracted = Buffer.from(options.data)
      options.success()
    }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })

  page.openSelectedFile({ name: 'linked.zip', path: '/tmp/linked.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  const linkIndex = page.data.inspectorEntries.findIndex(entry => entry.name === 'shortcut')
  assert.ok(linkIndex >= 0)
  assert.equal(page.data.inspectorEntries[linkIndex].isLink, true)
  assert.equal(page.data.inspectorEntries[linkIndex].canOpen, true)

  await page.openInspectorEntry({ currentTarget: { dataset: { index: linkIndex } } })
  assert.equal(page.data.error, '')
  assert.equal(page.data.sourceName, 'page.html')
  assert.equal(extracted.toString(), targetHtml)
  assert.match(page._staticHtmlFallback, /ZIP 链接后的真实页面/)
  assert.doesNotMatch(page._htmlRuntime.document.body.textContent, /^docs\/page\.html$/)
})

test('ZIP 链接目标即使位于500项显示上限之后，仍按完整中央目录身份打开', async () => {
  const { zipWithLinks } = require('./helpers/archive-links')
  const fillers = Array.from({ length: 500 }, (_, index) => ({ name: `mid-${String(index).padStart(3, '0')}.txt`, content: '' }))
  const archive = zipWithLinks([
    { name: '000-shortcut', target: 'zzz-target.html' },
    ...fillers,
    { name: 'zzz-target.html', content: '<h1>显示上限后的真实目标</h1>' }
  ])
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/tmp/many-linked.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
      const data = source.subarray(start, end)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })

  page.openSelectedFile({ name: 'many-linked.zip', path: '/tmp/many-linked.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  assert.equal(page.data.inspectorEntries.length, 500)
  assert.equal(page.data.inspectorEntries.some(entry => entry.name === 'zzz-target.html'), false)
  const linkIndex = page.data.inspectorEntries.findIndex(entry => entry.name === '000-shortcut')
  await page.openInspectorEntry({ currentTarget: { dataset: { index: linkIndex } } })

  assert.equal(page.data.error, '')
  assert.equal(page.data.sourceName, 'zzz-target.html')
  assert.equal(extracted.toString(), '<h1>显示上限后的真实目标</h1>')
})

test('归档目录分页保留1001项完整身份并从第三页打开真实正文', async () => {
  const files = {}
  for (let index = 0; index < 1000; index++) files[`member-${String(index).padStart(4, '0')}.txt`] = Buffer.from(`成员 ${index}`)
  const body = '<h1>第三页归档成员真实正文</h1>'
  files['zzzz-target.html'] = Buffer.from(body)
  const archive = Buffer.from(zipSync(files, { level: 0 }))
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/local/many-members.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
      const data = source.subarray(start, end)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/local' } })
  page.openSelectedFile({ name: 'many-members.zip', path: '/local/many-members.zip', size: archive.length })
  await flushPromises()

  assert.equal(page.data.error, '')
  assert.equal(page.data.inspectorEntryCount, 1001)
  assert.equal(page.data.inspectorEntries.length, 500)
  assert.equal(page.data.inspectorEntryPage, 1)
  assert.equal(page.data.inspectorEntryPages, 3)
  assert.equal(page.data.inspectorHasPreviousPage, false)
  assert.equal(page.data.inspectorHasNextPage, true)

  page.nextInspectorEntryPage()
  assert.equal(page.data.inspectorEntryPage, 2)
  assert.equal(page.data.inspectorEntries.length, 500)
  page.nextInspectorEntryPage()
  assert.equal(page.data.inspectorEntryPage, 3)
  assert.equal(page.data.inspectorEntries.length, 1)
  assert.equal(page.data.inspectorHasNextPage, false)
  const targetIndex = page.data.inspectorEntries.findIndex(entry => entry.name === 'zzzz-target.html')
  assert.equal(targetIndex, 0)
  await page.openInspectorEntry({ currentTarget: { dataset: { index: targetIndex } } })

  assert.equal(page.data.error, '')
  assert.equal(extracted.toString(), body)
  assert.equal(page._htmlRuntime.document.body.textContent.trim(), '第三页归档成员真实正文')
})

test('包内特殊名称保留阅读页显示名，只有临时存储路径净化', async () => {
  for (const name of ['report*.txt', 'note?.txt', '@list.txt', '-option.txt', '中文"标题.txt']) {
    const content = Buffer.from(`真实内容：${name}`)
    const archive = zipSync({ [`资料/${name}`]: content })
    let extracted = Buffer.alloc(0)
    let savedPath = ''
    const manager = {
      readFile: options => {
        const source = options.filePath === '/tmp/names.zip' ? Buffer.from(archive) : extracted
        const start = Number(options.position || 0)
        const data = source.subarray(start, options.length == null ? source.length : start + Number(options.length))
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      },
      writeFile: options => { savedPath = options.filePath; extracted = Buffer.from(options.data); options.success() }
    }
    const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })
    page.openSelectedFile({ name: 'names.zip', path: '/tmp/names.zip', size: archive.length })
    await flushPromises()
    const index = page.data.inspectorEntries.findIndex(entry => entry.canOpen)
    await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
    assert.equal(page.data.sourceName, name)
    assert.deepEqual(extracted, content)
    assert.match(page._staticHtmlFallback, /真实内容/)
    assert.ok(savedPath.startsWith('/wx-user-data/html-reader-zip-'))
    assert.doesNotMatch(savedPath.split('/').pop(), /[\\:*?"<>|]/)
  }
})

test('斜杠分隔的归档保留文件名中的字面反斜杠，临时路径仍净化', async () => {
  const body = Buffer.from('<h1>字面反斜杠正文</h1>')
  let selected
  let savedPath = ''
  const { page } = loadPage({
    env: { USER_DATA_PATH: '/wx-user-data' },
    getFileSystemManager: () => ({ writeFile: options => { savedPath = options.filePath; options.success() } })
  })
  page._inspectorBytes = body
  page._inspectorEntries = [{
    name: 'literal\\backslash.html', pathSeparator: 'slash', archiveType: 'rar4', canOpen: true,
    dataOffset: 0, compressedSize: body.length, uncompressedSize: body.length, crc: require('./helpers/archive-duplicates').crc32(body)
  }]
  page.openSelectedFile = file => { selected = file }

  await page.openInspectorEntry({ currentTarget: { dataset: { index: 0 } } })

  assert.equal(selected.name, 'literal\\backslash.html')
  assert.doesNotMatch(savedPath.split('/').pop(), /[\\:*?"<>|]/)
})

test('ZIP 旧式文件名可在阅读页切换 CP437 与 GBK，不把标准样本显示成中文乱码', async () => {
  const archive = Buffer.from('UEsDBAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAYXNjaWkudHh0YXNjaWlQSwMECgAAAAAA5npGOubG5usNAAAADQAAAAwAAACZbGaEc3Nlci50eHRIZWxsbywgd29ybGQhUEsDBAoAAAgAAPR6RjpgmWdMEwAAABMAAAASAAAA4oKsX2Zvcl9Eb2xsYXIudHh0R2l2ZSBtZSB5b3VyIG1vbmV5IVBLAQIUAAoAAAAAAImDRzr52jrRBQAAAAUAAAAJAAAAAAAAAAAAIAAAAAAAAABhc2NpaS50eHRQSwECFAAKAAAAAADmekY65sbm6w0AAAANAAAADAAAAAAAAAAAAIAAAAAsAAAAmWxmhHNzZXIudHh0UEsBAhQACgAACAAA9HpGOmCZZ0wTAAAAEwAAABIAAAAAAAAAAACAAAAAYwAAAOKCrF9mb3JfRG9sbGFyLnR4dFBLBQYAAAAAAwADALEAAACmAAAAAAA=', 'base64')
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(archive) })

  page.openSelectedFile({ name: 'utf8-7zip-test.zip', path: '/tmp/utf8-7zip-test.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()

  assert.deepEqual(page.data.inspectorEntries.map(entry => entry.name), ['ascii.txt', 'Ölfässer.txt', '€_for_Dollar.txt'])
  assert.equal(page.data.inspectorNameEncoding, '自动（UTF-8 / CP437）')
  assert.deepEqual(page.data.inspectorNameEncodingOptions.map(item => item.value), ['auto', 'utf-8', 'cp437', 'gb18030', 'shift_jis', 'cp949', 'big5'])

  await page.applyArchiveNameEncoding('gb18030')
  assert.equal(page.data.inspectorNameEncoding, 'GBK')
  assert.equal(page.data.inspectorEntries.some(entry => entry.name === '檒f剆ser.txt'), true)

  await page.applyArchiveNameEncoding('cp437')
  assert.equal(page.data.inspectorEntries.some(entry => entry.name === 'Ölfässer.txt'), true)
})

test('BZip2 ZIP 在阅读页切换编码后保留原生成员身份并解出真实正文', async () => {
  const zlib = require('node:zlib')
  const { BZIP2_ZIP, renameSingleMemberZip } = require('./helpers/zip-legacy-compat')
  const { inspect7zArchive, extract7zEntry } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
  const { inspectZipCentral, readZipDirectoryDescriptor } = require('../miniprogram/file-reader/engine/core/file-inspector')
  const { mergeZipEngineInspection } = require('../miniprogram/file-reader/archive/zip-engine-bridge')
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const options = { wasmBinary, maxEntrySize: 1024 * 1024, archiveExtension: '.zip', archiveType: 'zip-engine' }
  const name = '한글/읽기.txt'
  const archive = renameSingleMemberZip(BZIP2_ZIP, iconv.encode(name, 'cp949'))
  const native = await inspect7zArchive(archive, options)
  const descriptor = readZipDirectoryDescriptor(archive)
  const central = archive.subarray(descriptor.offset, descriptor.offset + descriptor.centralSize)
  const { page } = loadPage()
  page._inspectorZipCentral = central
  page._inspectorZipDescriptor = descriptor
  page._inspectorZipNativeInspection = native
  page.presentInspection(mergeZipEngineInspection(native, inspectZipCentral(central, descriptor)), page._fileOpenRevision)
  for (const encoding of ['cp949', 'cp437', 'cp949']) {
    await page.applyArchiveNameEncoding(encoding)
    assert.equal(page.data.error, '')
    const entry = page._inspectorEntries.find(item => item.canOpen)
    const expectedName = iconv.decode(iconv.encode(name, 'cp949'), encoding)
    assert.equal(page.data.inspectorEntries.find(item => item.canOpen).name, expectedName)
    assert.equal(entry.name, expectedName)
    assert.equal(entry.nativeName, native.entries[0].name)
    const content = await extract7zEntry(archive, entry, options)
    assert.equal(new TextDecoder().decode(content), 'BZip2 ZIP 里的真实正文。'.repeat(200))
  }
})

test('阅读页可直接选择日文、韩文与繁体编码，不必循环猜编码', async () => {
  const cases = [
    { encoding: 'shift_jis', name: '日本語/設計資料.txt', label: '日文 Shift_JIS' },
    { encoding: 'cp949', name: '한글/폴더/읽기.txt', label: '韩文 CP949 / EUC-KR' },
    { encoding: 'big5', name: '繁體中文/設計圖.ai', label: '繁体 Big5' }
  ]
  for (const sample of cases) {
    const archive = storedZipWithRawName(iconv.encode(sample.name, sample.encoding))
    const { page } = loadPage({ getFileSystemManager: () => rangedReader(archive) })
    page.openSelectedFile({ name: `${sample.encoding}.zip`, path: `/tmp/${sample.encoding}.zip`, size: archive.length, type: 'application/zip' })
    await flushPromises()
    page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding: sample.encoding } } })
    assert.equal(page.data.inspectorNameEncoding, sample.label)
    assert.equal(page.data.inspectorEntries.find(entry => entry.canOpen).name, sample.name)
  }
})

test('韩文 CP949 文件名切换后点击真实条目，正文身份与原始字节保持一致', async () => {
  const name = '한글/폴더/읽기.html'
  const body = '<h1>압축 파일의 실제 본문</h1>'
  const archive = storedZipWithRawName(iconv.encode(name, 'cp949'), body)
  let extracted = Buffer.alloc(0)
  const manager = {
    readFile: options => {
      const source = options.filePath === '/tmp/korean.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const end = options.length == null ? source.length : start + Number(options.length)
      const data = source.subarray(start, end)
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })
  page.openSelectedFile({ name: 'korean.zip', path: '/tmp/korean.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  assert.notEqual(page.data.inspectorEntries.find(item => item.canOpen).name, name)
  page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding: 'cp949' } } })
  const index = page.data.inspectorEntries.findIndex(item => item.canOpen)
  assert.equal(page.data.inspectorEntries[index].name, name)
  await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
  assert.equal(extracted.toString(), body)
  assert.equal(page.data.error, '')
  assert.equal(page._htmlRuntime.document.body.textContent.trim(), '압축 파일의 실제 본문')
})

test('阅读页自动和手动编码往返后仍打开同一条目，切换不会重新读取聊天文件', async () => {
  const rawName = Buffer.concat([Buffer.from('nested/symbol-'), Buffer.from([0xc2, 0xa5]), Buffer.from('.txt')])
  const archive = storedZipWithRawName(rawName, '切换编码后仍然是同一份正文')
  let extracted = Buffer.alloc(0)
  let reads = 0
  const manager = {
    readFile: options => {
      reads++
      const source = options.filePath === '/tmp/ambiguous.zip' ? archive : extracted
      const start = Number(options.position || 0)
      const data = source.subarray(start, options.length == null ? source.length : start + Number(options.length))
      options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
    },
    writeFile: options => { extracted = Buffer.from(options.data); options.success() }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })
  page.openSelectedFile({ name: 'ambiguous.zip', path: '/tmp/ambiguous.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  assert.equal(page._inspectorZipLegacyEncoding, 'auto')
  assert.equal(page.data.inspectorEntries.find(item => item.canOpen).name, 'nested/symbol-¥.txt')
  const initialReads = reads
  for (const encoding of ['cp437', 'utf-8', 'auto', 'cp437']) {
    page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding } } })
    assert.equal(page.data.error, '')
    assert.equal(page.data.inspectorEntries.find(item => item.canOpen).name, iconv.decode(rawName, encoding === 'auto' ? 'utf-8' : encoding))
    assert.deepEqual(page.data.inspectorNameEncodingOptions.filter(item => item.active).map(item => item.value), [encoding])
    assert.equal(reads, initialReads)
  }
  const index = page.data.inspectorEntries.findIndex(item => item.canOpen)
  await page.openInspectorEntry({ currentTarget: { dataset: { index } } })
  assert.equal(page.data.inspectorMode, false)
  assert.match(page._staticHtmlFallback, /切换编码后仍然是同一份正文/)
})

test('非法 UTF-8 编码选择保留原目录，选择自动后清除错误且换文件重置选择', async () => {
  let archive = storedZipWithRawName(Buffer.from([0x81, 0x2e, 0x74, 0x78, 0x74]))
  const { page } = loadPage({ getFileSystemManager: () => rangedReader(archive) })
  page.openSelectedFile({ name: 'invalid.zip', path: '/tmp/invalid.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  const names = page.data.inspectorEntries.map(item => item.name)
  page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding: 'utf-8' } } })
  assert.match(page.data.error, /UTF-8/)
  assert.deepEqual(page.data.inspectorEntries.map(item => item.name), names)
  assert.equal(page._inspectorZipLegacyEncoding, 'auto')
  page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding: 'auto' } } })
  assert.equal(page.data.error, '')
  page.selectArchiveNameEncoding({ currentTarget: { dataset: { encoding: 'cp437' } } })
  archive = storedZipWithRawName(Buffer.from('中文正文.txt'))
  page.openSelectedFile({ name: 'modern.zip', path: '/tmp/modern.zip', size: archive.length, type: 'application/zip' })
  await flushPromises()
  assert.equal(page._inspectorZipLegacyEncoding, 'auto')
  assert.equal(page.data.inspectorEntries.find(item => item.canOpen).name, '中文正文.txt')
})

test('现代 CDR 文档包可查看目录并打开内部 XML 正文', async () => {
  const archive = zipSync({
    'metadata/document.xml': Buffer.from('<document><page name="封面"/></document>'),
    'content/root.dat': Buffer.from([1, 2, 3, 4])
  })
  let extracted = null
  const manager = rangedReader(archive, {
    writeFile: options => {
      extracted = new Uint8Array(options.data)
      options.success()
    }
  })
  manager.readFile = options => {
    const source = options.filePath === '/tmp/画册.cdr' ? Buffer.from(archive) : Buffer.from(extracted || [])
    const start = Number(options.position || 0)
    const end = options.length == null ? source.length : Math.min(source.length, start + Number(options.length))
    const data = source.subarray(start, end)
    options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
  }
  const { page } = loadPage({ getFileSystemManager: () => manager, env: { USER_DATA_PATH: '/wx-user-data' } })

  page.openSelectedFile({ name: '画册.cdr', path: '/tmp/画册.cdr', size: archive.length, type: 'application/x-cdr' })
  await flushPromises()
  assert.equal(page.data.inspectorTitle, 'CorelDRAW 文档包')
  const fileIndex = page.data.inspectorEntries.findIndex(entry => entry.name.endsWith('document.xml'))
  assert.ok(fileIndex >= 0)

  await page.openInspectorEntry({ currentTarget: { dataset: { index: fileIndex } } })
  assert.equal(page.data.inspectorMode, false)
  assert.match(page._staticHtmlFallback, /&lt;document&gt;&lt;page name="封面"\/&gt;&lt;\/document&gt;/)
})

test('超过 80 MB 的 ZIP 只按范围读取尾部目录，不把整个压缩包载入内存', async () => {
  const archive = Buffer.from(zipSync({ '深层/资料/说明.txt': Buffer.from('大包里的正文') }))
  const eocdOffset = archive.length - 22
  const originalCentralOffset = archive.readUInt32LE(eocdOffset + 16)
  const localPart = archive.subarray(0, originalCentralOffset)
  const centralPart = archive.subarray(originalCentralOffset, eocdOffset)
  const virtualCentralOffset = 90 * 1024 * 1024
  const eocd = Buffer.from(archive.subarray(eocdOffset))
  eocd.writeUInt32LE(virtualCentralOffset, 16)
  const virtualSize = virtualCentralOffset + centralPart.length + eocd.length
  const reads = []
  const manager = {
    readFile: options => {
      const position = Number(options.position || 0)
      const length = Number(options.length || virtualSize)
      reads.push({ position, length })
      const output = Buffer.alloc(length)
      const overlay = (source, sourcePosition) => {
        const start = Math.max(position, sourcePosition)
        const end = Math.min(position + length, sourcePosition + source.length)
        if (end > start) source.copy(output, start - position, start - sourcePosition, end - sourcePosition)
      }
      overlay(localPart, 0)
      overlay(centralPart, virtualCentralOffset)
      overlay(eocd, virtualCentralOffset + centralPart.length)
      options.success({ data: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) })
    }
  }
  const { page } = loadPage({ getFileSystemManager: () => manager })

  page.openSelectedFile({ name: '大型资料.zip', path: '/tmp/large.zip', size: virtualSize, type: 'application/zip' })
  await flushPromises()

  assert.equal(page.data.inspectorMode, true)
  assert.deepEqual(page.data.inspectorEntries.map(entry => entry.displayName), ['深层/', '资料/', '说明.txt'])
  assert.equal(Math.max(...reads.map(read => read.length)) < 70 * 1024, true)
  assert.equal(reads.some(read => read.length === virtualSize), false)
})

test('独立 SVG 优先用净化后的 data URI，解码失败时回退本地文件', () => {
  let writeOptions
  const fileSystem = {
    readFile: options => options.success({ data: '<svg viewBox="0 0 10 10" onclick="bad()"><script>bad()</script><circle r="4"/></svg>' }),
    writeFile: options => { writeOptions = options; options.success() }
  }
  const { page } = loadPage({
    env: { USER_DATA_PATH: '/wx-user-data' },
    getWindowInfo: () => ({ windowWidth: 390 }),
    getFileSystemManager: () => fileSystem
  })

  page.openSelectedFile({ name: '图形.svg', path: '/tmp/art.svg', size: 128, type: 'image/svg+xml' })

  assert.equal(writeOptions, undefined)
  assert.match(page.data.standaloneSvgSource, /^data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(Buffer.from(page.data.standaloneSvgSource.split(',')[1], 'base64').toString('utf8'), /onclick|<script/)
  page.onStandaloneSvgError({ detail: { errMsg: 'data URI unavailable' } })
  assert.equal(writeOptions.filePath, '/wx-user-data/html-reader-svg-preview-1.svg')
  assert.match(writeOptions.data, /<svg\b/)
  assert.doesNotMatch(writeOptions.data, /onclick|<script/)
  assert.equal(page.data.hasContent, true)
  assert.equal(page.data.standaloneSvgPath, '/wx-user-data/html-reader-svg-preview-1.svg')
  assert.equal(page.data.standaloneSvgSource, '')
  assert.equal(page.data.domMode, false)
  page.onStandaloneSvgLoad()
  assert.equal(page.data.isLoading, false)
})

test('动态 SVG（SMIL / CSS 动画）交给 image 分包的 <svg-view> 播放，静态 data URI 同时备好；组件失败退回 <image>', () => {
  const animated = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/svg-animated/partridge-bike.svg'), 'utf8')
  const fileSystem = { readFile: options => options.success({ data: animated }), writeFile: () => {} }
  const { page } = loadPage({
    env: { USER_DATA_PATH: '/wx-user-data' },
    getWindowInfo: () => ({ windowWidth: 390 }),
    getFileSystemManager: () => fileSystem
  })
  page.openSelectedFile({ name: '鹧鸪.svg', path: '/tmp/bike.svg', size: animated.length, type: 'image/svg+xml' })
  assert.equal(page.data.hasContent, true)
  assert.equal(page.data.standaloneSvgAnimatedSource, animated, '原文交给 <svg-view>，不经净化（Canvas 不执行脚本）')
  assert.match(page.data.standaloneSvgSource, /^data:image\/svg\+xml;base64,/, '静态 data URI 同时准备好作为回退')
  assert.equal(page.data.isLoading, true, '首帧画出前仍在加载')
  page.onStandaloneSvgAnimatedReady({ detail: { animated: true, width: 390, height: 244, unsupported: [] } })
  assert.equal(page.data.isLoading, false)
  assert.equal(page.data.standaloneSvgAnimationNotice, '')

  page.onStandaloneSvgAnimatedError({ detail: { message: 'Canvas 2D 上下文不可用' } })
  assert.equal(page.data.standaloneSvgAnimatedSource, '', '组件失败后退回静态 <image>')
  assert.match(page.data.standaloneSvgSource, /^data:image\/svg\+xml;base64,/)

  assert.match(page.data.standaloneSvgAnimationNotice, /静态预览/)
  assert.equal(page.data.standaloneSvgAnimationCanRetry, true)
  page.retryStandaloneSvgAnimation()
  assert.equal(page.data.standaloneSvgAnimatedSource, animated)
  assert.equal(page.data.standaloneSvgAnimationNotice, '')
  assert.equal(page.data.standaloneSvgAnimationCanRetry, false)

  // 静态 SVG 不会请 <svg-view>
  fileSystem.readFile = options => options.success({ data: '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>' })
  page.openSelectedFile({ name: '静态.svg', path: '/tmp/still.svg', size: 60, type: 'image/svg+xml' })
  assert.equal(page.data.standaloneSvgAnimatedSource, '')
  assert.match(page.data.standaloneSvgSource, /^data:image\/svg\+xml;base64,/)
  page.retryStandaloneSvgAnimation()
  assert.equal(page.data.standaloneSvgAnimatedSource, '', '切换文件后不能重试上一份动画')
  assert.equal(page.data.standaloneSvgAnimationNotice, '')
})

test('动态 SVG 超过 Canvas 文本预算时明确显示静态限制且不提供无效重试', () => {
  const animated = '<svg viewBox="0 0 10 10"><rect width="2" height="2"><animate attributeName="x" to="5" dur="1s"/></rect><!--' + 'x'.repeat(512 * 1024) + '--></svg>'
  const { page } = loadPage({ env: { USER_DATA_PATH: '/wx-user-data' }, getFileSystemManager: () => ({ readFile: o => o.success({ data: animated }), writeFile: o => o.success() }) })
  page.openSelectedFile({ name: 'budget.svg', path: '/tmp/budget.svg', size: animated.length })
  assert.equal(page.data.standaloneSvgAnimatedSource, '')
  assert.match(page.data.standaloneSvgAnimationNotice, /较大.*静态/)
  assert.equal(page.data.standaloneSvgAnimationCanRetry, false)
  page.retryStandaloneSvgAnimation()
  assert.equal(page.data.standaloneSvgAnimatedSource, '')
})

test('过大的 SVG 会在读取前拒绝，避免把超大 XML 塞进本地解析器', () => {
  let readCount = 0
  const { page } = loadPage({ getFileSystemManager: () => ({ readFile: () => { readCount++ } }) })

  page.openSelectedFile({ name: '超大图.svg', path: '/tmp/huge.svg', size: 20 * 1024 * 1024 + 1, type: 'image/svg+xml' })

  assert.equal(readCount, 0)
  assert.match(page.data.error, /SVG 超过 20 MB/)
})

test('阅读页直接展示文件内容，不再显示顶部文件栏或自绘首页按钮', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/file-reader/engine/components/reader/reader.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/file-reader/engine/components/reader/reader.wxss'), 'utf8')
  const hostTemplate = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/index/index.wxml'), 'utf8')
  const hostStyles = require('./helpers/read-wxss')(path.join(__dirname, '..', 'miniprogram/pages/index/index.wxss'))

  assert.equal(template.includes('解析报告'), false)
  assert.equal(template.includes('阅读结果'), false)
  assert.equal(template.includes('A−'), false)
  assert.equal(template.includes('brand-lockup'), false)
  assert.equal(template.includes('document-kicker'), false)
  assert.equal(template.includes('高保真打开'), false)
  assert.equal(template.includes('打开常用文件'), false)
  assert.equal(template.includes('document-bar'), false)
  assert.equal(template.includes('换文件'), false)
  assert.equal(template.includes('home-icon'), false)
  assert.match(template, /copy-link="\{\{false\}\}"/)
  assert.match(template, /import src="\.\/dom-tree\.wxml"/)
  assert.match(template, /template is="dn0"/)
  assert.match(template, /<design-preview\b[^>]*file="\{\{designFile\}\}"/)
  assert.equal(template.includes('queueCount'), false, '队列栏属于宿主页面，不进入可复用组件')
  assert.match(styles, /\.reader-page\s*\{[^}]*padding:\s*0;/s)
  assert.equal(styles.includes('.file-queue'), false)
  assert.match(hostTemplate, /<file-reader\b[^>]*id="reader"[^>]*file="\{\{file\}\}"[^>]*siblings="\{\{siblings\}\}"/)
  assert.match(hostTemplate, /queueCount > 1/)
  assert.match(hostStyles, /\.file-queue\s*\{[^}]*position:\s*fixed/s)
})

test('同一批文件可在阅读页连续切换，不重新打开聊天文件选择器', () => {
  const app = {
    globalData: {
      fileQueue: [
        { name: '第一份.html', type: 'text/html', inlineHtml: '<h1>第一份</h1>' },
        { name: '第二份.html', type: 'text/html', inlineHtml: '<h1>第二份</h1>' }
      ],
      fileQueueIndex: 0,
      pendingMaterial: { name: '第一份.html', type: 'text/html', inlineHtml: '<h1>第一份</h1>' }
    }
  }
  const { page, host } = loadPage({}, app)
  host.onShow()
  assert.equal(host.data.queuePosition, 1)
  assert.deepEqual(page.data.siblings.map(item => item.name), ['第一份.html', '第二份.html'])
  assert.match(page._htmlRuntime.document.body.textContent, /第一份/)

  host.openNextFile()

  assert.equal(app.globalData.fileQueueIndex, 1)
  assert.equal(host.data.queuePosition, 2)
  assert.equal(host.data.hasNextFile, false)
  assert.match(page._htmlRuntime.document.body.textContent, /第二份/)
})

test('快速切换文件时，较慢返回的上一份读取结果不会覆盖当前页面', () => {
  const reads = []
  const app = {
    globalData: {
      fileQueue: [
        { name: '慢.html', path: '/tmp/slow.html', size: 100 },
        { name: '快.html', path: '/tmp/fast.html', size: 100 }
      ],
      fileQueueIndex: 0,
      pendingMaterial: { name: '慢.html', path: '/tmp/slow.html', size: 100 }
    }
  }
  const { page, host } = loadPage({
    getFileSystemManager: () => ({
      stat: options => options.success({ stats: { size: Buffer.byteLength('<h1>当前文件</h1>') } }),
      readFile: options => reads.push(options)
    })
  }, app)

  host.onShow()
  host.openNextFile()
  reads[1].success({ data: Buffer.from('<h1>当前文件</h1>') })
  reads[0].success({ data: Buffer.from('<h1>过期文件</h1>') })

  assert.equal(page.data.sourceName, '快.html')
  assert.match(page._htmlRuntime.document.body.textContent, /当前文件/)
  assert.doesNotMatch(page._htmlRuntime.document.body.textContent, /过期文件/)
})

test('打开网页后导航栏仍使用产品标题，阅读器组件不改宿主标题', () => {
  const { page, host, calls } = loadPage()

  host.onShow()
  page.parseContent('<title>HTML / CSS / JS 综合测试页</title><h1>正文</h1>', 'test.html')

  assert.deepEqual(calls.titles, ['兔子阅读器'])
  page.disposeHtmlRuntime()
})

test('页面重新显示时会清除上一个文档残留的导航标题', () => {
  let shareOptions
  const { host, calls } = loadPage({ showShareMenu: options => { shareOptions = options } })

  host.onShow()

  assert.deepEqual(calls.titles.at(-1), '兔子阅读器')
  assert.deepEqual(shareOptions.menus, ['shareAppMessage', 'shareTimeline'])
})

test('从聊天素材入口进入后会直接读取并打开 HTML 文件', () => {
  const app = {
    globalData: {
      pendingMaterial: {
        type: 'text/html',
        name: '聊天网页.html',
        path: '/tmp/chat-page.html',
        size: 512
      }
    }
  }
  let readPath = ''
  const content = Buffer.from('<article><h1>聊天中的网页</h1><p>直接打开成功</p></article>')
  const { page, host } = loadPage({
    getFileSystemManager: () => ({
      stat: options => options.success({ stats: { size: content.length } }),
      readFile: options => {
        readPath = options.filePath
        options.success({ data: content })
      }
    })
  }, app)

  host.onShow()

  assert.equal(readPath, '/tmp/chat-page.html')
  assert.equal(page.data.sourceName, '聊天网页.html')
  assert.match(page._htmlRuntime.document.body.textContent, /直接打开成功/)
  assert.equal(app.globalData.pendingMaterial, null)
})

test('聊天素材超限且没有 stat 能力时仍拒绝读取', () => {
  const app = {
    globalData: {
      pendingMaterial: {
        type: 'text/html',
        name: 'too-large.html',
        path: '/tmp/too-large.html',
        size: 20 * 1024 * 1024 + 1
      }
    }
  }
  let readCalled = false
  const { page, host } = loadPage({
    getFileSystemManager: () => ({ readFile: () => { readCalled = true } })
  }, app)

  host.onShow()

  assert.equal(readCalled, false)
  assert.match(page.data.error, /HTML 文件长度超过读取安全上限/)
})

test('Markdown front-matter 以 meta 事件交给宿主，正文背景色以 theme 事件交给宿主', async () => {
  const source = Buffer.from('---\nagi_bar_version: 1\nwx_miniapp_path: /pages/index/index\n---\n\n# 标题\n\n$E=mc^2$\n')
  const { page, internals } = loadPage({
    getFileSystemManager: () => ({
      readFile: options => options.success({ data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) })
    })
  })

  page.openSelectedFile({ name: 'deeplink.md', path: '/tmp/deeplink.md', size: source.length, type: 'text/markdown' })
  await flushPromises()

  const meta = page.events.find(event => event.name === 'meta')
  assert.deepEqual(meta.detail, { name: 'deeplink.md', meta: { agi_bar_version: '1', wx_miniapp_path: '/pages/index/index' } })
  assert.match(page._staticHtmlFallback, /<span class="md-formula">E=mc²<\/span>/)
  const theme = page.events.find(event => event.name === 'theme')
  assert.ok(theme, '排版完成后应报告正文背景')
  assert.equal(theme.detail.name, 'deeplink.md')
  page.disposeHtmlRuntime()

  assert.equal(internals.documentBackgroundColor('width:100%;background:#123456;color:#fff'), '#123456')
  assert.equal(internals.documentBackgroundColor('background-color: rgba(0,0,0,0)'), '')
  assert.equal(internals.documentBackgroundColor('background:transparent'), '')
  assert.equal(internals.documentBackgroundColor(''), '')
})

test('网页的 <meta name> 与 <title> 以 meta 事件交给宿主；没有元信息的网页不触发', () => {
  const { page } = loadPage()
  page.openSelectedFile({ name: 'export.html', inlineHtml: '<!doctype html><html><head><meta charset="utf-8"><meta name="agi_bar_version" content="1"><meta name=\'wx_miniapp_path\' content=\'/pages/index/index?from=doc\'><title> 活动 <b>手册</b> </title></head><body><p>正文</p></body></html>' })
  const meta = page.events.find(event => event.name === 'meta')
  assert.deepEqual(meta.detail, { name: 'export.html', meta: { agi_bar_version: '1', wx_miniapp_path: '/pages/index/index?from=doc', title: '活动 手册' } })
  page.disposeHtmlRuntime()

  const plain = loadPage().page
  plain.openSelectedFile({ name: 'plain.html', inlineHtml: '<p>没有头部信息</p>' })
  assert.equal(plain.events.some(event => event.name === 'meta'), false)
  plain.disposeHtmlRuntime()
})

test('深色网页的 theme 事件带出真实背景色，同一背景不重复触发', () => {
  const { page } = loadPage()
  page.parseContent('<body style="background:#101820;color:#fff"><button id="go">0</button><script>document.getElementById("go").onclick=function(){this.textContent="1"}</script></body>', 'dark.html')
  const themes = () => page.events.filter(event => event.name === 'theme')
  assert.equal(themes().length, 1)
  assert.equal(themes()[0].detail.background, '#101820')
  page.onDomTap({ currentTarget: { dataset: { nid: page._htmlRuntime.document.getElementById('go')._nid } } })
  page._htmlRuntime.flush(true)
  assert.equal(themes().length, 1, '背景未变化时不再重复触发')
  page.disposeHtmlRuntime()
})
