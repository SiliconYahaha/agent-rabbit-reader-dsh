'use strict'

// Uses real WXWebAssembly, the visible password input/button and actual WXML
// member rows. The OS picker and physical iOS/Android devices are outside it.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { solidArchive } = require('../tests/helpers/7z-solid')
const { MAX_SOLID_DECODE_BYTES } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

const password = 'solid-header-fixture-91'
const body = Buffer.from('<h1>微信加密固实块正文</h1>')
const resetBody = Buffer.from('<h1>微信空成员重置正文</h1>')

async function main () {
  const endpoint = process.argv[2]
  const out = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-encrypted-solid-wechat-'))
  assert.ok(endpoint, '请传入已解锁微信开发者工具的自动化端点')
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const over = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(MAX_SOLID_DECODE_BYTES - body.length + 1, 0x61) },
    { name: '999-target.html', bytes: body }
  ], { archiveName: 'encrypted-over-limit.7z', password })
  const targetFirst = await solidArchive(wasmBinary, [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(MAX_SOLID_DECODE_BYTES + 1, 0x62) }
  ], { archiveName: 'encrypted-target-first.7z', password })
  const emptyReset = await solidArchive(wasmBinary, [
    { name: '000-empty-dir', directory: true },
    { name: '010-empty.txt', bytes: Buffer.alloc(0) },
    { name: '020-nested', directory: true },
    { name: '020-nested/empty.txt', bytes: Buffer.alloc(0) },
    { name: '100-filler.bin', bytes: Buffer.alloc(64 * 1024, 0x63) },
    { name: '999-target.html', bytes: resetBody }
  ], { archiveName: 'encrypted-empty-reset.7z', password, solid: '1f' })
  const manyTinyMembers = Array.from({ length: 1001 }, (_, index) => ({
    name: `piece-${String(index).padStart(4, '0')}.dat`,
    bytes: Buffer.alloc(2048, index % 251)
  }))
  manyTinyMembers.push({ name: 'zzzz-target.html', bytes: Buffer.from('<h1>微信第三页真实正文</h1>') })
  const manyTiny = await solidArchive(wasmBinary, manyTinyMembers, { archiveName: 'encrypted-many-tiny.7z', password })

  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  const report = {
    at: new Date().toISOString(),
    version: require('../package.json').version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
    actualWxmlInputs: 0,
    actualWxmlButtonTaps: 0,
    actualWxmlRowTaps: 0,
    actualWxmlPageTaps: 0,
    boundary: 'Generated archives are written to the WeChat sandbox. Uses WXWebAssembly and actual WXML controls; not the OS picker or physical hardware.'
  }
  try {
    await mini.reLaunch('/pages/index/index')
    const state = () => mini.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], page = host.selectComponent('#reader')
      return {
        route: host.route,
        error: page.data.error,
        loading: page.data.isLoading,
        inspector: page.data.inspectorMode,
        needsPassword: page.data.inspectorNeedsPassword,
        passwordStatus: page.data.inspectorPasswordStatus,
        entries: page.data.inspectorEntries,
        entryCount: page.data.inspectorEntryCount,
        entryPage: page.data.inspectorEntryPage,
        entryPages: page.data.inspectorEntryPages,
        hasPreviousPage: page.data.inspectorHasPreviousPage,
        hasNextPage: page.data.inspectorHasNextPage,
        sourceName: page.data.sourceName,
        content: (page._staticHtmlFallback || '').slice(0, 4096),
        hasContent: page.data.hasContent
      }
    })
    const wait = async predicate => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < 30000) {
        const value = await state()
        assert.equal(value.error, '', JSON.stringify(value))
        if (predicate(value)) return value
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      throw new Error('微信加密固实块页面 30 秒内未稳定')
    }
    const openArchive = async (name, bytes) => {
      await mini.evaluate(({ name, base64 }) => {
        const data = wx.base64ToArrayBuffer(base64)
        const file = `${wx.env.USER_DATA_PATH}/${name}`
        wx.getFileSystemManager().writeFileSync(file, data)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: file, size: data.byteLength })
      }, { name, base64: Buffer.from(bytes).toString('base64') })
      return wait(value => value.inspector && value.needsPassword && !value.loading)
    }
    const enterPassword = async value => {
      const page = await mini.currentPage()
      const input = await page.$('#reader >>> .archive-password-input')
      const button = await page.$('#reader >>> .archive-password-button')
      assert.ok(input, '缺少实际 WXML 密码输入框')
      assert.ok(button, '缺少实际 WXML 解锁按钮')
      await input.input(value)
      report.actualWxmlInputs++
      await button.tap()
      report.actualWxmlButtonTaps++
    }

    await openArchive('encrypted-target-first.7z', targetFirst)
    await enterPassword('wrong-password')
    await wait(value => value.needsPassword && !value.loading && /密码不正确/.test(value.passwordStatus))
    await enterPassword(password)
    let listed = await wait(value => value.inspector && !value.needsPassword && !value.loading && value.entries.length === 2)
    let index = listed.entries.findIndex(entry => entry.name === '000-target.html')
    assert.ok(index >= 0)
    assert.equal(listed.entries[index].canOpen, true)
    let page = await mini.currentPage()
    let rows = await page.$$('#reader >>> .entry-row')
    assert.match(await rows[index].attribute('class'), /entry-row-actionable/)
    await rows[index].tap()
    report.actualWxmlRowTaps++
    const opened = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === '000-target.html')
    assert.match(opened.content, /微信加密固实块正文/)

    await openArchive('encrypted-over-limit.7z', over)
    await enterPassword(password)
    listed = await wait(value => value.inspector && !value.needsPassword && !value.loading && value.entries.length === 2)
    index = listed.entries.findIndex(entry => entry.name === '999-target.html')
    assert.ok(index >= 0)
    assert.equal(listed.entries[index].canOpen, false)
    assert.equal(listed.entries[index].solidDecodeSize, MAX_SOLID_DECODE_BYTES + 1)
    assert.match(listed.entries[index].detail, /固实块需解码 80\.0 MB，超过安全上限/)
    page = await mini.currentPage()
    rows = await page.$$('#reader >>> .entry-row')
    assert.doesNotMatch(await rows[index].attribute('class'), /entry-row-actionable/)
    await rows[index].tap()
    report.actualWxmlRowTaps++
    await new Promise(resolve => setTimeout(resolve, 500))
    const stayed = await state()
    assert.equal(stayed.inspector, true)
    assert.equal(stayed.loading, false)
    assert.equal(stayed.sourceName, 'encrypted-over-limit.7z')
    assert.equal(stayed.error, '')

    await openArchive('encrypted-empty-reset.7z', emptyReset)
    await enterPassword(password)
    listed = await wait(value => value.inspector && !value.needsPassword && !value.loading && value.entries.length === 6)
    assert.deepEqual(listed.entries.slice(0, 4).map(entry => entry.name.replace(/\/$/, '')).sort(), [
      '000-empty-dir', '010-empty.txt', '020-nested', '020-nested/empty.txt'
    ])
    const emptyEntry = listed.entries.find(entry => entry.name === '020-nested/empty.txt')
    assert.equal(emptyEntry.canOpen, true)
    assert.equal(emptyEntry.uncompressedSize, 0)
    index = listed.entries.findIndex(entry => entry.name === '999-target.html')
    assert.ok(index >= 0)
    assert.equal(listed.entries[index].canOpen, true)
    assert.equal(listed.entries[index].solidDecodeSize, undefined)
    page = await mini.currentPage()
    rows = await page.$$('#reader >>> .entry-row')
    assert.match(await rows[index].attribute('class'), /entry-row-actionable/)
    await rows[index].tap()
    report.actualWxmlRowTaps++
    const resetOpened = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === '999-target.html')
    assert.match(resetOpened.content, /微信空成员重置正文/)

    await openArchive('encrypted-many-tiny.7z', manyTiny)
    await enterPassword(password)
    listed = await wait(value => value.inspector && !value.needsPassword && !value.loading && value.entryCount === 1002 && value.entries.length === 500)
    assert.equal(listed.entryPage, 1)
    assert.equal(listed.entryPages, 3)
    assert.equal(listed.hasPreviousPage, false)
    assert.equal(listed.hasNextPage, true)
    page = await mini.currentPage()
    let pageButtons = await page.$$('#reader >>> .entry-page-button')
    assert.equal(pageButtons.length, 4)
    await pageButtons[1].tap()
    report.actualWxmlPageTaps++
    listed = await wait(value => value.inspector && !value.loading && value.entryPage === 2 && value.entries.length === 500)
    assert.equal(listed.hasPreviousPage, true)
    assert.equal(listed.hasNextPage, true)
    page = await mini.currentPage()
    pageButtons = await page.$$('#reader >>> .entry-page-button')
    await pageButtons[1].tap()
    report.actualWxmlPageTaps++
    listed = await wait(value => value.inspector && !value.loading && value.entryPage === 3 && value.entries.length === 2)
    assert.equal(listed.hasPreviousPage, true)
    assert.equal(listed.hasNextPage, false)
    index = listed.entries.findIndex(entry => entry.name === 'zzzz-target.html')
    assert.equal(index, 1)
    page = await mini.currentPage()
    rows = await page.$$('#reader >>> .entry-row')
    await rows[index].tap()
    report.actualWxmlRowTaps++
    const manyOpened = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === 'zzzz-target.html')
    assert.match(manyOpened.content, /微信第三页真实正文/)

    report.sdk = await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion)
    report.targetFirst = { wrongPasswordRecovered: true, openedBody: true, member: '000-target.html' }
    report.overLimit = { stayedInDirectory: true, member: '999-target.html', decodedPrefixBytes: MAX_SOLID_DECODE_BYTES + 1 }
    report.emptyReset = { listedEmptyMembers: 4, openedNewBlockBody: true, member: '999-target.html' }
    report.manyTiny = { memberCount: 1002, pages: 3, openedThirdPageBody: true, member: 'zzzz-target.html' }
    await mini.screenshot({ path: path.join(out, 'encrypted-over-limit-directory.png') })
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await mini.disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
