'use strict'
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { automationPortForProject, installAutomatorVersionCompatibility } = require('./miniprogram-automator-compat')
const { samples, sourceFor } = require('../tests/helpers/svg-path-morph')
const { parseMorphPath } = require('../miniprogram/file-reader/image/svg/svg-path-morph')
const originalDir = process.argv[2]
const oracle = JSON.parse(fs.readFileSync(process.argv[3] || 'outputs/svg-path-morph/after/report.json', 'utf8'))
const output = path.resolve(process.argv[4] || '/tmp/html-reader-svg-path-morph-wechat')
const inputs = samples.filter(s => s.public).map(s => ({ name: s.name, source: sourceFor(s), public: true, times: s.times.slice(0, 3) }))
if (originalDir) for (const name of fs.readdirSync(originalDir).filter(n => n.endsWith('.svg')).sort()) inputs.push({ name, source: fs.readFileSync(path.join(originalDir, name), 'utf8'), times: [0.007, 0.013, 0.25] })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
installAutomatorVersionCompatibility()
const watchdog = setTimeout(() => { console.error('SVG morph WeChat verification exceeded 180 seconds'); process.exit(2) }, 180000)
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(process.cwd())}` })
  fs.mkdirSync(output, { recursive: true }); const results = []
  try {
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p && p.loadSample) setTimeout(() => p.loadSample(), 100) })
    for (let i = 0; i < 60; i++) { if (await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && p.selectComponent('#reader')) })) break; await delay(100) }
    for (const input of inputs) {
      await mini.evaluate(({ name, base64 }) => {
        const buffer = wx.base64ToArrayBuffer(base64), file = wx.env.USER_DATA_PATH + '/morph-' + name + '.svg'
        wx.getFileSystemManager().writeFileSync(file, buffer)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name: name + '.svg', path: file, size: buffer.byteLength })
      }, { name: input.name, base64: Buffer.from(input.source).toString('base64') })
      let ready = false
      for (let i = 0; i < 60; i++) {
        ready = await mini.evaluate(() => { const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r && r.selectComponent('#standalone-svg-player'); return !!(v && v.data.ready && v._scene && v._ctx && !r.data.isLoading) })
        if (ready) break
        await delay(100)
      }
      assert.ok(ready, input.name + ': Canvas did not mount')
      const frames = []
      for (const time of input.times) {
        const frame = await mini.evaluate(time => {
          const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r.selectComponent('#standalone-svg-player')
          v.cancel(); v.drawFrame(time)
          const overrides = v._scene.timeline.sample(time)
          const paths = v._scene.doc.elements.filter(r => r.node.name === 'animate' && r.node.attrs.attributeName === 'd').map(r => {
            const target = r.parent, override = overrides.get(target)
            return override && override.attrs.d != null ? override.attrs.d : target.node.attrs.d
          })
          const pixels = v._ctx.getImageData(0, 0, v._canvas.width, v._canvas.height).data
          let hash = 2166136261, ink = 0
          for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0; if (i % 4 === 3 && pixels[i]) ink++ }
          return { time, paths, hash, ink, width: v._canvas.width, height: v._canvas.height }
        }, time)
        assert.ok(frame.ink > 0, input.name + ': blank Canvas')
        for (let i = 0; i < frame.paths.length; i++) {
          const name = input.public ? input.name : `${input.name}/path-${i + 1}`
          const expected = oracle.results.find(r => r.name === name).frames.find(f => f.time === time)
          const nativeD = expected.nativeD.match(/^path\("([\s\S]*)"\)$/)[1]
          const a = parseMorphPath(frame.paths[i]), b = parseMorphPath(nativeD)
          assert.equal(a.length, b.length, name)
          for (let j = 0; j < a.length; j++) {
            assert.equal(a[j].type, b[j].type, name)
            a[j].args.forEach((number, k) => assert.ok(Math.abs(number - b[j].args[k]) <= 0.002, `${name} t=${time} parameter mismatch`))
          }
        }
        frames.push(frame)
      }
      if (frames[0].paths.length) assert.equal(new Set(frames.map(f => f.hash)).size, 3, input.name + ': path frames static')
      await saveSvgCanvasSnapshot(mini, path.join(output, input.name + '.png'))
      results.push({ name: input.name, public: Boolean(input.public), frames }); console.log(JSON.stringify({ name: input.name, verifiedPaths: frames[0].paths.length, hashes: frames.map(f => f.hash) }))
    }
    const system = await mini.evaluate(() => { const i = wx.getSystemInfoSync(); return { SDKVersion: i.SDKVersion, platform: i.platform } })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), scope: 'Actual WX files, deterministic Canvas frames, sampled path parameters compared with native Chrome; not physical devices or full cross-platform pixel identity', system, results }, null, 2) + '\n')
  } finally { await mini.disconnect() }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
