'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require('miniprogram-automator')
const { publicSamples } = require('../tests/helpers/svg-closepath')
const { automationPortForProject, installAutomatorVersionCompatibility } = require('./miniprogram-automator-compat')
installAutomatorVersionCompatibility()
const output = path.resolve('outputs/svg-closepath/wechat')
fs.mkdirSync(output, { recursive: true })
const deadline = setTimeout(() => { console.error('WeChat SVG verification timed out'); process.exit(1) }, 90000)
async function main () {
  const mini = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(process.cwd())}` })
  try {
    await mini.reLaunch('/pages/index/index')
    let readerReady = false
    for (let i = 0; i < 60; i++) {
      readerReady = await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#reader'))
      if (readerReady) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(readerReady, 'Reader component did not mount; simulator evidence unavailable')
    const sources = [
      { name: 'minimal', source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 2L14 2L8 14z"/></svg>' },
      ...publicSamples
    ]
    const results = []
    for (const sample of sources) {
      let baseline
      for (const corrupt of [false, true]) {
        const source = sample.source.replace(/ d="([^"]+)"/g, (_, d) => ` d="${d}${/[zZ]$/.test(d) ? '' : 'z'}${corrupt ? '1 M20 20L30 30' : ''}"`)
          .replace('</svg>', '<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>')
        const name = `${sample.name}-${corrupt ? 'corrupt' : 'valid'}.svg`
        fs.writeFileSync(path.join(output, name), source)
        assert.equal(await mini.evaluate((name, source) => getCurrentPages().slice(-1)[0].selectComponent('#reader').readSvgMaterial({ name, path: `/__generated__/${name}` }, source), name, source), true)
        let snapshot
        for (let i = 0; i < 80; i++) {
          snapshot = await mini.evaluate(({ name, source }) => {
            const reader = getCurrentPages().slice(-1)[0].selectComponent('#reader')
            const view = reader && reader.selectComponent('svg-view')
            if (!reader || reader.data.sourceName !== name || !view || !view._ctx || !view.data.ready || reader.data.isLoading || view.data.source !== source) return null
            view.cancel(); view.drawFrame(0)
            const pixels = view._ctx.getImageData(0, 0, view._canvas.width, view._canvas.height).data
            let hash = 2166136261; let ink = 0
            for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ink++
            return { name, width: view._canvas.width, height: view._canvas.height, hash, ink, error: reader.data.error, animated: !!view._scene.animated, sdk: wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : wx.getSystemInfoSync().SDKVersion }
          }, { name, source })
          if (snapshot) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert.ok(snapshot, `${name}: actual Canvas did not become ready`)
        assert.equal(snapshot.error, ''); assert.ok(snapshot.ink > 0); assert.equal(snapshot.animated, true)
        if (corrupt) {
          assert.equal(snapshot.hash, baseline.hash, `${name}: wrong visible pixels`)
          assert.equal(snapshot.ink, baseline.ink)
        } else baseline = snapshot
        results.push(snapshot)
      }
    }
    await mini.screenshot({ path: path.join(output, 'last-corrupt-file.png') })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2) + '\n')
    console.log('WeChat actual animated Canvas: 3 valid/corrupt pairs, equal pixel hashes, continued file opens passed')
  } finally { await mini.disconnect() }
}
main().then(() => clearTimeout(deadline), error => { console.error(error); clearTimeout(deadline); process.exitCode = 1 })
