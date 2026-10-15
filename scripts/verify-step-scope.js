'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert/strict')
const { readerPage } = require('../tests/helpers/reader-host')
const original = require('../tests/fixtures/step-scope/originals.json')
const output = path.resolve(process.argv[2] || 'outputs/step-scope/verified')
fs.mkdirSync(output, { recursive: true })
const { chromium } = require(process.env.HTML_READER_PLAYWRIGHT)
async function main () {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  let bytes, operations = [], callback
  const methods = new Set(['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText', 'closePath'])
  const context = new Proxy({}, { get: (o, k) => methods.has(k) ? (...args) => operations.push(['call', k, args]) : o[k], set: (o, k, v) => { o[k] = v; operations.push(['set', k, v]); return true } })
  const canvas = { width: 0, height: 0, getContext: () => context }
  const host = readerPage({ getWindowInfo: () => ({ pixelRatio: 2 }), getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }), createSelectorQuery: () => ({ in () { return this }, select: () => ({ fields: (o, fn) => { callback = fn } }), exec: () => callback({ node: canvas, width: 360, height: 260 }) }) })
  const rows = [], control = new Map()
  try {
    for (const c of original.rows) {
      bytes = Buffer.from(c.source)
      host.openSelectedFile({ name: c.name + '.step', path: '/local/' + c.name + '.step', size: bytes.length })
      await new Promise(resolve => setTimeout(resolve, 15))
      const row = { name: c.name, sha256: c.sha256, nativeAccepted: !c.native.error, error: host.data.error, model: structuredClone(host._inspectorModel), views: [] }
      for (const state of ['isometric', 'drag', 'top']) {
        operations = []
        if (state === 'drag') { host.onStepModelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] }); host.onStepModelTouchMove({ touches: [{ clientX: 155, clientY: 125 }] }); host.onStepModelTouchEnd() }
        else host.setStepModelView({ currentTarget: { dataset: { view: state } } })
        assert.ok(operations.length)
        await page.setContent('<canvas style="width:360px;height:260px"></canvas>')
        const encoded = await page.locator('canvas').evaluate((canvas, args) => { canvas.width = args.width; canvas.height = args.height; const ctx = canvas.getContext('2d'); for (const [kind, name, value] of args.operations) { if (kind === 'call') ctx[name](...value); else ctx[name] = value } return canvas.toDataURL().split(',')[1] }, { width: canvas.width, height: canvas.height, operations })
        const hash = crypto.createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex')
        if (c.name === 'control') control.set(state, hash)
        row.views.push({ state, pngSha256: hash, matchesControl: hash === control.get(state), operations: operations.length, ready: host.data.inspectorModelReady, revision: host.data.inspectorModelRevision })
        if (state === 'isometric' && ['control', 'comment-phantom-point', 'name-reference'].includes(c.name)) await page.screenshot({ path: path.join(output, c.name + '-candidate.png') })
      }
      assert.deepEqual(row.model, {kind:'step-wireframe',points:[[0,0,0],[10,0,0]],edges:[[0,1]],faces:[]}, c.name); assert.ok(row.views.every(v=>v.matchesControl), c.name); rows.push(row)
    }
    const report = { schemaVersion: 1, testedAt: new Date().toISOString(), version: require('../package.json').version, oracle: original.oracle, chrome: await browser.version(), rows, summary: { originalFiles: rows.length, actualHostOpens: rows.length, chromeCanvasViews: rows.length * 3, nativeAcceptedFiles: rows.filter(r => r.nativeAccepted).length, nativeAcceptedWrongModels: rows.filter(r => r.nativeAccepted && JSON.stringify(r.model) !== JSON.stringify(rows[0].model)).length, nativeAcceptedWrongCanvasViews: rows.filter(r => r.nativeAccepted).flatMap(r => r.views).filter(v => !v.matchesControl).length }, limits: original.limits.concat(['Actual host Canvas commands replayed in Chrome; no WeChat WXML or physical devices.', 'Pixel identity compares equivalent original graphs; steputils is a lexical record oracle, not independent CAD rasterizer.']) }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(report.summary)
  } finally { host.detached(); await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
