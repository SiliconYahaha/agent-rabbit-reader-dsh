'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility(); require('./automator-deep-query').installAutomatorQueryCompatibility()
const references = require('../tests/fixtures/text-data/references.json')
const compact = source => source.match(/"(?:\\.|[^"\\])*"|[^\s]/g).join('')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main () {
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/text-data/wechat'); fs.mkdirSync(out, { recursive: true })
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:' + compat.automationPortForProject(root) })
  const wide = 'a,b,c,d,e,f,g\n1,2,3,4,5,6,7\n'
  const large = 'BEGIN\n' + '中文 & <script>字面文本</script>\n'.repeat(16000) + 'END-MARKER'
  const samples = [
    ...references.json.map(s => ({ name: s.id + '.json', base64: Buffer.from(s.source).toString('base64'), type: 'application/octet-stream', compact: s.compact, original: s.source })),
    ...references.csv.map(s => ({ name: s.id + '.csv', base64: Buffer.from(s.source).toString('base64'), type: 'text/csv', cells: s.rows.flat(), original: s.source })),
    ...references.encoded.map(s => ({ name: s.id + (s.mime.startsWith('application/json') ? '.json' : '.csv'), base64: s.base64, type: s.mime, compact: s.compact, cells: s.rows?.flat(), original: s.text })),
    ...['js', 'xml', 'yaml', 'txt'].map(ext => ({ name: 'literal.' + ext, base64: Buffer.from('<script>window.poison=1</script>\n<meta charset="gbk">中文 & 😀').toString('base64'), type: 'text/html', original: '<script>window.poison=1</script>\n<meta charset="gbk">中文 & 😀', source: true })),
    { name: 'wide.csv', base64: Buffer.from(wide).toString('base64'), type: 'text/csv', cells: wide.trim().split('\n').flatMap(row => row.split(',')), original: wide, wide: true },
    { name: 'large.txt', base64: Buffer.from(large).toString('base64'), type: 'text/plain', original: large, source: true },
    ...references.archive.members.map(s => ({ name: s.name, base64: references.archive.base64, type: 'application/zip', archive: true, compact: s.compact, cells: s.rows?.flat(), original: s.source, source: !s.compact && !s.rows }))
  ]
  const rows = []
  try {
    await mini.reLaunch('/pages/index/index')
    const platform = await mini.evaluate(() => ({ sdk: wx.getAppBaseInfo().SDKVersion, platform: wx.getDeviceInfo().platform }))
    for (const sample of process.argv.includes('--recovery-only') ? [] : samples) {
      const started = Date.now()
      await mini.evaluate(sample => {
        const data = wx.base64ToArrayBuffer(sample.base64), filePath = wx.env.USER_DATA_PATH + '/text-data-' + sample.name
        wx.getFileSystemManager().writeFileSync(filePath, data)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: sample.archive ? 'text-data.zip' : sample.name, path: filePath, size: 1, type: sample.type })
      }, sample)
      if (sample.archive) {
        let entries
        for (let i = 0; i < 200; i++) {
          const listed = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0].selectComponent('#reader'); return { entries: p.data.inspectorEntries, ready: p.data.inspectorMode && !p.data.isLoading, error: p.data.error } })
          assert.equal(listed.error, '')
          if (listed.ready && listed.entries?.length) { entries = listed.entries; break }
          await pause(100)
        }
        assert.ok(entries, 'ZIP directory did not settle')
        const index = entries.findIndex(entry => entry.name === sample.name)
        assert.ok(index >= 0); assert.equal(entries[index].canOpen, true)
        const page = await mini.currentPage(), entriesUi = await page.$$('#reader >>> .entry-row')
        await entriesUi[index].tap()
      }
      let state
      for (let i = 0; i < 200; i++) {
        state = await mini.evaluate(() => {
          const p = getCurrentPages().slice(-1)[0].selectComponent('#reader'), d = p._htmlRuntime?.document
          return { name: p.data.sourceName, error: p.data.error, ready: !p.data.isLoading && p.data.hasContent, pre: d?.querySelector('pre')?.textContent, preNid: d?.querySelector('pre')?._nid, cells: d?.querySelectorAll('td').map(e => ({ text: e.textContent, nid: e._nid })), button: d?.getElementById('text-data-toggle')?._nid, poison: p._htmlRuntime?.window.poison, errors: p._runtimeErrors }
        })
        if (state.error || state.ready && state.name === sample.name) break
        await pause(100)
      }
      assert.equal(state.error, '', sample.name); assert.equal(state.ready, true, sample.name); assert.equal(state.poison, undefined); assert.deepEqual(state.errors, [])
      const page = await mini.currentPage()
      if (sample.cells) {
        assert.deepEqual(state.cells.map(c => c.text), sample.cells.map(c => c.replace(/\r\n?/g, '\n')))
        for (const cell of state.cells) { const node = await page.$('#reader >>> #dom-nid-' + cell.nid); assert.equal(await node.text(), cell.text) }
      } else if (sample.compact) assert.equal(compact(state.pre), sample.compact)
      else if (sample.source) assert.equal(state.pre, sample.original)
      // Verify actual WXML source text, not just the parser's private DOM.
      if (state.preNid) { const pre = await page.$('#reader >>> #dom-nid-' + state.preNid); assert.ok(pre); assert.equal(await pre.text(), state.pre) }
      if (sample.wide) {
        const scroller = await page.$('#reader >>> .dom-table-scroll')
        assert.ok(scroller); const size = await scroller.size(), width = await scroller.scrollWidth(); assert.ok(width > size.width)
        await scroller.scrollTo(width, 0); await pause(100); assert.ok(await scroller.property('scrollLeft') > 20)
        await mini.screenshot({ path: path.join(out, 'csv-scrolled.png') })
      }
      if (state.button && sample.original) {
        const button = await page.$('#reader >>> #dom-nid-' + state.button); await button.tap(); await pause(100)
        const original = await mini.evaluate(() => { const d = getCurrentPages().slice(-1)[0].selectComponent('#reader')._htmlRuntime.document, pre = d.getElementById('text-data-original').querySelector('pre'); return { text: pre.textContent, nid: pre._nid, display: d.getElementById('text-data-original').style.display } })
        assert.equal(original.display, 'block'); assert.equal(original.text, sample.original.replace(/\r\n?/g, '\n'))
        const actualOriginal = await page.$('#reader >>> #dom-nid-' + original.nid)
        assert.equal(await actualOriginal.text(), original.text); assert.ok((await actualOriginal.size()).height > 0)
        await button.tap(); await pause(100)
      }
      rows.push({ name: sample.name, archive: !!sample.archive, elapsedMs: Date.now() - started, actualWxml: true, parserPreSha256: state.pre ? crypto.createHash('sha256').update(state.pre).digest('hex') : null, cells: state.cells?.length || 0, toggle: !!state.button })
      console.log(JSON.stringify(rows[rows.length - 1]))
    }
    const recovery = []
    for (const sample of [
      { name: 'invalid-encoding.csv', base64: Buffer.from([0xff]).toString('base64'), type: 'text/csv; charset=utf-8', error: true },
      { name: 'invalid.json', base64: Buffer.from('{"x":1,}').toString('base64'), type: 'application/json', expected: '{"x":1,}' },
      { name: 'recovered.json', base64: Buffer.from('{"ok":true}').toString('base64'), type: 'application/json', compact: '{"ok":true}' }
    ]) {
      await mini.evaluate(sample => {
        const filePath = wx.env.USER_DATA_PATH + '/text-data-' + sample.name
        wx.getFileSystemManager().writeFileSync(filePath, wx.base64ToArrayBuffer(sample.base64))
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: sample.name, path: filePath, size: 1, type: sample.type })
      }, sample)
      let value
      for (let i = 0; i < 200; i++) {
        value = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0].selectComponent('#reader'), d = p._htmlRuntime?.document; return { error: p.data.error, loading: p.data.isLoading, content: p.data.hasContent, pre: d?.querySelector('pre')?.textContent, preNid: d?.querySelector('pre')?._nid, diagnostic: d?.querySelector('p')?.textContent } })
        if (!value.loading && (value.error || value.content)) break
        await pause(100)
      }
      if (sample.error) { assert.match(value.error, /字符编码不匹配/); assert.equal(value.content, false); assert.equal(value.pre, undefined) }
      else {
        assert.equal(value.error, ''); assert.equal(value.content, true)
        if (sample.expected) { assert.equal(value.pre, sample.expected); assert.match(value.diagnostic, /显示完整原文/) }
        else assert.equal(compact(value.pre), sample.compact)
        const pre = await (await mini.currentPage()).$('#reader >>> #dom-nid-' + value.preNid)
        assert.equal(await pre.text(), value.pre)
      }
      recovery.push({ name: sample.name, clearErrorOrOriginalFallback: true, actualContentVerified: !sample.error })
    }
    fs.writeFileSync(path.join(out, process.argv.includes('--recovery-only') ? 'recovery.json' : 'report.json'), JSON.stringify({ at: new Date().toISOString(), platform, environment: 'WeChat DevTools, real filesystem/read-only component/WXML taps; not physical phones or actual chat menu handoff', rows, recovery }, null, 2))
    console.log(JSON.stringify({ files: rows.length, wxml: rows.length, wideCsvScroll: true }))
  } finally { await mini.reLaunch('/pages/home/home').catch(() => {}); await mini.disconnect() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
