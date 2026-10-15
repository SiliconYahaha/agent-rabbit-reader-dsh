'use strict'

// Uses real WXWebAssembly, page data propagation and WXML row taps. The OS
// picker and physical iOS/Android devices are intentionally outside this test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { solidArchive } = require('../tests/helpers/7z-solid')
const { MAX_SOLID_DECODE_BYTES } = require('../miniprogram/file-reader/archive/sevenzip-runtime')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

const body = Buffer.from('<h1>微信固实块正文</h1>')

async function main () {
  const endpoint = process.argv[2]
  const out = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-solid-wechat-'))
  assert.ok(endpoint, '请传入已解锁微信开发者工具的自动化端点')
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const over = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(MAX_SOLID_DECODE_BYTES - body.length + 1, 0x61) },
    { name: '999-target.html', bytes: body }
  ], { archiveName: 'over-limit.7z' })
  const targetFirst = await solidArchive(wasmBinary, [
    { name: '000-target.html', bytes: body },
    { name: '999-filler.bin', bytes: Buffer.alloc(MAX_SOLID_DECODE_BYTES + 1, 0x62) }
  ], { archiveName: 'target-first.7z' })

  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  const report = {
    at: new Date().toISOString(),
    version: require('../package.json').version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
    actualWxmlTaps: 0,
    boundary: 'Generated archives are written to the WeChat sandbox. Uses WXWebAssembly and actual WXML member-row taps; not the OS picker or physical hardware.'
  }
  try {
    await mini.reLaunch('/pages/index/index')
    const readyStartedAt = Date.now()
    while (Date.now() - readyStartedAt < 20000) {
      const ready = await mini.evaluate(() => {
        const host = getCurrentPages().slice(-1)[0], page = host.selectComponent('#reader')
        return page && host.route === 'pages/index/index' && typeof page.openSelectedFile === 'function'
      })
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    const state = () => mini.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], page = host.selectComponent('#reader')
      return {
        route: host.route,
        error: page.data.error,
        loading: page.data.isLoading,
        inspector: page.data.inspectorMode,
        entries: page.data.inspectorEntries,
        sourceName: page.data.sourceName,
        content: page._staticHtmlFallback || '',
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
      throw new Error('微信固实块页面 30 秒内未稳定')
    }
    const openArchive = async (name, bytes) => {
      await mini.evaluate(({ name, base64 }) => {
        const data = wx.base64ToArrayBuffer(base64)
        const file = `${wx.env.USER_DATA_PATH}/${name}`
        wx.getFileSystemManager().writeFileSync(file, data)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: file, size: data.byteLength })
      }, { name, base64: Buffer.from(bytes).toString('base64') })
      return wait(value => value.inspector && !value.loading && value.entries && value.entries.length === 2)
    }

    let listed = await openArchive('target-first.7z', targetFirst)
    let index = listed.entries.findIndex(entry => entry.name === '000-target.html')
    assert.ok(index >= 0)
    assert.equal(listed.entries[index].canOpen, true)
    let page = await mini.currentPage()
    let rows = await page.$$('#reader >>> .entry-row')
    assert.match(await rows[index].attribute('class'), /entry-row-actionable/)
    await rows[index].tap()
    report.actualWxmlTaps++
    const opened = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === '000-target.html')
    assert.match(opened.content, /微信固实块正文/)

    listed = await openArchive('over-limit.7z', over)
    index = listed.entries.findIndex(entry => entry.name === '999-target.html')
    assert.ok(index >= 0)
    assert.equal(listed.entries[index].canOpen, false)
    assert.equal(listed.entries[index].solidDecodeSize, MAX_SOLID_DECODE_BYTES + 1)
    assert.match(listed.entries[index].detail, /固实块需解码 80\.0 MB，超过安全上限/)
    page = await mini.currentPage()
    rows = await page.$$('#reader >>> .entry-row')
    assert.doesNotMatch(await rows[index].attribute('class'), /entry-row-actionable/)
    await rows[index].tap()
    report.actualWxmlTaps++
    await new Promise(resolve => setTimeout(resolve, 500))
    const stayed = await state()
    assert.equal(stayed.inspector, true)
    assert.equal(stayed.loading, false)
    assert.equal(stayed.sourceName, 'over-limit.7z')
    assert.equal(stayed.error, '')

    report.sdk = await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion)
    report.targetFirst = { openedBody: true, member: '000-target.html' }
    report.overLimit = { stayedInDirectory: true, member: '999-target.html', decodedPrefixBytes: MAX_SOLID_DECODE_BYTES + 1 }
    await mini.screenshot({ path: path.join(out, 'over-limit-directory.png') })
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await mini.disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
