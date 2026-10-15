'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { automationPortForProject, installAutomatorVersionCompatibility } = require('./miniprogram-automator-compat')
const { saveSvgCanvasSnapshot } = require('./svg-wechat-snapshot')
const { cases } = require('../tests/helpers/svg-container-bounds')
const output = path.resolve(process.argv[2] || '/tmp/html-reader-svg-container-bounds-wechat')
const chrome = JSON.parse(fs.readFileSync(process.argv[3] || 'outputs/svg-container-bounds/report.json', 'utf8'))
const inputs = cases.filter((c, i) => i < 2 || i >= 32).map(c => ({ ...c, bounds: chrome.results.find(r => r.name === c.name).variants[0].bounds, source: c.source.replace('</svg>', '<animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite"/></svg>') }))
installAutomatorVersionCompatibility()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const watchdog = setTimeout(() => { console.error('WeChat bounds verification exceeded 180 seconds'); process.exit(2) }, 180000)
async function main () {
  const mini = await require('miniprogram-automator').connect({ wsEndpoint: `ws://127.0.0.1:${automationPortForProject(process.cwd())}` })
  fs.mkdirSync(output, { recursive: true })
  const results = []
  try {
    await mini.reLaunch('/pages/home/home')
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p && p.loadSample) setTimeout(() => p.loadSample(), 100) })
    for (let i = 0; i < 60; i++) { if (await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#reader'))) break; await delay(100) }
    for (const input of (process.argv.includes('--wpt-only') ? inputs.filter(c => c.name.endsWith('.svg')) : inputs)) {
      const name = input.name + '-bounds.svg'
      await mini.evaluate(({ name, base64 }) => {
        const bytes = wx.base64ToArrayBuffer(base64), file = wx.env.USER_DATA_PATH + '/' + name
        wx.getFileSystemManager().writeFileSync(file, bytes)
        getCurrentPages().slice(-1)[0].selectComponent('#reader').openSelectedFile({ name, path: file, size: bytes.byteLength })
      }, { name, base64: Buffer.from(input.source).toString('base64') })
      let result
      for (let i = 0; i < 80; i++) {
        result = await mini.evaluate(({ name, input }) => {
          const r = getCurrentPages().slice(-1)[0].selectComponent('#reader'), v = r && r.selectComponent('#standalone-svg-player')
          if (!v || !v.data.ready || !v._ctx || r.data.isLoading || r.data.sourceName !== name || v.data.source !== input.source) return null
          v.cancel(); v.drawFrame(0)
          const ctx = v._ctx, width = v._canvas.width, height = v._canvas.height
          const actual = new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data)
          const bbox = input.oracle ? v._scene.renderer.getBounds(v._scene.doc.byId[input.oracle.measureId]) : null
          ctx.save()
          try {
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height); ctx.scale(width / 256, height / 256)
            if (input.oracle) {
              const o = input.oracle, b = input.bounds
              ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 256, 256)
              if (o.matrix) ctx.transform(...o.matrix)
              ctx.beginPath(); ctx.rect(b.x + b.width * o.clip[0], b.y + b.height * o.clip[1], b.width * o.clip[2], b.height * o.clip[3]); ctx.clip()
              for (const p of o.paints) {
                ctx.save(); if (p.matrix) ctx.transform(...p.matrix)
                if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width; ctx.stroke(v._canvas.createPath2D(p.d)) } else { ctx.fillStyle = p.fill || 'green'; ctx.fill(v._canvas.createPath2D(p.d)) }
                ctx.restore()
              }
            } else {
              const units = input.name.includes('objectboundingbox-002') ? 400 : 200
              // Match the viewport's single division; two successive scales round differently at half-pixel edges.
              ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(width / units, height / units); ctx.fillStyle = 'green'
              if (input.name.includes('objectboundingbox-003')) { ctx.beginPath(); ctx.ellipse(50, 50, 50, 50, 0, 0, 2 * Math.PI); ctx.clip(); ctx.fillRect(0, 0, 200, 200) }
              else if (input.name.includes('content-clip')) ctx.fillRect(0, 0, 100, 100)
              else ctx.fill(v._canvas.createPath2D('M50 50H150V150H50Z'))
            }
            const expected = ctx.getImageData(0, 0, width, height).data
            const differences = []
            let rgbaError = 0, maxChannelError = 0, ink = 0
            for (let j = 0; j < actual.length; j++) { const d = Math.abs(actual[j] - expected[j]); rgbaError += d; maxChannelError = Math.max(maxChannelError, d); if (d && differences.length < 8) differences.push({x: Math.floor(j / 4) % width, y: Math.floor(j / 4 / width), channel: j % 4, actual: actual[j], expected: expected[j]}); if (j % 4 === 3 && actual[j]) ink++ }
            return { rgbaError, maxChannelError, differences, ink, width, height, bbox, boundsError: bbox ? Math.max(...Object.keys(bbox).map(k => Math.abs(bbox[k] - input.bounds[k]))) : null, error: r.data.error, animated: v._scene.animated }
          } finally { ctx.restore(); v.drawFrame(0) }
        }, { name, input })
        if (result) break
        await delay(100)
      }
      assert.ok(result, name + ': Canvas not ready')
      assert.equal(result.error, ''); assert.ok(result.ink > 0); assert.equal(result.animated, true)
      if (!process.argv.includes('--discover')) assert.equal(result.rgbaError, 0, name + ': independent Canvas reference mismatch')
      assert.ok(result.boundsError == null || result.boundsError < 1e-4, name + ': Chrome DOM bounds mismatch')
      if (input.name.endsWith('.svg')) await saveSvgCanvasSnapshot(mini, path.join(output, input.name + '.png'))
      results.push({ name: input.name, ...result }); console.log(JSON.stringify(results.at(-1)))
    }
    const system = await mini.evaluate(() => { const i = wx.getSystemInfoSync(); return { platform: i.platform, SDKVersion: i.SDKVersion, version: i.version } })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ testedAt: new Date().toISOString(), scope: 'Actual reader file import and Canvas pixels; independent Canvas geometry plus Chrome DOM getBBox; DevTools only, not physical devices.', system, results }, null, 2) + '\n')
  } finally { await mini.disconnect() }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
