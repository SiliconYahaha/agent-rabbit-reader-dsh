'use strict'

// Uses real WXWebAssembly and the live reader component event handlers/state.
// The OS picker and physical iOS/Android devices are outside this verifier.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { packedCorruptionFixture } = require('../tests/helpers/7z-packed-corruption')
const { mixedBlocksFixture, splitMixedVolumes } = require('../tests/helpers/7z-mixed-blocks')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()

async function main () {
  const endpoint = process.argv[2]
  const out = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'reader-7z-packed-corruption-wechat-'))
  assert.ok(endpoint, '请传入已解锁微信开发者工具的自动化端点')
  fs.mkdirSync(out, { recursive: true })
  const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
  const method = process.argv[4] || null
  const mixed = method === 'mixed'
  const volumes = process.argv[5] === 'volumes'
  const generated = mixed ? await mixedBlocksFixture(wasmBinary) : null
  const fixture = mixed ? { ...generated, damaged: generated.damaged[0] } : await packedCorruptionFixture(wasmBinary, method ? { method, solid: 'off' } : {})
  const names = mixed ? fixture.names : ['000-first.html', '999-second.html']
  const independentIndex = mixed ? 2 : 1
  const firstPattern = mixed ? /混合压缩正文 1/ : /第一固实块完整正文/
  const independentPattern = mixed ? /混合压缩正文 3/ : /第二固实块完整正文/
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: endpoint })
  const report = {
    at: new Date().toISOString(),
    version: require('../package.json').version,
    method: method || 'LZMA2:d=1m',
    volumes,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
    componentPasswordInputs: 0,
    componentUnlockCalls: 0,
    componentRowCalls: 0,
    renderedSnapshots: 0,
    boundary: 'Generated header-encrypted 7z with two independent solid blocks. Uses WXWebAssembly and the live modular reader component; not the OS picker, nested native-control tap protocol, or physical hardware.'
  }
  try {
    await mini.reLaunch('/pages/index/index')
    const state = () => mini.evaluate(() => {
      const page = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      if (!page) return { attached: false }
      return {
        attached: true,
        error: page.data.error,
        loading: page.data.isLoading,
        inspector: page.data.inspectorMode,
        needsPassword: page.data.inspectorNeedsPassword,
        entries: page.data.inspectorEntries,
        sourceName: page.data.sourceName,
        hasContent: page.data.hasContent,
        loadMetrics: page._loadMetrics,
        domCount: page.data.domTree.length,
        content: (page._staticHtmlFallback || '').slice(0, 2048),
        passwordVerified: Boolean(page._archivePasswordVerified),
        hasPassword: Boolean(page._archivePassword)
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
      throw new Error(`微信 7z 数据损坏页 30 秒内未稳定：${JSON.stringify(current)}`)
    }
    const openArchive = async (name, bytes) => {
      if (volumes) {
        await mini.evaluate(parts => {
          const files = parts.map(({ name, base64 }) => {
            const data = wx.base64ToArrayBuffer(base64)
            const target = `${wx.env.USER_DATA_PATH}/${name}`
            wx.getFileSystemManager().writeFileSync(target, data)
            return { name, path: target, tempFilePath: target, size: data.byteLength }
          })
          getApp().globalData.fileQueue = files
          getApp().globalData.fileQueueIndex = 0
          // Host API synchronizes siblings into the modular reader; assigning
          // only globalData leaves it unaware of the other selected volumes.
          getCurrentPages().slice(-1)[0].openMaterial(files[0])
        }, splitMixedVolumes(bytes).map(part => ({ name: part.name, base64: Buffer.from(part.bytes).toString('base64') })).reverse())
      } else await mini.evaluate(({ name, base64 }) => {
        const data = wx.base64ToArrayBuffer(base64)
        const target = `${wx.env.USER_DATA_PATH}/${name}`
        wx.getFileSystemManager().writeFileSync(target, data)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: target, tempFilePath: target, size: data.byteLength })
      }, { name, base64: Buffer.from(bytes).toString('base64') })
      // A previous damaged member may still have an error card during the
      // first automation poll; the new archive is ready only after its own
      // password prompt appears.
      return wait(value => value.inspector && value.needsPassword && !value.loading, true)
    }
    const unlock = async () => {
      const page = await mini.currentPage()
      const reader = await page.$('#reader')
      assert.ok(reader, '缺少模块化阅读器组件')
      await reader.callMethod('onArchivePasswordInput', { detail: { value: fixture.password } })
      report.componentPasswordInputs++
      await reader.callMethod('unlockArchive')
      report.componentUnlockCalls++
      return wait(value => value.inspector && !value.needsPassword && !value.loading && value.entries.length === names.length)
    }

    await wait(value => value.attached, true)
    await openArchive('damaged-packed-data.7z', fixture.damaged)
    let listed = await unlock()
    assert.equal(listed.passwordVerified, true)
    assert.equal(listed.hasPassword, true)
    assert.deepEqual(listed.entries.map(entry => entry.name), names)

    let page = await mini.currentPage()
    let reader = await page.$('#reader')
    await reader.callMethod('openInspectorEntry', { detail: { index: 0 } })
    report.componentRowCalls++
    let result = await wait(value => value.inspector && !value.loading && /数据校验失败/.test(value.error), true)
    assert.equal(result.needsPassword, false)
    assert.equal(result.passwordVerified, true)
    assert.equal(result.hasPassword, true)
    assert.equal(result.entries.length, names.length)
    assert.doesNotMatch(result.error, /密码不正确/)
    page = await mini.currentPage()
    await mini.screenshot({ path: path.join(out, 'damaged-first-member.png') })
    report.renderedSnapshots++

    reader = await page.$('#reader')
    await reader.callMethod('openInspectorEntry', { detail: { index: independentIndex } })
    report.componentRowCalls++
    // The old error card can survive one protocol tick before the row handler
    // clears it. The destination identity and body are the success boundary.
    result = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === names[independentIndex], true)
    assert.equal(result.error, '')
    assert.match(result.content, independentPattern)
    if (mixed) {
      assert.equal(result.domCount, 2049)
      assert.ok(result.loadMetrics.domChunks < 10, 'live compiler must contain byte-batched renderer')
      report.independentRender = { nodes: result.domCount, chunks: result.loadMetrics.domChunks, readyMs: result.loadMetrics.readyAt - result.loadMetrics.startedAt }
    }
    await mini.screenshot({ path: path.join(out, 'independent-second-member.png') })
    report.renderedSnapshots++

    await openArchive('complete-packed-data.7z', fixture.archive)
    listed = await unlock()
    page = await mini.currentPage()
    reader = await page.$('#reader')
    await reader.callMethod('openInspectorEntry', { detail: { index: 0 } })
    report.componentRowCalls++
    result = await wait(value => !value.inspector && !value.loading && value.hasContent && value.sourceName === '000-first.html')
    assert.match(result.content, firstPattern)
    await mini.screenshot({ path: path.join(out, 'complete-first-member.png') })
    report.renderedSnapshots++

    report.sdk = await mini.evaluate(() => wx.getAppBaseInfo().SDKVersion)
    report.damagedFirst = { readableDataError: true, passwordRetained: true, directoryEntries: names.length }
    report.independentSecond = { openedBody: true, member: names[independentIndex] }
    report.completeRecovery = { openedBody: true, member: '000-first.html' }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await mini.disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
