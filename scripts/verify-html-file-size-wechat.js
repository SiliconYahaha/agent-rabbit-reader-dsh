'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
require('./miniprogram-automator-compat').installAutomatorVersionCompatibility()
const output = path.resolve(process.argv[2])
const port = Number(process.argv[3] || 15239)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const name = 'verify-html-size-' + crypto.randomUUID() + '.html'
const watchdog = setTimeout(() => { console.error('HTML size verification timed out'); process.exit(2) }, 180000)

async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
  const results = []
  fs.mkdirSync(output, { recursive: true })
  try {
    await mini.reLaunch('/pages/index/index')
    for (let i = 0; i < 100; i++) {
      if (await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#reader'))) break
      await pause(100)
    }
    const system = await mini.evaluate(() => { const s = wx.getSystemInfoSync(); return { SDKVersion: s.SDKVersion, platform: s.platform, version: s.version } })
    for (const count of [100000, 400000, 600000]) {
      // Exercise both early metadata thresholds with real native stat/read and
      // exact WXML text, in addition to the historical truncation regressions.
      for (const delta of [0, -46, 46, 21 * 1024 * 1024, 201 * 1024 * 1024]) {
        const expected = 'BEGIN-' + count + '中'.repeat(count) + '-END-' + count
        const size = Buffer.byteLength('<p>' + expected + '</p>')
        await mini.evaluate(({ name, count, size, delta }) => {
          const file = wx.env.USER_DATA_PATH + '/' + name
          const text = 'BEGIN-' + count + '中'.repeat(count) + '-END-' + count
          wx.getFileSystemManager().writeFileSync(file, '<p>' + text + '</p>', 'utf8')
          getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: file, size: size + delta })
        }, { name, count, size, delta })
        let state
        for (let i = 0; i < 180; i++) {
          state = await mini.evaluate(() => {
            const r = getCurrentPages().slice(-1)[0].selectComponent('#reader')
            return { loading: r.data.isLoading, error: r.data.error, domMode: r.data.domMode, roots: r.data.domTree.length, metrics: r._loadMetrics }
          })
          if (!state.loading) break
          await pause(100)
        }
        const page = await mini.currentPage()
        const node = await page.$('#reader >>> .dom-p')
        const actual = node ? await node.text() : ''
        const row = { count, size, metadataDelta: delta, ...state, actualViewFound: Boolean(node), actualViewCharacters: actual.length, actualViewHash: hash(actual), expectedHash: hash(expected), exactViewText: actual === expected }
        results.push(row)
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), scope: 'Actual native filesystem and WXML text; simulator only, not chat picker or physical devices', system, results }, null, 2) + '\n')
        console.log(JSON.stringify(row))
        assert.ok(!state.loading && !state.error && state.domMode && row.exactViewText, 'Visible text differs from source or reader failed')
      }
    }
  } finally {
    // Remove only this invocation's reproducible fixture, never user documents.
    try { await mini.evaluate(name => { const f = wx.getFileSystemManager(); const p = wx.env.USER_DATA_PATH + '/' + name; try { f.accessSync(p) } catch (_) { return }; f.unlinkSync(p) }, name) } finally { await mini.disconnect() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
