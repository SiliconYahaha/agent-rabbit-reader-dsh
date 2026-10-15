'use strict'

// Uses real WXWebAssembly and actual WXML error/password/member controls.
// The OS picker and physical iOS/Android devices are outside this verifier.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { solidArchive } = require('../tests/helpers/7z-solid')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

const password = 'truncated-volume-fixture-92'
const body = Buffer.from('<h1>微信完整分卷正文</h1>')

function uint32 (bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function uint64 (bytes, offset) {
  return uint32(bytes, offset) + uint32(bytes, offset + 4) * 0x100000000
}

function splitThree (archive) {
  const first = Math.ceil(archive.length / 3)
  const second = Math.ceil(archive.length * 2 / 3)
  return [archive.subarray(0, first), archive.subarray(first, second), archive.subarray(second)]
}

async function main () {
  const endpoint = process.argv[2]
  const out = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-truncated-volumes-wechat-'))
  assert.ok(endpoint, '请传入已解锁微信开发者工具的自动化端点')
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const archive = await solidArchive(wasmBinary, [
    { name: '000-filler.bin', bytes: Buffer.alloc(1024 * 1024, 0x77) },
    { name: '999-target.html', bytes: body }
  ], { password })
  const complete = splitThree(archive)
  const damaged = Buffer.from(archive)
  const nextStart = 32 + uint64(archive, 12)
  const nextSize = uint64(archive, 20)
  damaged[nextStart + Math.floor(nextSize / 2)] ^= 0x01

  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  const report = {
    at: new Date().toISOString(),
    version: require('../package.json').version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
    actualWxmlErrors: 0,
    actualWxmlInputs: 0,
    actualWxmlButtonTaps: 0,
    actualWxmlRowTaps: 0,
    boundary: 'Generated header-encrypted numeric volumes in the WeChat sandbox. Uses WXWebAssembly and actual WXML controls; not the OS picker or physical hardware.'
  }
  try {
    await mini.reLaunch('/pages/index/index')
    const state = () => mini.evaluate(() => {
      const host = getCurrentPages().slice(-1)[0], page = host.selectComponent('#reader')
      return {
        error: page.data.error,
        loading: page.data.isLoading,
        inspector: page.data.inspectorMode,
        needsPassword: page.data.inspectorNeedsPassword,
        entries: page.data.inspectorEntries,
        sourceName: page.data.sourceName,
        hasContent: page.data.hasContent,
        content: (page._staticHtmlFallback || '').slice(0, 2048)
      }
    })
    const wait = async (predicate, allowError = false) => {
      const startedAt = Date.now()
      let current
      while (Date.now() - startedAt < 30000) {
        current = await state()
        if (!allowError) assert.equal(current.error, '', JSON.stringify(current))
        if (predicate(current)) return current
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      throw new Error(`微信 7z 分卷页 30 秒内未稳定：${JSON.stringify(current)}`)
    }
    const openVolumes = async (parts, prefix) => {
      await mini.evaluate(({ encoded, prefix }) => {
        const files = encoded.map((base64, index) => {
          const bytes = wx.base64ToArrayBuffer(base64)
          const name = `${prefix}.7z.${String(index + 1).padStart(3, '0')}`
          const target = `${wx.env.USER_DATA_PATH}/${name}`
          wx.getFileSystemManager().writeFileSync(target, bytes)
          return { name, path: target, tempFilePath: target, size: bytes.byteLength, type: 'application/octet-stream' }
        })
        const app = getApp()
        app.globalData.fileQueue = files
        app.globalData.fileQueueIndex = 0
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile(files[0])
      }, { encoded: parts.map(bytes => Buffer.from(bytes).toString('base64')), prefix })
    }

    await openVolumes(splitThree(damaged), 'damaged-directory')
    let result = await wait(value => !value.loading && /目录头校验失败/.test(value.error), true)
    assert.equal(result.needsPassword, false)
    assert.equal(result.entries.length, 0)
    let page = await mini.currentPage()
    let errorCard = await page.$('#reader >>> .error-card')
    assert.ok(errorCard)
    assert.match(await errorCard.text(), /7z 分卷目录头校验失败，文件可能损坏/)
    report.actualWxmlErrors++
    await mini.screenshot({ path: path.join(out, 'damaged-directory-error.png') })

    await openVolumes(complete.slice(0, 2), 'missing-final')
    result = await wait(value => !value.loading && /末卷缺失或已截断/.test(value.error), true)
    assert.equal(result.needsPassword, false)
    page = await mini.currentPage()
    errorCard = await page.$('#reader >>> .error-card')
    assert.match(await errorCard.text(), /末卷缺失或已截断/)
    report.actualWxmlErrors++

    await openVolumes(complete, 'complete')
    await wait(value => value.inspector && value.needsPassword && !value.loading)
    page = await mini.currentPage()
    const input = await page.$('#reader >>> .archive-password-input')
    const button = await page.$('#reader >>> .archive-password-button')
    assert.ok(input)
    assert.ok(button)
    await input.input(password)
    report.actualWxmlInputs++
    await button.tap()
    report.actualWxmlButtonTaps++
    result = await wait(value => value.inspector && !value.needsPassword && !value.loading && value.entries.length === 2)
    const targetIndex = result.entries.findIndex(entry => entry.name === '999-target.html')
    assert.ok(targetIndex >= 0)
    page = await mini.currentPage()
    const rows = await page.$$('#reader >>> .entry-row')
    await rows[targetIndex].tap()
    report.actualWxmlRowTaps++
    result = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === '999-target.html')
    assert.match(result.content, /微信完整分卷正文/)
    await mini.screenshot({ path: path.join(out, 'recovered-body.png') })

    report.sdk = await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion)
    report.damagedDirectory = { readableError: true, passwordPrompt: false, directoryLeaked: false }
    report.missingFinal = { readableError: true, passwordPrompt: false }
    report.completeRecovery = { passwordPrompt: true, directoryEntries: 2, openedBody: true }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await mini.disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
