'use strict'

// Run the actual file-open Page against a real, asynchronous local filesystem.
// Optional --repo permits the same input and harness to reproduce an old build.
// This checks the bridge contract, NOT WeChat WXML, native decoding or a phone.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

async function verifyFileRoute ({ sourcePath, repo = path.resolve(__dirname, '..'), output, width = 390, height = 844, expectFailure = false }) {
  const bytes = await fs.readFile(sourcePath)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-interactive-poster-assets-'))
  const owned = new Set(), pending = new Set(), writes = [], patches = [], bridgeErrors = []
  const digest = data => crypto.createHash('sha256').update(data).digest('hex')
  let definition, page
  const saved = { Page: global.Page, Component: global.Component, wx: global.wx, getApp: global.getApp }
  const tracked = task => {
    pending.add(task)
    task.finally(() => pending.delete(task)).catch(error => bridgeErrors.push(error.message))
  }
  const fileSystem = {
    readFile (options) {
      tracked(fs.readFile(options.filePath).then(data => {
        const start = options.position || 0
        const slice = data.subarray(start, options.length == null ? data.length : start + options.length)
        options.success({ data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) })
      }, error => options.fail?.({ errMsg: error.message })))
    },
    writeFile (options) {
      assert.equal(path.dirname(options.filePath), root)
      // Never expose a reference before the complete byte stream is on disk.
      tracked(new Promise(resolve => setTimeout(resolve, 20)).then(async () => {
        const data = typeof options.data === 'string' ? Buffer.from(options.data, options.encoding) : Buffer.from(options.data)
        await fs.writeFile(options.filePath, data, { flag: 'wx' })
        owned.add(options.filePath)
        const readback = await fs.readFile(options.filePath)
        assert.equal(digest(readback), digest(data))
        writes.push({ bytes: data.length, sha256: digest(data) })
        options.success()
      }).catch(error => options.fail?.({ errMsg: error.message })))
    },
    unlink (options) {
      assert.equal(path.dirname(options.filePath), root)
      tracked(fs.unlink(options.filePath).then(() => { owned.delete(options.filePath); options.success?.() }, error => options.fail?.({ errMsg: error.message })))
    }
  }
  global.Page = value => { definition = value }
  global.Component = value => { definition = { ...value.methods, data: value.data, onUnload () { value.lifetimes.detached.call(this) } } }
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    env: { USER_DATA_PATH: root },
    getWindowInfo: () => ({ windowWidth: width, windowHeight: height, pixelRatio: 1 }),
    getFileSystemManager: () => fileSystem,
    setNavigationBarTitle () {}, pageScrollTo () {},
    nextTick: callback => setTimeout(callback, 5)
  }
  const target = require.resolve(path.join(repo, 'miniprogram/file-reader/engine/components/reader/reader.js'))
  delete require.cache[target]
  require(target)
  try {
    page = {
      ...definition, data: structuredClone(definition.data),
      setData (patch, callback) {
        const serialized = JSON.stringify(patch)
        patches.push(Buffer.byteLength(serialized))
        // Snapshot exactly what crosses the bridge; do not retain object aliases.
        const snapshot = JSON.parse(serialized)
        for (const [key, value] of Object.entries(snapshot)) {
          const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
          let destination = this.data
          for (const part of parts.slice(0, -1)) destination = destination[part]
          destination[parts.at(-1)] = value
        }
        for (const reference of serialized.matchAll(/reader-inline-[^"\\)\s]+\.(?:png|jpg|gif|webp|avif)/g)) {
          if (!owned.has(path.join(root, reference[0]))) bridgeErrors.push('View referenced an incomplete or missing image')
        }
        if (callback) setTimeout(callback, 5)
      }
    }
    page.openSelectedFile({ name: path.basename(sourcePath), path: sourcePath, size: bytes.length })
    const startedAt = Date.now()
    while (Date.now() - startedAt < 15000 && (page.data.isLoading || pending.size || !page.data.hasContent && !page.data.error)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    const runtime = page._htmlRuntime
    const modal = runtime?.document.querySelector('[data-export-modal]')
    const flatten = nodes => (nodes || []).flatMap(node => [node, ...flatten(node.children)])
    const visibleModal = modal && flatten(page.data.domTree).find(node => node.nid === modal._nid)
    const report = {
      checkedAt: new Date().toISOString(), version: require(path.join(repo, 'package.json')).version,
      sourceBytes: bytes.length, sourceSha256: digest(bytes), viewport: { width, height },
      error: page.data.error, domMode: page.data.domMode, hasContent: page.data.hasContent,
      loading: page.data.isLoading, elapsedMs: Date.now() - startedAt,
      viewBytes: Buffer.byteLength(JSON.stringify({ domTree: page.data.domTree, domStyles: page.data.domStyles })),
      maxPatchBytes: Math.max(...patches), writes,
      scriptErrors: (runtime?.errors || []).map(error => ({ phase: error.phase, message: error.message })),
      bridgeErrors, modalInitiallyHidden: !!modal?.hidden && (!visibleModal || /display:none/.test(page.data.domStyles[visibleModal.styleId] || '')),
      controls: [], wechat: 'not verified; Node Page with asynchronous filesystem, not a WeChat simulator'
    }
    if (!expectFailure) {
      assert.equal(report.error, '')
      assert.equal(report.domMode, true)
      assert.equal(report.loading, false)
      assert.deepEqual(report.scriptErrors, [])
      assert.deepEqual(bridgeErrors, [])
      assert.equal(report.modalInitiallyHidden, true)
      assert.ok(report.maxPatchBytes < 160 * 1024)
      assert.ok(writes.length > 0)
      for (const level of [5, 4, 3, 2, 1]) {
        const button = runtime.document.querySelector(`.scene-hotspot[data-level="${level}"]`)
        assert.ok(button)
        page.onDomTap({ currentTarget: { dataset: { nid: button._nid } } })
        runtime.flush(true)
        await new Promise(resolve => setTimeout(resolve, 80))
        assert.equal(Number(runtime.document.querySelector('[data-dashboard-app]').dataset.level), level)
        assert.equal(page.data.error, '')
        const readout = runtime.document.querySelector('[data-current-readout]')
        const nodes = flatten(page.data.domTree)
        const visibleReadout = nodes.find(node => node.nid === readout._nid)
        assert.ok(visibleReadout, 'updated readout must reach the view, not only the script DOM')
        assert.equal(flatten(visibleReadout.children).filter(node => node.type === 'text').map(node => node.text).join(''), readout.textContent)
        for (const image of nodes.filter(node => node.name === 'img' && node.attrs.src?.startsWith(root))) {
          const author = runtime.document.querySelectorAll('img').find(node => node._nid === image.nid)
          assert.ok(author)
          assert.match(author.src, /^data:image\/[^;]+;base64,/)
          assert.equal(digest(await fs.readFile(image.attrs.src)), digest(Buffer.from(author.src.slice(author.src.indexOf(',') + 1), 'base64')))
        }
        report.controls.push({ level, text: readout.textContent, viewTextAndImageBytesMatch: true })
      }
      report.maxPatchBytes = Math.max(...patches)
      assert.ok(report.maxPatchBytes < 160 * 1024, 'interactive updates must also stay within the bridge budget')
    } else assert.match(report.error, /排版数据仍有 .*安全上限/)
    page.onUnload()
    await new Promise(resolve => setTimeout(resolve, 25))
    await Promise.all([...pending])
    report.filesRemainingAfterClose = (await fs.readdir(root)).length
    assert.equal(report.filesRemainingAfterClose, 0)
    assert.deepEqual(bridgeErrors, [])
    if (output) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
    return report
  } finally {
    page?.onUnload()
    await new Promise(resolve => setTimeout(resolve, 25))
    await Promise.all([...pending])
    // Leave the exact temporary directory in place for inspection if not empty.
    if ((await fs.readdir(root)).length === 0) await fs.rmdir(root)
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete global[name]
      else global[name] = value
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  if (!args[0] || args[0].startsWith('--')) throw Error('Usage: node scripts/verify-interactive-poster-file-route.js ORIGINAL.html [--repo REPO] [--output REPORT.json] [--expect-failure]')
  verifyFileRoute({ sourcePath: path.resolve(args[0]), repo: option('--repo'), output: option('--output'), width: Number(option('--width') || 390), height: Number(option('--height') || 844), expectFailure: args.includes('--expect-failure') })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1 })
}
module.exports = { verifyFileRoute }
