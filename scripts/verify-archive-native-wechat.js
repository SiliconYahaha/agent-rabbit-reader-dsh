'use strict'

// Tests the real WXWebAssembly + WXML member tap route, not the Node WASM path.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { files, names, nativeNamesArchive } = require('../tests/helpers/archive-native-names')
const { combineZips, duplicateSevenZip } = require('../tests/helpers/archive-duplicates')
const { renameSingleMemberZip } = require('../tests/helpers/zip-legacy-compat')
const { storedZipWithUnicodePaths } = require('../tests/helpers/zip-unicode-path')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

async function main () {
  const endpoint = process.argv[2], out = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'native-archive-wechat-'))
  assert.ok(endpoint, 'Pass the unlocked WeChat DevTools automator endpoint')
  console.log(`连接微信开发者工具：${endpoint}`)
  fs.mkdirSync(out, { recursive: true })
  const wasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const duplicateMembers = [{ name: 'a\nb.txt', content: 'first native same-name body' }, { name: 'a\nb.txt', content: 'other native same-name body' }]
  const bzip2Sources = [
    'UEsDBC4AAAAMAIMYIlAHyf8rPgAAABUAAAAJAAAAZW50cnkudHh0QlpoOTFBWSZTWbRlYL0AAAoAeUKAAQAIBwBuB4AgACKBoZGPVChppgA5CSo2EPWaNdCQ+LuSKcKEhaMrBehQSwECLgMuAAAADACDGCJQB8n/Kz4AAAAVAAAACQAAAAAAAAAAAAAAgAEAAAAAZW50cnkudHh0UEsFBgAAAAABAAEANwAAAGUAAAAAAA==',
    'UEsDBC4AAAAMAIMYIlAIiuFYPgAAABUAAAAJAAAAZW50cnkudHh0QlpoOTFBWSZTWVxhGogAAAoAeQKEAQAIBwA+B4AgACKA0ZNM9UKGmmACMtKjYTpRYRwkPi7kinChILjCNRBQSwECLgMuAAAADACDGCJQCIrhWD4AAAAVAAAACQAAAAAAAAAAAAAAgAEAAAAAZW50cnkudHh0UEsFBgAAAAABAAEANwAAAGUAAAAAAA=='
  ].map(value => Buffer.from(value, 'base64'))
  const decodedDuplicateZip = combineZips(bzip2Sources.map((source, index) => renameSingleMemberZip(source, Buffer.from(index ? 'f9e92e747874' : 'a2a52e747874', 'hex'))))
  const duplicateUnicodePathZip = storedZipWithUnicodePaths({ unicodePaths: [{ name: 'first.html' }, { name: 'second.html' }], content: '<h1>微信重复元数据正文</h1>' })
  const scenarios = [
    { name: 'native-control-names.7z', bytes: await nativeNamesArchive(wasm, '7z'), selections: names.map(name => ({ name, expected: files[name].toString() })) },
    { name: 'native-duplicates.7z', bytes: await duplicateSevenZip(duplicateMembers, wasm), selections: duplicateMembers.map((m, index) => ({ name: m.name, duplicateIndex: index, expected: m.content })) },
    { name: 'decoded-duplicates.zip', bytes: decodedDuplicateZip, encoding: 'big5', selections: ['第一份兼容正文', '第二份兼容正文'].map((expected, duplicateIndex) => ({ name: '╞.txt', duplicateIndex, expected })) },
    { name: 'duplicate-unicode-path.zip', bytes: duplicateUnicodePathZip, selections: [{ name: 'safe/raw.html', expected: '微信重复元数据正文' }] }
  ]
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  const report = { at: new Date().toISOString(), version: require('../package.json').version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(), opened: [],
    automatorScreenshots: process.env.WECHAT_SIMULATOR_SCREENSHOTS !== '0',
    boundary: 'Generated fixtures written to local WeChat sandbox; actual Page openSelectedFile and WXML row taps. Not the OS picker and not iOS/Android hardware.' }
  try {
    await mini.reLaunch('/pages/home/home')
    report.environment = await mini.evaluate(() => ({ sdk: wx.getAppBaseInfo().SDKVersion, window: wx.getWindowInfo() }))
    const home = await mini.currentPage(), buttons = await home.$$('.source-button')
    assert.equal(buttons.length, 2)
    assert.match(await buttons[1].text(), /打开示例/)
    await buttons[1].tap()
    const start = Date.now()
    let sampleReady = false
    while (Date.now() - start < 20000) {
      sampleReady = await mini.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader')
        return host.route === 'pages/index/index' && p.data.sourceName === 'html-css-js-local-test.html' && p.data.hasContent && !p.data.isLoading && !p.data.error
      })
      if (sampleReady) break
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    assert.ok(sampleReady, 'Home sample button did not start a fresh reader session')
    const state = () => mini.evaluate(() => { const host = getCurrentPages().slice(-1)[0], p = host.selectComponent('#reader'); return { path: host.route, error: p.data.error, loading: p.data.isLoading, entries: p.data.inspectorEntries, inspector: p.data.inspectorMode, sourceName: p.data.sourceName, content: p._staticHtmlFallback || '', hasContent: p.data.hasContent } })
    const wait = async predicate => {
      const start = Date.now()
      while (Date.now() - start < 20000) {
        const value = await state(); assert.equal(value.error, '', JSON.stringify(value))
        if (predicate(value)) return value
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      throw new Error('Native archive page did not settle in 20 seconds')
    }
    for (const scenario of scenarios) for (const selection of scenario.selections) {
      console.log(`验证归档条目：${scenario.name} / ${selection.duplicateIndex == null ? selection.name : `${selection.name} #${selection.duplicateIndex + 1}`}`)
      await mini.evaluate(({ name, base64 }) => {
        const bytes = wx.base64ToArrayBuffer(base64), file = wx.env.USER_DATA_PATH + '/' + name
        wx.getFileSystemManager().writeFileSync(file, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: file, size: bytes.byteLength })
      }, { name: scenario.name, base64: Buffer.from(scenario.bytes).toString('base64') })
      let listed = await wait(s => s.inspector && !s.loading && s.entries && s.entries.length)
      const page = await mini.currentPage()
      if (scenario.encoding) {
        const choice = await page.$(`.archive-name-encoding-${scenario.encoding}`)
        assert.ok(choice, `Missing ${scenario.encoding} WXML encoding choice`)
        await choice.tap()
        listed = await wait(s => s.inspector && !s.loading && s.entries.some(entry => entry.name === selection.name))
      }
      const index = listed.entries.findIndex(e => e.name === selection.name && (selection.duplicateIndex == null || e.duplicateIndex === selection.duplicateIndex))
      assert.ok(index >= 0, 'Missing original member identity: ' + JSON.stringify(selection))
      assert.equal(listed.entries[index].canOpen, true)
      assert.ok(!/[\n\r\t]/.test(listed.entries[index].displayName), 'Control character leaked into row layout')
      if (!report.opened.length && report.automatorScreenshots) await mini.screenshot({ path: path.join(out, 'directory.png') })
      const rows = await page.$$('#reader >>> .entry-row')
      assert.ok(rows[index], 'Missing actual WXML row')
      await rows[index].tap()
      const body = await wait(s => !s.inspector && !s.loading && s.hasContent && s.sourceName === selection.name.split('/').pop())
      assert.ok(body.content.includes(selection.expected), 'Wrong member body: ' + JSON.stringify(selection))
      if (selection.expected === '') assert.ok(!names.filter(name => files[name].length).some(name => body.content.includes(files[name].toString())), 'Empty file substituted with another member')
      if (!report.opened.length && report.automatorScreenshots) await mini.screenshot({ path: path.join(out, 'content.png') })
      report.opened.push({ archive: scenario.name, name: selection.name, memberIndex: listed.entries[index].memberIndex, duplicateIndex: listed.entries[index].duplicateIndex, label: listed.entries[index].displayName, contentVerified: true })
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ version: report.version, sdk: report.environment.sdk, actualWxmlTaps: report.opened.length, out }))
  } finally { mini.disconnect() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
