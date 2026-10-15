'use strict'

// Native WXML bridge regression: a long HTML document keeps its real text and
// button while one embedded animated SVG is replaced by its static resource.
// The unsupported-SMIL decision is forced to exercise that path deterministically;
// this does not claim that a particular phone naturally reports unsupported SMIL.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const compat = require('./miniprogram-automator-compat')
compat.installAutomatorVersionCompatibility()
require('./automator-deep-query').installAutomatorQueryCompatibility()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'outputs/smil-payload/wechat')
fs.mkdirSync(output, { recursive: true })
const deadline = setTimeout(() => { console.error('Native SMIL fallback verification exceeded 180 seconds'); process.exit(2) }, 180000)

async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${compat.automationPortForProject(root)}` })
  const rows = []
  const state = () => mini.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
    const find = (nodes, predicate) => {
      for (const node of nodes || []) {
        if (predicate(node)) return node
        const child = find(node.children, predicate)
        if (child) return child
      }
      return null
    }
    const svg = find(p.data.domTree, node => node.svgHasSmil)
    const pre = p._htmlRuntime?.document.getElementById('source')
    const button = p._htmlRuntime?.document.getElementById('action')
    return { loading: p.data.isLoading, progressive: !!p._progressiveDomRendering,
      error: p.data.error, file: p.data.sourceName, svg: svg && { nid: svg.nid, src: svg.attrs.src, fallback: svg.svgFallbackSrc, token: svg.mediaToken },
      pre: pre && { nid: pre._nid, length: pre.textContent.length }, button: button && { nid: button._nid, text: button.textContent },
      patches: p._smilNativePatches || [], support: p._smilSupport,
      queuedTrigger: p._smilQueuedTriggerSnapshot || null }
  })
  const settled = async predicate => {
    for (let i = 0; i < 400; i++) {
      const value = await state()
      if (value.error) throw Error(value.error)
      if (!value.loading && !value.progressive && predicate(value)) return value
      await pause(50)
    }
    throw Error('Native HTML/WXML did not settle')
  }
  try {
    await mini.reLaunch('/pages/index/index')
    for (let i = 0; i < 80; i++) {
      if (await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#reader'))) break
      await pause(50)
    }
    const body = '正文中文😀\n'.repeat(80000)
    await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      const native = p.setData
      p._smilNativePatches = []
      p._smilNativePhase = 'initial'
      p.setData = function (patch, callback) {
        const bytes = new TextEncoder().encode(JSON.stringify(patch)).byteLength
        p._smilNativePatches.push({ phase: p._smilNativePhase, bytes, root: Object.hasOwn(patch, 'domTree'), keys: Object.keys(patch) })
        return native.call(this, patch, callback)
      }
      p._smilSupport = 'supported' // prevent an automatic timeout racing the controlled fallback
      const text = '正文中文😀\n'.repeat(80000)
      const html = '<svg width="96" height="96"><circle cx="48" cy="48" r="36" fill="#ef4444"><animate attributeName="r" values="24;36;24" dur="1s" repeatCount="indefinite"/></circle></svg><button id="action">继续</button><pre id="source">'+text+'</pre><script>document.getElementById("action").onclick=function(){this.textContent="已点击"}</script>'
      p.openSelectedFile({ name: 'smil-long.html', inlineHtml: html })
    })
    let before = await settled(value => value.file === 'smil-long.html' && value.svg && value.pre && value.button)
    const page = await mini.currentPage()
    const pre = await page.$('#reader >>> #dom-nid-' + before.pre.nid)
    assert.equal(await pre.text(), body)
    assert.notEqual(before.svg.src, before.svg.fallback)
    const initialToken = before.svg.token
    await mini.evaluate(({ nid, mediaToken }) => {
      const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      p._smilNativePhase = 'fallback'
      p.onDomMediaError({ currentTarget: { dataset: { nid, mediaToken } }, detail: { errMsg: 'controlled animated SVG decode failure' } })
    }, { nid: before.svg.nid, mediaToken: before.svg.token })
    const after = await settled(value => value.svg && value.svg.src === value.svg.fallback && value.support === 'unsupported')
    const image = await page.$('#reader >>> #dom-nid-' + after.svg.nid)
    assert.equal(await image.attribute('src'), after.svg.fallback)
    assert.ok((await image.size()).height > 0)
    assert.equal(await pre.text(), body)
    assert.equal(after.svg.nid, before.svg.nid)
    assert.notEqual(after.svg.token, initialToken)
    const fallbackPatches = after.patches.filter(row => row.phase === 'fallback')
    assert.ok(fallbackPatches.length)
    assert.ok(fallbackPatches.every(row => !row.root && row.bytes <= 160 * 1024), JSON.stringify(fallbackPatches))
    await mini.screenshot({ path: path.join(output, 'native-fallback.png') })
    const button = await page.$('#reader >>> #dom-nid-' + after.button.nid)
    await button.tap()
    let clicked
    for (let i = 0; i < 100; i++) {
      clicked = await state()
      if (clicked.button?.text === '已点击' && !clicked.progressive) break
      await pause(50)
    }
    assert.equal(await button.text(), '已点击')
    assert.equal(await pre.text(), body)
    rows.push({ kind: 'smil-long', textSha256: sha(body), textLength: body.length, actualWxmlText: true,
      actualWxmlImage: true, actualWxmlTap: true, fallbackPatchMax: Math.max(...fallbackPatches.map(row => row.bytes)),
      fallbackOnlyImagePatch: true, lateSourceTokenChanged: after.svg.token !== initialToken })

    await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      p._smilNativePhase = 'static'
      p.openSelectedFile({ name: 'static.html', inlineHtml: '<svg width="96" height="96"><circle cx="48" cy="48" r="36" fill="#22c55e"/></svg><p id="body">新文件正文</p><button id="action">再点</button><script>document.getElementById("action").onclick=function(){this.textContent="仍可操作"}</script>' })
    })
    const fresh = await settled(value => value.file === 'static.html' && value.button)
    const staticText = await page.$('#reader >>> #dom-nid-' + fresh.button.nid)
    assert.equal(await staticText.text(), '再点')
    const late = await mini.evaluate(({ nid, token }) => {
      const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      const start = p._smilNativePatches.length
      p.onDomMediaError({ currentTarget: { dataset: { nid, mediaToken: token } }, detail: { errMsg: 'late old image event' } })
      p.onDomMediaLoad({ currentTarget: { dataset: { nid, mediaToken: token } }, detail: {} })
      return { name: p.data.sourceName, body: p._htmlRuntime.document.getElementById('body').textContent,
        support: p._smilSupport, patches: p._smilNativePatches.length - start }
    }, { nid: before.svg.nid, token: initialToken })
    assert.deepEqual(late, { name: 'static.html', body: '新文件正文', support: 'unsupported', patches: 0 })
    await staticText.tap()
    for (let i = 0; i < 100; i++) {
      if ((await state()).button?.text === '仍可操作') break
      await pause(50)
    }
    assert.equal(await staticText.text(), '仍可操作')
    rows.push({ kind: 'late-old-media-events', newFileContent: late.body, ignoredOldLoadAndError: true, nextFileTap: true })

    const queuedText = '队列正文😀\n'.repeat(60000)
    await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0].selectComponent('#reader')
      p._smilNativePhase = 'queued'
      p._smilSupport = 'supported'
      const originalPresent = p.presentRenderedDom
      p.presentRenderedDom = function (...args) {
        const result = originalPresent.apply(this, args)
        if (!this._smilQueuedTriggered && this._progressiveDomRendering && this._htmlRuntime) {
          this._smilQueuedTriggered = true
          this.rememberSmilSupport('unsupported')
          this.downgradeSmilImages()
          this._smilQueuedTriggerSnapshot = { hasRuntime: !!this._htmlRuntime,
            inProgress: !!this._progressiveDomRendering, pending: !!this._pendingDomRender }
        }
        return result
      }
      const text = '队列正文😀\n'.repeat(60000)
      p.openSelectedFile({ name: 'queued.html', inlineHtml: '<svg width="48" height="48"><circle cx="24" cy="24" r="16" fill="#22c55e"><animate attributeName="r" values="10;16;10" dur="1s" repeatCount="indefinite"/></circle></svg><pre id="source">'+text+'</pre>' })
    })
    const queued = await settled(value => value.file === 'queued.html' && value.svg && value.pre && value.svg.src === value.svg.fallback && value.queuedTrigger)
    const queuedAtTrigger = queued.queuedTrigger
    assert.deepEqual(queuedAtTrigger, { hasRuntime: true, inProgress: true, pending: true })
    const queuedPre = await page.$('#reader >>> #dom-nid-' + queued.pre.nid)
    assert.equal(await queuedPre.text(), queuedText)
    const queuedImage = await page.$('#reader >>> #dom-nid-' + queued.svg.nid)
    assert.equal(await queuedImage.attribute('src'), queued.svg.fallback)
    assert.ok((await queuedImage.size()).height > 0)
    const queuedPatches = queued.patches.filter(row => row.phase === 'queued')
    assert.ok(queuedPatches.some(row => row.keys.some(key => key.endsWith('.attrs.src'))), JSON.stringify(queuedPatches))
    assert.ok(queuedPatches.every(row => row.bytes <= 160 * 1024), JSON.stringify(queuedPatches))
    rows.push({ kind: 'downgrade-during-progressive-load', queuedAtTrigger, actualWxmlTextSha256: sha(queuedText),
      actualWxmlImage: true, maximumPatch: Math.max(...queuedPatches.map(row => row.bytes)) })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'WeChat DevTools actual WXML and native setData; controlled unsupported-SMIL transition, not physical phone or natural platform detection', rows }, null, 2) + '\n')
    console.log(JSON.stringify({ cases: rows.length, maxFallbackPatch: rows[0].fallbackPatchMax, actualWxmlText: true, actualWxmlTap: true }))
  } finally {
    fs.writeFileSync(path.join(output, 'partial.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2) + '\n')
    await mini.reLaunch('/pages/home/home').catch(() => {})
    await mini.disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(deadline))
